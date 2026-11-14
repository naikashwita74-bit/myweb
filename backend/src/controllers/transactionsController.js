const db = require('../config/database');

function isValidDate(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return false;
  const parts = dateString.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  if (month < 1 || month > 12) return false;
  const dateObj = new Date(year, month - 1, day);
  return (
    dateObj.getFullYear() === year &&
    dateObj.getMonth() === month - 1 &&
    dateObj.getDate() === day
  );
}

function parseIntegerId(idParam) {
  const num = Number(idParam);
  if (!Number.isInteger(num) || num <= 0) return null;
  return num;
}

const transactionsController = {
  // GET /api/transactions
  getAll: (req, res, next) => {
    try {
      const stmt = db.prepare('SELECT * FROM transactions ORDER BY date DESC, id DESC');
      const rows = stmt.all();
      return res.status(200).json({ success: true, data: rows });
    } catch (err) {
      return next(err);
    }
  },

  // GET /api/transactions/:id
  getById: (req, res, next) => {
    try {
      const id = parseIntegerId(req.params.id);
      if (!id) {
        return res.status(400).json({ success: false, error: 'Invalid transaction ID. Must be a positive integer.' });
      }

      const stmt = db.prepare('SELECT * FROM transactions WHERE id = ?');
      const transaction = stmt.get(id);

      if (!transaction) {
        return res.status(404).json({ success: false, error: 'Transaction not found.' });
      }

      return res.status(200).json({ success: true, data: transaction });
    } catch (err) {
      return next(err);
    }
  },

  // POST /api/transactions
  create: (req, res, next) => {
    try {
      const { title, amount, category, type, date, description } = req.body || {};

      if (!title || typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ success: false, error: 'Title is required and must not be empty.' });
      }

      const numAmount = Number(amount);
      if (!Number.isFinite(numAmount) || numAmount <= 0) {
        return res.status(400).json({ success: false, error: 'Amount must be a number greater than 0.' });
      }

      if (!type || (type !== 'income' && type !== 'expense')) {
        return res.status(400).json({ success: false, error: 'Type must be either "income" or "expense".' });
      }

      if (!category || typeof category !== 'string' || !category.trim()) {
        return res.status(400).json({ success: false, error: 'Category is required and must not be empty.' });
      }

      if (!date || !isValidDate(date)) {
        return res.status(400).json({ success: false, error: 'Date is required and must be a valid date in YYYY-MM-DD format.' });
      }

      const cleanTitle = title.trim();
      const cleanCategory = category.trim();
      const cleanDesc = description ? String(description).trim() : null;
      const roundedAmount = Math.round(numAmount * 100) / 100;

      const stmt = db.prepare(`
        INSERT INTO transactions (title, amount, category, type, date, description)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(cleanTitle, roundedAmount, cleanCategory, type, date, cleanDesc);

      const createdStmt = db.prepare('SELECT * FROM transactions WHERE id = ?');
      const createdTx = createdStmt.get(result.lastInsertRowid);

      return res.status(201).json({ success: true, data: createdTx });
    } catch (err) {
      return next(err);
    }
  },

  // PUT /api/transactions/:id
  update: (req, res, next) => {
    try {
      const id = parseIntegerId(req.params.id);
      if (!id) {
        return res.status(400).json({ success: false, error: 'Invalid transaction ID. Must be a positive integer.' });
      }

      const checkStmt = db.prepare('SELECT * FROM transactions WHERE id = ?');
      const existing = checkStmt.get(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Transaction not found.' });
      }

      const { title, amount, category, type, date, description } = req.body || {};

      if (!title || typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ success: false, error: 'Title is required and must not be empty.' });
      }

      const numAmount = Number(amount);
      if (!Number.isFinite(numAmount) || numAmount <= 0) {
        return res.status(400).json({ success: false, error: 'Amount must be a number greater than 0.' });
      }

      if (!type || (type !== 'income' && type !== 'expense')) {
        return res.status(400).json({ success: false, error: 'Type must be either "income" or "expense".' });
      }

      if (!category || typeof category !== 'string' || !category.trim()) {
        return res.status(400).json({ success: false, error: 'Category is required and must not be empty.' });
      }

      if (!date || !isValidDate(date)) {
        return res.status(400).json({ success: false, error: 'Date is required and must be a valid date in YYYY-MM-DD format.' });
      }

      const cleanTitle = title.trim();
      const cleanCategory = category.trim();
      const cleanDesc = description !== undefined ? (description ? String(description).trim() : null) : existing.description;
      const roundedAmount = Math.round(numAmount * 100) / 100;

      const updateStmt = db.prepare(`
        UPDATE transactions
        SET title = ?, amount = ?, category = ?, type = ?, date = ?, description = ?
        WHERE id = ?
      `);

      updateStmt.run(cleanTitle, roundedAmount, cleanCategory, type, date, cleanDesc, id);

      const updated = checkStmt.get(id);
      return res.status(200).json({ success: true, data: updated });
    } catch (err) {
      return next(err);
    }
  },

  // DELETE /api/transactions/:id
  delete: (req, res, next) => {
    try {
      const id = parseIntegerId(req.params.id);
      if (!id) {
        return res.status(400).json({ success: false, error: 'Invalid transaction ID. Must be a positive integer.' });
      }

      const checkStmt = db.prepare('SELECT * FROM transactions WHERE id = ?');
      const existing = checkStmt.get(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Transaction not found.' });
      }

      const deleteStmt = db.prepare('DELETE FROM transactions WHERE id = ?');
      deleteStmt.run(id);

      return res.status(200).json({ success: true, message: 'Transaction deleted successfully.' });
    } catch (err) {
      return next(err);
    }
  },
};

module.exports = transactionsController;
