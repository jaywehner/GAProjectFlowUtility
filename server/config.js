const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DB_PATH = path.join(DATA_DIR, 'app.db');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const STORAGE_KEY_PATH = path.join(DATA_DIR, 'storage.key');
const SAMPLE_DATA_DIR = path.join(ROOT_DIR, 'sample_data');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT || 3000);
const SESSION_COOKIE_NAME = 'ga_session';
const CSRF_COOKIE_NAME = 'ga_csrf';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 100;
const PRIMARY_ADMIN_USERNAME = 'admin';

module.exports = {
  ROOT_DIR,
  DATA_DIR,
  DB_PATH,
  UPLOADS_DIR,
  STORAGE_KEY_PATH,
  SAMPLE_DATA_DIR,
  PUBLIC_DIR,
  IS_PRODUCTION,
  PORT,
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  SESSION_TTL_MS,
  MAX_FILE_SIZE_BYTES,
  MAX_FILES_PER_UPLOAD,
  PRIMARY_ADMIN_USERNAME,
};
