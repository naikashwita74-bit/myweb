/**
 * storage.js
 * Centralized persistence layer wrapping LocalStorage.
 * Structured as an isolated repository module so LocalStorage calls
 * can be replaced directly with REST API calls (Node.js / Express / SQL) later.
 */

export const STORAGE_KEYS = {
  TRANSACTIONS: 'ledgerflow_transactions_v1',
  BUDGET: 'ledgerflow_budget_v1',
  INITIALIZED: 'ledgerflow_initialized_v1',
};

/**
 * Generates a unique transaction identifier.
 * @returns {string}
 */
export function generateTransactionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `tx_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `tx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Normalizes a transaction object to enforce schema consistency.
 * @param {object} raw
 * @returns {object|null}
 */
function normalizeTransaction(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const type = raw.type === 'income' ? 'income' : 'expense';
  const amount = Number(raw.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const title = String(raw.title || '').trim();
  const category = String(raw.category || 'Other').trim() || 'Other';
  const date = String(raw.date || '').trim();
  const description = String(raw.description || '').trim();

  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  return {
    id: String(raw.id || generateTransactionId()),
    title,
    amount: Math.round(amount * 100) / 100,
    category,
    type,
    date,
    description,
  };
}

/**
 * Builds relative YYYY-MM-DD strings anchored to today's date
 * so initial sample data always populates the current and prior months.
 * @param {number} monthsAgo
 * @param {number} dayOfMonth
 * @returns {string}
 */
function buildRelativeDate(monthsAgo, dayOfMonth) {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  const clampedDay = Math.min(Math.max(1, dayOfMonth), lastDay);
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, '0');
  const day = String(clampedDay).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Creates a realistic initial dataset for first-time users.
 * @returns {{ transactions: Array<object>, budget: { defaultLimit: number, byMonth: Record<string, number> } }}
 */
function createSeedData() {
  const today = new Date();
  const currentDay = today.getDate();

  const transactions = [
    {
      id: 'tx_seed_01',
      title: 'Monthly Salary',
      amount: 5400,
      category: 'Salary',
      type: 'income',
      date: buildRelativeDate(0, 1),
      description: 'Primary engineering payroll deposit',
    },
    {
      id: 'tx_seed_02',
      title: 'Apartment Rent',
      amount: 1650,
      category: 'Housing',
      type: 'expense',
      date: buildRelativeDate(0, 2),
      description: 'Monthly lease payment',
    },
    {
      id: 'tx_seed_03',
      title: 'Grocery Shopping',
      amount: 215.4,
      category: 'Food',
      type: 'expense',
      date: buildRelativeDate(0, Math.max(3, currentDay - 4)),
      description: 'Weekly groceries and produce',
    },
    {
      id: 'tx_seed_04',
      title: 'Electric & Fiber Internet',
      amount: 148.9,
      category: 'Utilities',
      type: 'expense',
      date: buildRelativeDate(0, Math.max(4, currentDay - 3)),
      description: 'Monthly power and home internet',
    },
    {
      id: 'tx_seed_05',
      title: 'Freelance UI Audit',
      amount: 850,
      category: 'Freelance',
      type: 'income',
      date: buildRelativeDate(0, Math.max(5, currentDay - 2)),
      description: 'Design systems consulting invoice',
    },
    {
      id: 'tx_seed_06',
      title: 'Metro Pass & Fuel',
      amount: 96,
      category: 'Transport',
      type: 'expense',
      date: buildRelativeDate(0, Math.max(5, currentDay - 1)),
      description: 'Commuter transit pass and fuel',
    },
    {
      id: 'tx_seed_07',
      title: 'Dental Checkup',
      amount: 135,
      category: 'Healthcare',
      type: 'expense',
      date: buildRelativeDate(0, currentDay),
      description: 'Routine preventive care copay',
    },
    {
      id: 'tx_seed_08',
      title: 'Monthly Salary',
      amount: 5400,
      category: 'Salary',
      type: 'income',
      date: buildRelativeDate(1, 1),
      description: 'Primary engineering payroll deposit',
    },
    {
      id: 'tx_seed_09',
      title: 'Apartment Rent',
      amount: 1650,
      category: 'Housing',
      type: 'expense',
      date: buildRelativeDate(1, 2),
      description: 'Monthly lease payment',
    },
    {
      id: 'tx_seed_10',
      title: 'Whole Foods & Dining',
      amount: 482.6,
      category: 'Food',
      type: 'expense',
      date: buildRelativeDate(1, 14),
      description: 'Groceries and weekend dinner',
    },
    {
      id: 'tx_seed_11',
      title: 'Cloud & Streaming Services',
      amount: 64.5,
      category: 'Entertainment',
      type: 'expense',
      date: buildRelativeDate(1, 19),
      description: 'Music, film, and digital subscriptions',
    },
    {
      id: 'tx_seed_12',
      title: 'Utilities Bundle',
      amount: 162,
      category: 'Utilities',
      type: 'expense',
      date: buildRelativeDate(1, 22),
      description: 'Water, electric, and internet',
    },
    {
      id: 'tx_seed_13',
      title: 'Monthly Salary',
      amount: 5250,
      category: 'Salary',
      type: 'income',
      date: buildRelativeDate(2, 1),
      description: 'Primary payroll deposit',
    },
    {
      id: 'tx_seed_14',
      title: 'Apartment Rent',
      amount: 1650,
      category: 'Housing',
      type: 'expense',
      date: buildRelativeDate(2, 2),
      description: 'Monthly lease payment',
    },
    {
      id: 'tx_seed_15',
      title: 'Grocery & Household',
      amount: 410,
      category: 'Food',
      type: 'expense',
      date: buildRelativeDate(2, 11),
      description: 'Pantry restock and household essentials',
    },
    {
      id: 'tx_seed_16',
      title: 'Quarterly Dividend',
      amount: 320,
      category: 'Investments',
      type: 'income',
      date: buildRelativeDate(2, 18),
      description: 'Index fund distribution',
    },
    {
      id: 'tx_seed_17',
      title: 'Running Shoes & Apparel',
      amount: 185,
      category: 'Shopping',
      type: 'expense',
      date: buildRelativeDate(2, 24),
      description: 'Athletic gear replacement',
    },
    {
      id: 'tx_seed_18',
      title: 'Monthly Salary',
      amount: 5250,
      category: 'Salary',
      type: 'income',
      date: buildRelativeDate(3, 1),
      description: 'Primary payroll deposit',
    },
    {
      id: 'tx_seed_19',
      title: 'Apartment Rent',
      amount: 1650,
      category: 'Housing',
      type: 'expense',
      date: buildRelativeDate(3, 2),
      description: 'Monthly lease payment',
    },
    {
      id: 'tx_seed_20',
      title: 'Online Course Subscription',
      amount: 199,
      category: 'Education',
      type: 'expense',
      date: buildRelativeDate(3, 15),
      description: 'Systems architecture workshop',
    },
    {
      id: 'tx_seed_21',
      title: 'Monthly Salary',
      amount: 5100,
      category: 'Salary',
      type: 'income',
      date: buildRelativeDate(4, 1),
      description: 'Primary payroll deposit',
    },
    {
      id: 'tx_seed_22',
      title: 'Apartment Rent & Utilities',
      amount: 1795,
      category: 'Housing',
      type: 'expense',
      date: buildRelativeDate(4, 2),
      description: 'Monthly lease and utilities',
    },
    {
      id: 'tx_seed_23',
      title: 'Groceries & Coffee',
      amount: 365,
      category: 'Food',
      type: 'expense',
      date: buildRelativeDate(4, 16),
      description: 'Weekly markets and cafes',
    },
  ];

  const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const budget = {
    defaultLimit: 3200,
    byMonth: {
      [currentMonthKey]: 3200,
    },
  };

  return { transactions, budget };
}

/**
 * Ensures LocalStorage has initial sample data on first launch only.
 */
export function ensureInitialized() {
  try {
    const initialized = localStorage.getItem(STORAGE_KEYS.INITIALIZED);
    if (initialized === 'true') return;

    const seed = createSeedData();
    localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(seed.transactions));
    localStorage.setItem(STORAGE_KEYS.BUDGET, JSON.stringify(seed.budget));
    localStorage.setItem(STORAGE_KEYS.INITIALIZED, 'true');
  } catch (err) {
    console.error('Storage initialization failed:', err);
  }
}

/**
 * Retrieves all stored transactions.
 * Future REST mapping: GET /api/transactions
 * @returns {Array<object>}
 */
export function getTransactions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.TRANSACTIONS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeTransaction).filter(Boolean);
  } catch (err) {
    console.error('Failed to read transactions from storage:', err);
    return [];
  }
}

/**
 * Persists the complete transactions array.
 * @param {Array<object>} transactions
 * @returns {Array<object>}
 */
export function saveTransactions(transactions) {
  const sanitized = Array.isArray(transactions)
    ? transactions.map(normalizeTransaction).filter(Boolean)
    : [];
  try {
    localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(sanitized));
    localStorage.setItem(STORAGE_KEYS.INITIALIZED, 'true');
  } catch (err) {
    console.error('Failed to save transactions:', err);
    throw new Error('Unable to save to browser storage.');
  }
  return sanitized;
}

/**
 * Adds a new transaction record.
 * Future REST mapping: POST /api/transactions
 * @param {object} txInput
 * @returns {object}
 */
export function addTransaction(txInput) {
  const normalized = normalizeTransaction({
    ...txInput,
    id: generateTransactionId(),
  });
  if (!normalized) {
    throw new Error('Invalid transaction payload.');
  }

  const current = getTransactions();
  current.unshift(normalized);
  saveTransactions(current);
  return normalized;
}

/**
 * Updates an existing transaction by ID.
 * Future REST mapping: PUT /api/transactions/:id
 * @param {string} id
 * @param {object} updates
 * @returns {object}
 */
export function updateTransaction(id, updates) {
  const current = getTransactions();
  const index = current.findIndex((item) => item.id === id);
  if (index === -1) {
    throw new Error('Transaction not found.');
  }

  const merged = normalizeTransaction({
    ...current[index],
    ...updates,
    id: current[index].id,
  });

  if (!merged) {
    throw new Error('Invalid transaction update payload.');
  }

  current[index] = merged;
  saveTransactions(current);
  return merged;
}

/**
 * Deletes a transaction by ID.
 * Future REST mapping: DELETE /api/transactions/:id
 * @param {string} id
 * @returns {boolean}
 */
export function deleteTransaction(id) {
  const current = getTransactions();
  const next = current.filter((item) => item.id !== id);
  if (next.length === current.length) return false;
  saveTransactions(next);
  return true;
}

/**
 * Retrieves budget configuration object.
 * Future REST mapping: GET /api/budget
 * @returns {{ defaultLimit: number, byMonth: Record<string, number> }}
 */
export function getBudgetData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.BUDGET);
    if (!raw) return { defaultLimit: 0, byMonth: {} };
    const parsed = JSON.parse(raw);
    const defaultLimit = Number(parsed?.defaultLimit);
    const byMonth = parsed?.byMonth && typeof parsed.byMonth === 'object' ? parsed.byMonth : {};
    return {
      defaultLimit: Number.isFinite(defaultLimit) && defaultLimit >= 0 ? defaultLimit : 0,
      byMonth,
    };
  } catch (err) {
    console.error('Failed to read budget configuration:', err);
    return { defaultLimit: 0, byMonth: {} };
  }
}

/**
 * Returns the configured budget limit for a specific YYYY-MM month.
 * @param {string} monthKey
 * @returns {number}
 */
export function getMonthlyBudget(monthKey) {
  const data = getBudgetData();
  if (monthKey && Object.prototype.hasOwnProperty.call(data.byMonth, monthKey)) {
    const val = Number(data.byMonth[monthKey]);
    return Number.isFinite(val) && val >= 0 ? val : 0;
  }
  return data.defaultLimit || 0;
}

/**
 * Saves a monthly budget limit for the given month key.
 * Future REST mapping: PUT /api/budget
 * @param {string} monthKey
 * @param {number} amount
 * @returns {number}
 */
export function saveMonthlyBudget(monthKey, amount) {
  const numericAmount = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error('Budget amount must be greater than zero.');
  }

  const current = getBudgetData();
  const next = {
    defaultLimit: current.defaultLimit || numericAmount,
    byMonth: {
      ...current.byMonth,
      [monthKey]: numericAmount,
    },
  };

  try {
    localStorage.setItem(STORAGE_KEYS.BUDGET, JSON.stringify(next));
    localStorage.setItem(STORAGE_KEYS.INITIALIZED, 'true');
  } catch (err) {
    console.error('Failed to save budget:', err);
    throw new Error('Unable to save budget to browser storage.');
  }
  return numericAmount;
}

/**
 * Restores realistic sample data for demonstration and testing.
 */
export function resetSampleData() {
  const seed = createSeedData();
  try {
    localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(seed.transactions));
    localStorage.setItem(STORAGE_KEYS.BUDGET, JSON.stringify(seed.budget));
    localStorage.setItem(STORAGE_KEYS.INITIALIZED, 'true');
  } catch (err) {
    console.error('Failed to reset sample data:', err);
    throw new Error('Unable to reset sample data.');
  }
  return seed;
}
