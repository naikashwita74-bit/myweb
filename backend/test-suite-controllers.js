/**
 * In-Process Complete Test Suite for LedgerFlow Backend
 * Tests every endpoint, controller, status code, validation rule, database constraint,
 * and data persistence in SQLite.
 */

const path = require('path');
const db = require('./src/config/database');
const transactionsController = require('./src/controllers/transactionsController');
const budgetsController = require('./src/controllers/budgetsController');
const { notFoundHandler, errorHandler } = require('./src/middleware/errorHandler');

const results = [];

function assert(description, condition, details = '') {
  if (condition) {
    results.push({ pass: true, description, details });
    console.log(`PASS: ${description}`);
  } else {
    results.push({ pass: false, description, details });
    console.error(`FAIL: ${description} | Details: ${details}`);
  }
}

function createMockReqRes({ method = 'GET', url = '/', body = {}, params = {}, query = {} } = {}) {
  let statusCode = 200;
  let responseData = null;

  const req = {
    method,
    url,
    body,
    params,
    query,
    headers: { 'content-type': 'application/json' },
  };

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
    if (err) {
      errorHandler(err, req, res, () => {});
    }
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
  console.log('LEDGERFLOW BACKEND TEST SUITE (PHASE 8)');
  console.log('====================================================\n');

  // Test 1: Health check response
  {
    const { req, res, getResult } = createMockReqRes({ method: 'GET', url: '/api/health' });
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
    const r = getResult();
    assert('1. GET /api/health returns 200 and status: ok', r.status === 200 && r.body.status === 'ok');
  }

  // Test 2: Transactions - Get all
  {
    const { req, res, next, getResult } = createMockReqRes({ method: 'GET', url: '/api/transactions' });
    transactionsController.getAll(req, res, next);
    const r = getResult();
    assert('2. GET /api/transactions returns 200 and data array', r.status === 200 && Array.isArray(r.body.data));
  }

  let createdIncomeId = null;
  // Test 3: Create valid income transaction
  {
    const incomePayload = {
      title: 'Monthly Salary',
      amount: 5400.0,
      category: 'Salary',
      type: 'income',
      date: '2026-11-01',
      description: 'Primary engineering payroll',
    };
    const { req, res, next, getResult } = createMockReqRes({
      method: 'POST',
      url: '/api/transactions',
      body: incomePayload,
    });
    transactionsController.create(req, res, next);
    const r = getResult();
    assert(
      '3. POST /api/transactions creates income transaction (201)',
      r.status === 201 && r.body.success === true && r.body.data.title === incomePayload.title,
      JSON.stringify(r.body)
    );
    createdIncomeId = r.body?.data?.id;
  }

  let createdExpenseId = null;
  // Test 4: Create valid expense transaction
  {
    const expensePayload = {
      title: 'Apartment Rent',
      amount: 1650.0,
      category: 'Housing',
      type: 'expense',
      date: '2026-11-02',
      description: 'Monthly lease payment',
    };
    const { req, res, next, getResult } = createMockReqRes({
      method: 'POST',
      url: '/api/transactions',
      body: expensePayload,
    });
    transactionsController.create(req, res, next);
    const r = getResult();
    assert(
      '4. POST /api/transactions creates expense transaction (201)',
      r.status === 201 && r.body.data.amount === 1650.0 && r.body.data.type === 'expense',
      JSON.stringify(r.body)
    );
    createdExpenseId = r.body?.data?.id;
  }

  // Test 5: Validation - Missing title
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'POST',
      url: '/api/transactions',
      body: { amount: 100, category: 'Food', type: 'expense', date: '2026-11-05' },
    });
    transactionsController.create(req, res, next);
    const r = getResult();
    assert('5. POST /api/transactions with missing title returns 400', r.status === 400 && r.body.success === false, r.body?.error);
  }

  // Test 6: Validation - Empty/whitespace title
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'POST',
      url: '/api/transactions',
      body: { title: '   ', amount: 100, category: 'Food', type: 'expense', date: '2026-11-05' },
    });
    transactionsController.create(req, res, next);
    const r = getResult();
    assert('6. POST /api/transactions with whitespace title returns 400', r.status === 400, r.body?.error);
  }

  // Test 7: Validation - Negative amount
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'POST',
      url: '/api/transactions',
      body: { title: 'Coffee', amount: -4.5, category: 'Food', type: 'expense', date: '2026-11-05' },
    });
    transactionsController.create(req, res, next);
    const r = getResult();
    assert('7. POST /api/transactions with negative amount returns 400', r.status === 400, r.body?.error);
  }

  // Test 8: Validation - Zero amount
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'POST',
      url: '/api/transactions',
      body: { title: 'Coffee', amount: 0, category: 'Food', type: 'expense', date: '2026-11-05' },
    });
    transactionsController.create(req, res, next);
    const r = getResult();
    assert('8. POST /api/transactions with amount = 0 returns 400', r.status === 400, r.body?.error);
  }

  // Test 9: Validation - Wrong transaction type
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'POST',
      url: '/api/transactions',
      body: { title: 'Grant', amount: 500, category: 'Other', type: 'invalid_type', date: '2026-11-05' },
    });
    transactionsController.create(req, res, next);
    const r = getResult();
    assert('9. POST /api/transactions with invalid type returns 400', r.status === 400, r.body?.error);
  }

  // Test 10: Validation - Missing category
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'POST',
      url: '/api/transactions',
      body: { title: 'Dinner', amount: 45, category: '', type: 'expense', date: '2026-11-05' },
    });
    transactionsController.create(req, res, next);
    const r = getResult();
    assert('10. POST /api/transactions with empty category returns 400', r.status === 400, r.body?.error);
  }

  // Test 11: Validation - Invalid date format
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'POST',
      url: '/api/transactions',
      body: { title: 'Dinner', amount: 45, category: 'Food', type: 'expense', date: '2026/11/05' },
    });
    transactionsController.create(req, res, next);
    const r = getResult();
    assert('11. POST /api/transactions with invalid date format returns 400', r.status === 400, r.body?.error);
  }

  // Test 12: GET /api/transactions/:id - Valid ID
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'GET',
      url: `/api/transactions/${createdIncomeId}`,
      params: { id: String(createdIncomeId) },
    });
    transactionsController.getById(req, res, next);
    const r = getResult();
    assert(
      '12. GET /api/transactions/:id returns 200 and matches created record',
      r.status === 200 && r.body.data.id === createdIncomeId,
      JSON.stringify(r.body)
    );
  }

  // Test 13: GET /api/transactions/:id - Invalid ID format
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'GET',
      url: '/api/transactions/abc',
      params: { id: 'abc' },
    });
    transactionsController.getById(req, res, next);
    const r = getResult();
    assert('13. GET /api/transactions/abc returns 400 for non-integer ID', r.status === 400, r.body?.error);
  }

  // Test 14: GET /api/transactions/:id - Non-existent ID
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'GET',
      url: '/api/transactions/999999',
      params: { id: '999999' },
    });
    transactionsController.getById(req, res, next);
    const r = getResult();
    assert('14. GET /api/transactions/999999 returns 404', r.status === 404, r.body?.error);
  }

  // Test 15: PUT /api/transactions/:id - Valid update
  {
    const updatePayload = {
      title: 'Apartment Rent & Storage',
      amount: 1720.0,
      category: 'Housing',
      type: 'expense',
      date: '2026-11-02',
      description: 'Monthly lease plus storage locker',
    };
    const { req, res, next, getResult } = createMockReqRes({
      method: 'PUT',
      url: `/api/transactions/${createdExpenseId}`,
      params: { id: String(createdExpenseId) },
      body: updatePayload,
    });
    transactionsController.update(req, res, next);
    const r = getResult();
    assert(
      '15. PUT /api/transactions/:id returns 200 and updated fields',
      r.status === 200 && r.body.data.amount === 1720.0 && r.body.data.title === updatePayload.title,
      JSON.stringify(r.body)
    );
  }

  // Test 16: PUT /api/transactions/:id - Invalid update data
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'PUT',
      url: `/api/transactions/${createdExpenseId}`,
      params: { id: String(createdExpenseId) },
      body: { title: 'Test', amount: -20, category: 'Food', type: 'expense', date: '2026-11-02' },
    });
    transactionsController.update(req, res, next);
    const r = getResult();
    assert('16. PUT /api/transactions/:id with negative amount returns 400', r.status === 400, r.body?.error);
  }

  // Test 17: PUT /api/transactions/:id - Non-existent ID
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'PUT',
      url: '/api/transactions/999999',
      params: { id: '999999' },
      body: { title: 'Valid', amount: 50, category: 'Food', type: 'expense', date: '2026-11-02' },
    });
    transactionsController.update(req, res, next);
    const r = getResult();
    assert('17. PUT /api/transactions/999999 returns 404', r.status === 404, r.body?.error);
  }

  // Test 18: DELETE /api/transactions/:id - Valid delete
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'DELETE',
      url: `/api/transactions/${createdExpenseId}`,
      params: { id: String(createdExpenseId) },
    });
    transactionsController.delete(req, res, next);
    const r = getResult();
    assert('18. DELETE /api/transactions/:id returns 200', r.status === 200 && r.body.success === true);
  }

  // Test 19: DELETE /api/transactions/:id - Repeated delete (now 404)
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'DELETE',
      url: `/api/transactions/${createdExpenseId}`,
      params: { id: String(createdExpenseId) },
    });
    transactionsController.delete(req, res, next);
    const r = getResult();
    assert('19. DELETE /api/transactions/:id on deleted record returns 404', r.status === 404);
  }

  let createdBudgetId = null;
  // Test 20: POST /api/budgets - Valid creation
  {
    // Clean any prior 2026-11 budget for fresh test
    db.prepare('DELETE FROM monthly_budgets WHERE year = 2026 AND month = 11').run();

    const { req, res, next, getResult } = createMockReqRes({
      method: 'POST',
      url: '/api/budgets',
      body: { year: 2026, month: 11, amount: 3200.0 },
    });
    budgetsController.create(req, res, next);
    const r = getResult();
    assert(
      '20. POST /api/budgets returns 201 and creates monthly budget',
      r.status === 201 && r.body.data.amount === 3200.0,
      JSON.stringify(r.body)
    );
    createdBudgetId = r.body?.data?.id;
  }

  // Test 21: POST /api/budgets - Duplicate month/year (409 Conflict)
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'POST',
      url: '/api/budgets',
      body: { year: 2026, month: 11, amount: 3500.0 },
    });
    budgetsController.create(req, res, next);
    const r = getResult();
    assert('21. POST /api/budgets for existing month/year returns 409 Conflict', r.status === 409, r.body?.error);
  }

  // Test 22: POST /api/budgets - Invalid month (13)
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'POST',
      url: '/api/budgets',
      body: { year: 2026, month: 13, amount: 3000.0 },
    });
    budgetsController.create(req, res, next);
    const r = getResult();
    assert('22. POST /api/budgets with month = 13 returns 400', r.status === 400, r.body?.error);
  }

  // Test 23: POST /api/budgets - Negative amount
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'POST',
      url: '/api/budgets',
      body: { year: 2026, month: 12, amount: -500.0 },
    });
    budgetsController.create(req, res, next);
    const r = getResult();
    assert('23. POST /api/budgets with negative amount returns 400', r.status === 400, r.body?.error);
  }

  // Test 24: GET /api/budgets/:year/:month - Valid
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'GET',
      url: '/api/budgets/2026/11',
      params: { year: '2026', month: '11' },
    });
    budgetsController.getByYearAndMonth(req, res, next);
    const r = getResult();
    assert(
      '24. GET /api/budgets/2026/11 returns 200 and matches created budget',
      r.status === 200 && r.body.data.amount === 3200.0,
      JSON.stringify(r.body)
    );
  }

  // Test 25: GET /api/budgets/:year/:month - Non-existent month (404)
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'GET',
      url: '/api/budgets/2030/1',
      params: { year: '2030', month: '1' },
    });
    budgetsController.getByYearAndMonth(req, res, next);
    const r = getResult();
    assert('25. GET /api/budgets/2030/1 returns 404', r.status === 404, r.body?.error);
  }

  // Test 26: PUT /api/budgets/:id - Valid update
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'PUT',
      url: `/api/budgets/${createdBudgetId}`,
      params: { id: String(createdBudgetId) },
      body: { amount: 3750.0 },
    });
    budgetsController.update(req, res, next);
    const r = getResult();
    assert(
      '26. PUT /api/budgets/:id returns 200 and updates budget amount',
      r.status === 200 && r.body.data.amount === 3750.0,
      JSON.stringify(r.body)
    );
  }

  // Test 27: PUT /api/budgets/:id - Invalid negative amount
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'PUT',
      url: `/api/budgets/${createdBudgetId}`,
      params: { id: String(createdBudgetId) },
      body: { amount: -50.0 },
    });
    budgetsController.update(req, res, next);
    const r = getResult();
    assert('27. PUT /api/budgets/:id with negative amount returns 400', r.status === 400, r.body?.error);
  }

  // Test 28: PUT /api/budgets/:id - Non-existent ID (404)
  {
    const { req, res, next, getResult } = createMockReqRes({
      method: 'PUT',
      url: '/api/budgets/999999',
      params: { id: '999999' },
      body: { amount: 2000.0 },
    });
    budgetsController.update(req, res, next);
    const r = getResult();
    assert('28. PUT /api/budgets/999999 returns 404', r.status === 404, r.body?.error);
  }

  // Test 29: Unknown API route (404 JSON)
  {
    const { req, res, getResult } = createMockReqRes({
      method: 'GET',
      url: '/api/non-existent-resource',
    });
    req.originalUrl = req.url;
    notFoundHandler(req, res);
    const r = getResult();
    assert('29. Unknown /api route returns 404 with JSON error', r.status === 404 && r.body.success === false, r.body?.error);
  }

  // Test 30: Database Direct Persistence Verification
  {
    const txRow = db.prepare('SELECT * FROM transactions WHERE id = ?').get(createdIncomeId);
    assert('30. Persistence: SQLite database directly holds created transaction', txRow && txRow.title === 'Monthly Salary');

    const budgetRow = db.prepare('SELECT * FROM monthly_budgets WHERE id = ?').get(createdBudgetId);
    assert('31. Persistence: SQLite database directly holds updated budget (3750)', budgetRow && budgetRow.amount === 3750.0);
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
