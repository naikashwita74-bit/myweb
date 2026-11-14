/**
 * storage.js
 * Centralized data persistence layer connected to the Node.js + Express + SQLite backend.
 * LocalStorage read/writes have been replaced with REST API calls using fetch().
 * Includes one-time migration from legacy LocalStorage data into the database.
 */

/**
 * Resolves the API base URL.
 *
 * - Served by the Express backend (http://localhost:3000) -> same origin.
 * - Served by the Vite dev server (http://localhost:5173) -> /api is proxied
 *   to the backend by vite.config.ts, so the same relative path still works.
 * - Opened straight from the file system -> fall back to the backend origin.
 */
const API_BASE = (() => {
  const origin = typeof window !== 'undefined' ? window.location?.origin : '';

  if (!origin || origin === 'null' || origin.startsWith('file:')) {
    return 'http://localhost:3000/api';
  }

  return '/api';
})();

export const STORAGE_KEYS = {
  TRANSACTIONS: 'ledgerflow_transactions_v1',
  BUDGET: 'ledgerflow_budget_v1',
  INITIALIZED: 'ledgerflow_initialized_v1',
  MIGRATED: 'ledgerflow_migrated_v1',
};

/**
 * Helper to handle fetch responses and parse JSON with proper error handling.
 * @param {string} endpoint
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const data = isJson ? await response.json() : null;

  if (!response.ok) {
    const errorMsg = data?.error || `Request failed with status ${response.status}: ${response.statusText}`;
    const err = new Error(errorMsg);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  return data;
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
 * Creates realistic initial seed dataset.
 */
function createSeedData() {
  const today = new Date();
  const currentDay = today.getDate();

  const transactions = [
    {
      title: 'Monthly Salary',
      amount: 5400,
      category: 'Salary',
      type: 'income',
      date: buildRelativeDate(0, 1),
      description: 'Primary engineering payroll deposit',
    },
    {
      title: 'Apartment Rent',
      amount: 1650,
      category: 'Housing',
      type: 'expense',
      date: buildRelativeDate(0, 2),
      description: 'Monthly lease payment',
    },
    {
      title: 'Grocery Shopping',
      amount: 215.4,
      category: 'Food',
      type: 'expense',
      date: buildRelativeDate(0, Math.max(3, currentDay - 4)),
      description: 'Weekly groceries and produce',
    },
    {
      title: 'Electric & Fiber Internet',
      amount: 148.9,
      category: 'Utilities',
      type: 'expense',
      date: buildRelativeDate(0, Math.max(4, currentDay - 3)),
      description: 'Monthly power and home internet',
    },
    {
      title: 'Freelance UI Audit',
      amount: 850,
      category: 'Freelance',
      type: 'income',
      date: buildRelativeDate(0, Math.max(5, currentDay - 2)),
      description: 'Design systems consulting invoice',
    },
    {
      title: 'Metro Pass & Fuel',
      amount: 96,
      category: 'Transport',
      type: 'expense',
      date: buildRelativeDate(0, Math.max(5, currentDay - 1)),
      description: 'Commuter transit pass and fuel',
    },
    {
      title: 'Dental Checkup',
      amount: 135,
      category: 'Healthcare',
      type: 'expense',
      date: buildRelativeDate(0, currentDay),
      description: 'Routine preventive care copay',
    },
    {
      title: 'Monthly Salary',
      amount: 5400,
      category: 'Salary',
      type: 'income',
      date: buildRelativeDate(1, 1),
      description: 'Primary engineering payroll deposit',
    },
    {
      title: 'Apartment Rent',
      amount: 1650,
      category: 'Housing',
      type: 'expense',
      date: buildRelativeDate(1, 2),
      description: 'Monthly lease payment',
    },
    {
      title: 'Whole Foods & Dining',
      amount: 482.6,
      category: 'Food',
      type: 'expense',
      date: buildRelativeDate(1, 14),
      description: 'Groceries and weekend dinner',
    },
    {
      title: 'Cloud & Streaming Services',
      amount: 64.5,
      category: 'Entertainment',
      type: 'expense',
      date: buildRelativeDate(1, 19),
      description: 'Music, film, and digital subscriptions',
    },
    {
      title: 'Utilities Bundle',
      amount: 162,
      category: 'Utilities',
      type: 'expense',
      date: buildRelativeDate(1, 22),
      description: 'Water, electric, and internet',
    },
    {
      title: 'Monthly Salary',
      amount: 5250,
      category: 'Salary',
      type: 'income',
      date: buildRelativeDate(2, 1),
      description: 'Primary payroll deposit',
    },
    {
      title: 'Apartment Rent',
      amount: 1650,
      category: 'Housing',
      type: 'expense',
      date: buildRelativeDate(2, 2),
      description: 'Monthly lease payment',
    },
    {
      title: 'Grocery & Household',
      amount: 410,
      category: 'Food',
      type: 'expense',
      date: buildRelativeDate(2, 11),
      description: 'Pantry restock and household essentials',
    },
    {
      title: 'Quarterly Dividend',
      amount: 320,
      category: 'Investments',
      type: 'income',
      date: buildRelativeDate(2, 18),
      description: 'Index fund distribution',
    },
    {
      title: 'Running Shoes & Apparel',
      amount: 185,
      category: 'Shopping',
      type: 'expense',
      date: buildRelativeDate(2, 24),
      description: 'Athletic gear replacement',
    },
    {
      title: 'Monthly Salary',
      amount: 5250,
      category: 'Salary',
      type: 'income',
      date: buildRelativeDate(3, 1),
      description: 'Primary payroll deposit',
    },
    {
      title: 'Apartment Rent',
      amount: 1650,
      category: 'Housing',
      type: 'expense',
      date: buildRelativeDate(3, 2),
      description: 'Monthly lease payment',
    },
    {
      title: 'Online Course Subscription',
      amount: 199,
      category: 'Education',
      type: 'expense',
      date: buildRelativeDate(3, 15),
      description: 'Systems architecture workshop',
    },
    {
      title: 'Monthly Salary',
      amount: 5100,
      category: 'Salary',
      type: 'income',
      date: buildRelativeDate(4, 1),
      description: 'Primary payroll deposit',
    },
    {
      title: 'Apartment Rent & Utilities',
      amount: 1795,
      category: 'Housing',
      type: 'expense',
      date: buildRelativeDate(4, 2),
      description: 'Monthly lease and utilities',
    },
    {
      title: 'Groceries & Coffee',
      amount: 365,
      category: 'Food',
      type: 'expense',
      date: buildRelativeDate(4, 16),
      description: 'Weekly markets and cafes',
    },
  ];

  return {
    transactions,
    budget: {
      year: today.getFullYear(),
      month: today.getMonth() + 1,
      amount: 3200,
    },
  };
}

/**
 * Performs a one-time migration of existing LocalStorage data into SQLite via the REST API.
 * Sets a flag 'ledgerflow_migrated_v1' so it never runs twice.
 * Leaves the original LocalStorage data untouched as a backup.
 * @returns {Promise<{ migrated: boolean, txCount: number, budgetCount: number }>}
 */
export async function migrateFromLocalStorage() {
  try {
    const alreadyMigrated = localStorage.getItem(STORAGE_KEYS.MIGRATED);
    if (alreadyMigrated === 'true') {
      return { migrated: false, txCount: 0, budgetCount: 0 };
    }

    let txCount = 0;
    let budgetCount = 0;

    // Check for existing transactions in LocalStorage (skipping dummy seed records)
    const rawTx = localStorage.getItem(STORAGE_KEYS.TRANSACTIONS);
    if (rawTx) {
      const parsedTx = JSON.parse(rawTx);
      if (Array.isArray(parsedTx) && parsedTx.length > 0) {
        for (const item of parsedTx) {
          // Do not migrate dummy seed data
          if (item.id && String(item.id).startsWith('tx_seed_')) {
            continue;
          }
          try {
            await apiRequest('/transactions', {
              method: 'POST',
              body: JSON.stringify({
                title: item.title,
                amount: Number(item.amount),
                category: item.category,
                type: item.type,
                date: item.date,
                description: item.description || '',
              }),
            });
            txCount += 1;
          } catch (itemErr) {
            console.warn('Failed to migrate transaction item:', item, itemErr);
          }
        }
      }
    }

    // Check for existing budget in LocalStorage
    const rawBudget = localStorage.getItem(STORAGE_KEYS.BUDGET);
    if (rawBudget) {
      const parsedBudget = JSON.parse(rawBudget);
      const byMonth = parsedBudget?.byMonth || {};
      for (const [mKey, limit] of Object.entries(byMonth)) {
        if (/^\d{4}-\d{2}$/.test(mKey) && Number(limit) > 0) {
          const [yStr, mStr] = mKey.split('-');
          try {
            await apiRequest('/budgets', {
              method: 'POST',
              body: JSON.stringify({
                year: parseInt(yStr, 10),
                month: parseInt(mStr, 10),
                amount: Number(limit),
              }),
            });
            budgetCount += 1;
          } catch (budgetErr) {
            // Ignore if already created or conflict
            console.warn('Budget migration notice:', budgetErr.message);
          }
        }
      }
    }

    // Mark migration complete in LocalStorage without removing backup data
    localStorage.setItem(STORAGE_KEYS.MIGRATED, 'true');

    if (txCount > 0 || budgetCount > 0) {
      console.log(`[Migration] Successfully imported ${txCount} transactions and ${budgetCount} budgets from LocalStorage into SQLite.`);
    }

    return { migrated: true, txCount, budgetCount };
  } catch (err) {
    console.error('Migration error:', err);
    return { migrated: false, txCount: 0, budgetCount: 0 };
  }
}

/**
 * Ensures data initialization checks run on launch.
 * Runs one-time migration from LocalStorage (if any user records exist).
 */
export async function ensureInitialized() {
  try {
    const migrationResult = await migrateFromLocalStorage();
    return migrationResult;
  } catch (err) {
    console.error('Data initialization failed:', err);
    throw err;
  }
}

/**
 * Retrieves all transactions from the API, newest first.
 * Mapping: GET /api/transactions
 * @returns {Promise<Array<object>>}
 */
export async function getTransactions() {
  const result = await apiRequest('/transactions');
  return result?.data || [];
}

/**
 * Adds a new transaction via the API.
 * Mapping: POST /api/transactions
 * @param {object} txInput
 * @returns {Promise<object>}
 */
export async function addTransaction(txInput) {
  const result = await apiRequest('/transactions', {
    method: 'POST',
    body: JSON.stringify(txInput),
  });
  return result?.data;
}

/**
 * Updates an existing transaction by ID via the API.
 * Mapping: PUT /api/transactions/:id
 * @param {number|string} id
 * @param {object} updates
 * @returns {Promise<object>}
 */
export async function updateTransaction(id, updates) {
  const result = await apiRequest(`/transactions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return result?.data;
}

/**
 * Deletes a transaction by ID via the API.
 * Mapping: DELETE /api/transactions/:id
 * @param {number|string} id
 * @returns {Promise<boolean>}
 */
export async function deleteTransaction(id) {
  await apiRequest(`/transactions/${id}`, {
    method: 'DELETE',
  });
  return true;
}

/**
 * Returns the configured budget limit for a specific YYYY-MM month from the API.
 * Mapping: GET /api/budgets/:year/:month
 * @param {string} monthKey 'YYYY-MM'
 * @returns {Promise<number>}
 */
export async function getMonthlyBudget(monthKey) {
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return 0;
  const [yStr, mStr] = monthKey.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);

  try {
    const result = await apiRequest(`/budgets/${year}/${month}`);
    return Number(result?.data?.amount) || 0;
  } catch (err) {
    if (err.status === 404) {
      return 0; // No budget set for this month
    }
    console.error(`Failed to fetch budget for ${monthKey}:`, err);
    return 0;
  }
}

/**
 * Saves a monthly budget limit for the given month key via the API.
 * Creates if not exists, or updates if already present.
 * Mapping: POST /api/budgets or PUT /api/budgets/:id
 * @param {string} monthKey 'YYYY-MM'
 * @param {number} amount
 * @returns {Promise<number>}
 */
export async function saveMonthlyBudget(monthKey, amount) {
  const numericAmount = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error('Budget amount must be greater than zero.');
  }

  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) {
    throw new Error('Invalid month key format. Expected YYYY-MM.');
  }

  const [yStr, mStr] = monthKey.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);

  // Check if budget record exists
  let existingBudget = null;
  try {
    const check = await apiRequest(`/budgets/${year}/${month}`);
    existingBudget = check?.data;
  } catch (err) {
    if (err.status !== 404) throw err;
  }

  if (existingBudget && existingBudget.id) {
    // Update existing budget
    await apiRequest(`/budgets/${existingBudget.id}`, {
      method: 'PUT',
      body: JSON.stringify({ amount: numericAmount }),
    });
  } else {
    // Create new budget
    await apiRequest('/budgets', {
      method: 'POST',
      body: JSON.stringify({ year, month, amount: numericAmount }),
    });
  }

  return numericAmount;
}

/**
 * Restores sample seed data in the database through the API.
 */
export async function resetSampleData() {
  const current = await getTransactions();
  for (const tx of current) {
    await deleteTransaction(tx.id);
  }

  const seed = createSeedData();
  for (const tx of seed.transactions) {
    await addTransaction(tx);
  }

  await saveMonthlyBudget(
    `${seed.budget.year}-${String(seed.budget.month).padStart(2, '0')}`,
    seed.budget.amount
  );

  return seed;
}

/**
 * Reads the AI Expense Analyzer provider configuration.
 * Mapping: GET /api/ai/status
 * @returns {Promise<object>}
 */
export async function getAiStatus() {
  const result = await apiRequest('/ai/status');
  return result?.data || null;
}

/**
 * Requests an AI analysis of the recorded transactions.
 * Mapping: POST /api/ai/analyze
 * @param {{ period?: string, month?: string, refresh?: boolean }} options
 * @returns {Promise<{ analysis: object, meta: object }>}
 */
export async function analyzeExpenses(options = {}) {
  const result = await apiRequest('/ai/analyze', {
    method: 'POST',
    body: JSON.stringify({
      period: options.period || 'month',
      month: options.month || undefined,
      refresh: options.refresh === true,
    }),
  });

  return {
    analysis: result?.data || null,
    meta: result?.meta || null,
  };
}

/**
 * Asks the AI a free-form question about the recorded transactions.
 * Mapping: POST /api/ai/question
 * @param {string} question
 * @param {{ period?: string, month?: string }} options
 * @returns {Promise<object>}
 */
export async function askAiAboutSpending(question, options = {}) {
  const result = await apiRequest('/ai/question', {
    method: 'POST',
    body: JSON.stringify({
      question,
      period: options.period || 'month',
      month: options.month || undefined,
    }),
  });

  return result?.data || null;
}

/**
 * Lists previously generated analyses.
 * Mapping: GET /api/ai/history
 * @param {number} limit
 * @returns {Promise<Array<object>>}
 */
export async function getAiHistory(limit = 8) {
  const result = await apiRequest(`/ai/history?limit=${encodeURIComponent(limit)}`);
  return result?.data || [];
}
