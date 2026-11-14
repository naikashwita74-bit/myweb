/**
 * analytics.js
 * Expense analytics calculations and Chart.js visualizations (Feature 4).
 * Pure calculations decoupled from storage.js.
 */

import { getTrailingMonthKeys } from './dashboard.js';
import {
  CATEGORY_COLORS,
  escapeHtml,
  formatCurrency,
  formatMonthLabel,
  refreshIcons,
} from './transactions.js';

let comparisonChartInstance = null;
let categoryBarChartInstance = null;
let distributionChartInstance = null;

/**
 * Filters transactions by period relative to activeMonth.
 * @param {Array<object>} transactions
 * @param {'month'|'3m'|'6m'|'all'} period
 * @param {string} activeMonth
 * @returns {Array<object>}
 */
function filterByPeriod(transactions, period, activeMonth) {
  if (period === 'all') return transactions;
  const count = period === 'month' ? 1 : period === '3m' ? 3 : 6;
  const allowedMonths = new Set(getTrailingMonthKeys(activeMonth, count));
  return transactions.filter((tx) => allowedMonths.has(String(tx.date || '').slice(0, 7)));
}

/**
 * Computes analytics metrics for the selected timeframe.
 * @param {Array<object>} transactions
 * @param {'month'|'3m'|'6m'|'all'} period
 * @param {string} activeMonth
 * @returns {object}
 */
export function calculateAnalytics(transactions, period, activeMonth) {
  const all = Array.isArray(transactions) ? transactions : [];
  const scoped = filterByPeriod(all, period, activeMonth);

  let totalIncome = 0;
  let totalExpenses = 0;
  const categoryMap = {};
  const monthlyMap = {};

  for (const tx of scoped) {
    const mKey = String(tx.date || '').slice(0, 7);
    if (!monthlyMap[mKey]) {
      monthlyMap[mKey] = { income: 0, expense: 0 };
    }

    if (tx.type === 'income') {
      totalIncome += tx.amount;
      monthlyMap[mKey].income += tx.amount;
    } else if (tx.type === 'expense') {
      totalExpenses += tx.amount;
      monthlyMap[mKey].expense += tx.amount;
      if (!categoryMap[tx.category]) {
        categoryMap[tx.category] = { amount: 0, count: 0 };
      }
      categoryMap[tx.category].amount += tx.amount;
      categoryMap[tx.category].count += 1;
    }
  }

  const totalSavings = totalIncome - totalExpenses;
  const savingsRate = totalIncome > 0 ? (totalSavings / totalIncome) * 100 : 0;

  const categoryBreakdown = Object.entries(categoryMap)
    .map(([category, data]) => ({
      category,
      amount: Math.round(data.amount * 100) / 100,
      count: data.count,
      percentage: totalExpenses > 0 ? (data.amount / totalExpenses) * 100 : 0,
      color: CATEGORY_COLORS[category] || '#64748b',
    }))
    .sort((a, b) => b.amount - a.amount);

  const highestCategory = categoryBreakdown[0] || null;

  let monthKeys;
  if (period === 'all') {
    const existing = Object.keys(monthlyMap).sort();
    monthKeys = existing.length > 0 ? existing.slice(-12) : getTrailingMonthKeys(activeMonth, 6);
  } else {
    const count = period === 'month' ? 6 : period === '3m' ? 3 : 6;
    monthKeys = getTrailingMonthKeys(activeMonth, count);
  }

  // Ensure monthly comparison includes full monthly data when viewing a 1-month window
  const fullMonthMap = {};
  for (const tx of all) {
    const k = String(tx.date || '').slice(0, 7);
    if (!fullMonthMap[k]) fullMonthMap[k] = { income: 0, expense: 0 };
    if (tx.type === 'income') fullMonthMap[k].income += tx.amount;
    else if (tx.type === 'expense') fullMonthMap[k].expense += tx.amount;
  }

  const monthlyComparison = monthKeys.map((k) => {
    const src = period === 'month' ? fullMonthMap[k] : monthlyMap[k];
    const inc = src?.income || 0;
    const exp = src?.expense || 0;
    return {
      monthKey: k,
      label: formatMonthLabel(k, 'short'),
      income: Math.round(inc * 100) / 100,
      expense: Math.round(exp * 100) / 100,
      savings: Math.round((inc - exp) * 100) / 100,
    };
  });

  return {
    totalIncome: Math.round(totalIncome * 100) / 100,
    totalExpenses: Math.round(totalExpenses * 100) / 100,
    totalSavings: Math.round(totalSavings * 100) / 100,
    savingsRate,
    highestCategory,
    categoryBreakdown,
    monthlyComparison,
    transactionCount: scoped.length,
  };
}

function destroyAnalyticsCharts() {
  if (comparisonChartInstance) {
    comparisonChartInstance.destroy();
    comparisonChartInstance = null;
  }
  if (categoryBarChartInstance) {
    categoryBarChartInstance.destroy();
    categoryBarChartInstance = null;
  }
  if (distributionChartInstance) {
    distributionChartInstance.destroy();
    distributionChartInstance = null;
  }
}

/**
 * Renders the Expense Analytics view (Feature 4).
 * @param {HTMLElement} container
 * @param {Array<object>} transactions
 * @param {string} activeMonth
 * @param {'month'|'3m'|'6m'|'all'} period
 * @param {object} callbacks
 */
export function renderAnalyticsView(container, transactions, activeMonth, period, callbacks) {
  destroyAnalyticsCharts();

  const data = calculateAnalytics(transactions, period, activeMonth);
  const periodTitle =
    period === 'month'
      ? formatMonthLabel(activeMonth, 'long')
      : period === '3m'
        ? 'Last 3 Months'
        : period === '6m'
          ? 'Last 6 Months'
          : 'All Time';

  const breakdownRows = data.categoryBreakdown
    .map(
      (item) => `
      <tr>
        <td>
          <div class="legend-left">
            <span class="legend-swatch" style="background-color: ${escapeHtml(item.color)}"></span>
            <span class="legend-name">${escapeHtml(item.category)}</span>
          </div>
        </td>
        <td class="num">${item.count}</td>
        <td class="td-right num">${item.percentage.toFixed(1)}%</td>
        <td class="td-right num" style="font-weight: 600">${escapeHtml(formatCurrency(item.amount))}</td>
      </tr>
    `
    )
    .join('');

  container.innerHTML = `
    <div class="section-header">
      <div>
        <h2 class="section-title">Expense Analytics</h2>
        <p class="section-subtitle">Category breakdown, income versus expenses, and savings performance (${escapeHtml(
    periodTitle
  )}).</p>
      </div>

      <div class="segmented" role="group" aria-label="Analytics timeframe">
        <button type="button" class="segmented-btn ${period === 'month' ? 'is-active' : ''}" data-period="month">Month</button>
        <button type="button" class="segmented-btn ${period === '3m' ? 'is-active' : ''}" data-period="3m">3 Months</button>
        <button type="button" class="segmented-btn ${period === '6m' ? 'is-active' : ''}" data-period="6m">6 Months</button>
        <button type="button" class="segmented-btn ${period === 'all' ? 'is-active' : ''}" data-period="all">All Time</button>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">
          <span>Total Savings</span>
          <i data-lucide="piggy-bank"></i>
        </div>
        <div class="kpi-value ${data.totalSavings >= 0 ? 'is-income' : 'is-expense'}">${escapeHtml(
    formatCurrency(data.totalSavings)
  )}</div>
        <div class="kpi-foot"><span class="num">${data.savingsRate.toFixed(1)}%</span> net savings rate</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-label">
          <span>Highest Spending Category</span>
          <i data-lucide="award"></i>
        </div>
        <div class="kpi-value" style="font-family: var(--font-display); font-size: 19px;">${data.highestCategory ? escapeHtml(data.highestCategory.category) : 'No expenses'
    }</div>
        <div class="kpi-foot">${data.highestCategory
      ? `<span class="num">${escapeHtml(
        formatCurrency(data.highestCategory.amount)
      )}</span> (<span class="num">${data.highestCategory.percentage.toFixed(1)}%</span> of spend)`
      : 'Add expenses to analyze categories'
    }</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-label">
          <span>Period Income</span>
          <i data-lucide="arrow-down-left"></i>
        </div>
        <div class="kpi-value is-income">${escapeHtml(formatCurrency(data.totalIncome))}</div>
        <div class="kpi-foot">${escapeHtml(periodTitle)}</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-label">
          <span>Period Expenses</span>
          <i data-lucide="arrow-up-right"></i>
        </div>
        <div class="kpi-value">${escapeHtml(formatCurrency(data.totalExpenses))}</div>
        <div class="kpi-foot"><span class="num">${data.transactionCount}</span> scoped transactions</div>
      </div>
    </div>

    <div class="grid-analytics">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Monthly Income vs Expenses</h3>
          <span class="card-meta">${period === 'month' ? '6-month context' : escapeHtml(periodTitle)}</span>
        </div>
        <div class="chart-wrap chart-wrap-tall">
          <canvas id="analytics-comparison-chart"></canvas>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Spending Distribution</h3>
          <span class="card-meta">${escapeHtml(periodTitle)}</span>
        </div>
        ${data.categoryBreakdown.length > 0
      ? '<div class="chart-wrap chart-wrap-tall"><canvas id="analytics-distribution-chart"></canvas></div>'
      : `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="pie-chart"></i></div><h3 class="empty-state-title">No expense data</h3><p class="empty-state-desc">No expenses recorded in this period.</p></div>`
    }
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Category-wise Expense Breakdown</h3>
          <span class="card-meta">Ranked by spend</span>
        </div>
        ${data.categoryBreakdown.length > 0
      ? '<div class="chart-wrap"><canvas id="analytics-category-bar-chart"></canvas></div>'
      : `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="bar-chart-2"></i></div><h3 class="empty-state-title">No categories to rank</h3><p class="empty-state-desc">Record an expense to generate category comparisons.</p></div>`
    }
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Category Share Table</h3>
          <span class="card-meta">${data.categoryBreakdown.length} categories</span>
        </div>
        ${data.categoryBreakdown.length > 0
      ? `
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Entries</th>
                  <th class="th-right">Share</th>
                  <th class="th-right">Total</th>
                </tr>
              </thead>
              <tbody>
                ${breakdownRows}
              </tbody>
            </table>
          </div>
        `
      : `<div class="empty-state"><p class="empty-state-desc">No expense breakdown available for ${escapeHtml(
        periodTitle
      )}.</p></div>`
    }
      </div>
    </div>
  `;

  container.onclick = (e) => {
    const btn = e.target.closest('[data-period]');
    if (!btn) return;
    const nextPeriod = btn.getAttribute('data-period');
    if (nextPeriod && nextPeriod !== period) {
      callbacks.onPeriodChange(nextPeriod);
    }
  };

  renderAnalyticsCharts(data);
  refreshIcons();
}

/**
 * Instantiates Chart.js visualizations for Analytics.
 * @param {object} data
 */
function renderAnalyticsCharts(data) {
  if (typeof window.Chart === 'undefined') return;

  const compCanvas = document.getElementById('analytics-comparison-chart');
  if (compCanvas) {
    comparisonChartInstance = new window.Chart(compCanvas, {
      type: 'bar',
      data: {
        labels: data.monthlyComparison.map((m) => m.label),
        datasets: [
          {
            label: 'Income',
            data: data.monthlyComparison.map((m) => m.income),
            backgroundColor: '#16a34a',
            borderRadius: 4,
          },
          {
            label: 'Expenses',
            data: data.monthlyComparison.map((m) => m.expense),
            backgroundColor: '#0f172a',
            borderRadius: 4,
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
              callback: (v) => `₹${Number(v).toLocaleString('en-IN')}`,
            },
          },
        },
      },
    });
  }

  const distCanvas = document.getElementById('analytics-distribution-chart');
  if (distCanvas && data.categoryBreakdown.length > 0) {
    distributionChartInstance = new window.Chart(distCanvas, {
      type: 'doughnut',
      data: {
        labels: data.categoryBreakdown.map((c) => c.category),
        datasets: [
          {
            data: data.categoryBreakdown.map((c) => c.amount),
            backgroundColor: data.categoryBreakdown.map((c) => c.color),
            borderColor: '#ffffff',
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '58%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 10,
              boxHeight: 10,
              padding: 14,
              color: '#475569',
              font: { family: 'DM Sans', size: 12 },
            },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const item = data.categoryBreakdown[ctx.dataIndex];
                return `${item.category}: ${formatCurrency(item.amount)} (${item.percentage.toFixed(1)}%)`;
              },
            },
          },
        },
      },
    });
  }

  const barCanvas = document.getElementById('analytics-category-bar-chart');
  if (barCanvas && data.categoryBreakdown.length > 0) {
    categoryBarChartInstance = new window.Chart(barCanvas, {
      type: 'bar',
      data: {
        labels: data.categoryBreakdown.map((c) => c.category),
        datasets: [
          {
            label: 'Total Spent',
            data: data.categoryBreakdown.map((c) => c.amount),
            backgroundColor: data.categoryBreakdown.map((c) => c.color),
            borderRadius: 4,
            barThickness: 18,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => formatCurrency(ctx.parsed.x),
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            border: { display: false },
            grid: { color: '#f1f5f9' },
            ticks: {
              color: '#64748b',
              font: { family: 'JetBrains Mono', size: 11 },
              callback: (v) => `₹${Number(v).toLocaleString('en-IN')}`,
            },
          },
          y: {
            grid: { display: false },
            ticks: { color: '#0f172a', font: { family: 'DM Sans', size: 12 } },
          },
        },
      },
    });
  }
}
