/**
 * transactions.js
 * Domain constants, formatting utilities, validation, filtering/sorting,
 * and UI rendering for Add/Edit Transaction & Transaction History views.
 */

export const CATEGORIES = {
  expense: [
    'Food',
    'Housing',
    'Transport',
    'Utilities',
    'Healthcare',
    'Entertainment',
    'Shopping',
    'Education',
    'Other',
  ],
  income: ['Salary', 'Freelance', 'Investments', 'Bonus', 'Gift', 'Other'],
};

export const ALL_CATEGORIES = Array.from(
  new Set([...CATEGORIES.expense, ...CATEGORIES.income])
);

export const CATEGORY_COLORS = {
  Food: '#0f172a',
  Housing: '#2563eb',
  Transport: '#0891b2',
  Utilities: '#64748b',
  Healthcare: '#059669',
  Entertainment: '#7c3aed',
  Shopping: '#d97706',
  Education: '#4f46e5',
  Salary: '#16a34a',
  Freelance: '#0d9488',
  Investments: '#0284c7',
  Bonus: '#65a30d',
  Gift: '#9333ea',
  Other: '#94a3b8',
};

/**
 * Escapes HTML special characters to prevent XSS in template rendering.
 * @param {string} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Formats a numeric value as USD currency.
 * @param {number} amount
 * @param {{ signed?: boolean }} options
 * @returns {string}
 */
export function formatCurrency(amount, options = {}) {
  const num = Number(amount) || 0;
  const absFormatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(num));

  if (options.signed) {
    if (num > 0) return `+${absFormatted}`;
    if (num < 0) return `-${absFormatted}`;
  }
  return num < 0 ? `-${absFormatted}` : absFormatted;
}

/**
 * Formats YYYY-MM-DD into a compact readable date (e.g., Nov 13, 2026).
 * @param {string} isoDate
 * @returns {string}
 */
export function formatDate(isoDate) {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate || '';
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(dt);
}

/**
 * Formats YYYY-MM into Month Year (e.g., Nov 2026).
 * @param {string} monthKey
 * @param {'short'|'long'} monthStyle
 * @returns {string}
 */
export function formatMonthLabel(monthKey, monthStyle = 'short') {
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return monthKey || '';
  const [y, m] = monthKey.split('-').map(Number);
  const dt = new Date(y, m - 1, 1);
  return new Intl.DateTimeFormat('en-US', {
    month: monthStyle,
    year: 'numeric',
  }).format(dt);
}

/**
 * Returns today's date in YYYY-MM-DD local format.
 * @returns {string}
 */
export function getTodayDateKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns current month in YYYY-MM local format.
 * @returns {string}
 */
export function getCurrentMonthKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Re-renders Lucide icon placeholders inside the DOM.
 */
export function refreshIcons() {
  if (typeof window !== 'undefined' && window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

/**
 * Validates transaction form input.
 * @param {object} data
 * @returns {{ valid: boolean, errors: Record<string, string>, normalized?: object }}
 */
export function validateTransactionInput(data) {
  const errors = {};
  const type = data.type === 'income' ? 'income' : data.type === 'expense' ? 'expense' : '';
  const title = String(data.title || '').trim();
  const amount = Number(data.amount);
  const category = String(data.category || '').trim();
  const date = String(data.date || '').trim();
  const description = String(data.description || '').trim();

  if (!type) {
    errors.type = 'Select income or expense.';
  }

  if (!title) {
    errors.title = 'Enter a transaction title.';
  } else if (title.length < 2) {
    errors.title = 'Title must be at least 2 characters.';
  } else if (title.length > 80) {
    errors.title = 'Title must be 80 characters or fewer.';
  }

  if (data.amount === '' || data.amount === null || data.amount === undefined) {
    errors.amount = 'Enter an amount.';
  } else if (!Number.isFinite(amount) || amount <= 0) {
    errors.amount = 'Amount must be greater than 0.';
  } else if (amount > 100000000) {
    errors.amount = 'Amount exceeds maximum limit.';
  }

  if (!category) {
    errors.category = 'Select a category.';
  }

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    errors.date = 'Select a valid date.';
  }

  if (description.length > 240) {
    errors.description = 'Description must be 240 characters or fewer.';
  }

  const valid = Object.keys(errors).length === 0;
  return {
    valid,
    errors,
    normalized: valid
      ? {
          type,
          title,
          amount: Math.round(amount * 100) / 100,
          category,
          date,
          description,
        }
      : undefined,
  };
}

/**
 * Pure filtering and sorting query over a transactions array.
 * @param {Array<object>} transactions
 * @param {{ search?: string, category?: string, type?: string, sortBy?: string }} filters
 * @returns {Array<object>}
 */
export function queryTransactions(transactions, filters = {}) {
  const search = String(filters.search || '').trim().toLowerCase();
  const category = filters.category || 'all';
  const type = filters.type || 'all';
  const sortBy = filters.sortBy || 'date-desc';

  const filtered = (transactions || []).filter((tx) => {
    if (type !== 'all' && tx.type !== type) return false;
    if (category !== 'all' && tx.category !== category) return false;

    if (search) {
      const haystack = `${tx.title} ${tx.description} ${tx.category} ${tx.amount}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }

    return true;
  });

  return filtered.sort((a, b) => {
    switch (sortBy) {
      case 'date-asc':
        return a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
      case 'amount-desc':
        return b.amount - a.amount || b.date.localeCompare(a.date);
      case 'amount-asc':
        return a.amount - b.amount || b.date.localeCompare(a.date);
      case 'date-desc':
      default:
        return b.date.localeCompare(a.date) || b.id.localeCompare(a.id);
    }
  });
}

/**
 * Builds HTML markup for the Add / Edit transaction form.
 * @param {{ mode: 'add'|'edit', initialData?: object, formId: string, showCancel?: boolean }} config
 * @returns {string}
 */
export function buildTransactionFormMarkup({ mode, initialData = {}, formId, showCancel = false }) {
  const type = initialData.type === 'income' ? 'income' : 'expense';
  const categoryList = CATEGORIES[type];
  const selectedCategory = categoryList.includes(initialData.category)
    ? initialData.category
    : categoryList[0];
  const dateValue = initialData.date || getTodayDateKey();
  const amountValue =
    initialData.amount !== undefined && initialData.amount !== null ? String(initialData.amount) : '';

  return `
    <form id="${escapeHtml(formId)}" class="tx-form" novalidate>
      <div class="form-field">
        <span class="form-label">Transaction Type</span>
        <div class="segmented" role="group" aria-label="Transaction Type">
          <button
            type="button"
            class="segmented-btn ${type === 'expense' ? 'is-active' : ''}"
            data-tx-type="expense"
          >
            Expense
          </button>
          <button
            type="button"
            class="segmented-btn ${type === 'income' ? 'is-active' : ''}"
            data-tx-type="income"
          >
            Income
          </button>
        </div>
        <input type="hidden" name="type" value="${escapeHtml(type)}" />
        <span class="field-error" data-error-for="type"></span>
      </div>

      <div class="form-grid-2">
        <div class="form-field">
          <label class="form-label" for="${escapeHtml(formId)}-title">Title</label>
          <input
            id="${escapeHtml(formId)}-title"
            name="title"
            type="text"
            class="input"
            placeholder="${type === 'income' ? 'e.g., Monthly Salary' : 'e.g., Grocery Shopping'}"
            value="${escapeHtml(initialData.title || '')}"
            maxlength="80"
            required
          />
          <span class="field-error" data-error-for="title"></span>
        </div>

        <div class="form-field">
          <label class="form-label" for="${escapeHtml(formId)}-amount">Amount (USD)</label>
          <input
            id="${escapeHtml(formId)}-amount"
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            class="input num"
            placeholder="0.00"
            value="${escapeHtml(amountValue)}"
            required
          />
          <span class="field-error" data-error-for="amount"></span>
        </div>
      </div>

      <div class="form-grid-2">
        <div class="form-field">
          <label class="form-label" for="${escapeHtml(formId)}-category">Category</label>
          <select id="${escapeHtml(formId)}-category" name="category" class="select" required>
            ${categoryList
              .map(
                (cat) =>
                  `<option value="${escapeHtml(cat)}" ${
                    cat === selectedCategory ? 'selected' : ''
                  }>${escapeHtml(cat)}</option>`
              )
              .join('')}
          </select>
          <span class="field-error" data-error-for="category"></span>
        </div>

        <div class="form-field">
          <label class="form-label" for="${escapeHtml(formId)}-date">Date</label>
          <input
            id="${escapeHtml(formId)}-date"
            name="date"
            type="date"
            class="input num"
            value="${escapeHtml(dateValue)}"
            required
          />
          <span class="field-error" data-error-for="date"></span>
        </div>
      </div>

      <div class="form-field">
        <label class="form-label" for="${escapeHtml(formId)}-description">Description (Optional)</label>
        <textarea
          id="${escapeHtml(formId)}-description"
          name="description"
          class="textarea"
          placeholder="Add notes or context for this entry..."
          maxlength="240"
        >${escapeHtml(initialData.description || '')}</textarea>
        <span class="field-error" data-error-for="description"></span>
      </div>

      <div class="form-actions">
        ${
          showCancel
            ? '<button type="button" class="btn btn-secondary" data-form-cancel>Cancel</button>'
            : '<button type="reset" class="btn btn-secondary">Clear Form</button>'
        }
        <button type="submit" class="btn btn-primary">
          <i data-lucide="${mode === 'edit' ? 'check' : 'plus'}"></i>
          <span>${mode === 'edit' ? 'Save Changes' : 'Save Transaction'}</span>
        </button>
      </div>
    </form>
  `;
}

/**
 * Binds validation, dynamic category switching, and submit behavior to a transaction form.
 * @param {HTMLFormElement} formEl
 * @param {{ onSubmit: Function, onCancel?: Function }} handlers
 */
export function bindTransactionForm(formEl, { onSubmit, onCancel }) {
  if (!formEl) return;

  const typeInput = formEl.querySelector('input[name="type"]');
  const categorySelect = formEl.querySelector('select[name="category"]');
  const titleInput = formEl.querySelector('input[name="title"]');
  const typeButtons = formEl.querySelectorAll('[data-tx-type]');

  const clearErrors = () => {
    formEl.querySelectorAll('.field-error').forEach((el) => {
      el.textContent = '';
    });
    formEl.querySelectorAll('.is-invalid').forEach((el) => {
      el.classList.remove('is-invalid');
      el.removeAttribute('aria-invalid');
    });
  };

  const applyErrors = (errors) => {
    Object.entries(errors).forEach(([field, msg]) => {
      const errorSlot = formEl.querySelector(`[data-error-for="${field}"]`);
      const inputEl = formEl.querySelector(`[name="${field}"]`);
      if (errorSlot) errorSlot.textContent = msg;
      if (inputEl) {
        inputEl.classList.add('is-invalid');
        inputEl.setAttribute('aria-invalid', 'true');
      }
    });
  };

  typeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextType = btn.getAttribute('data-tx-type');
      if (!nextType || !CATEGORIES[nextType]) return;

      typeInput.value = nextType;
      typeButtons.forEach((b) =>
        b.classList.toggle('is-active', b.getAttribute('data-tx-type') === nextType)
      );

      const previousValue = categorySelect.value;
      const nextCategories = CATEGORIES[nextType];
      categorySelect.innerHTML = nextCategories
        .map((cat) => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`)
        .join('');
      if (nextCategories.includes(previousValue)) {
        categorySelect.value = previousValue;
      }

      if (titleInput) {
        titleInput.placeholder =
          nextType === 'income' ? 'e.g., Monthly Salary' : 'e.g., Grocery Shopping';
      }
    });
  });

  formEl.querySelectorAll('input, select, textarea').forEach((fieldEl) => {
    fieldEl.addEventListener('input', () => {
      const name = fieldEl.getAttribute('name');
      fieldEl.classList.remove('is-invalid');
      fieldEl.removeAttribute('aria-invalid');
      const errorSlot = formEl.querySelector(`[data-error-for="${name}"]`);
      if (errorSlot) errorSlot.textContent = '';
    });
  });

  formEl.addEventListener('reset', () => {
    window.setTimeout(() => {
      clearErrors();
      const defaultType = 'expense';
      typeInput.value = defaultType;
      typeButtons.forEach((b) =>
        b.classList.toggle('is-active', b.getAttribute('data-tx-type') === defaultType)
      );
      categorySelect.innerHTML = CATEGORIES[defaultType]
        .map((cat) => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`)
        .join('');
      const dateInput = formEl.querySelector('input[name="date"]');
      if (dateInput) dateInput.value = getTodayDateKey();
    }, 0);
  });

  const cancelBtn = formEl.querySelector('[data-form-cancel]');
  if (cancelBtn && typeof onCancel === 'function') {
    cancelBtn.addEventListener('click', onCancel);
  }

  formEl.addEventListener('submit', (event) => {
    event.preventDefault();
    clearErrors();

    const formData = new FormData(formEl);
    const payload = {
      type: formData.get('type'),
      title: formData.get('title'),
      amount: formData.get('amount'),
      category: formData.get('category'),
      date: formData.get('date'),
      description: formData.get('description'),
    };

    const result = validateTransactionInput(payload);
    if (!result.valid) {
      applyErrors(result.errors);
      return;
    }

    onSubmit(result.normalized);
  });
}

/**
 * Renders the dedicated Add Income / Expense view (Feature 2).
 * @param {HTMLElement} container
 * @param {object} callbacks
 */
export function renderAddTransactionView(container, callbacks) {
  container.innerHTML = `
    <div class="section-header">
      <div>
        <h2 class="section-title">Add Income or Expense</h2>
        <p class="section-subtitle">Record a new financial transaction with category, date, and validation.</p>
      </div>
    </div>

    <div class="card form-layout">
      ${buildTransactionFormMarkup({
        mode: 'add',
        formId: 'dedicated-tx-form',
        showCancel: false,
      })}
    </div>
  `;

  const formEl = container.querySelector('#dedicated-tx-form');
  bindTransactionForm(formEl, {
    onSubmit: (normalized) => {
      callbacks.onCreate(normalized);
      formEl.reset();
    },
  });

  refreshIcons();
}

/**
 * Renders a reusable transactions table body or empty state.
 * @param {Array<object>} rows
 * @returns {string}
 */
export function buildTransactionRowsMarkup(rows) {
  return rows
    .map((tx) => {
      const isIncome = tx.type === 'income';
      const signedAmount = formatCurrency(isIncome ? tx.amount : -tx.amount, { signed: true });
      return `
        <tr>
          <td>
            <div class="tx-title-cell">
              <span class="tx-title">${escapeHtml(tx.title)}</span>
              ${
                tx.description
                  ? `<span class="tx-desc" title="${escapeHtml(tx.description)}">${escapeHtml(
                      tx.description
                    )}</span>`
                  : ''
              }
            </div>
          </td>
          <td>${escapeHtml(tx.category)}</td>
          <td>
            <span class="tx-type-text ${isIncome ? 'is-income' : 'is-expense'}">
              <i data-lucide="${isIncome ? 'arrow-down-left' : 'arrow-up-right'}"></i>
              <span>${isIncome ? 'Income' : 'Expense'}</span>
            </span>
          </td>
          <td class="num">${escapeHtml(formatDate(tx.date))}</td>
          <td class="td-right tx-amount ${isIncome ? 'is-income' : 'is-expense'}">${escapeHtml(
        signedAmount
      )}</td>
          <td class="td-right">
            <div class="row-actions">
              <button
                type="button"
                class="icon-btn"
                data-action="edit-tx"
                data-tx-id="${escapeHtml(tx.id)}"
                aria-label="Edit ${escapeHtml(tx.title)}"
                title="Edit transaction"
              >
                <i data-lucide="pencil"></i>
              </button>
              <button
                type="button"
                class="icon-btn icon-btn-danger"
                data-action="delete-tx"
                data-tx-id="${escapeHtml(tx.id)}"
                aria-label="Delete ${escapeHtml(tx.title)}"
                title="Delete transaction"
              >
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

/**
 * Renders the full Transaction History view (Feature 3).
 * Preserves search input focus while updating results dynamically.
 * @param {HTMLElement} container
 * @param {Array<object>} allTransactions
 * @param {{ search: string, category: string, type: string, sortBy: string }} filterState
 * @param {object} callbacks
 */
export function renderTransactionsView(container, allTransactions, filterState, callbacks) {
  const filtered = queryTransactions(allTransactions, filterState);

  const filteredIncome = filtered
    .filter((t) => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);
  const filteredExpenses = filtered
    .filter((t) => t.type === 'expense')
    .reduce((sum, t) => sum + t.amount, 0);

  const tableMarkup =
    filtered.length > 0
      ? `
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Transaction</th>
              <th>Category</th>
              <th>Type</th>
              <th>Date</th>
              <th class="th-right">Amount</th>
              <th class="th-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${buildTransactionRowsMarkup(filtered)}
          </tbody>
        </table>
      </div>
    `
      : `
      <div class="empty-state">
        <div class="empty-state-icon">
          <i data-lucide="receipt"></i>
        </div>
        <h3 class="empty-state-title">${
          allTransactions.length === 0 ? 'No transactions recorded yet' : 'No matching transactions'
        }</h3>
        <p class="empty-state-desc">${
          allTransactions.length === 0
            ? 'Start by adding your first income or expense entry to track your cash flow.'
            : 'Try adjusting your search query, category filter, or transaction type.'
        }</p>
        ${
          allTransactions.length === 0
            ? '<button type="button" class="btn btn-primary" data-action="open-add-modal"><i data-lucide="plus"></i><span>Add First Transaction</span></button>'
            : '<button type="button" class="btn btn-secondary" data-action="reset-filters">Reset Filters</button>'
        }
      </div>
    `;

  container.innerHTML = `
    <div class="section-header">
      <div>
        <h2 class="section-title">Transaction History</h2>
        <p class="section-subtitle">Search, filter, sort, edit, or remove any recorded income or expense.</p>
      </div>
      <button type="button" class="btn btn-primary" data-action="open-add-modal">
        <i data-lucide="plus"></i>
        <span>New Transaction</span>
      </button>
    </div>

    <div class="card">
      <div class="filter-bar">
        <div class="filter-group">
          <div class="search-box">
            <i data-lucide="search"></i>
            <input
              type="search"
              id="tx-search-input"
              class="input"
              placeholder="Search title, category, or notes..."
              value="${escapeHtml(filterState.search)}"
              aria-label="Search transactions"
            />
          </div>

          <select id="tx-category-filter" class="select select-inline" aria-label="Filter by category">
            <option value="all" ${filterState.category === 'all' ? 'selected' : ''}>All Categories</option>
            ${ALL_CATEGORIES.map(
              (cat) =>
                `<option value="${escapeHtml(cat)}" ${
                  filterState.category === cat ? 'selected' : ''
                }>${escapeHtml(cat)}</option>`
            ).join('')}
          </select>

          <select id="tx-sort-select" class="select select-inline" aria-label="Sort transactions">
            <option value="date-desc" ${filterState.sortBy === 'date-desc' ? 'selected' : ''}>Newest First</option>
            <option value="date-asc" ${filterState.sortBy === 'date-asc' ? 'selected' : ''}>Oldest First</option>
            <option value="amount-desc" ${filterState.sortBy === 'amount-desc' ? 'selected' : ''}>Highest Amount</option>
            <option value="amount-asc" ${filterState.sortBy === 'amount-asc' ? 'selected' : ''}>Lowest Amount</option>
          </select>
        </div>

        <div class="segmented" role="group" aria-label="Filter by transaction type">
          <button type="button" class="segmented-btn ${filterState.type === 'all' ? 'is-active' : ''}" data-filter-type="all">All</button>
          <button type="button" class="segmented-btn ${filterState.type === 'income' ? 'is-active' : ''}" data-filter-type="income">Income</button>
          <button type="button" class="segmented-btn ${filterState.type === 'expense' ? 'is-active' : ''}" data-filter-type="expense">Expense</button>
        </div>
      </div>

      <div class="summary-strip">
        <span class="summary-strip-item">Showing <strong class="num">${filtered.length}</strong> of <span class="num">${allTransactions.length}</span> entries</span>
        <span aria-hidden="true">·</span>
        <span class="summary-strip-item">Filtered Income: <strong class="num" style="color: var(--semantic-income)">${escapeHtml(formatCurrency(filteredIncome))}</strong></span>
        <span aria-hidden="true">·</span>
        <span class="summary-strip-item">Filtered Expenses: <strong class="num">${escapeHtml(formatCurrency(filteredExpenses))}</strong></span>
      </div>

      <div id="tx-table-region">
        ${tableMarkup}
      </div>
    </div>
  `;

  const searchInput = container.querySelector('#tx-search-input');
  const categorySelect = container.querySelector('#tx-category-filter');
  const sortSelect = container.querySelector('#tx-sort-select');
  const typeButtons = container.querySelectorAll('[data-filter-type]');
  const tableRegion = container.querySelector('#tx-table-region');

  const updateTableOnly = () => {
    const updated = queryTransactions(allTransactions, filterState);
    const inc = updated.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const exp = updated.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

    const strip = container.querySelector('.summary-strip');
    if (strip) {
      strip.innerHTML = `
        <span class="summary-strip-item">Showing <strong class="num">${updated.length}</strong> of <span class="num">${allTransactions.length}</span> entries</span>
        <span aria-hidden="true">·</span>
        <span class="summary-strip-item">Filtered Income: <strong class="num" style="color: var(--semantic-income)">${escapeHtml(formatCurrency(inc))}</strong></span>
        <span aria-hidden="true">·</span>
        <span class="summary-strip-item">Filtered Expenses: <strong class="num">${escapeHtml(formatCurrency(exp))}</strong></span>
      `;
    }

    if (tableRegion) {
      tableRegion.innerHTML =
        updated.length > 0
          ? `
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Transaction</th>
                  <th>Category</th>
                  <th>Type</th>
                  <th>Date</th>
                  <th class="th-right">Amount</th>
                  <th class="th-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${buildTransactionRowsMarkup(updated)}
              </tbody>
            </table>
          </div>
        `
          : `
          <div class="empty-state">
            <div class="empty-state-icon"><i data-lucide="search-x"></i></div>
            <h3 class="empty-state-title">No matching transactions</h3>
            <p class="empty-state-desc">Try adjusting your search query, category filter, or transaction type.</p>
            <button type="button" class="btn btn-secondary" data-action="reset-filters">Reset Filters</button>
          </div>
        `;
      refreshIcons();
    }
  };

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      callbacks.onFilterChange({ search: e.target.value }, { skipFullRender: true });
      updateTableOnly();
    });
  }

  if (categorySelect) {
    categorySelect.addEventListener('change', (e) => {
      callbacks.onFilterChange({ category: e.target.value });
    });
  }

  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      callbacks.onFilterChange({ sortBy: e.target.value });
    });
  }

  typeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextType = btn.getAttribute('data-filter-type');
      callbacks.onFilterChange({ type: nextType });
    });
  });

  container.onclick = (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.getAttribute('data-action');
    const txId = target.getAttribute('data-tx-id');

    if (action === 'edit-tx' && txId) {
      callbacks.onEditRequest(txId);
    } else if (action === 'delete-tx' && txId) {
      callbacks.onDeleteRequest(txId);
    } else if (action === 'open-add-modal') {
      callbacks.onAddRequest();
    } else if (action === 'reset-filters') {
      callbacks.onResetFilters();
    }
  };

  refreshIcons();
}

/**
 * Generates and downloads a CSV file of transactions.
 * @param {Array<object>} transactions
 */
export function exportTransactionsCsv(transactions) {
  const headers = ['ID', 'Title', 'Type', 'Category', 'Amount', 'Date', 'Description'];
  const escapeCsv = (val) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replaceAll('"', '""')}"`;
    }
    return str;
  };

  const lines = [
    headers.join(','),
    ...transactions.map((t) =>
      [t.id, t.title, t.type, t.category, t.amount.toFixed(2), t.date, t.description]
        .map(escapeCsv)
        .join(',')
    ),
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `ledgerflow-transactions-${getTodayDateKey()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
