const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sanitizeFilename = require('sanitize-filename');
const { getDb, nowIso } = require('./database');
const { UPLOADS_DIR, PRIMARY_ADMIN_USERNAME } = require('./config');
const { encryptBuffer, decryptBuffer, isEncryptedPayload } = require('./fileCrypto');
const { safeTrim, normalizeFileNameKey } = require('./utils');

function mapUserRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    username: row.username,
    isAdmin: Boolean(row.is_admin),
    mustChangePassword: Boolean(row.must_change_password),
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapFolderRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    fileCount: Number(row.file_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapFileRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    workFolderId: row.work_folder_id,
    originalName: row.original_name,
    storedName: row.stored_name,
    relativePath: row.relative_path,
    size: row.size,
    uploadedAt: row.uploaded_at,
    updatedAt: row.updated_at,
  };
}

function getUserById(userId) {
  const db = getDb();
  return mapUserRow(db.prepare('SELECT * FROM users WHERE id = ?').get(userId));
}

function getUserByUsername(username) {
  const db = getDb();
  return mapUserRow(db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(safeTrim(username)));
}

function listUsers() {
  const db = getDb();
  return db.prepare('SELECT id, username, is_admin, must_change_password, created_at, updated_at FROM users ORDER BY username COLLATE NOCASE ASC').all().map((row) => ({
    id: row.id,
    username: row.username,
    isAdmin: Boolean(row.is_admin),
    mustChangePassword: Boolean(row.must_change_password),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function createUser({ username, passwordHash, isAdmin, mustChangePassword }) {
  const db = getDb();
  const timestamp = nowIso();
  const result = db.prepare(`
    INSERT INTO users (username, password_hash, is_admin, must_change_password, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(safeTrim(username), passwordHash, isAdmin ? 1 : 0, mustChangePassword ? 1 : 0, timestamp, timestamp);

  return getUserById(result.lastInsertRowid);
}

function updateUser(userId, { username, isAdmin, mustChangePassword, passwordHash }) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

  if (!existing) {
    return null;
  }

  const nextUsername = username === undefined ? existing.username : safeTrim(username);
  const nextIsAdmin = isAdmin === undefined ? existing.is_admin : (isAdmin ? 1 : 0);
  const nextMustChangePassword = mustChangePassword === undefined ? existing.must_change_password : (mustChangePassword ? 1 : 0);
  const nextPasswordHash = passwordHash || existing.password_hash;
  const timestamp = nowIso();

  db.prepare(`
    UPDATE users
    SET username = ?, password_hash = ?, is_admin = ?, must_change_password = ?, updated_at = ?
    WHERE id = ?
  `).run(nextUsername, nextPasswordHash, nextIsAdmin, nextMustChangePassword, timestamp, userId);

  return getUserById(userId);
}

function deleteUser(userId) {
  const db = getDb();
  const user = getUserById(userId);

  if (!user) {
    return false;
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  return true;
}

function createSessionRecord({ sessionHash, userId, csrfToken, expiresAt, userAgent, ipAddress }) {
  const db = getDb();
  const timestamp = nowIso();

  const result = db.prepare(`
    INSERT INTO sessions (session_hash, user_id, csrf_token, created_at, expires_at, user_agent, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(sessionHash, userId, csrfToken, timestamp, expiresAt, userAgent || '', ipAddress || '');

  return result.lastInsertRowid;
}

function getSessionWithUser(sessionHash) {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      sessions.id,
      sessions.session_hash,
      sessions.user_id,
      sessions.csrf_token,
      sessions.created_at,
      sessions.expires_at,
      sessions.user_agent,
      sessions.ip_address,
      users.username,
      users.password_hash,
      users.is_admin,
      users.must_change_password,
      users.created_at AS user_created_at,
      users.updated_at AS user_updated_at
    FROM sessions
    INNER JOIN users ON users.id = sessions.user_id
    WHERE sessions.session_hash = ? AND sessions.expires_at > ?
  `).get(sessionHash, nowIso());

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    csrfToken: row.csrf_token,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    userAgent: row.user_agent,
    ipAddress: row.ip_address,
    user: {
      id: row.user_id,
      username: row.username,
      passwordHash: row.password_hash,
      isAdmin: Boolean(row.is_admin),
      mustChangePassword: Boolean(row.must_change_password),
      createdAt: row.user_created_at,
      updatedAt: row.user_updated_at,
    },
  };
}

function deleteSessionByHash(sessionHash) {
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE session_hash = ?').run(sessionHash);
}

function deleteSessionsForUser(userId) {
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

function deleteExpiredSessions() {
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso());
}

function listWorkFoldersForUser(userId) {
  const db = getDb();
  return db.prepare(`
    SELECT work_folders.*, COUNT(files.id) AS file_count
    FROM work_folders
    LEFT JOIN files ON files.work_folder_id = work_folders.id
    WHERE work_folders.user_id = ?
    GROUP BY work_folders.id
    ORDER BY work_folders.name COLLATE NOCASE ASC
  `).all(userId).map(mapFolderRow);
}

function getWorkFolderByIdForUser(workFolderId, userId) {
  const db = getDb();
  const row = db.prepare(`
    SELECT work_folders.*, COUNT(files.id) AS file_count
    FROM work_folders
    LEFT JOIN files ON files.work_folder_id = work_folders.id
    WHERE work_folders.id = ? AND work_folders.user_id = ?
    GROUP BY work_folders.id
  `).get(workFolderId, userId);

  return mapFolderRow(row);
}

function findWorkFolderByName(userId, name) {
  const db = getDb();
  return mapFolderRow(db.prepare('SELECT * FROM work_folders WHERE user_id = ? AND name = ? COLLATE NOCASE').get(userId, safeTrim(name)));
}

function createWorkFolder(userId, name) {
  const db = getDb();
  const timestamp = nowIso();
  const result = db.prepare(`
    INSERT INTO work_folders (user_id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(userId, safeTrim(name), timestamp, timestamp);

  fs.mkdirSync(path.join(UPLOADS_DIR, String(result.lastInsertRowid)), { recursive: true });
  return getWorkFolderByIdForUser(result.lastInsertRowid, userId);
}

function listFilesForFolder(workFolderId) {
  const db = getDb();
  return db.prepare('SELECT * FROM files WHERE work_folder_id = ? ORDER BY original_name COLLATE NOCASE ASC').all(workFolderId).map(mapFileRow);
}

function findFileByOriginalName(workFolderId, originalName) {
  const db = getDb();
  return mapFileRow(db.prepare('SELECT * FROM files WHERE work_folder_id = ? AND original_name = ? COLLATE NOCASE').get(workFolderId, safeTrim(originalName)));
}

function getFileByIdForFolder(fileId, workFolderId) {
  const db = getDb();
  return mapFileRow(db.prepare('SELECT * FROM files WHERE id = ? AND work_folder_id = ?').get(fileId, workFolderId));
}

function buildStoredName(originalName) {
  const base = sanitizeFilename(safeTrim(originalName).replace(/\s+/g, '-').toLowerCase()) || 'file.xml';
  return `${Date.now()}-${crypto.randomUUID()}-${base}`;
}

function resolveStoredPath(relativePath) {
  return path.join(UPLOADS_DIR, relativePath);
}

function removeStoredFile(fileRecord) {
  if (!fileRecord || !fileRecord.relativePath) {
    return;
  }

  const fullPath = resolveStoredPath(fileRecord.relativePath);

  if (fs.existsSync(fullPath)) {
    fs.rmSync(fullPath, { force: true });
  }
}

function saveFileContent(workFolderId, originalName, contentBuffer, options = {}) {
  const db = getDb();
  const timestamp = nowIso();
  const cleanName = safeTrim(originalName);
  const existing = findFileByOriginalName(workFolderId, cleanName);

  if (existing && options.skipIfExists) {
    return existing;
  }

  const storedName = buildStoredName(cleanName);
  const relativePath = path.join(String(workFolderId), storedName);
  const fullPath = resolveStoredPath(relativePath);
  const encryptedContent = encryptBuffer(contentBuffer);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, encryptedContent);

  if (existing) {
    removeStoredFile(existing);

    db.prepare(`
      UPDATE files
      SET stored_name = ?, relative_path = ?, size = ?, updated_at = ?
      WHERE id = ?
    `).run(storedName, relativePath, contentBuffer.length, timestamp, existing.id);

    return findFileByOriginalName(workFolderId, cleanName);
  }

  const result = db.prepare(`
    INSERT INTO files (work_folder_id, original_name, stored_name, relative_path, size, uploaded_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(workFolderId, cleanName, storedName, relativePath, contentBuffer.length, timestamp, timestamp);

  return mapFileRow(db.prepare('SELECT * FROM files WHERE id = ?').get(result.lastInsertRowid));
}

function readFileContent(fileRecord) {
  const fullPath = resolveStoredPath(fileRecord.relativePath);
  const rawBuffer = fs.readFileSync(fullPath);
  const decrypted = decryptBuffer(rawBuffer);

  if (!decrypted.encrypted) {
    fs.writeFileSync(fullPath, encryptBuffer(decrypted.buffer));
  }

  return decrypted.buffer.toString('utf8');
}

function deleteFileByIdForFolder(fileId, workFolderId) {
  const db = getDb();
  const file = getFileByIdForFolder(fileId, workFolderId);

  if (!file) {
    return null;
  }

  removeStoredFile(file);
  db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
  return file;
}

function deleteWorkFolderByIdForUser(workFolderId, userId) {
  const db = getDb();
  const folder = getWorkFolderByIdForUser(workFolderId, userId);

  if (!folder) {
    return null;
  }

  db.prepare('DELETE FROM work_folders WHERE id = ? AND user_id = ?').run(folder.id, userId);
  fs.rmSync(path.join(UPLOADS_DIR, String(folder.id)), { recursive: true, force: true });
  return folder;
}

function migrateStoredFilesToEncrypted() {
  const db = getDb();
  const files = db.prepare('SELECT * FROM files').all().map(mapFileRow);

  for (const file of files) {
    const fullPath = resolveStoredPath(file.relativePath);

    if (!fs.existsSync(fullPath)) {
      continue;
    }

    const rawBuffer = fs.readFileSync(fullPath);

    if (isEncryptedPayload(rawBuffer)) {
      continue;
    }

    fs.writeFileSync(fullPath, encryptBuffer(rawBuffer));
  }
}

function getFolderFileMap(workFolderId) {
  const files = listFilesForFolder(workFolderId);
  const map = new Map();

  for (const file of files) {
    map.set(normalizeFileNameKey(file.originalName), {
      ...file,
      content: readFileContent(file),
    });
  }

  return map;
}

function isPrimaryAdmin(user) {
  return Boolean(user) && safeTrim(user.username).toLowerCase() === PRIMARY_ADMIN_USERNAME;
}

module.exports = {
  getUserById,
  getUserByUsername,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  createSessionRecord,
  getSessionWithUser,
  deleteSessionByHash,
  deleteSessionsForUser,
  deleteExpiredSessions,
  listWorkFoldersForUser,
  getWorkFolderByIdForUser,
  findWorkFolderByName,
  createWorkFolder,
  listFilesForFolder,
  findFileByOriginalName,
  getFileByIdForFolder,
  saveFileContent,
  readFileContent,
  deleteFileByIdForFolder,
  deleteWorkFolderByIdForUser,
  migrateStoredFilesToEncrypted,
  getFolderFileMap,
  isPrimaryAdmin,
};
