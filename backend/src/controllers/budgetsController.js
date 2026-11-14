const db = require('../config/database');

function parsePositiveInt(val) {
  const num = Number(val);
  if (!Number.isInteger(num) || num <= 0) return null;
  return num;
}

const budgetsController = {
  // GET /api/budgets/:year/:month
  getByYearAndMonth: (req, res, next) => {
    try {
      const year = parsePositiveInt(req.params.year);
      const month = Number(req.params.month);

      if (!year || !Number.isInteger(month) || month < 1 || month > 12) {
        return res.status(400).json({
          success: false,
          error: 'Year must be a positive integer and month must be an integer between 1 and 12.',
        });
      }

      const stmt = db.prepare('SELECT * FROM monthly_budgets WHERE year = ? AND month = ?');
      const budget = stmt.get(year, month);

      if (!budget) {
        return res.status(404).json({
          success: false,
          error: `No budget found for month ${month} and year ${year}.`,
        });
      }

      return res.status(200).json({ success: true, data: budget });
    } catch (err) {
      return next(err);
    }
  },

  // POST /api/budgets
  create: (req, res, next) => {
    try {
      const { year, month, amount } = req.body || {};

      const numYear = parsePositiveInt(year);
      const numMonth = Number(month);
      const numAmount = Number(amount);

      if (!numYear || !Number.isInteger(numMonth) || numMonth < 1 || numMonth > 12) {
        return res.status(400).json({
          success: false,
          error: 'Year must be a valid positive integer and month must be between 1 and 12.',
        });
      }

      if (!Number.isFinite(numAmount) || numAmount <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Amount must be a number greater than 0.',
        });
      }

      // Check if a budget already exists for this year and month
      const existingStmt = db.prepare('SELECT * FROM monthly_budgets WHERE year = ? AND month = ?');
      const existing = existingStmt.get(numYear, numMonth);

      if (existing) {
        return res.status(409).json({
          success: false,
          error: `A budget already exists for year ${numYear} and month ${numMonth}. Use PUT to update it.`,
        });
      }

      const roundedAmount = Math.round(numAmount * 100) / 100;
      const insertStmt = db.prepare(`
        INSERT INTO monthly_budgets (year, month, amount)
        VALUES (?, ?, ?)
      `);

      const result = insertStmt.run(numYear, numMonth, roundedAmount);
      const createdStmt = db.prepare('SELECT * FROM monthly_budgets WHERE id = ?');
      const created = createdStmt.get(result.lastInsertRowid);

      return res.status(201).json({ success: true, data: created });
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({
          success: false,
          error: 'A budget already exists for this month and year.',
        });
      }
      return next(err);
    }
  },

  // PUT /api/budgets/:id
  update: (req, res, next) => {
    try {
      const id = parsePositiveInt(req.params.id);
      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'Invalid budget ID. Must be a positive integer.',
        });
      }

      const checkStmt = db.prepare('SELECT * FROM monthly_budgets WHERE id = ?');
      const existing = checkStmt.get(id);
      if (!existing) {
        return res.status(404).json({
          success: false,
          error: 'Budget not found.',
        });
      }

      const { amount } = req.body || {};
      const numAmount = Number(amount);
      if (!Number.isFinite(numAmount) || numAmount <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Amount must be a number greater than 0.',
        });
      }

      const roundedAmount = Math.round(numAmount * 100) / 100;
      const updateStmt = db.prepare('UPDATE monthly_budgets SET amount = ? WHERE id = ?');
      updateStmt.run(roundedAmount, id);

      const updated = checkStmt.get(id);
      return res.status(200).json({ success: true, data: updated });
    } catch (err) {
      return next(err);
    }
  },
};

module.exports = budgetsController;
