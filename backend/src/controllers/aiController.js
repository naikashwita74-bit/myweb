/**
 * aiController.js
 * HTTP layer for the AI Expense Analyzer.
 *
 * Flow for POST /api/ai/analyze:
 *   1. Load transactions and the active monthly budget from SQLite.
 *   2. Derive the deterministic financial context (analysisEngine).
 *   3. Reuse the cached result when the dataset has not changed.
 *   4. Ask Gemini for a narrative grounded in that context.
 *   5. Merge the narrative with the deterministic figures and persist it.
 *
 * When no AI provider is configured - or the provider call fails - the
 * deterministic analysis is returned instead, so the endpoint never fails
 * because of an external dependency.
 */

const db = require('../config/database');
const analysisEngine = require('../services/analysisEngine');
const aiService = require('../services/aiService');
const analysisStore = require('../services/analysisStore');

const MAX_QUESTION_LENGTH = 500;

function parseMonthKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return null;
  const [year, month] = value.split('-').map(Number);
  if (month < 1 || month > 12) return null;
  return value;
}

function parsePeriod(value) {
  if (typeof value !== 'string') return 'month';
  const period = value.trim().toLowerCase();
  return analysisEngine.VALID_PERIODS.includes(period) ? period : 'month';
}

function loadTransactions() {
  return db.prepare('SELECT * FROM transactions ORDER BY date DESC, id DESC').all();
}

function loadBudget(monthKey) {
  if (!monthKey) return 0;
  const [year, month] = monthKey.split('-').map(Number);
  const row = db
    .prepare('SELECT amount FROM monthly_budgets WHERE year = ? AND month = ?')
    .get(year, month);
  return row ? Number(row.amount) || 0 : 0;
}

/**
 * Merges the AI narrative with the deterministic analysis.
 * Figures always come from the local engine; only wording comes from the AI.
 *
 * @param {object} localAnalysis
 * @param {object|null} aiPayload
 * @returns {object}
 */
function mergeAnalysis(localAnalysis, aiPayload) {
  if (!aiPayload) return localAnalysis;

  return {
    ...localAnalysis,
    headline: aiPayload.headline || localAnalysis.headline,
    summary: aiPayload.summary || localAnalysis.summary,
    healthScore:
      aiPayload.healthScore === null ? localAnalysis.healthScore : aiPayload.healthScore,
    spendingTrend: aiPayload.spendingTrend || localAnalysis.spendingTrend,
    insights: aiPayload.insights.length > 0 ? aiPayload.insights : localAnalysis.insights,
    anomalies: aiPayload.anomalies.length > 0 ? aiPayload.anomalies : localAnalysis.anomalies,
    recommendations:
      aiPayload.recommendations.length > 0 ? aiPayload.recommendations : localAnalysis.recommendations,
    categoriesToWatch:
      aiPayload.categoriesToWatch.length > 0
        ? aiPayload.categoriesToWatch
        : localAnalysis.categoriesToWatch,
  };
}

/**
 * Builds a deterministic answer used when no AI provider is available.
 * @param {object} context
 * @returns {string}
 */
function buildLocalAnswer(context) {
  const lines = [];

  lines.push(
    `For ${context.activeMonth} you recorded ${context.totalIncome.toFixed(
      2
    )} in income and ${context.totalExpenses.toFixed(2)} in expenses, netting ${context.netSavings.toFixed(
      2
    )} (${context.savingsRate.toFixed(1)}% savings rate).`
  );

  if (context.topCategory) {
    lines.push(
      `${context.topCategory.category} is your largest category at ${context.topCategory.amount.toFixed(
        2
      )} (${context.topCategory.share.toFixed(1)}% of spending).`
    );
  }

  if (context.budgetLimit > 0) {
    lines.push(
      `You have used ${context.budgetUsagePct.toFixed(1)}% of your ${context.budgetLimit.toFixed(
        2
      )} budget and are projected to finish near ${context.projectedMonthEndSpend.toFixed(2)}.`
    );
  }

  lines.push(
    'Set GEMINI_API_KEY in the backend environment to enable free-form AI questions against this data.'
  );

  return lines.join('\n');
}

const aiController = {
  // GET /api/ai/status
  getStatus: (req, res, next) => {
    try {
      const provider = aiService.getProviderStatus();
      const cached = analysisStore.listRecentAnalyses(5);

      return res.status(200).json({
        success: true,
        data: {
          ...provider,
          cachedAnalyses: cached.length,
          recentAnalyses: cached,
          periodOptions: analysisEngine.VALID_PERIODS,
        },
      });
    } catch (err) {
      return next(err);
    }
  },

  // POST /api/ai/analyze
  analyze: async (req, res, next) => {
    try {
      const body = req.body || {};
      const period = parsePeriod(body.period);
      const month = parseMonthKey(body.month) || analysisEngine.currentMonthKey();
      const refresh = body.refresh === true || body.refresh === 'true';

      const transactions = loadTransactions();
      const budget = loadBudget(month);

      const context = analysisEngine.buildFinancialContext(transactions, { period, month, budget });
      const scopeKey = analysisStore.computeScopeKey(transactions, { period, month, budget });

      if (!refresh) {
        const cached = analysisStore.getCachedAnalysis(scopeKey);
        if (cached) {
          return res.status(200).json({
            success: true,
            data: cached.analysis,
            meta: {
              source: cached.source,
              model: cached.model,
              cached: true,
              generatedAt: cached.createdAt,
              period: cached.period,
              month: cached.month,
              scopeKey,
            },
          });
        }
      }

      const localAnalysis = analysisEngine.buildAnalysis(context);

      let analysis = localAnalysis;
      let source = 'local';
      let model = null;
      let notice = null;

      if (aiService.isAiConfigured()) {
        try {
          const aiPayload = await aiService.requestAnalysis(context, {
            includeDescriptions: process.env.AI_INCLUDE_DESCRIPTIONS === 'true',
          });
          analysis = mergeAnalysis(localAnalysis, aiPayload);
          source = 'gemini';
          model = aiService.getModel();
        } catch (err) {
          console.error('AI analysis failed, falling back to local analysis:', err.message);
          notice = `AI provider unavailable (${err.message}). Showing the built-in analysis instead.`;
        }
      } else {
        notice =
          'No AI provider configured. Set GEMINI_API_KEY in backend/.env to enable AI-written insights.';
      }

      const stored = analysisStore.saveAnalysis({
        scopeKey,
        period,
        month,
        source,
        model,
        analysis,
      });

      // Keep the history table bounded: analyses older than 30 days are dropped.
      analysisStore.pruneOldAnalyses(30);

      return res.status(200).json({
        success: true,
        data: analysis,
        meta: {
          source,
          model,
          cached: false,
          notice,
          generatedAt: stored?.createdAt || new Date().toISOString(),
          period,
          month,
          scopeKey,
        },
      });
    } catch (err) {
      return next(err);
    }
  },

  // POST /api/ai/question
  ask: async (req, res, next) => {
    try {
      const body = req.body || {};
      const question = String(body.question || '').trim();
      const period = parsePeriod(body.period);
      const month = parseMonthKey(body.month) || analysisEngine.currentMonthKey();

      if (!question) {
        return res.status(400).json({
          success: false,
          error: 'Question is required and must not be empty.',
        });
      }

      if (question.length > MAX_QUESTION_LENGTH) {
        return res.status(400).json({
          success: false,
          error: `Question must be ${MAX_QUESTION_LENGTH} characters or fewer.`,
        });
      }

      const transactions = loadTransactions();
      const budget = loadBudget(month);
      const context = analysisEngine.buildFinancialContext(transactions, { period, month, budget });

      if (!aiService.isAiConfigured()) {
        return res.status(200).json({
          success: true,
          data: {
            answer: buildLocalAnswer(context),
            source: 'local',
            model: null,
            notice:
              'No AI provider configured. Set GEMINI_API_KEY in backend/.env to enable AI answers.',
          },
        });
      }

      try {
        const answer = await aiService.requestAnswer(context, question, {
          includeDescriptions: process.env.AI_INCLUDE_DESCRIPTIONS === 'true',
        });

        return res.status(200).json({
          success: true,
          data: { answer, source: 'gemini', model: aiService.getModel(), notice: null },
        });
      } catch (err) {
        console.error('AI question failed, falling back to local answer:', err.message);
        return res.status(200).json({
          success: true,
          data: {
            answer: buildLocalAnswer(context),
            source: 'local',
            model: null,
            notice: `AI provider unavailable (${err.message}). Answered from the recorded figures.`,
          },
        });
      }
    } catch (err) {
      return next(err);
    }
  },

  // GET /api/ai/history
  getHistory: (req, res, next) => {
    try {
      const limit = Number(req.query?.limit) || 8;
      return res.status(200).json({
        success: true,
        data: analysisStore.listRecentAnalyses(limit),
      });
    } catch (err) {
      return next(err);
    }
  },
};

module.exports = aiController;
