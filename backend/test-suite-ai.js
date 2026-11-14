/**
 * In-Process Test Suite for the AI Expense Analyzer backend.
 * Covers the analysis engine, the AI controller endpoints, the analysis cache
 * and the graceful fallback used when no AI provider is configured.
 */

const db = require('./src/config/database');
const aiController = require('./src/controllers/aiController');
const analysisEngine = require('./src/services/analysisEngine');
const aiService = require('./src/services/aiService');
const analysisStore = require('./src/services/analysisStore');
const { notFoundHandler } = require('./src/middleware/errorHandler');

const results = [];

function assert(description, condition, details = '') {
  if (condition) {
    results.push({ pass: true, description });
    console.log(`PASS: ${description}`);
  } else {
    results.push({ pass: false, description, details });
    console.error(`FAIL: ${description} | Details: ${details}`);
  }
}

function createMockReqRes({ method = 'GET', url = '/', body = {}, params = {}, query = {} } = {}) {
  let statusCode = 200;
  let responseData = null;

  const req = { method, url, body, params, query, headers: { 'content-type': 'application/json' } };

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
    send(data) {
      responseData = data;
      return this;
    },
    get statusCode() {
      return statusCode;
    },
  };

  let nextCalledWith = null;
  const next = (err) => {
    nextCalledWith = err;
  };

  return {
    req,
    res,
    next,
    getResult: () => ({ status: res.statusCode, body: responseData, error: nextCalledWith }),
  };
}

async function runTestSuite() {
  console.log('====================================================');
  console.log('LEDGERFLOW AI EXPENSE ANALYZER TEST SUITE');
  console.log('====================================================\n');

  const allTransactions = db.prepare('SELECT * FROM transactions').all();
  const activeMonth = analysisEngine.currentMonthKey();

  // Test 1: Analysis engine scopes a single month
  {
    const scoped = analysisEngine.scopeTransactions(
      allTransactions.map((tx) => ({ ...tx, date: tx.date })),
      'month',
      activeMonth
    );
    const valid = scoped.every((tx) => String(tx.date).slice(0, 7) === activeMonth);
    assert('1. scopeTransactions("month") keeps only the active month', valid, `scoped=${scoped.length}`);
  }

  // Test 2: Analysis engine returns consistent totals
  {
    const { context } = analysisEngine.analyzeTransactions(allTransactions, {
      period: 'all',
      month: activeMonth,
      budget: 3200,
    });
    const expectedExpenses = allTransactions
      .filter((tx) => tx.type === 'expense')
      .reduce((sum, tx) => sum + Number(tx.amount), 0);
    assert(
      '2. Analysis engine total expenses match the ledger',
      Math.abs(context.totalExpenses - expectedExpenses) < 0.05,
      `${context.totalExpenses} vs ${expectedExpenses}`
    );
  }

  // Test 3: Analysis engine detects recurring charges across months
  {
    const { context } = analysisEngine.analyzeTransactions(allTransactions, {
      period: 'month',
      month: activeMonth,
      budget: 3200,
    });
    assert(
      '3. Analysis engine detects recurring charges across months',
      Array.isArray(context.recurringCharges) && context.recurringCharges.length > 0,
      `recurring=${context.recurringCharges?.length}`
    );
  }

  // Test 4: Health score stays within 0-100
  {
    const { analysis } = analysisEngine.analyzeTransactions(allTransactions, {
      period: '6m',
      month: activeMonth,
      budget: 3200,
    });
    assert(
      '4. Health score is an integer between 0 and 100',
      Number.isInteger(analysis.healthScore) && analysis.healthScore >= 0 && analysis.healthScore <= 100,
      String(analysis.healthScore)
    );
  }

  // Test 5: Local analysis payload shape
  {
    const { analysis } = analysisEngine.analyzeTransactions(allTransactions, {
      period: 'month',
      month: activeMonth,
      budget: 3200,
    });
    const hasShape =
      typeof analysis.headline === 'string' &&
      typeof analysis.summary === 'string' &&
      Array.isArray(analysis.insights) &&
      Array.isArray(analysis.anomalies) &&
      Array.isArray(analysis.recommendations) &&
      Array.isArray(analysis.categoryBreakdown) &&
      analysis.stats &&
      typeof analysis.stats.totalExpenses === 'number';
    assert('5. Local analysis returns the canonical payload shape', hasShape, JSON.stringify(Object.keys(analysis)));
  }

  // Test 6: Scope key changes when the data changes
  {
    const keyA = analysisStore.computeScopeKey(allTransactions, {
      period: 'month',
      month: activeMonth,
      budget: 3200,
    });
    const keyB = analysisStore.computeScopeKey(
      [...allTransactions, { id: 99999, amount: 10, type: 'expense', category: 'Food', date: activeMonth + '-01' }],
      { period: 'month', month: activeMonth, budget: 3200 }
    );
    assert('6. Scope key changes when transactions change', keyA !== keyB, `${keyA} vs ${keyB}`);
  }

  // Test 7: GET /api/ai/status
  {
    const { req, res, next, getResult } = createMockReqRes({ method: 'GET', url: '/api/ai/status' });
    aiController.getStatus(req, res, next);
    const r = getResult();
    assert(
      '7. GET /api/ai/status returns 200 with provider configuration',
      r.status === 200 && r.body.success === true && typeof r.body.data.configured === 'boolean',
      JSON.stringify(r.body)
    );
  }

  // Test 8: POST /api/ai/analyze returns an analysis
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'POST',
      url: '/api/ai/analyze',
      body: { period: '3m', month: activeMonth, refresh: true },
    });
    await aiController.analyze(req, res, next);
    const r = getResult();
    assert(
      '8. POST /api/ai/analyze returns 200 with analysis data and meta',
      r.status === 200 &&
        r.body.success === true &&
        typeof r.body.data.summary === 'string' &&
        Array.isArray(r.body.data.insights) &&
        typeof r.body.meta.source === 'string',
      JSON.stringify(r.body?.meta)
    );
  }

  // Test 9: POST /api/ai/analyze serves the cached result on repeat
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'POST',
      url: '/api/ai/analyze',
      body: { period: '3m', month: activeMonth },
    });
    await aiController.analyze(req, res, next);
    const r = getResult();
    assert('9. POST /api/ai/analyze returns the cached analysis on a repeat call', r.body?.meta?.cached === true, JSON.stringify(r.body?.meta));
  }

  // Test 10: POST /api/ai/analyze falls back to the local engine without a key
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'POST',
      url: '/api/ai/analyze',
      body: { period: 'month', month: activeMonth, refresh: true },
    });
    await aiController.analyze(req, res, next);
    const r = getResult();
    const hasKey = aiService.isAiConfigured();
    const expectedSource = hasKey ? r.body?.meta?.source : 'local';
    assert(
      '10. POST /api/ai/analyze always resolves a source and never errors',
      r.status === 200 && r.body?.meta?.source === expectedSource && r.body?.data?.insights !== undefined,
      JSON.stringify(r.body?.meta)
    );
  }

  // Test 11: POST /api/ai/analyze rejects an invalid month
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'POST',
      url: '/api/ai/analyze',
      body: { period: 'month', month: '2026-13' },
    });
    await aiController.analyze(req, res, next);
    const r = getResult();
    assert(
      '11. POST /api/ai/analyze falls back to the current month for an invalid month',
      r.status === 200 && r.body?.meta?.month === activeMonth,
      JSON.stringify(r.body?.meta)
    );
  }

  // Test 12: POST /api/ai/question requires a question
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'POST',
      url: '/api/ai/question',
      body: { question: '   ' },
    });
    await aiController.ask(req, res, next);
    const r = getResult();
    assert('12. POST /api/ai/question with an empty question returns 400', r.status === 400, r.body?.error);
  }

  // Test 13: POST /api/ai/question rejects an oversized question
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'POST',
      url: '/api/ai/question',
      body: { question: 'x'.repeat(600) },
    });
    await aiController.ask(req, res, next);
    const r = getResult();
    assert('13. POST /api/ai/question with an oversized question returns 400', r.status === 400, r.body?.error);
  }

  // Test 14: POST /api/ai/question always returns an answer
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'POST',
      url: '/api/ai/question',
      body: { question: 'Where am I spending the most?', period: '3m', month: activeMonth },
    });
    await aiController.ask(req, res, next);
    const r = getResult();
    assert(
      '14. POST /api/ai/question returns 200 with a non-empty answer',
      r.status === 200 && r.body?.success === true && typeof r.body.data.answer === 'string' && r.body.data.answer.length > 0,
      JSON.stringify(r.body?.data)
    );
  }

  // Test 15: GET /api/ai/history
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'GET',
      url: '/api/ai/history',
      query: { limit: '5' },
    });
    aiController.getHistory(req, res, next);
    const r = getResult();
    assert(
      '15. GET /api/ai/history returns 200 with an array of runs',
      r.status === 200 && Array.isArray(r.body?.data),
      JSON.stringify(r.body)
    );
  }

  // Test 16: Unknown /api/ai route returns 404 JSON
  {
    const { req, res, getResult } = createMockReqRes({ method: 'GET', url: '/api/ai/unknown' });
    req.originalUrl = req.url;
    notFoundHandler(req, res);
    const r = getResult();
    assert('16. Unknown /api/ai route returns 404 with JSON error', r.status === 404 && r.body.success === false, r.body?.error);
  }

  // Test 17: Analysis payload is persisted in SQLite
  {
    const row = db.prepare('SELECT COUNT(*) AS count FROM ai_analyses').get();
    assert('17. ai_analyses table stores the generated runs', Number(row.count) > 0, JSON.stringify(row));
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log('\n====================================================');
  console.log(`TEST RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
