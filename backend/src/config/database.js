const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const backendDir = path.resolve(__dirname, '../../');
const rawDbPath = process.env.DATABASE_PATH || 'database/expense-tracker.db';
const dbPath = path.isAbsolute(rawDbPath)
  ? rawDbPath
  : path.resolve(backendDir, rawDbPath);

// Ensure the directory for the database file exists
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

// Initialize database
const db = new Database(dbPath);

// Optimize SQLite settings
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Execute schema
const schemaPath = path.resolve(backendDir, 'database/schema.sql');
if (fs.existsSync(schemaPath)) {
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schemaSql);
}

module.exports = db;
