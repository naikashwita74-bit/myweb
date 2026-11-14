/**
 * dashboard.js
 * Pure financial calculations and UI rendering for the Dashboard overview (Feature 1).
 * Independent of storage.js so data can be supplied from LocalStorage or a future REST API.
 */

import {
  CATEGORY_COLORS,
  buildTransactionRowsMarkup,
  escapeHtml,
  formatCurrency,
  formatMonthLabel,
  queryTransactions,
  refreshIcons,
} from './transactions.js';

let overviewChartInstance = null;
let categoryChartInstance = null;

/**
 * Generates an ordered list of N YYYY-MM keys ending at referenceMonth.
 * @param {string} referenceMonth
 * @param {number} count
 * @returns {Array<string>}
 */
export function getTrailingMonthKeys(referenceMonth, count = 6) {
  const [yStr, mStr] = (referenceMonth || '').split('-');
  const year = Number(yStr) || new Date().getFullYear();
  const month = Number(mStr) || new Date().getMonth() + 1;

  const keys = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const dt = new Date(year, month - 1 - i, 1);
    const kYear = dt.getFullYear();
    const kMonth = String(dt.getMonth() + 1).padStart(2, '0');
    keys.push(`${kYear}-${kMonth}`);
  }
  return keys;
}

/**
 * Computes all Dashboard KPIs, chart series, and recent transactions dynamically.
 * @param {Array<object>} transactions
 * @param {string} activeMonth YYYY-MM
 * @returns {object}
 */
export function calculateDashboardMetrics(transactions, activeMonth) {
  const list = Array.isArray(transactions) ? transactions : [];

  let totalIncome = 0;
  let totalExpenses = 0;
  let monthlyIncome = 0;
  let monthlySpending = 0;

  const categoryTotals = {};
  const monthMap = {};

  for (const tx of list) {
    const txMonth = String(tx.date || '').slice(0, 7);
    if (!monthMap[txMonth]) {
      monthMap[txMonth] = { income: 0, expense: 0 };
    }

    if (tx.type === 'income') {
      totalIncome += tx.amount;
      monthMap[txMonth].income += tx.amount;
      if (txMonth === activeMonth) {
        monthlyIncome += tx.amount;
      }
    } else if (tx.type === 'expense') {
      totalExpenses += tx.amount;
      monthMap[txMonth].expense += tx.amount;
      if (txMonth === activeMonth) {
        monthlySpending += tx.amount;
        categoryTotals[tx.category] = (categoryTotals[tx.category] || 0) + tx.amount;
      }
    }
  }

  const totalBalance = totalIncome - totalExpenses;

  const trailingKeys = getTrailingMonthKeys(activeMonth, 6);
  const monthlyOverview = trailingKeys.map((key) => ({
    monthKey: key,
    label: formatMonthLabel(key, 'short'),
    income: Math.round((monthMap[key]?.income || 0) * 100) / 100,
    expense: Math.round((monthMap[key]?.expense || 0) * 100) / 100,
  }));

  const categoryBreakdown = Object.entries(categoryTotals)
    .map(([category, amount]) => ({
      category,
      amount: Math.round(amount * 100) / 100,
      percentage: monthlySpending > 0 ? (amount / monthlySpending) * 100 : 0,
      color: CATEGORY_COLORS[category] || '#64748b',
    }))
    .sort((a, b) => b.amount - a.amount);

  const recentTransactions = queryTransactions(list, { sortBy: 'date-desc' }).slice(0, 6);

  return {
    totalBalance: Math.round(totalBalance * 100) / 100,
    totalIncome: Math.round(totalIncome * 100) / 100,
    totalExpenses: Math.round(totalExpenses * 100) / 100,
    monthlyIncome: Math.round(monthlyIncome * 100) / 100,
    monthlySpending: Math.round(monthlySpending * 100) / 100,
    monthlyOverview,
    categoryBreakdown,
    recentTransactions,
  };
}

/**
 * Destroys existing Chart.js instances owned by Dashboard.
 */
function destroyDashboardCharts() {
  if (overviewChartInstance) {
    overviewChartInstance.destroy();
    overviewChartInstance = null;
  }
  if (categoryChartInstance) {
    categoryChartInstance.destroy();
    categoryChartInstance = null;
  }
}

/**
 * Renders the Dashboard view.
 * @param {HTMLElement} container
 * @param {Array<object>} transactions
 * @param {string} activeMonth
 * @param {number} monthlyBudget
 * @param {object} callbacks
 */
export function renderDashboardView(container, transactions, activeMonth, monthlyBudget, callbacks) {
  destroyDashboardCharts();

  const metrics = calculateDashboardMetrics(transactions, activeMonth);
  const monthLabel = formatMonthLabel(activeMonth, 'long');
  const budgetPct = monthlyBudget > 0 ? (metrics.monthlySpending / monthlyBudget) * 100 : 0;

  let budgetAlertBanner = '';
  if (monthlyBudget > 0 && budgetPct > 100) {
    const overAmount = metrics.monthlySpending - monthlyBudget;
    budgetAlertBanner = `
      <div class="status-banner is-exceeded">
        <div class="status-banner-main">
          <i data-lucide="alert-octagon"></i>
          <div>
            <div class="status-banner-title">Monthly Budget Exceeded (${escapeHtml(monthLabel)})</div>
            <div class="status-banner-desc">
              Spending is <strong class="num">${escapeHtml(formatCurrency(overAmount))}</strong> over your
              <span class="num">${escapeHtml(formatCurrency(monthlyBudget))}</span> monthly limit
              (<span class="num">${budgetPct.toFixed(1)}%</span> used).
            </div>
          </div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" data-action="go-budget">Review Budget</button>
      </div>
    `;
  } else if (monthlyBudget > 0 && budgetPct >= 80) {
    const remaining = Math.max(0, monthlyBudget - metrics.monthlySpending);
    budgetAlertBanner = `
      <div class="status-banner is-warning">
        <div class="status-banner-main">
          <i data-lucide="alert-triangle"></i>
          <div>
            <div class="status-banner-title">Approaching Monthly Budget Limit (${escapeHtml(monthLabel)})</div>
            <div class="status-banner-desc">
              You have used <strong class="num">${budgetPct.toFixed(1)}%</strong> of your budget.
              <span class="num">${escapeHtml(formatCurrency(remaining))}</span> remaining.
            </div>
          </div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" data-action="go-budget">Manage Budget</button>
      </div>
    `;
  }

  const categoryLegendHtml =
    metrics.categoryBreakdown.length > 0
      ? `
      <div class="chart-legend-list">
        ${metrics.categoryBreakdown
          .map(
            (item) => `
          <div class="legend-row">
            <div class="legend-left">
              <span class="legend-swatch" style="background-color: ${escapeHtml(item.color)}"></span>
              <span class="legend-name">${escapeHtml(item.category)}</span>
            </div>
            <div class="legend-right">
              <span class="legend-pct num">${item.percentage.toFixed(1)}%</span>
              <span class="legend-amt num">${escapeHtml(formatCurrency(item.amount))}</span>
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    `
      : '';

  const recentMarkup =
    metrics.recentTransactions.length > 0
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
            ${buildTransactionRowsMarkup(metrics.recentTransactions)}
          </tbody>
        </table>
      </div>
    `
      : `
      <div class="empty-state">
        <div class="empty-state-icon"><i data-lucide="inbox"></i></div>
        <h3 class="empty-state-title">No transactions yet</h3>
        <p class="empty-state-desc">Add an income or expense entry to see balances, charts, and recent activity.</p>
        <button type="button" class="btn btn-primary" data-action="open-add-modal">
          <i data-lucide="plus"></i>
          <span>Add First Transaction</span>
        </button>
      </div>
    `;

  container.innerHTML = `
    <div class="section-header">
      <div>
        <h2 class="section-title">Financial Overview</h2>
        <p class="section-subtitle">Dynamic balances and monthly spending for ${escapeHtml(monthLabel)}.</p>
      </div>
    </div>

    ${budgetAlertBanner}

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">
          <span>Total Balance</span>
          <i data-lucide="landmark"></i>
        </div>
        <div class="kpi-value ${metrics.totalBalance < 0 ? 'is-expense' : ''}">${escapeHtml(
    formatCurrency(metrics.totalBalance)
  )}</div>
        <div class="kpi-foot">Total Income minus Total Expenses</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-label">
          <span>Total Income</span>
          <i data-lucide="trending-up"></i>
        </div>
        <div class="kpi-value is-income">${escapeHtml(formatCurrency(metrics.totalIncome))}</div>
        <div class="kpi-foot">Cumulative recorded inflows</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-label">
          <span>Total Expenses</span>
          <i data-lucide="trending-down"></i>
        </div>
        <div class="kpi-value">${escapeHtml(formatCurrency(metrics.totalExpenses))}</div>
        <div class="kpi-foot">Cumulative recorded outflows</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-label">
          <span>Monthly Spending</span>
          <i data-lucide="calendar-days"></i>
        </div>
        <div class="kpi-value ${budgetPct > 100 ? 'is-expense' : budgetPct >= 80 ? 'is-warning' : ''}">${escapeHtml(
    formatCurrency(metrics.monthlySpending)
  )}</div>
        <div class="kpi-foot">${
          monthlyBudget > 0
            ? `<span class="num">${budgetPct.toFixed(0)}%</span> of <span class="num">${escapeHtml(
                formatCurrency(monthlyBudget)
              )}</span> budget`
            : `${escapeHtml(monthLabel)} expenses`
        }</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Monthly Spending Overview</h3>
          <span class="card-meta">Trailing 6 months</span>
        </div>
        <div class="chart-wrap">
          <canvas id="dashboard-overview-chart"></canvas>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Expense Category Breakdown</h3>
          <span class="card-meta">${escapeHtml(monthLabel)}</span>
        </div>
        ${
          metrics.categoryBreakdown.length > 0
            ? `<div class="chart-wrap"><canvas id="dashboard-category-chart"></canvas></div>${categoryLegendHtml}`
            : `
            <div class="empty-state">
              <div class="empty-state-icon"><i data-lucide="pie-chart"></i></div>
              <h3 class="empty-state-title">No expenses in ${escapeHtml(monthLabel)}</h3>
              <p class="empty-state-desc">Add an expense for this month to view category distribution.</p>
            </div>
          `
        }
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">Recent Transactions</h3>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" data-action="go-transactions">
          <span>View all</span>
          <i data-lucide="arrow-right"></i>
        </button>
      </div>
      ${recentMarkup}
    </div>
  `;

  container.onclick = (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.getAttribute('data-action');
    const txId = target.getAttribute('data-tx-id');

    if (action === 'go-transactions') {
      callbacks.onNavigate('transactions');
    } else if (action === 'go-budget') {
      callbacks.onNavigate('budget');
    } else if (action === 'open-add-modal') {
      callbacks.onAddRequest();
    } else if (action === 'edit-tx' && txId) {
      callbacks.onEditRequest(txId);
    } else if (action === 'delete-tx' && txId) {
      callbacks.onDeleteRequest(txId);
    }
  };

  renderDashboardCharts(metrics);
  refreshIcons();
}

/**
 * Instantiates Chart.js canvases on the Dashboard view.
 * @param {object} metrics
 */
function renderDashboardCharts(metrics) {
  if (typeof window.Chart === 'undefined') return;

  const overviewCanvas = document.getElementById('dashboard-overview-chart');
  if (overviewCanvas) {
    overviewChartInstance = new window.Chart(overviewCanvas, {
      type: 'bar',
      data: {
        labels: metrics.monthlyOverview.map((m) => m.label),
        datasets: [
          {
            label: 'Income',
            data: metrics.monthlyOverview.map((m) => m.income),
            backgroundColor: '#16a34a',
            borderRadius: 4,
            barPercentage: 0.72,
          },
          {
            label: 'Expenses',
            data: metrics.monthlyOverview.map((m) => m.expense),
            backgroundColor: '#0f172a',
            borderRadius: 4,
            barPercentage: 0.72,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            align: 'end',
            labels: {
              boxWidth: 10,
              boxHeight: 10,
              usePointStyle: true,
              pointStyle: 'rectRounded',
              color: '#475569',
              font: { family: 'DM Sans', size: 12 },
            },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#64748b', font: { family: 'DM Sans', size: 12 } },
          },
          y: {
            beginAtZero: true,
            border: { display: false },
            grid: { color: '#f1f5f9' },
            ticks: {
              color: '#64748b',
              font: { family: 'JetBrains Mono', size: 11 },
              callback: (val) => `₹${Number(val).toLocaleString('en-IN')}`,
            },
          },
        },
      },
    });
  }

  const categoryCanvas = document.getElementById('dashboard-category-chart');
  if (categoryCanvas && metrics.categoryBreakdown.length > 0) {
    categoryChartInstance = new window.Chart(categoryCanvas, {
      type: 'doughnut',
      data: {
        labels: metrics.categoryBreakdown.map((c) => c.category),
        datasets: [
          {
            data: metrics.categoryBreakdown.map((c) => c.amount),
            backgroundColor: metrics.categoryBreakdown.map((c) => c.color),
            borderColor: '#ffffff',
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '66%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const item = metrics.categoryBreakdown[ctx.dataIndex];
                return `${item.category}: ${formatCurrency(item.amount)} (${item.percentage.toFixed(1)}%)`;
              },
            },
          },
        },
      },
    });
  }
}
