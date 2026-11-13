/**
 * budget.js
 * Monthly budget tracking, threshold alerts (80% warning, >100% exceeded),
 * and budget configuration UI (Feature 5).
 */

import {
  CATEGORY_COLORS,
  escapeHtml,
  formatCurrency,
  formatMonthLabel,
  refreshIcons,
} from './transactions.js';

/**
 * Pure calculation of monthly budget status independent of storage.
 * @param {Array<object>} transactions
 * @param {number} monthlyLimit
 * @param {string} monthKey YYYY-MM
 * @returns {object}
 */
export function calculateBudgetStatus(transactions, monthlyLimit, monthKey) {
  const limit = Number(monthlyLimit) > 0 ? Number(monthlyLimit) : 0;
  const monthExpenses = (transactions || []).filter(
    (tx) => tx.type === 'expense' && String(tx.date || '').slice(0, 7) === monthKey
  );

  const spent = monthExpenses.reduce((sum, tx) => sum + tx.amount, 0);
  const remaining = limit - spent;
  const utilizationPercent = limit > 0 ? (spent / limit) * 100 : 0;

  let status = 'unset';
  if (limit > 0) {
    if (utilizationPercent > 100) status = 'exceeded';
    else if (utilizationPercent >= 80) status = 'warning';
    else status = 'healthy';
  }

  const byCategoryMap = {};
  for (const tx of monthExpenses) {
    byCategoryMap[tx.category] = (byCategoryMap[tx.category] || 0) + tx.amount;
  }

  const categoryBreakdown = Object.entries(byCategoryMap)
    .map(([category, amount]) => ({
      category,
      amount: Math.round(amount * 100) / 100,
      shareOfBudget: limit > 0 ? (amount / limit) * 100 : 0,
      shareOfSpend: spent > 0 ? (amount / spent) * 100 : 0,
      color: CATEGORY_COLORS[category] || '#64748b',
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    budgetLimit: Math.round(limit * 100) / 100,
    monthlyExpenses: Math.round(spent * 100) / 100,
    remainingBudget: Math.round(remaining * 100) / 100,
    utilizationPercent,
    status,
    categoryBreakdown,
  };
}

/**
 * Renders the Budget Management view (Feature 5).
 * @param {HTMLElement} container
 * @param {Array<object>} transactions
 * @param {string} activeMonth
 * @param {number} monthlyLimit
 * @param {object} callbacks
 */
export function renderBudgetView(container, transactions, activeMonth, monthlyLimit, callbacks) {
  const statusInfo = calculateBudgetStatus(transactions, monthlyLimit, activeMonth);
  const monthLabel = formatMonthLabel(activeMonth, 'long');
  const clampedBarWidth = Math.min(100, Math.max(0, statusInfo.utilizationPercent));

  let bannerHtml = '';
  if (statusInfo.status === 'exceeded') {
    bannerHtml = `
      <div class="status-banner is-exceeded">
        <div class="status-banner-main">
          <i data-lucide="alert-octagon"></i>
          <div>
            <div class="status-banner-title">Alert: Monthly Budget Exceeded</div>
            <div class="status-banner-desc">
              Expenses for ${escapeHtml(monthLabel)} reached
              <strong class="num">${escapeHtml(formatCurrency(statusInfo.monthlyExpenses))}</strong>,
              exceeding your <span class="num">${escapeHtml(formatCurrency(statusInfo.budgetLimit))}</span>
              limit by <strong class="num">${escapeHtml(
                formatCurrency(Math.abs(statusInfo.remainingBudget))
              )}</strong>.
            </div>
          </div>
        </div>
      </div>
    `;
  } else if (statusInfo.status === 'warning') {
    bannerHtml = `
      <div class="status-banner is-warning">
        <div class="status-banner-main">
          <i data-lucide="alert-triangle"></i>
          <div>
            <div class="status-banner-title">Warning: 80% Budget Threshold Reached</div>
            <div class="status-banner-desc">
              You have used <strong class="num">${statusInfo.utilizationPercent.toFixed(
                1
              )}%</strong> of your ${escapeHtml(monthLabel)} budget. Only
              <strong class="num">${escapeHtml(
                formatCurrency(statusInfo.remainingBudget)
              )}</strong> remains.
            </div>
          </div>
        </div>
      </div>
    `;
  } else if (statusInfo.status === 'healthy') {
    bannerHtml = `
      <div class="status-banner is-healthy">
        <div class="status-banner-main">
          <i data-lucide="check-circle-2"></i>
          <div>
            <div class="status-banner-title">On Track: Within Monthly Budget</div>
            <div class="status-banner-desc">
              Spending is at <strong class="num">${statusInfo.utilizationPercent.toFixed(
                1
              )}%</strong> of your ${escapeHtml(monthLabel)} target with
              <strong class="num">${escapeHtml(
                formatCurrency(statusInfo.remainingBudget)
              )}</strong> remaining.
            </div>
          </div>
        </div>
      </div>
    `;
  } else {
    bannerHtml = `
      <div class="status-banner">
        <div class="status-banner-main">
          <i data-lucide="info"></i>
          <div>
            <div class="status-banner-title">No Monthly Budget Configured</div>
            <div class="status-banner-desc">
              Set a spending target for ${escapeHtml(
                monthLabel
              )} below to enable 80% warnings and exceeded-budget alerts.
            </div>
          </div>
        </div>
      </div>
    `;
  }

  const categoryRows = statusInfo.categoryBreakdown
    .map(
      (item) => `
      <tr>
        <td>
          <div class="legend-left">
            <span class="legend-swatch" style="background-color: ${escapeHtml(item.color)}"></span>
            <span class="legend-name">${escapeHtml(item.category)}</span>
          </div>
        </td>
        <td class="td-right num">${item.shareOfSpend.toFixed(1)}%</td>
        <td class="td-right num">${
          statusInfo.budgetLimit > 0 ? `${item.shareOfBudget.toFixed(1)}%` : '—'
        }</td>
        <td class="td-right num" style="font-weight: 600">${escapeHtml(formatCurrency(item.amount))}</td>
      </tr>
    `
    )
    .join('');

  container.innerHTML = `
    <div class="section-header">
      <div>
        <h2 class="section-title">Budget Management</h2>
        <p class="section-subtitle">Configure monthly limits and monitor spending thresholds for ${escapeHtml(
          monthLabel
        )}.</p>
      </div>
    </div>

    ${bannerHtml}

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">
          <span>Monthly Budget</span>
          <i data-lucide="target"></i>
        </div>
        <div class="kpi-value">${
          statusInfo.budgetLimit > 0 ? escapeHtml(formatCurrency(statusInfo.budgetLimit)) : 'Not Set'
        }</div>
        <div class="kpi-foot">Target for ${escapeHtml(monthLabel)}</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-label">
          <span>Monthly Expenses</span>
          <i data-lucide="credit-card"></i>
        </div>
        <div class="kpi-value">${escapeHtml(formatCurrency(statusInfo.monthlyExpenses))}</div>
        <div class="kpi-foot">Tracked outflows this month</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-label">
          <span>Remaining Budget</span>
          <i data-lucide="wallet"></i>
        </div>
        <div class="kpi-value ${
          statusInfo.status === 'exceeded'
            ? 'is-expense'
            : statusInfo.status === 'warning'
            ? 'is-warning'
            : statusInfo.status === 'healthy'
            ? 'is-income'
            : ''
        }">${
    statusInfo.budgetLimit > 0
      ? escapeHtml(
          statusInfo.remainingBudget < 0
            ? `-${formatCurrency(Math.abs(statusInfo.remainingBudget))}`
            : formatCurrency(statusInfo.remainingBudget)
        )
      : '—'
  }</div>
        <div class="kpi-foot">${
          statusInfo.remainingBudget < 0 && statusInfo.budgetLimit > 0
            ? 'Exceeded monthly limit'
            : 'Available to spend'
        }</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-label">
          <span>Budget Utilization</span>
          <i data-lucide="gauge"></i>
        </div>
        <div class="kpi-value ${
          statusInfo.status === 'exceeded'
            ? 'is-expense'
            : statusInfo.status === 'warning'
            ? 'is-warning'
            : ''
        }">${
    statusInfo.budgetLimit > 0 ? `${statusInfo.utilizationPercent.toFixed(1)}%` : '0.0%'
  }</div>
        <div class="kpi-foot">Warning triggers at 80%</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Utilization Progress</h3>
        <span class="card-meta num">${escapeHtml(
          formatCurrency(statusInfo.monthlyExpenses)
        )} / ${
    statusInfo.budgetLimit > 0 ? escapeHtml(formatCurrency(statusInfo.budgetLimit)) : '$0.00'
  }</span>
      </div>
      <div class="progress-track" role="progressbar" aria-valuenow="${Math.round(
        statusInfo.utilizationPercent
      )}" aria-valuemin="0" aria-valuemax="100">
        <div class="progress-fill is-${escapeHtml(statusInfo.status)}" style="width: ${clampedBarWidth.toFixed(
    1
  )}%"></div>
        <div class="progress-threshold" title="80% warning threshold"></div>
      </div>
      <div class="progress-meta">
        <span>0%</span>
        <span>80% Warning Threshold</span>
        <span>100% Limit</span>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Set Monthly Budget</h3>
          <span class="card-meta">${escapeHtml(monthLabel)}</span>
        </div>

        <form id="budget-form" class="tx-form" novalidate>
          <div class="form-field">
            <label class="form-label" for="budget-limit-input">Monthly Budget Limit (USD)</label>
            <input
              id="budget-limit-input"
              name="budgetLimit"
              type="number"
              step="0.01"
              min="1"
              class="input num"
              placeholder="e.g., 3200.00"
              value="${statusInfo.budgetLimit > 0 ? escapeHtml(String(statusInfo.budgetLimit)) : ''}"
              required
            />
            <span class="field-error" id="budget-form-error"></span>
          </div>

          <div class="form-actions">
            <button type="submit" class="btn btn-primary">
              <i data-lucide="save"></i>
              <span>Save Budget</span>
            </button>
          </div>
        </form>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Monthly Expense Drivers</h3>
          <span class="card-meta">${escapeHtml(monthLabel)}</span>
        </div>
        ${
          statusInfo.categoryBreakdown.length > 0
            ? `
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th class="th-right">% of Spend</th>
                  <th class="th-right">% of Budget</th>
                  <th class="th-right">Spent</th>
                </tr>
              </thead>
              <tbody>
                ${categoryRows}
              </tbody>
            </table>
          </div>
        `
            : `
          <div class="empty-state">
            <div class="empty-state-icon"><i data-lucide="layers"></i></div>
            <h3 class="empty-state-title">No expenses for ${escapeHtml(monthLabel)}</h3>
            <p class="empty-state-desc">Expenses added in this month will appear here ranked by budget impact.</p>
          </div>
        `
        }
      </div>
    </div>
  `;

  const formEl = container.querySelector('#budget-form');
  const limitInput = container.querySelector('#budget-limit-input');
  const errorSlot = container.querySelector('#budget-form-error');

  if (limitInput) {
    limitInput.addEventListener('input', () => {
      limitInput.classList.remove('is-invalid');
      if (errorSlot) errorSlot.textContent = '';
    });
  }

  if (formEl) {
    formEl.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = Number(limitInput.value);
      if (!limitInput.value || !Number.isFinite(val) || val <= 0) {
        limitInput.classList.add('is-invalid');
        if (errorSlot) errorSlot.textContent = 'Enter a valid monthly budget greater than 0.';
        return;
      }
      callbacks.onSaveBudget(activeMonth, val);
    });
  }

  refreshIcons();
}
