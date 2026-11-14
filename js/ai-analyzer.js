/**
 * ai-analyzer.js
 * AI Expense Analyzer view (Feature 6).
 *
 * Renders the analysis returned by POST /api/ai/analyze: a narrative summary,
 * a financial health score, key insights, detected anomalies, recommended
 * actions and a free-form question box backed by POST /api/ai/question.
 *
 * The view is intentionally source-agnostic: the payload is identical whether
 * it was written by Gemini or by the deterministic local analysis engine.
 */

import {
  CATEGORY_COLORS,
  escapeHtml,
  formatCurrency,
  formatMonthLabel,
  refreshIcons,
} from './transactions.js';

let categoryChartInstance = null;

const PERIOD_LABELS = {
  month: 'This Month',
  '3m': 'Last 3 Months',
  '6m': 'Last 6 Months',
  all: 'All Time',
};

const SEVERITY_META = {
  positive: { icon: 'trending-up', label: 'Positive' },
  info: { icon: 'info', label: 'Insight' },
  warning: { icon: 'alert-triangle', label: 'Watch' },
  critical: { icon: 'alert-octagon', label: 'Critical' },
};

const PRIORITY_META = {
  high: { label: 'High priority' },
  medium: { label: 'Medium priority' },
  low: { label: 'Low priority' },
};

const SUGGESTED_QUESTIONS = [
  'Which category is growing fastest?',
  'Where can I cut the most this month?',
  'Am I on track to stay within budget?',
];

/**
 * Maps a period key to its label.
 * @param {string} period
 * @returns {string}
 */
function getPeriodLabel(period) {
  return PERIOD_LABELS[period] || PERIOD_LABELS.month;
}

/**
 * Formats a timestamp coming from the API into a readable local string.
 * @param {string} value
 * @returns {string}
 */
function formatGeneratedAt(value) {
  if (!value) return '';
  const normalized = String(value).includes('T') ? String(value) : `${String(value).replace(' ', 'T')}Z`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
}

/**
 * Builds the circular health score indicator.
 * @param {number} score
 * @param {string} label
 * @returns {string}
 */
function buildScoreRing(score, label) {
  const safeScore = Math.max(0, Math.min(100, Number(score) || 0));
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - safeScore / 100);
  const tone = safeScore >= 80 ? 'good' : safeScore >= 60 ? 'ok' : safeScore >= 40 ? 'warn' : 'bad';

  return `
    <div class="ai-score" role="img" aria-label="Financial health score ${safeScore} out of 100">
      <svg viewBox="0 0 120 120" class="ai-score-ring" aria-hidden="true">
        <circle class="ai-score-track" cx="60" cy="60" r="${radius}"></circle>
        <circle
          class="ai-score-fill is-${tone}"
          cx="60"
          cy="60"
          r="${radius}"
          stroke-dasharray="${circumference.toFixed(1)}"
          stroke-dashoffset="${offset.toFixed(1)}"
        ></circle>
      </svg>
      <div class="ai-score-center">
        <span class="ai-score-value num">${safeScore}</span>
        <span class="ai-score-label">${escapeHtml(label || 'Health')}</span>
      </div>
    </div>
  `;
}

/**
 * Renders a single insight row.
 * @param {object} insight
 * @returns {string}
 */
function buildInsightMarkup(insight) {
  const severity = SEVERITY_META[insight.severity] || SEVERITY_META.info;
  const icon = insight.icon || severity.icon;
  const impact =
    insight.impact !== null && insight.impact !== undefined
      ? `<span class="ai-insight-impact num">${escapeHtml(formatCurrency(insight.impact))}</span>`
      : '';

  return `
    <li class="ai-insight is-${escapeHtml(insight.severity || 'info')}">
      <span class="ai-insight-icon"><i data-lucide="${escapeHtml(icon)}"></i></span>
      <div class="ai-insight-body">
        <div class="ai-insight-title">${escapeHtml(insight.title)}</div>
        <p class="ai-insight-detail">${escapeHtml(insight.detail)}</p>
      </div>
      ${impact}
    </li>
  `;
}

/**
 * Renders a single recommendation row.
 * @param {object} rec
 * @returns {string}
 */
function buildRecommendationMarkup(rec) {
  const priority = PRIORITY_META[rec.priority] || PRIORITY_META.medium;
  const saving =
    rec.estimatedSavings !== null && rec.estimatedSavings !== undefined
      ? `<span class="ai-rec-saving num">Est. saving ${escapeHtml(formatCurrency(rec.estimatedSavings))}</span>`
      : '';

  return `
    <li class="ai-rec is-${escapeHtml(rec.priority || 'medium')}">
      <div class="ai-rec-head">
        <span class="ai-pill is-${escapeHtml(rec.priority || 'medium')}">${escapeHtml(priority.label)}</span>
        <span class="ai-rec-title">${escapeHtml(rec.title)}</span>
      </div>
      <p class="ai-rec-action">${escapeHtml(rec.action)}</p>
      ${saving}
    </li>
  `;
}

/**
 * Renders the anomaly list.
 * @param {Array<object>} anomalies
 * @returns {string}
 */
function buildAnomalyMarkup(anomalies) {
  if (!anomalies || anomalies.length === 0) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon"><i data-lucide="shield-check"></i></div>
        <h3 class="empty-state-title">No unusual spending detected</h3>
        <p class="empty-state-desc">Nothing in this period stands out against your own history.</p>
      </div>
    `;
  }

  return `
    <ul class="ai-list">
      ${anomalies
        .map(
          (item) => `
        <li class="ai-insight is-${escapeHtml(item.severity || 'info')}">
          <span class="ai-insight-icon"><i data-lucide="${
            (SEVERITY_META[item.severity] || SEVERITY_META.info).icon
          }"></i></span>
          <div class="ai-insight-body">
            <div class="ai-insight-title">${escapeHtml(item.title)}</div>
            <p class="ai-insight-detail">${escapeHtml(item.detail)}</p>
          </div>
        </li>
      `
        )
        .join('')}
    </ul>
  `;
}

/**
 * Renders the loading skeleton shown while an analysis is running.
 * @returns {string}
 */
function buildSkeletonMarkup() {
  return `
    <div class="card ai-skeleton-card">
      <div class="ai-skeleton-line is-title"></div>
      <div class="ai-skeleton-line"></div>
      <div class="ai-skeleton-line is-short"></div>
    </div>
    <div class="kpi-grid">
      ${Array.from({ length: 4 })
        .map(
          () => `
        <div class="kpi-card ai-skeleton-card">
          <div class="ai-skeleton-line is-short"></div>
          <div class="ai-skeleton-line is-value"></div>
        </div>
      `
        )
        .join('')}
    </div>
    <div class="grid-2">
      <div class="card ai-skeleton-card">
        <div class="ai-skeleton-line is-title"></div>
        <div class="ai-skeleton-line"></div>
        <div class="ai-skeleton-line is-short"></div>
      </div>
      <div class="card ai-skeleton-card">
        <div class="ai-skeleton-line is-title"></div>
        <div class="ai-skeleton-line"></div>
        <div class="ai-skeleton-line is-short"></div>
      </div>
    </div>
  `;
}

/**
 * Renders the AI Expense Analyzer view.
 * @param {HTMLElement} container
 * @param {object} viewModel
 * @param {object} callbacks
 */
export function renderAiAnalyzerView(container, viewModel, callbacks = {}) {
  const {
    analysis = null,
    meta = null,
    status = null,
    isAnalyzing = false,
    isAsking = false,
    error = null,
    period = 'month',
    activeMonth = '',
    answer = null,
    question = '',
  } = viewModel || {};

  destroyAiCharts();

  const periodLabel = getPeriodLabel(period);
  const monthLabel = activeMonth ? formatMonthLabel(activeMonth, 'long') : '';

  const periodControl = `
    <div class="segmented" role="group" aria-label="Analysis period">
      ${Object.entries(PERIOD_LABELS)
        .map(
          ([key, label]) => `
        <button type="button" class="segmented-btn ${
          period === key ? 'is-active' : ''
        }" data-ai-period="${escapeHtml(key)}">${escapeHtml(label)}</button>
      `
        )
        .join('')}
    </div>
  `;

  const header = `
    <div class="section-header">
      <div>
        <h2 class="section-title">AI Expense Analyzer</h2>
        <p class="section-subtitle">
          Pattern detection, anomaly flags and savings guidance for ${escapeHtml(
            monthLabel || periodLabel
          )}.
        </p>
      </div>
      <div class="ai-header-actions">
        ${periodControl}
        <button type="button" class="btn btn-primary" data-action="ai-analyze" ${
          isAnalyzing ? 'disabled' : ''
        }>
          <i data-lucide="${analysis ? 'refresh-cw' : 'sparkles'}"></i>
          <span>${analysis ? 'Re-analyze' : 'Analyze spending'}</span>
        </button>
      </div>
    </div>
  `;

  const providerBanner = `
    ${
      status && !status.configured
        ? `
      <div class="status-banner">
        <div class="status-banner-main">
          <i data-lucide="cpu"></i>
          <div>
            <div class="status-banner-title">Built-in analysis mode</div>
            <div class="status-banner-desc">
              No AI provider is configured, so the analyzer is using the deterministic local engine.
              Set <code>GEMINI_API_KEY</code> in <code>backend/.env</code> to enable AI-written insights.
            </div>
          </div>
        </div>
      </div>
    `
        : ''
    }
    ${
      meta && meta.notice
        ? `
      <div class="status-banner is-warning">
        <div class="status-banner-main">
          <i data-lucide="alert-triangle"></i>
          <div>
            <div class="status-banner-title">Provider notice</div>
            <div class="status-banner-desc">${escapeHtml(meta.notice)}</div>
          </div>
        </div>
      </div>
    `
        : ''
    }
    ${
      error
        ? `
      <div class="status-banner is-exceeded">
        <div class="status-banner-main">
          <i data-lucide="alert-circle"></i>
          <div>
            <div class="status-banner-title">Analysis failed</div>
            <div class="status-banner-desc">${escapeHtml(error)}</div>
          </div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" data-action="ai-analyze">Retry</button>
      </div>
    `
        : ''
    }
  `;

  let body = '';

  if (isAnalyzing && !analysis) {
    body = buildSkeletonMarkup();
  } else if (!analysis) {
    body = `
      <div class="card">
        <div class="empty-state">
          <div class="empty-state-icon"><i data-lucide="sparkles"></i></div>
          <h3 class="empty-state-title">Ready to analyze your spending</h3>
          <p class="empty-state-desc">
            Run the analyzer to surface spending patterns, unusual transactions and savings opportunities
            for ${escapeHtml(monthLabel || periodLabel)}.
          </p>
          <button type="button" class="btn btn-primary" data-action="ai-analyze">
            <i data-lucide="sparkles"></i>
            <span>Analyze spending</span>
          </button>
        </div>
      </div>
    `;
  } else {
    const stats = analysis.stats || {};
    const sourceLabel =
      meta?.source === 'gemini' ? `Gemini · ${meta.model || 'model'}` : 'Built-in analysis';

    const trendMeta = {
      improving: { label: 'Improving', icon: 'trending-up', tone: 'is-income' },
      stable: { label: 'Stable', icon: 'minus', tone: '' },
      worsening: { label: 'Worsening', icon: 'trending-down', tone: 'is-expense' },
    };
    const trend = trendMeta[analysis.spendingTrend] || trendMeta.stable;

    const budgetUsage =
      stats.budgetUsagePct !== undefined && stats.budgetLimit > 0 ? stats.budgetUsagePct : null;

    const kpis = `
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label"><span>Total Spending</span><i data-lucide="credit-card"></i></div>
          <div class="kpi-value">${escapeHtml(formatCurrency(stats.totalExpenses))}</div>
          <div class="kpi-foot">${escapeHtml(periodLabel)} · ${stats.transactionCount || 0} entries</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label"><span>Net Savings</span><i data-lucide="piggy-bank"></i></div>
          <div class="kpi-value ${
            (stats.netSavings || 0) >= 0 ? 'is-income' : 'is-expense'
          }">${escapeHtml(formatCurrency(stats.netSavings))}</div>
          <div class="kpi-foot">${escapeHtml(formatCurrency(stats.totalIncome))} income recorded</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label"><span>Savings Rate</span><i data-lucide="percent"></i></div>
          <div class="kpi-value ${
            (stats.savingsRate || 0) < 0 ? 'is-expense' : (stats.savingsRate || 0) >= 20 ? 'is-income' : ''
          }">${(stats.savingsRate || 0).toFixed(1)}%</div>
          <div class="kpi-foot">${
            (stats.savingsRate || 0) < 0 ? 'Outflows exceed inflows' : 'Share of income retained'
          }</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label"><span>Budget Usage</span><i data-lucide="gauge"></i></div>
          <div class="kpi-value ${
            budgetUsage === null
              ? ''
              : budgetUsage > 100
                ? 'is-expense'
                : budgetUsage >= 80
                  ? 'is-warning'
                  : ''
          }">${budgetUsage === null ? '—' : `${budgetUsage.toFixed(1)}%`}</div>
          <div class="kpi-foot">${
            budgetUsage === null
              ? 'No budget set for this month'
              : `of ${escapeHtml(formatCurrency(stats.budgetLimit))} · projected ${(
                  stats.projectedBudgetUsagePct || 0
                ).toFixed(1)}%`
          }</div>
        </div>
      </div>
    `;

    const categoryRows = (analysis.categoryBreakdown || [])
      .map(
        (item) => `
        <div class="legend-row">
          <div class="legend-left">
            <span class="legend-swatch" style="background-color: ${escapeHtml(
              CATEGORY_COLORS[item.category] || '#64748b'
            )}"></span>
            <span class="legend-name">${escapeHtml(item.category)}</span>
          </div>
          <div class="legend-right">
            <span class="legend-pct num">${(item.share || 0).toFixed(1)}%</span>
            <span class="legend-amt num">${escapeHtml(formatCurrency(item.amount))}</span>
          </div>
        </div>
      `
      )
      .join('');

    const insightsMarkup =
      analysis.insights && analysis.insights.length > 0
        ? `<ul class="ai-list">${analysis.insights.map(buildInsightMarkup).join('')}</ul>`
        : `
        <div class="empty-state">
          <div class="empty-state-icon"><i data-lucide="lightbulb"></i></div>
          <h3 class="empty-state-title">No insights for this period</h3>
          <p class="empty-state-desc">Record more transactions to unlock pattern detection.</p>
        </div>
      `;

    const recommendationsMarkup =
      analysis.recommendations && analysis.recommendations.length > 0
        ? `<ul class="ai-list">${analysis.recommendations.map(buildRecommendationMarkup).join('')}</ul>`
        : `
        <div class="empty-state">
          <div class="empty-state-icon"><i data-lucide="check-circle-2"></i></div>
          <h3 class="empty-state-title">No actions required</h3>
          <p class="empty-state-desc">Your spending in this period already looks well balanced.</p>
        </div>
      `;

    const answerMarkup = answer
      ? `
        <div class="ai-answer">
          <div class="ai-answer-head">
            <i data-lucide="message-square-text"></i>
            <span>${escapeHtml(answer.source === 'gemini' ? 'AI answer' : 'Answer from your data')}</span>
          </div>
          <p class="ai-answer-body">${escapeHtml(answer.answer)}</p>
          ${answer.notice ? `<p class="ai-answer-notice">${escapeHtml(answer.notice)}</p>` : ''}
        </div>
      `
      : '';

    body = `
      <div class="card ai-hero">
        <div class="ai-hero-main">
          <div class="ai-hero-eyebrow">
            <span class="ai-badge is-${escapeHtml(
              meta?.source === 'gemini' ? 'ai' : 'local'
            )}"><i data-lucide="sparkles"></i>${escapeHtml(sourceLabel)}</span>
            <span class="ai-trend ${trend.tone}"><i data-lucide="${escapeHtml(
              trend.icon
            )}"></i>${escapeHtml(trend.label)}</span>
          </div>
          <h3 class="ai-hero-title">${escapeHtml(analysis.headline || 'Spending analysis')}</h3>
          <p class="ai-hero-summary">${escapeHtml(analysis.summary || '')}</p>
          <div class="ai-hero-meta">
            <span><i data-lucide="clock"></i>${escapeHtml(
              formatGeneratedAt(meta?.generatedAt) || 'Just now'
            )}</span>
            <span><i data-lucide="layers"></i>${escapeHtml(periodLabel)}</span>
            ${
              analysis.categoriesToWatch && analysis.categoriesToWatch.length > 0
                ? `<span><i data-lucide="eye"></i>Watch: ${escapeHtml(
                    analysis.categoriesToWatch.join(', ')
                  )}</span>`
                : ''
            }
          </div>
        </div>
        ${buildScoreRing(analysis.healthScore, analysis.healthLabel)}
      </div>

      ${kpis}

      <div class="grid-ai">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Key Insights</h3>
            <span class="card-meta">${(analysis.insights || []).length} findings</span>
          </div>
          ${insightsMarkup}
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Spending by Category</h3>
            <span class="card-meta">${escapeHtml(periodLabel)}</span>
          </div>
          ${
            (analysis.categoryBreakdown || []).length > 0
              ? `<div class="chart-wrap"><canvas id="ai-category-chart"></canvas></div>
                 <div class="chart-legend-list">${categoryRows}</div>`
              : `<div class="empty-state">
                   <div class="empty-state-icon"><i data-lucide="pie-chart"></i></div>
                   <h3 class="empty-state-title">No expenses in this period</h3>
                   <p class="empty-state-desc">Add an expense to generate a category breakdown.</p>
                 </div>`
          }
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Anomalies &amp; Flags</h3>
          <span class="card-meta">${(analysis.anomalies || []).length} flagged</span>
        </div>
        ${buildAnomalyMarkup(analysis.anomalies)}
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Recommended Actions</h3>
          <span class="card-meta">${(analysis.recommendations || []).length} suggestions</span>
        </div>
        ${recommendationsMarkup}
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Ask About Your Spending</h3>
          <span class="card-meta">${status?.configured ? 'Powered by Gemini' : 'Local data mode'}</span>
        </div>

        <form id="ai-question-form" class="ai-ask-form" novalidate>
          <input
            id="ai-question-input"
            name="question"
            type="text"
            class="input"
            maxlength="500"
            placeholder="e.g. Why did my Food spending jump this month?"
            value="${escapeHtml(question)}"
            aria-label="Ask a question about your spending"
          />
          <button type="submit" class="btn btn-primary" ${isAsking ? 'disabled' : ''}>
            <i data-lucide="send-horizontal"></i>
            <span>${isAsking ? 'Thinking...' : 'Ask'}</span>
          </button>
        </form>

        <div class="ai-suggestions">
          ${SUGGESTED_QUESTIONS.map(
            (text) => `
            <button type="button" class="ai-chip" data-action="ai-suggestion" data-question="${escapeHtml(
              text
            )}">${escapeHtml(text)}</button>
          `
          ).join('')}
        </div>

        ${answerMarkup}
      </div>
    `;
  }

  container.innerHTML = `${header}${providerBanner}${body}`;

  container.onclick = (e) => {
    const periodBtn = e.target.closest('[data-ai-period]');
    if (periodBtn) {
      const nextPeriod = periodBtn.getAttribute('data-ai-period');
      if (nextPeriod && nextPeriod !== period) {
        callbacks.onPeriodChange?.(nextPeriod);
      }
      return;
    }

    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn) return;
    const action = actionBtn.getAttribute('data-action');

    if (action === 'ai-analyze') {
      callbacks.onAnalyze?.({ refresh: Boolean(analysis) });
    } else if (action === 'ai-suggestion') {
      const suggestion = actionBtn.getAttribute('data-question');
      if (suggestion) callbacks.onAsk?.(suggestion);
    }
  };

  const questionForm = container.querySelector('#ai-question-form');
  if (questionForm) {
    questionForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = questionForm.querySelector('#ai-question-input');
      const value = (input?.value || '').trim();
      if (!value) {
        showFieldError(questionForm, 'Enter a question about your spending.');
        return;
      }
      showFieldError(questionForm, '');
      callbacks.onAsk?.(value);
    });
  }

  renderAiCharts(analysis);
  refreshIcons();
}

/**
 * Shows or clears the inline error of the question form.
 * @param {HTMLElement} formEl
 * @param {string} message
 */
function showFieldError(formEl, message) {
  const slot = formEl.querySelector('[data-error-for="question"]');
  if (slot) slot.textContent = message;
  const input = formEl.querySelector('#ai-question-input');
  if (input) {
    input.classList.toggle('is-invalid', Boolean(message));
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
}

/**
 * Destroys the Chart.js instances owned by this view.
 */
function destroyAiCharts() {
  if (categoryChartInstance) {
    categoryChartInstance.destroy();
    categoryChartInstance = null;
  }
}

/**
 * Renders the category breakdown chart.
 * @param {object|null} analysis
 */
function renderAiCharts(analysis) {
  if (typeof window === 'undefined' || typeof window.Chart === 'undefined') return;
  const canvas = document.getElementById('ai-category-chart');
  const breakdown = analysis?.categoryBreakdown || [];
  if (!canvas || breakdown.length === 0) return;

  categoryChartInstance = new window.Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: breakdown.map((item) => item.category),
      datasets: [
        {
          data: breakdown.map((item) => item.amount),
          backgroundColor: breakdown.map((item) => CATEGORY_COLORS[item.category] || '#64748b'),
          borderColor: '#ffffff',
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const item = breakdown[ctx.dataIndex];
              return `${item.category}: ${formatCurrency(item.amount)} (${(item.share || 0).toFixed(1)}%)`;
            },
          },
        },
      },
    },
  });
}
