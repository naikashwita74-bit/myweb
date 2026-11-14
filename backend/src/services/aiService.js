/**
 * aiService.js
 * Google Gemini integration for the AI Expense Analyzer.
 *
 * The service is intentionally provider-agnostic at the boundary: it receives
 * a grounding context produced by analysisEngine.js, asks Gemini for a
 * structured JSON analysis, validates the response, and merges it with the
 * deterministic figures so the narrative can never contradict the numbers.
 *
 * If no API key is configured, or the provider call fails, the caller falls
 * back to the local analysis produced by analysisEngine.js.
 */

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-flash-latest';
const REQUEST_TIMEOUT_MS = 45000;

const SYSTEM_INSTRUCTION = `You are a precise personal finance analyst embedded in the LedgerFlow expense tracker.
You receive a JSON summary of a user's transactions and you must return a JSON analysis.

Rules:
- Reply with JSON only. No markdown fences, no commentary outside the JSON object.
- Only use the numbers supplied in the context. Never invent amounts, dates, or merchants.
- Be specific and actionable. Reference categories and periods by name.
- Keep every string under 320 characters and use plain, non-jargon language.
- Amounts are in INR (Indian Rupees).
- Never give regulated investment, tax, or medical advice; stick to spending behaviour.`;

const ANALYSIS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    headline: {
      type: 'STRING',
      description: 'One short sentence summarising the financial state of the period.',
    },
    summary: {
      type: 'STRING',
      description: 'Two or three sentences explaining what the numbers show.',
    },
    healthScore: {
      type: 'INTEGER',
      description: 'Overall spending health from 0 to 100.',
    },
    spendingTrend: {
      type: 'STRING',
      enum: ['improving', 'stable', 'worsening'],
    },
    insights: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          detail: { type: 'STRING' },
          category: { type: 'STRING' },
          severity: {
            type: 'STRING',
            enum: ['positive', 'info', 'warning', 'critical'],
          },
          impact: { type: 'NUMBER' },
        },
        required: ['title', 'detail', 'severity'],
      },
    },
    anomalies: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          detail: { type: 'STRING' },
          severity: {
            type: 'STRING',
            enum: ['info', 'warning', 'critical'],
          },
        },
        required: ['title', 'detail', 'severity'],
      },
    },
    recommendations: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          action: { type: 'STRING' },
          estimatedSavings: { type: 'NUMBER' },
          priority: {
            type: 'STRING',
            enum: ['high', 'medium', 'low'],
          },
        },
        required: ['title', 'action', 'priority'],
      },
    },
    categoriesToWatch: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
  },
  required: [
    'headline',
    'summary',
    'healthScore',
    'spendingTrend',
    'insights',
    'anomalies',
    'recommendations',
  ],
};

function getApiKey() {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
  return key.trim();
}

function getModel() {
  const model = (process.env.AI_MODEL || DEFAULT_MODEL).trim();
  return model || DEFAULT_MODEL;
}

/**
 * Reports whether a usable AI provider is configured.
 * @returns {boolean}
 */
function isAiConfigured() {
  const key = getApiKey();
  if (!key) return false;
  // Reject untouched placeholder values from .env.example files.
  if (/^(MY_|your_|replace|changeme)/i.test(key)) return false;
  return key.length >= 20;
}

/**
 * Describes the AI provider configuration for the client.
 * @returns {object}
 */
function getProviderStatus() {
  return {
    configured: isAiConfigured(),
    provider: 'gemini',
    model: getModel(),
    includesDescriptions: process.env.AI_INCLUDE_DESCRIPTIONS === 'true',
  };
}

function stripCodeFences(text) {
  return String(text || '')
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

/**
 * Parses a model response into JSON, tolerating prose around the payload.
 * @param {string} text
 * @returns {object|null}
 */
function parseJsonPayload(text) {
  const cleaned = stripCodeFences(text);
  if (!cleaned) return null;

  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall back to the first balanced JSON object in the response.
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/**
 * Removes fields that are not plain JSON scalars.
 * @param {*} value
 * @returns {*} sanitized value or null
 */
function sanitizeScalar(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.trim();
  return null;
}

function sanitizeList(value, mapper, limit = 8) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .map(mapper)
    .filter(Boolean)
    .slice(0, limit);
}

const SEVERITIES = ['positive', 'info', 'warning', 'critical'];
const ANOMALY_SEVERITIES = ['info', 'warning', 'critical'];
const PRIORITIES = ['high', 'medium', 'low'];
const TRENDS = ['improving', 'stable', 'worsening'];

function normalizeSeverity(value, allowed) {
  const severity = String(value || '').toLowerCase();
  return allowed.includes(severity) ? severity : 'info';
}

/**
 * Converts an arbitrary model response into the canonical analysis shape.
 * @param {object} payload
 * @returns {object|null}
 */
function normalizeAiPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const insights = sanitizeList(
    payload.insights,
    (item) => {
      const title = sanitizeScalar(item.title);
      const detail = sanitizeScalar(item.detail);
      if (!title || !detail) return null;
      return {
        title: String(title).slice(0, 160),
        detail: String(detail).slice(0, 320),
        category: sanitizeScalar(item.category),
        severity: normalizeSeverity(item.severity, SEVERITIES),
        impact: sanitizeScalar(item.impact),
      };
    },
    8
  );

  const anomalies = sanitizeList(
    payload.anomalies,
    (item) => {
      const title = sanitizeScalar(item.title);
      const detail = sanitizeScalar(item.detail);
      if (!title || !detail) return null;
      return {
        title: String(title).slice(0, 160),
        detail: String(detail).slice(0, 320),
        severity: normalizeSeverity(item.severity, ANOMALY_SEVERITIES),
      };
    },
    6
  );

  const recommendations = sanitizeList(
    payload.recommendations,
    (item) => {
      const title = sanitizeScalar(item.title);
      const action = sanitizeScalar(item.action);
      if (!title || !action) return null;
      const savings = sanitizeScalar(item.estimatedSavings);
      return {
        title: String(title).slice(0, 160),
        action: String(action).slice(0, 320),
        estimatedSavings: savings === null ? null : Math.max(0, Number(savings)),
        priority: normalizeSeverity(item.priority, PRIORITIES),
      };
    },
    6
  );

  const categoriesToWatch = Array.isArray(payload.categoriesToWatch)
    ? payload.categoriesToWatch
        .map((item) => sanitizeScalar(item))
        .filter(Boolean)
        .map((item) => String(item).slice(0, 60))
        .slice(0, 5)
    : [];

  const healthScore = sanitizeScalar(payload.healthScore);

  return {
    headline: sanitizeScalar(payload.headline),
    summary: sanitizeScalar(payload.summary),
    healthScore: healthScore === null ? null : Math.round(Math.min(100, Math.max(0, healthScore))),
    spendingTrend: TRENDS.includes(String(payload.spendingTrend || '').toLowerCase())
      ? String(payload.spendingTrend).toLowerCase()
      : null,
    insights,
    anomalies,
    recommendations,
    categoriesToWatch,
  };
}

/**
 * Builds the grounding payload sent to the model.
 * @param {object} context
 * @param {object} options
 * @returns {object}
 */
function buildGroundingPayload(context, options = {}) {
  const includeDescriptions = options.includeDescriptions === true;
  const maxTransactions = Number(options.maxTransactions) || 40;

  const transactions = (context.transactions || [])
    .slice()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, maxTransactions)
    .map((tx) => {
      const entry = {
        title: tx.title,
        amount: Number(tx.amount),
        category: tx.category,
        type: tx.type,
        date: tx.date,
      };
      if (includeDescriptions && tx.description) {
        entry.description = tx.description;
      }
      return entry;
    });

  return {
    period: context.period,
    activeMonth: context.activeMonth,
    currency: 'INR',
    aggregates: {
      totalIncome: context.totalIncome,
      totalExpenses: context.totalExpenses,
      netSavings: context.netSavings,
      savingsRatePercent: context.savingsRate,
      transactionCount: context.transactionCount,
      averageExpense: context.averageExpense,
      monthOverMonthChangePercent: context.monthOverMonthChangePct,
      averageDailySpend: context.avgDailySpend,
      projectedMonthEndSpend: context.projectedMonthEndSpend,
      budgetLimit: context.budgetLimit,
      budgetUsagePercent: context.budgetUsagePct,
      projectedBudgetUsagePercent: context.projectedBudgetUsagePct,
      subscriptionLoad: context.subscriptionLoad,
      subscriptionSharePercent: context.subscriptionSharePct,
      largestExpense: context.largestExpense,
    },
    categoryBreakdown: context.categoryBreakdown.map((item) => ({
      category: item.category,
      amount: item.amount,
      transactions: item.count,
      sharePercent: item.share,
      averageTicket: item.average,
    })),
    recurringCharges: context.recurringCharges.map((item) => ({
      title: item.title,
      monthsSeen: item.months,
      averageAmount: item.average,
      lastAmount: item.lastAmount,
    })),
    monthlyExpenseSeries: context.monthlySeries,
    recentTransactions: transactions,
  };
}

function buildAnalysisPrompt(grounding) {
  return `Analyse this personal expense data and return a JSON analysis.

CONTEXT (JSON):
${JSON.stringify(grounding, null, 2)}

Produce:
- "headline": one sentence describing the financial state of this period.
- "summary": two or three sentences interpreting the figures.
- "healthScore": integer 0-100 summarising spending health.
- "spendingTrend": "improving", "stable" or "worsening".
- "insights": up to 6 objects (title, detail, category, severity, impact) with severity one of positive|info|warning|critical.
- "anomalies": up to 5 objects (title, detail, severity) for unusual spending signals only. Return [] when nothing stands out.
- "recommendations": up to 5 objects (title, action, estimatedSavings, priority) with priority one of high|medium|low.
- "categoriesToWatch": up to 5 category names that need the closest attention.

Only reference values present in the context. Use the "impact" field for the rupee amount the insight refers to.`;
}

function buildQuestionPrompt(grounding, question) {
  return `The user asks: "${question}"

CONTEXT (JSON):
${JSON.stringify(grounding, null, 2)}

Answer the question using only these figures. Be concise (at most 160 words), lead with the direct answer, and finish with up to 3 short bullet points of practical next steps. Return JSON: {"answer": string}.`;
}

/**
 * Performs a Gemini generateContent call.
 * @param {string} prompt
 * @param {object} options
 * @returns {Promise<object>} raw parsed JSON payload
 */
async function callGemini(prompt, options = {}) {
  const apiKey = getApiKey();
  const model = getModel();
  const url = `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent`;

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.35,
      topP: 0.9,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
    },
  };

  if (options.schema) {
    body.generationConfig.responseSchema = options.schema;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const providerMessage =
      data?.error?.message || data?.message || `Gemini request failed with status ${response.status}.`;
    const error = new Error(providerMessage);
    error.status = response.status;
    error.provider = 'gemini';
    throw error;
  }

  const text = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim();

  if (!text) {
    const blocked = data?.promptFeedback?.blockReason;
    const error = new Error(
      blocked
        ? `Gemini blocked the request (${blocked}).`
        : 'Gemini returned an empty response.'
    );
    error.provider = 'gemini';
    throw error;
  }

  return parseJsonPayload(text);
}

/**
 * Requests a full analysis from Gemini.
 * @param {object} context
 * @param {object} options
 * @returns {Promise<object>} normalized AI payload
 */
async function requestAnalysis(context, options = {}) {
  const grounding = buildGroundingPayload(context, options);
  const prompt = buildAnalysisPrompt(grounding);

  let payload = null;
  try {
    payload = await callGemini(prompt, { schema: ANALYSIS_SCHEMA });
  } catch (err) {
    // Structured output is an optimisation, not a requirement: retry as plain JSON.
    if (err.status === 400) {
      payload = await callGemini(prompt, {});
    } else {
      throw err;
    }
  }

  const normalized = normalizeAiPayload(payload);
  if (!normalized) {
    throw new Error('Gemini returned a response that could not be parsed as JSON.');
  }

  return normalized;
}

/**
 * Answers a free-form question about the user's spending.
 * @param {object} context
 * @param {string} question
 * @param {object} options
 * @returns {Promise<string>}
 */
async function requestAnswer(context, question, options = {}) {
  const grounding = buildGroundingPayload(context, options);
  const prompt = buildQuestionPrompt(grounding, question);

  let payload = null;
  try {
    payload = await callGemini(prompt, {});
  } catch (err) {
    if (err.status === 400) {
      payload = await callGemini(prompt, {});
    } else {
      throw err;
    }
  }

  const answer = sanitizeScalar(payload?.answer);
  if (!answer) {
    throw new Error('Gemini returned an empty answer.');
  }

  return String(answer).slice(0, 2000);
}

module.exports = {
  DEFAULT_MODEL,
  buildGroundingPayload,
  getModel,
  getProviderStatus,
  isAiConfigured,
  normalizeAiPayload,
  requestAnalysis,
  requestAnswer,
};
