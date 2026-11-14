const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const backendDir = path.resolve(__dirname, '../../');

// Ephemeral storage location used on read-only serverless filesystems.
const EPHEMERAL_DB_PATH = path.join(path.sep, 'tmp', 'ledgerflow.db');

/**
 * Returns true when the given directory exists and accepts writes.
 * @param {string} dir
 * @returns {boolean}
 */
function isWritableDir(dir) {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolves the SQLite file location.
 *
 * - Locally: `backend/database/expense-tracker.db` (or DATABASE_PATH).
 * - On Vercel: the deployment filesystem is read-only except for /tmp, so the
 *   database is placed in /tmp. That storage is ephemeral - it is wiped when
 *   the function instance is recycled - so point DATABASE_PATH at a persistent
 *   location (or a hosted database) before storing real data.
 */
function resolveDatabasePath() {
  const configured = (process.env.DATABASE_PATH || '').trim();

  if (configured) {
    const resolved = path.isAbsolute(configured) ? configured : path.resolve(backendDir, configured);
    const dir = path.dirname(resolved);

    if (process.env.VERCEL && !isWritableDir(dir)) {
      console.warn(
        `[database] ${resolved} is not writable on Vercel, falling back to ephemeral storage at ${EPHEMERAL_DB_PATH}.`
      );
      return EPHEMERAL_DB_PATH;
    }

    return resolved;
  }

  if (process.env.VERCEL) {
    return EPHEMERAL_DB_PATH;
  }

  return path.resolve(backendDir, 'database/expense-tracker.db');
}

const dbPath = resolveDatabasePath();

/**
 * Opens the SQLite database, falling back to ephemeral storage when the
 * configured location cannot be written to (read-only serverless filesystems).
 * @param {string} targetPath
 * @returns {import('better-sqlite3').Database}
 */
function openDatabase(targetPath) {
  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    return new Database(targetPath);
  } catch (err) {
    if (process.env.VERCEL && targetPath !== EPHEMERAL_DB_PATH) {
      console.warn(
        `[database] Could not open ${targetPath} (${err.message}), falling back to ephemeral storage at ${EPHEMERAL_DB_PATH}.`
      );
      fs.mkdirSync(path.dirname(EPHEMERAL_DB_PATH), { recursive: true });
      return new Database(EPHEMERAL_DB_PATH);
    }
    throw err;
  }
}

// Initialize database
let db;
try {
  db = openDatabase(dbPath);
} catch (err) {
  console.error(`[database] Could not open SQLite database at ${dbPath}:`, err.message);
  throw err;
}

// Optimize SQLite settings
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Execute schema
const schemaPath = path.resolve(backendDir, 'database/schema.sql');
if (fs.existsSync(schemaPath)) {
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schemaSql);
}

if (process.env.VERCEL && dbPath === EPHEMERAL_DB_PATH) {
  console.warn(
    `[database] Using ephemeral storage at ${dbPath}. Data is reset when the function instance is recycled.`
  );
}

module.exports = db;
