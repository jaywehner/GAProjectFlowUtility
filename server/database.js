const fs = require('fs');
const Database = require('better-sqlite3');
const { DATA_DIR, DB_PATH, UPLOADS_DIR } = require('./config');

let dbInstance;

function nowIso() {
  return new Date().toISOString();
}

function ensureDirectories() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_hash TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      csrf_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      user_agent TEXT,
      ip_address TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS work_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL COLLATE NOCASE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, name),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_folder_id INTEGER NOT NULL,
      original_name TEXT NOT NULL COLLATE NOCASE,
      stored_name TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      size INTEGER NOT NULL,
      uploaded_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(work_folder_id, original_name),
      FOREIGN KEY (work_folder_id) REFERENCES work_folders(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_files_work_folder_id ON files(work_folder_id);
  `);
}

function initDatabase() {
  if (dbInstance) {
    return dbInstance;
  }

  ensureDirectories();
  dbInstance = new Database(DB_PATH);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');
  createSchema(dbInstance);
  return dbInstance;
}

function getDb() {
  return dbInstance || initDatabase();
}

module.exports = {
  nowIso,
  initDatabase,
  getDb,
};
