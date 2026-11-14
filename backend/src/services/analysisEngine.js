/**
 * analysisEngine.js
 * Deterministic analysis engine powering the AI Expense Analyzer.
 *
 * Responsibilities:
 *   1. Scope transactions to the requested analysis period.
 *   2. Derive the statistical context (totals, trends, recurring charges,
 *      budget pace, concentration) that grounds every downstream statement.
 *   3. Produce a complete analysis payload without any external service so
 *      the feature keeps working when no AI provider is configured.
 *
 * The Gemini service (aiService.js) reuses `buildFinancialContext` as its
 * grounding data and returns the exact same payload shape, which lets the
 * client render either source through a single code path.
 */

const PERIOD_MONTH_COUNT = {
  month: 1,
  '3m': 3,
  '6m': 6,
};

const VALID_PERIODS = ['month', '3m', '6m', 'all'];

const SEVERITY_RANK = {
  critical: 0,
  warning: 1,
  info: 2,
  positive: 3,
};

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function clamp(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, num));
}

function isMonthKey(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value);
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthKeyToDate(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(year, month - 1, 1);
}

function shiftMonthKey(monthKey, delta) {
  const date = monthKeyToDate(monthKey);
  date.setDate(1);
  date.setMonth(date.getMonth() + delta);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getTrailingMonthKeys(referenceMonth, count) {
  const keys = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    keys.push(shiftMonthKey(referenceMonth, -i));
  }
  return keys;
}

function daysInMonth(monthKey) {
  const date = monthKeyToDate(monthKey);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function normalizeTitle(title) {
  return String(title || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function monthKeyOf(transaction) {
  return String(transaction?.date || '').slice(0, 7);
}

function amountOf(transaction) {
  return Number(transaction?.amount) || 0;
}

function sumAmounts(list) {
  return round2(list.reduce((total, tx) => total + amountOf(tx), 0));
}

/**
 * Restricts a transaction list to the requested analysis period.
 * @param {Array<object>} transactions
 * @param {'month'|'3m'|'6m'|'all'} period
 * @param {string} activeMonth YYYY-MM
 * @returns {Array<object>}
 */
function scopeTransactions(transactions, period, activeMonth) {
  const list = Array.isArray(transactions) ? transactions : [];
  if (period === 'all') return list.slice();
  const count = PERIOD_MONTH_COUNT[period] || 1;
  const allowed = new Set(getTrailingMonthKeys(activeMonth, count));
  return list.filter((tx) => allowed.has(monthKeyOf(tx)));
}

/**
 * Aggregates expenses by category with share and average ticket size.
 * @param {Array<object>} expenses
 * @returns {Array<object>}
 */
function buildCategoryBreakdown(expenses) {
  const map = new Map();

  for (const tx of expenses) {
    const key = tx.category || 'Other';
    const entry = map.get(key) || { category: key, amount: 0, count: 0 };
    entry.amount += amountOf(tx);
    entry.count += 1;
    map.set(key, entry);
  }

  const total = [...map.values()].reduce((sum, item) => sum + item.amount, 0);

  return [...map.values()]
    .map((item) => ({
      category: item.category,
      amount: round2(item.amount),
      count: item.count,
      share: total > 0 ? round2((item.amount / total) * 100) : 0,
      average: item.count > 0 ? round2(item.amount / item.count) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * Detects recurring charges: the same normalized title charged across 2+ months.
 * @param {Array<object>} transactions
 * @returns {Array<object>}
 */
function findRecurringCharges(transactions) {
  const map = new Map();

  for (const tx of transactions) {
    if (tx.type !== 'expense') continue;
    const key = normalizeTitle(tx.title);
    if (!key) continue;

    const entry = map.get(key) || {
      title: tx.title,
      total: 0,
      count: 0,
      months: new Set(),
      lastAmount: amountOf(tx),
      lastDate: tx.date,
    };

    entry.total += amountOf(tx);
    entry.count += 1;
    entry.months.add(monthKeyOf(tx));

    if (String(tx.date) > String(entry.lastDate)) {
      entry.lastDate = tx.date;
      entry.lastAmount = amountOf(tx);
    }

    map.set(key, entry);
  }

  return [...map.values()]
    .filter((entry) => entry.months.size >= 2)
    .map((entry) => ({
      title: entry.title,
      months: entry.months.size,
      occurrences: entry.count,
      total: round2(entry.total),
      average: round2(entry.total / entry.count),
      lastAmount: round2(entry.lastAmount),
      lastDate: entry.lastDate,
    }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Computes the spending direction between the active month and the one before.
 * @param {number} currentAmount
 * @param {number} previousAmount
 * @returns {'improving'|'stable'|'worsening'}
 */
function computeSpendingTrend(currentAmount, previousAmount) {
  if (previousAmount <= 0) return currentAmount > 0 ? 'worsening' : 'stable';
  const change = ((currentAmount - previousAmount) / previousAmount) * 100;
  if (change <= -5) return 'improving';
  if (change >= 5) return 'worsening';
  return 'stable';
}

function scoreLabel(score) {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Healthy';
  if (score >= 40) return 'Under Strain';
  return 'Critical';
}

/**
 * Builds the complete statistical context for a set of transactions.
 * This object is the single source of truth for every number shown in the UI
 * and the grounding payload sent to the AI provider.
 *
 * @param {Array<object>} allTransactions
 * @param {{ period?: string, month?: string, budget?: number }} options
 * @returns {object}
 */
function buildFinancialContext(allTransactions, options = {}) {
  const period = VALID_PERIODS.includes(options.period) ? options.period : 'month';
  const activeMonth = isMonthKey(options.month) ? options.month : currentMonthKey();
  const budgetLimit = Number(options.budget) > 0 ? round2(options.budget) : 0;

  const transactions = Array.isArray(allTransactions) ? allTransactions : [];
  const scoped = scopeTransactions(transactions, period, activeMonth);

  const scopedIncome = scoped.filter((tx) => tx.type === 'income');
  const scopedExpenses = scoped.filter((tx) => tx.type === 'expense');

  const totalIncome = sumAmounts(scopedIncome);
  const totalExpenses = sumAmounts(scopedExpenses);
  const netSavings = round2(totalIncome - totalExpenses);
  const savingsRate = totalIncome > 0 ? round2((netSavings / totalIncome) * 100) : 0;

  const categoryBreakdown = buildCategoryBreakdown(scopedExpenses);
  // Recurring charges are detected across the whole ledger: a subscription is
  // only recognisable by comparing the same title across several months.
  const recurringCharges = findRecurringCharges(transactions);
  const activeRecurringCharges = recurringCharges.filter(
    (item) => monthKeyOf({ date: item.lastDate }) === activeMonth
  );

  const activeMonthExpenses = transactions.filter(
    (tx) => tx.type === 'expense' && monthKeyOf(tx) === activeMonth
  );
  const activeMonthExpenseTotal = sumAmounts(activeMonthExpenses);

  const previousMonthKey = shiftMonthKey(activeMonth, -1);
  const previousMonthExpenseTotal = sumAmounts(
    transactions.filter((tx) => tx.type === 'expense' && monthKeyOf(tx) === previousMonthKey)
  );

  const monthOverMonthChangePct =
    previousMonthExpenseTotal > 0
      ? round2(((activeMonthExpenseTotal - previousMonthExpenseTotal) / previousMonthExpenseTotal) * 100)
      : activeMonthExpenseTotal > 0
        ? 100
        : 0;

  const spendingTrend = computeSpendingTrend(activeMonthExpenseTotal, previousMonthExpenseTotal);

  const now = new Date();
  const isCurrentMonth = activeMonth === currentMonthKey();
  const totalDaysInMonth = daysInMonth(activeMonth);
  const elapsedDays = isCurrentMonth ? now.getDate() : totalDaysInMonth;
  const avgDailySpend = elapsedDays > 0 ? round2(activeMonthExpenseTotal / elapsedDays) : 0;
  const projectedMonthEndSpend = round2(avgDailySpend * totalDaysInMonth);

  const budgetUsagePct = budgetLimit > 0 ? round2((activeMonthExpenseTotal / budgetLimit) * 100) : 0;
  const projectedBudgetUsagePct =
    budgetLimit > 0 ? round2((projectedMonthEndSpend / budgetLimit) * 100) : 0;

  const seriesKeys =
    period === 'all'
      ? [...new Set(transactions.map(monthKeyOf))].filter(Boolean).sort().slice(-12)
      : getTrailingMonthKeys(activeMonth, PERIOD_MONTH_COUNT[period] || 1);

  const monthlySeries = seriesKeys.map((key) => ({
    monthKey: key,
    expense: sumAmounts(
      transactions.filter((tx) => tx.type === 'expense' && monthKeyOf(tx) === key)
    ),
  }));

  const subscriptionLoad = round2(
    activeRecurringCharges.reduce((sum, item) => sum + item.lastAmount, 0)
  );
  const subscriptionSharePct =
    activeMonthExpenseTotal > 0 ? round2((subscriptionLoad / activeMonthExpenseTotal) * 100) : 0;

  const largestExpense = scopedExpenses.reduce(
    (largest, tx) => (!largest || amountOf(tx) > amountOf(largest) ? tx : largest),
    null
  );

  const topCategory = categoryBreakdown[0] || null;

  const averageExpense = scopedExpenses.length > 0 ? round2(totalExpenses / scopedExpenses.length) : 0;

  const context = {
    period,
    activeMonth,
    budgetLimit,
    transactionCount: scoped.length,
    expenseCount: scopedExpenses.length,
    incomeCount: scopedIncome.length,
    transactions: scoped,
    totalIncome,
    totalExpenses,
    netSavings,
    savingsRate,
    averageExpense,
    activeMonthExpenseTotal,
    previousMonthExpenseTotal,
    monthOverMonthChangePct,
    spendingTrend,
    avgDailySpend,
    projectedMonthEndSpend,
    elapsedDays,
    totalDaysInMonth,
    budgetUsagePct,
    projectedBudgetUsagePct,
    categoryBreakdown,
    recurringCharges,
    activeRecurringCharges,
    subscriptionLoad,
    subscriptionSharePct,
    largestExpense: largestExpense
      ? {
          title: largestExpense.title,
          amount: round2(amountOf(largestExpense)),
          category: largestExpense.category,
          date: largestExpense.date,
        }
      : null,
    monthlySeries,
    topCategory,
  };

  context.healthScore = calculateHealthScore(context);
  context.healthLabel = scoreLabel(context.healthScore);
  return context;
}

/**
 * Scores overall financial health (0-100) from the derived context.
 * @param {object} context
 * @returns {number}
 */
function calculateHealthScore(context) {
  let score = 100;

  if (context.totalIncome <= 0 && context.totalExpenses > 0) {
    score -= 25;
  } else if (context.savingsRate < 0) {
    score -= Math.min(30, Math.round(Math.abs(context.savingsRate)));
  } else if (context.savingsRate < 10) {
    score -= 15;
  } else if (context.savingsRate < 20) {
    score -= 7;
  }

  if (context.budgetUsagePct > 100) {
    score -= Math.min(25, Math.round((context.budgetUsagePct - 100) * 0.5));
  } else if (context.budgetUsagePct >= 80) {
    score -= 8;
  }

  if (context.topCategory) {
    if (context.topCategory.share > 50) score -= 10;
    else if (context.topCategory.share > 40) score -= 5;
  }

  if (context.monthOverMonthChangePct > 25) score -= 8;
  else if (context.monthOverMonthChangePct > 10) score -= 4;
  else if (context.monthOverMonthChangePct < -10) score += 3;

  if (context.subscriptionSharePct > 15) score -= 5;

  if (context.transactionCount === 0) score = 50;

  return Math.round(clamp(score, 0, 100));
}

function insight(title, detail, severity, extra = {}) {
  return {
    title,
    detail,
    severity,
    category: extra.category || null,
    impact: Number.isFinite(extra.impact) ? round2(extra.impact) : null,
    icon: extra.icon || null,
  };
}

function recommendation(title, action, estimatedSavings, priority) {
  return {
    title,
    action,
    estimatedSavings: Number.isFinite(estimatedSavings) ? round2(estimatedSavings) : null,
    priority,
  };
}

/**
 * Derives insight statements from the financial context.
 * @param {object} context
 * @returns {Array<object>}
 */
function buildInsights(context) {
  const insights = [];
  const { topCategory } = context;

  if (context.transactionCount === 0) {
    return [
      insight(
        'No data to analyze yet',
        'Add income or expense entries and run the analyzer again to unlock pattern detection.',
        'info'
      ),
    ];
  }

  if (context.savingsRate >= 20) {
    insights.push(
      insight(
        'Strong savings rate',
        `You kept ${context.savingsRate.toFixed(1)}% of income (${context.netSavings.toFixed(2)}) in this period.`,
        'positive',
        { impact: context.netSavings }
      )
    );
  } else if (context.savingsRate < 0) {
    insights.push(
      insight(
        'Spending exceeds income',
        `Outflows are ${Math.abs(context.savingsRate).toFixed(1)}% above inflows, a deficit of ${Math.abs(
          context.netSavings
        ).toFixed(2)}.`,
        'critical',
        { impact: context.netSavings }
      )
    );
  } else {
    insights.push(
      insight(
        'Thin savings margin',
        `Only ${context.savingsRate.toFixed(1)}% of income is being saved (${context.netSavings.toFixed(2)}).`,
        'warning',
        { impact: context.netSavings }
      )
    );
  }

  if (topCategory) {
    insights.push(
      insight(
        `${topCategory.category} leads spending`,
        `${topCategory.category} accounts for ${topCategory.share.toFixed(1)}% of outflows across ${topCategory.count} transaction${
          topCategory.count === 1 ? '' : 's'
        }, averaging ${topCategory.average.toFixed(2)} each.`,
        topCategory.share > 40 ? 'warning' : 'info',
        { category: topCategory.category, impact: topCategory.amount }
      )
    );
  }

  if (context.monthOverMonthChangePct !== 0) {
    const direction = context.monthOverMonthChangePct > 0 ? 'up' : 'down';
    insights.push(
      insight(
        `Spending is ${direction} ${Math.abs(context.monthOverMonthChangePct).toFixed(1)}%`,
        `Month-to-date outflows moved ${direction} from ${context.previousMonthExpenseTotal.toFixed(
          2
        )} in the previous month to ${context.activeMonthExpenseTotal.toFixed(2)}.`,
        context.monthOverMonthChangePct > 25 ? 'warning' : context.monthOverMonthChangePct < 0 ? 'positive' : 'info',
        {
          impact: context.activeMonthExpenseTotal,
          icon: context.monthOverMonthChangePct < 0 ? 'trending-down' : 'trending-up',
        }
      )
    );
  }

  if (context.budgetLimit > 0) {
    const usage = context.budgetUsagePct;
    const budgetTitle =
      usage > 100
        ? 'Budget exceeded'
        : usage >= 80
          ? `Budget nearly consumed (${usage.toFixed(1)}%)`
          : `Budget on track (${usage.toFixed(1)}% used)`;
    insights.push(
      insight(
        budgetTitle,
        `You have spent ${context.activeMonthExpenseTotal.toFixed(2)} of a ${context.budgetLimit.toFixed(
          2
        )} monthly budget. At the current pace of ${context.avgDailySpend.toFixed(2)} per day the month ends near ${context.projectedMonthEndSpend.toFixed(
          2
        )}.`,
        usage > 100 ? 'critical' : usage >= 80 ? 'warning' : 'positive',
        { impact: context.activeMonthExpenseTotal, icon: 'gauge' }
      )
    );
  }

  if (context.activeRecurringCharges.length > 0) {
    insights.push(
      insight(
        `${context.activeRecurringCharges.length} recurring charge${
          context.activeRecurringCharges.length === 1 ? '' : 's'
        } detected`,
        `Recurring commitments run about ${context.subscriptionLoad.toFixed(
          2
        )} per month (${context.subscriptionSharePct.toFixed(1)}% of this month's spend).`,
        context.subscriptionSharePct > 15 ? 'warning' : 'info',
        { impact: context.subscriptionLoad }
      )
    );
  }

  insights.sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9)
  );

  return insights;
}

/**
 * Derives anomalies (unusual spending signals) from the financial context.
 * @param {object} context
 * @returns {Array<object>}
 */
function buildAnomalies(context) {
  const anomalies = [];

  if (context.transactionCount === 0) return anomalies;

  const byCategory = new Map();
  for (const tx of context.categoryBreakdown) {
    byCategory.set(tx.category, tx);
  }

  const scopedExpenses = context.categoryBreakdown;

  // Unusually large single transaction compared to its category average.
  for (const item of scopedExpenses) {
    if (item.count < 3) continue;
    if (item.average > 0 && item.amount > item.average * 3 && item.amount >= 500) {
      anomalies.push({
        title: `Large ${item.category} concentration`,
        detail: `${item.category} totals ${item.amount.toFixed(2)} across ${item.count} entries, averaging ${item.average.toFixed(
          2
        )} — well above the ${(item.average * 2).toFixed(2)} two-ticket threshold.`,
        severity: item.amount > item.average * 5 ? 'critical' : 'warning',
      });
    }
  }

  if (context.topCategory && context.topCategory.share > 45) {
    anomalies.push({
      title: `${context.topCategory.category} dominates the budget`,
      detail: `A single category makes up ${context.topCategory.share.toFixed(
        1
      )}% of all spending, which usually signals an unbalanced allocation.`,
      severity: 'warning',
    });
  }

  if (context.budgetLimit > 0 && context.projectedBudgetUsagePct > 100) {
    anomalies.push({
      title: 'Projected to overshoot the monthly budget',
      detail: `At ${context.avgDailySpend.toFixed(2)} per day you are on pace for ${context.projectedMonthEndSpend.toFixed(
        2
      )}, which is ${context.projectedBudgetUsagePct.toFixed(1)}% of your ${context.budgetLimit.toFixed(2)} limit.`,
      severity: 'critical',
    });
  }

  if (context.monthOverMonthChangePct > 25) {
    anomalies.push({
      title: 'Sharp month-over-month increase',
      detail: `Outflows are up ${context.monthOverMonthChangePct.toFixed(
        1
      )}% compared with the previous month, which is worth investigating.`,
      severity: 'warning',
    });
  }

  if (context.totalIncome <= 0 && context.totalExpenses > 0) {
    anomalies.push({
      title: 'No income recorded in this period',
      detail: 'Outflows were recorded without a matching inflow, so savings figures are not meaningful yet.',
      severity: 'warning',
    });
  }

  if (context.largestExpense && context.largestExpense.amount >= 1000) {
    anomalies.push({
      title: `Large single expense: ${context.largestExpense.title}`,
      detail: `${context.largestExpense.amount.toFixed(
        2
      )} on ${context.largestExpense.date} is the single largest outflow recorded in this period.`,
      severity: 'info',
    });
  }

  return anomalies;
}

/**
 * Derives actionable recommendations from the financial context.
 * @param {object} context
 * @returns {Array<object>}
 */
function buildRecommendations(context) {
  const recommendations = [];

  if (context.transactionCount === 0) {
    return [
      recommendation(
        'Record your first transactions',
        'Add a few income and expense entries so the analyzer can detect patterns and estimate savings.',
        null,
        'high'
      ),
    ];
  }

  if (context.topCategory && context.topCategory.amount > 0) {
    const savings = round2(context.topCategory.amount * 0.1);
    recommendations.push(
      recommendation(
        `Trim ${context.topCategory.category} by 10%`,
        `${context.topCategory.category} is ${context.topCategory.share.toFixed(
          1
        )}% of spending. A 10% trim frees about ${savings.toFixed(2)} per period.`,
        savings,
        context.topCategory.share > 40 ? 'high' : 'medium'
      )
    );
  }

  const recurringCandidates =
    context.activeRecurringCharges.length > 0 ? context.activeRecurringCharges : context.recurringCharges;

  if (recurringCandidates.length > 0) {
    const biggest = recurringCandidates[0];
    recommendations.push(
      recommendation(
        `Audit "${biggest.title}"`,
        `This charge has repeated across ${biggest.months} months at roughly ${biggest.average.toFixed(
          2
        )} each time. Review whether it is still needed.`,
        biggest.average,
        recurringCandidates.length > 2 ? 'high' : 'medium'
      )
    );
  }

  if (context.budgetLimit <= 0) {
    recommendations.push(
      recommendation(
        'Set a monthly budget',
        'Without a budget target the analyzer cannot estimate a safe daily allowance or flag overspending.',
        null,
        'high'
      )
    );
  } else if (context.projectedBudgetUsagePct > 100) {
    const overshoot = round2(context.projectedMonthEndSpend - context.budgetLimit);
    recommendations.push(
      recommendation(
        'Bring the projected month back inside budget',
        `At the current pace you will finish ${overshoot.toFixed(
          2
        )} over the limit. Capping the top category or pausing recurring charges closes the gap.`,
        overshoot,
        'high'
      )
    );
  } else {
    const headroom = round2(context.budgetLimit - context.projectedMonthEndSpend);
    recommendations.push(
      recommendation(
        'Protect the remaining budget headroom',
        `You are projected to finish about ${headroom.toFixed(
          2
        )} under budget. Keeping daily spend near ${(context.avgDailySpend * 0.9).toFixed(2)} preserves it.`,
        headroom,
        'low'
      )
    );
  }

  if (context.savingsRate < 15 && context.totalIncome > 0) {
    const target = round2(context.totalIncome * 0.1);
    recommendations.push(
      recommendation(
        'Automate a 10% savings transfer',
        `Moving ${target.toFixed(2)} per period out of every inflow lifts the savings rate above a 10% floor.`,
        target,
        'high'
      )
    );
  }

  if (context.avgDailySpend > 0) {
    const savings = round2(context.avgDailySpend * 0.2 * context.totalDaysInMonth);
    recommendations.push(
      recommendation(
        'Adopt a daily spending cap',
        `A ${context.avgDailySpend.toFixed(2)} average day is adding up. A 20% daily cap saves roughly ${savings.toFixed(
          2
        )} across the month.`,
        savings,
        'medium'
      )
    );
  }

  const priorityRank = { high: 0, medium: 1, low: 2 };
  recommendations.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);

  return recommendations;
}

/**
 * Builds the analysis payload rendered by the AI Expense Analyzer view.
 * @param {object} context
 * @returns {object}
 */
function buildLocalAnalysis(context) {
  const insights = buildInsights(context);
  const anomalies = buildAnomalies(context);
  const recommendations = buildRecommendations(context);

  const categoriesToWatch = context.categoryBreakdown
    .slice(0, 3)
    .map((item) => item.category);

  const headline = context.transactionCount === 0
    ? 'No transactions in the selected period'
    : `${context.healthLabel} financial health · ${context.totalExpenses.toFixed(2)} spent`;

  const summary =
    context.transactionCount === 0
      ? 'There is nothing to analyze for the selected period yet.'
      : `Across ${context.transactionCount} transaction${
          context.transactionCount === 1 ? '' : 's'
        } you recorded ${context.totalIncome.toFixed(2)} in income and ${context.totalExpenses.toFixed(
          2
        )} in expenses, netting ${context.netSavings.toFixed(2)} (${
          context.savingsRate.toFixed(1)
        }% savings rate). Spending is trending ${context.spendingTrend}${
          context.topCategory ? `, led by ${context.topCategory.category} at ${context.topCategory.share.toFixed(1)}% of outflows` : ''
        }.`;

  return {
    headline,
    summary,
    healthScore: context.healthScore,
    healthLabel: context.healthLabel,
    spendingTrend: context.spendingTrend,
    insights,
    anomalies,
    recommendations,
    categoriesToWatch,
    stats: {
      totalIncome: context.totalIncome,
      totalExpenses: context.totalExpenses,
      netSavings: context.netSavings,
      savingsRate: context.savingsRate,
      transactionCount: context.transactionCount,
      averageExpense: context.averageExpense,
      topCategory: context.topCategory ? context.topCategory.category : null,
      topCategoryShare: context.topCategory ? context.topCategory.share : 0,
      avgDailySpend: context.avgDailySpend,
      projectedMonthEndSpend: context.projectedMonthEndSpend,
      budgetUsagePct: context.budgetUsagePct,
      projectedBudgetUsagePct: context.projectedBudgetUsagePct,
      monthOverMonthChangePct: context.monthOverMonthChangePct,
      recurringChargeCount: context.activeRecurringCharges.length,
      subscriptionLoad: context.subscriptionLoad,
      budgetLimit: context.budgetLimit,
    },
    categoryBreakdown: context.categoryBreakdown,
    recurringCharges: context.activeRecurringCharges,
  };
}

/**
 * Convenience entry point: derives the context and the analysis payload.
 * @param {Array<object>} transactions
 * @param {{ period?: string, month?: string, budget?: number }} options
 * @returns {{ context: object, analysis: object }}
 */
function analyzeTransactions(transactions, options = {}) {
  const context = buildFinancialContext(transactions, options);
  return { context, analysis: buildLocalAnalysis(context) };
}

module.exports = {
  PERIOD_MONTH_COUNT,
  VALID_PERIODS,
  analyzeTransactions,
  buildAnalysis: buildLocalAnalysis,
  buildFinancialContext,
  buildCategoryBreakdown,
  currentMonthKey,
  findRecurringCharges,
  getTrailingMonthKeys,
  isMonthKey,
  scopeTransactions,
};
