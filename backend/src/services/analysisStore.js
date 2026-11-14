/**
 * analysisStore.js
 * Persistence layer for AI Expense Analyzer runs.
 *
 * Every analysis is stored under a scope key derived from the analysed data
 * itself, so identical datasets are never re-sent to the AI provider and the
 * UI can restore the last result instantly.
 */

const crypto = require('crypto');
const db = require('../config/database');

/**
 * Builds a stable key for an analysis scope.
 * The hash covers every transaction that participates in the analysis plus the
 * budget limit, so any data change invalidates the cached result.
 *
 * @param {Array<object>} transactions
 * @param {{ period: string, month: string, budget?: number }} options
 * @returns {string}
 */
function computeScopeKey(transactions, options = {}) {
  const period = options.period || 'month';
  const month = options.month || '';
  const budget = Number(options.budget) > 0 ? Number(options.budget).toFixed(2) : '0';

  const hash = crypto.createHash('sha256');
  hash.update(`${period}|${month}|${budget}`);

  const rows = (Array.isArray(transactions) ? transactions : [])
    .slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));

  for (const tx of rows) {
    hash.update(
      `|${tx.id}:${Number(tx.amount) || 0}:${tx.type}:${tx.category}:${tx.date}:${tx.description || ''}`
    );
  }

  return `${period}-${month || 'all'}-${hash.digest('hex').slice(0, 16)}`;
}

/**
 * Reads a cached analysis for a scope key.
 * @param {string} scopeKey
 * @returns {object|null}
 */
function getCachedAnalysis(scopeKey) {
  if (!scopeKey) return null;

  const row = db.prepare('SELECT * FROM ai_analyses WHERE scope_key = ?').get(scopeKey);
  if (!row) return null;

  try {
    return {
      id: row.id,
      scopeKey: row.scope_key,
      period: row.period,
      month: row.month,
      source: row.source,
      model: row.model,
      analysis: JSON.parse(row.payload),
      createdAt: row.created_at,
    };
  } catch (err) {
    console.error('Failed to parse cached analysis payload:', err);
    return null;
  }
}

/**
 * Stores (or replaces) an analysis for a scope key.
 * @param {{ scopeKey: string, period: string, month: string, source: string, model?: string, analysis: object }} input
 * @returns {object} the stored record
 */
function saveAnalysis(input) {
  const payload = JSON.stringify(input.analysis);

  db.prepare(
    `
      INSERT INTO ai_analyses (scope_key, period, month, source, model, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(scope_key) DO UPDATE SET
        period = excluded.period,
        month = excluded.month,
        source = excluded.source,
        model = excluded.model,
        payload = excluded.payload,
        created_at = excluded.created_at
    `
  ).run(input.scopeKey, input.period, input.month, input.source, input.model || null, payload);

  return getCachedAnalysis(input.scopeKey);
}

/**
 * Lists the most recent analyses (newest first).
 * @param {number} limit
 * @returns {Array<object>}
 */
function listRecentAnalyses(limit = 8) {
  const safeLimit = Math.min(25, Math.max(1, Number(limit) || 8));
  const rows = db
    .prepare(
      `
        SELECT id, scope_key, period, month, source, model, created_at,
               json_extract(payload, '$.headline') AS headline
        FROM ai_analyses
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT ?
      `
    )
    .all(safeLimit);

  return rows.map((row) => ({
    id: row.id,
    scopeKey: row.scope_key,
    period: row.period,
    month: row.month,
    source: row.source,
    model: row.model,
    headline: row.headline || null,
    createdAt: row.created_at,
  }));
}

/**
 * Removes analyses older than the given number of days.
 * @param {number} days
 * @returns {number} number of removed rows
 */
function pruneOldAnalyses(days = 30) {
  const result = db
    .prepare(`DELETE FROM ai_analyses WHERE datetime(created_at) < datetime('now', ?)`)
    .run(`-${Math.max(1, Number(days) || 30)} days`);
  return result.changes || 0;
}

module.exports = {
  computeScopeKey,
  getCachedAnalysis,
  listRecentAnalyses,
  pruneOldAnalyses,
  saveAnalysis,
};
