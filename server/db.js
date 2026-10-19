import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

export const db = new DatabaseSync(config.dbFile);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email         TEXT,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    quota_mb      INTEGER,
    disabled      INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,
    last_login    INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    ip         TEXT,
    user_agent TEXT
  );

  CREATE TABLE IF NOT EXISTS shares (
    id                TEXT PRIMARY KEY,
    owner_id          INTEGER REFERENCES users(id) ON DELETE CASCADE,
    title             TEXT,
    message           TEXT,
    password_hash     TEXT,
    expires_at        INTEGER,
    max_downloads     INTEGER,
    download_count    INTEGER NOT NULL DEFAULT 0,
    view_count        INTEGER NOT NULL DEFAULT 0,
    manage_token_hash TEXT,
    uploader_ip       TEXT,
    created_at        INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS files (
    id             TEXT PRIMARY KEY,
    share_id       TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    size           INTEGER NOT NULL,
    mime           TEXT NOT NULL,
    crc32          INTEGER NOT NULL,
    storage_name   TEXT NOT NULL,
    download_count INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invites (
    code       TEXT PRIMARY KEY,
    note       TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    used_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    used_at    INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_files_share ON files(share_id);
  CREATE INDEX IF NOT EXISTS idx_shares_owner ON shares(owner_id);
  CREATE INDEX IF NOT EXISTS idx_shares_expires ON shares(expires_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

// Columns added after the first release; CREATE TABLE IF NOT EXISTS doesn't touch existing tables.
const hasColumn = (table, column) => db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
if (!hasColumn('shares', 'zip_only')) db.exec('ALTER TABLE shares ADD COLUMN zip_only INTEGER NOT NULL DEFAULT 0');

export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const now = () => Date.now();
