const fs = require('fs');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const yauzl = require('yauzl');
const { initDatabase } = require('./database');
const {
  PORT,
  PUBLIC_DIR,
  MAX_FILE_SIZE_BYTES,
  MAX_FILES_PER_UPLOAD,
  UPLOADS_DIR,
} = require('./config');
const {
  safeTrim,
  validateUsername,
  validateFolderName,
  isXmlFileName,
  isZipFileName,
  toBoolean,
} = require('./utils');
const {
  hashPassword,
  verifyPassword,
  validatePassword,
  createSession,
  setSessionCookie,
  clearSessionCookie,
  authenticationMiddleware,
  requireAuth,
  requireAdmin,
  requirePasswordChangeClearance,
  requireCsrf,
  destroySession,
} = require('./security');
const {
  getUserById,
  getUserByUsername,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  deleteSessionsForUser,
  listWorkFoldersForUser,
  getWorkFolderByIdForUser,
  findWorkFolderByName,
  createWorkFolder,
  listFilesForFolder,
  getFileByIdForFolder,
  saveFileContent,
  readFileContent,
  deleteFileByIdForFolder,
  deleteWorkFolderByIdForUser,
  migrateStoredFilesToEncrypted,
  getFolderFileMap,
  isPrimaryAdmin,
} = require('./store');
const { buildFlowGraph } = require('./flowParser');
const { seedDefaults } = require('./sampleSeeder');

initDatabase();
migrateStoredFilesToEncrypted();
seedDefaults();

const app = express();
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginOpenerPolicy: false,
  originAgentCluster: false,
  referrerPolicy: { policy: 'no-referrer' },
}));
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(authenticationMiddleware);
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many authentication attempts. Please try again in a few minutes.',
  },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: MAX_FILES_PER_UPLOAD,
  },
  fileFilter: (req, file, callback) => {
    if (!isXmlFileName(file.originalname) && !isZipFileName(file.originalname)) {
      callback(new Error(`Only XML and ZIP files are allowed: ${file.originalname}`));
      return;
    }

    callback(null, true);
  },
});

function isUnsafeZipEntryName(entryName) {
  const normalized = String(entryName || '').replace(/\\/g, '/');
  return normalized.startsWith('/')
    || /^[A-Za-z]:/.test(normalized)
    || normalized.split('/').some((segment) => segment === '..');
}

function zipEntryBaseName(entryName) {
  return path.posix.basename(String(entryName || '').replace(/\\/g, '/'));
}

function readZipEntry(zipFile, entry) {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (streamError, readStream) => {
      if (streamError) {
        reject(streamError);
        return;
      }

      const chunks = [];
      let totalSize = 0;

      readStream.on('data', (chunk) => {
        totalSize += chunk.length;

        if (totalSize > MAX_FILE_SIZE_BYTES) {
          readStream.destroy(new Error(`Extracted file exceeds maximum size: ${entry.fileName}`));
          return;
        }

        chunks.push(chunk);
      });
      readStream.on('error', reject);
      readStream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  });
}

function openZipBuffer(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zipFile) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(zipFile);
    });
  });
}

async function extractXmlFilesFromZip(file) {
  const zipFile = await openZipBuffer(file.buffer);
  const extractedFiles = [];

  return new Promise((resolve, reject) => {
    zipFile.on('error', reject);
    zipFile.on('end', () => resolve(extractedFiles));
    zipFile.on('entry', async (entry) => {
      try {
        const entryName = String(entry.fileName || '');

        if (isUnsafeZipEntryName(entryName)) {
          throw new Error(`ZIP file contains an unsafe path: ${entryName}`);
        }

        if (/\/$/.test(entryName) || !isXmlFileName(entryName)) {
          zipFile.readEntry();
          return;
        }

        if (entry.uncompressedSize > MAX_FILE_SIZE_BYTES) {
          throw new Error(`Extracted XML file exceeds maximum size: ${entryName}`);
        }

        const originalName = zipEntryBaseName(entryName);

        if (!originalName || !isXmlFileName(originalName)) {
          zipFile.readEntry();
          return;
        }

        const content = await readZipEntry(zipFile, entry);
        extractedFiles.push({ originalName, content });
        zipFile.readEntry();
      } catch (error) {
        zipFile.close();
        reject(error);
      }
    });

    zipFile.readEntry();
  });
}

function serializeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    username: user.username,
    isAdmin: Boolean(user.isAdmin),
    mustChangePassword: Boolean(user.mustChangePassword),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function serializeAuthState(req) {
  if (!req.auth || !req.auth.user) {
    return {
      authenticated: false,
      user: null,
      csrfToken: null,
    };
  }

  return {
    authenticated: true,
    user: serializeUser(req.auth.user),
    csrfToken: req.auth.csrfToken,
  };
}

function getFolderOrSend404(req, res) {
  const workFolderId = Number(req.params.workFolderId);

  if (!Number.isInteger(workFolderId) || workFolderId <= 0) {
    res.status(400).json({ error: 'Invalid work folder id.' });
    return null;
  }

  const folder = getWorkFolderByIdForUser(workFolderId, req.auth.user.id);

  if (!folder) {
    res.status(404).json({ error: 'Work folder not found.' });
    return null;
  }

  return folder;
}

function getDefaultWorkFolderId(workFolders) {
  if (!Array.isArray(workFolders) || workFolders.length === 0) {
    return null;
  }

  const sampleFolder = workFolders.find((folder) => safeTrim(folder.name).toLowerCase() === 'sample data');
  return sampleFolder ? sampleFolder.id : workFolders[0].id;
}

function getDefaultStartProjectFileName(files) {
  if (!Array.isArray(files) || files.length === 0) {
    return '';
  }

  const projectMain = files.find((file) => safeTrim(file.originalName).toLowerCase() === 'projectmain.xml');
  return projectMain ? projectMain.originalName : files[0].originalName;
}

function serializeFile(file) {
  return {
    id: file.id,
    originalName: file.originalName,
    size: file.size,
    uploadedAt: file.uploadedAt,
    updatedAt: file.updatedAt,
  };
}

function buildFilesPayload(folder) {
  const files = listFilesForFolder(folder.id).map(serializeFile);
  return {
    workFolder: folder,
    files,
    defaultStartProjectFileName: getDefaultStartProjectFileName(files),
  };
}

function sendNewSession(res, user, req) {
  const session = createSession(user, req);
  setSessionCookie(res, session.rawSessionToken);
  res.json({
    authenticated: true,
    user: serializeUser(user),
    csrfToken: session.csrfToken,
  });
}

app.get('/api/auth/session', (req, res) => {
  res.json(serializeAuthState(req));
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const username = safeTrim(req.body.username);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const user = getUserByUsername(username);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: 'Invalid username or password.' });
    return;
  }

  clearSessionCookie(res);
  sendNewSession(res, user, req);
});

app.post('/api/auth/register', authLimiter, (req, res) => {
  const username = safeTrim(req.body.username);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const usernameError = validateUsername(username);
  const passwordError = validatePassword(password, username);

  if (usernameError) {
    res.status(400).json({ error: usernameError });
    return;
  }

  if (passwordError) {
    res.status(400).json({ error: passwordError });
    return;
  }

  if (getUserByUsername(username)) {
    res.status(409).json({ error: 'That username is already in use.' });
    return;
  }

  const user = createUser({
    username,
    passwordHash: hashPassword(password),
    isAdmin: false,
    mustChangePassword: false,
  });

  sendNewSession(res, user, req);
});

app.post('/api/auth/change-password', requireAuth, requireCsrf, (req, res) => {
  const currentPassword = typeof req.body.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPassword = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';
  const user = getUserById(req.auth.user.id);

  if (!user) {
    destroySession(req, res);
    res.status(401).json({ error: 'Session is no longer valid.' });
    return;
  }

  if (!verifyPassword(currentPassword, user.passwordHash)) {
    res.status(400).json({ error: 'Current password is incorrect.' });
    return;
  }

  const passwordError = validatePassword(newPassword, user.username);

  if (passwordError) {
    res.status(400).json({ error: passwordError });
    return;
  }

  const updatedUser = updateUser(user.id, {
    passwordHash: hashPassword(newPassword),
    mustChangePassword: false,
  });

  deleteSessionsForUser(user.id);
  sendNewSession(res, updatedUser, req);
});

app.post('/api/auth/logout', (req, res) => {
  if (req.auth && req.auth.user) {
    destroySession(req, res);
  } else {
    clearSessionCookie(res);
  }

  res.json({ success: true });
});

app.get('/api/admin/users', requireAuth, requireAdmin, requirePasswordChangeClearance, (req, res) => {
  res.json({ users: listUsers() });
});

app.post('/api/admin/users', requireAuth, requireAdmin, requirePasswordChangeClearance, requireCsrf, (req, res) => {
  const username = safeTrim(req.body.username);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const isAdmin = toBoolean(req.body.isAdmin);
  const mustChangePassword = toBoolean(req.body.mustChangePassword);
  const usernameError = validateUsername(username);
  const passwordError = validatePassword(password, username);

  if (usernameError) {
    res.status(400).json({ error: usernameError });
    return;
  }

  if (passwordError) {
    res.status(400).json({ error: passwordError });
    return;
  }

  if (getUserByUsername(username)) {
    res.status(409).json({ error: 'That username is already in use.' });
    return;
  }

  const user = createUser({
    username,
    passwordHash: hashPassword(password),
    isAdmin,
    mustChangePassword,
  });

  res.status(201).json({ user: serializeUser(user) });
});

app.put('/api/admin/users/:userId', requireAuth, requireAdmin, requirePasswordChangeClearance, requireCsrf, (req, res) => {
  const userId = Number(req.params.userId);

  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(400).json({ error: 'Invalid user id.' });
    return;
  }

  const existingUser = getUserById(userId);

  if (!existingUser) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  const nextUsername = req.body.username === undefined ? existingUser.username : safeTrim(req.body.username);
  const nextIsAdmin = req.body.isAdmin === undefined ? existingUser.isAdmin : toBoolean(req.body.isAdmin);
  const nextMustChangePassword = req.body.mustChangePassword === undefined ? existingUser.mustChangePassword : toBoolean(req.body.mustChangePassword);
  const nextPassword = typeof req.body.password === 'string' ? req.body.password : '';
  const protectedAdmin = isPrimaryAdmin(existingUser);

  if (protectedAdmin && nextUsername.toLowerCase() !== existingUser.username.toLowerCase()) {
    res.status(400).json({ error: 'The primary admin username cannot be changed.' });
    return;
  }

  if (protectedAdmin && !nextIsAdmin) {
    res.status(400).json({ error: 'The primary admin must remain an administrator.' });
    return;
  }

  if (req.auth.user.id === existingUser.id && !nextIsAdmin) {
    res.status(400).json({ error: 'You cannot remove your own administrator access.' });
    return;
  }

  const usernameError = validateUsername(nextUsername);

  if (usernameError) {
    res.status(400).json({ error: usernameError });
    return;
  }

  const duplicate = getUserByUsername(nextUsername);

  if (duplicate && duplicate.id !== existingUser.id) {
    res.status(409).json({ error: 'That username is already in use.' });
    return;
  }

  let passwordHash;

  if (safeTrim(nextPassword)) {
    const passwordError = validatePassword(nextPassword, nextUsername);

    if (passwordError) {
      res.status(400).json({ error: passwordError });
      return;
    }

    passwordHash = hashPassword(nextPassword);
  }

  const updatedUser = updateUser(existingUser.id, {
    username: nextUsername,
    isAdmin: nextIsAdmin,
    mustChangePassword: nextMustChangePassword,
    passwordHash,
  });

  if (passwordHash || nextUsername.toLowerCase() !== existingUser.username.toLowerCase() || nextIsAdmin !== existingUser.isAdmin) {
    deleteSessionsForUser(existingUser.id);
  }

  if (req.auth.user.id === existingUser.id && (passwordHash || nextUsername.toLowerCase() !== existingUser.username.toLowerCase())) {
    clearSessionCookie(res);
    res.json({ user: serializeUser(updatedUser), reauthenticate: true });
    return;
  }

  res.json({ user: serializeUser(updatedUser) });
});

app.delete('/api/admin/users/:userId', requireAuth, requireAdmin, requirePasswordChangeClearance, requireCsrf, (req, res) => {
  const userId = Number(req.params.userId);

  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(400).json({ error: 'Invalid user id.' });
    return;
  }

  const user = getUserById(userId);

  if (!user) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  if (req.auth.user.id === user.id) {
    res.status(400).json({ error: 'You cannot delete your own account.' });
    return;
  }

  if (isPrimaryAdmin(user)) {
    res.status(400).json({ error: 'The primary admin user cannot be deleted.' });
    return;
  }

  const folders = listWorkFoldersForUser(user.id);
  deleteSessionsForUser(user.id);
  deleteUser(user.id);

  for (const folder of folders) {
    fs.rmSync(path.join(UPLOADS_DIR, String(folder.id)), { recursive: true, force: true });
  }

  res.json({ success: true });
});

app.get('/api/work-folders', requireAuth, requirePasswordChangeClearance, (req, res) => {
  const workFolders = listWorkFoldersForUser(req.auth.user.id);
  res.json({
    workFolders,
    defaultWorkFolderId: getDefaultWorkFolderId(workFolders),
  });
});

app.post('/api/work-folders', requireAuth, requirePasswordChangeClearance, requireCsrf, (req, res) => {
  const folderName = safeTrim(req.body.name);
  const folderNameError = validateFolderName(folderName);

  if (folderNameError) {
    res.status(400).json({ error: folderNameError });
    return;
  }

  if (findWorkFolderByName(req.auth.user.id, folderName)) {
    res.status(409).json({ error: 'A work folder with that name already exists.' });
    return;
  }

  const folder = createWorkFolder(req.auth.user.id, folderName);
  res.status(201).json({ workFolder: folder });
});

app.get('/api/work-folders/:workFolderId/files', requireAuth, requirePasswordChangeClearance, (req, res) => {
  const folder = getFolderOrSend404(req, res);

  if (!folder) {
    return;
  }

  res.json(buildFilesPayload(folder));
});

app.post('/api/work-folders/:workFolderId/upload', requireAuth, requirePasswordChangeClearance, requireCsrf, upload.array('files', MAX_FILES_PER_UPLOAD), async (req, res, next) => {
  const folder = getFolderOrSend404(req, res);

  if (!folder) {
    return;
  }

  if (!Array.isArray(req.files) || req.files.length === 0) {
    res.status(400).json({ error: 'Please select at least one XML or ZIP file to upload.' });
    return;
  }

  try {
    let savedFileCount = 0;

    for (const file of req.files) {
      if (isZipFileName(file.originalname)) {
        const extractedFiles = await extractXmlFilesFromZip(file);

        for (const extractedFile of extractedFiles) {
          saveFileContent(folder.id, extractedFile.originalName, extractedFile.content);
          savedFileCount += 1;
        }

        continue;
      }

      saveFileContent(folder.id, file.originalname, file.buffer);
      savedFileCount += 1;
    }

    if (savedFileCount === 0) {
      res.status(400).json({ error: 'No XML files were found to upload.' });
      return;
    }

    const refreshedFolder = getWorkFolderByIdForUser(folder.id, req.auth.user.id);
    res.status(201).json(buildFilesPayload(refreshedFolder));
  } catch (error) {
    next(error);
  }
});

app.post('/api/work-folders/:workFolderId/paste-xml', requireAuth, requirePasswordChangeClearance, requireCsrf, upload.none(), (req, res) => {
  const folder = getFolderOrSend404(req, res);

  if (!folder) {
    return;
  }

  const { fileName, xmlContent } = req.body;

  if (!fileName || !xmlContent) {
    res.status(400).json({ error: 'Both file name and XML content are required.' });
    return;
  }

  // Validate file name
  if (!fileName.endsWith('.xml') || fileName.includes('/') || fileName.includes('\\')) {
    res.status(400).json({ error: 'Invalid file name. Must end with .xml and contain no path separators.' });
    return;
  }

  // Check content size (1MB limit)
  const contentSize = Buffer.byteLength(xmlContent, 'utf8');
  if (contentSize > 1048576) {
    res.status(413).json({ error: 'XML content exceeds maximum size of 1MB.' });
    return;
  }

  // Check if file already exists
  const existingFiles = listFilesForFolder(folder.id);
  const existingFile = existingFiles.find(file => file.originalName === fileName);
  if (existingFile) {
    res.status(409).json({ error: 'A file with that name already exists in this folder.' });
    return;
  }

  // Validate XML content (basic check)
  const trimmedContent = xmlContent.trim();
  if (!trimmedContent.startsWith('<') || !trimmedContent.endsWith('>')) {
    res.status(400).json({ error: 'Invalid XML content. Content must be valid XML.' });
    return;
  }

  // Save the file
  saveFileContent(folder.id, fileName, Buffer.from(xmlContent, 'utf8'));

  const refreshedFolder = getWorkFolderByIdForUser(folder.id, req.auth.user.id);
  res.status(201).json(buildFilesPayload(refreshedFolder));
});

app.post('/api/work-folders/:workFolderId/replace-missing', requireAuth, requirePasswordChangeClearance, requireCsrf, (req, res) => {
  const folder = getFolderOrSend404(req, res);

  if (!folder) {
    return;
  }

  const missingFileName = safeTrim(req.body.missingFileName);
  const sourceFileId = Number(req.body.sourceFileId);

  if (!isXmlFileName(missingFileName)) {
    res.status(400).json({ error: 'Missing file name must end with .xml.' });
    return;
  }

  if (!Number.isInteger(sourceFileId) || sourceFileId <= 0) {
    res.status(400).json({ error: 'Select an uploaded XML file to use as the replacement.' });
    return;
  }

  const sourceFile = getFileByIdForFolder(sourceFileId, folder.id);

  if (!sourceFile) {
    res.status(404).json({ error: 'Selected replacement file was not found in this work folder.' });
    return;
  }

  saveFileContent(folder.id, missingFileName, Buffer.from(readFileContent(sourceFile), 'utf8'));

  const refreshedFolder = getWorkFolderByIdForUser(folder.id, req.auth.user.id);
  res.status(201).json(buildFilesPayload(refreshedFolder));
});

app.delete('/api/work-folders/:workFolderId', requireAuth, requirePasswordChangeClearance, requireCsrf, (req, res) => {
  const folder = getFolderOrSend404(req, res);

  if (!folder) {
    return;
  }

  const deletedFolder = deleteWorkFolderByIdForUser(folder.id, req.auth.user.id);

  if (!deletedFolder) {
    res.status(404).json({ error: 'Work folder not found.' });
    return;
  }

  const workFolders = listWorkFoldersForUser(req.auth.user.id);

  res.json({
    deletedWorkFolderId: deletedFolder.id,
    workFolders,
    defaultWorkFolderId: getDefaultWorkFolderId(workFolders),
  });
});

app.delete('/api/work-folders/:workFolderId/files/:fileId', requireAuth, requirePasswordChangeClearance, requireCsrf, (req, res) => {
  const folder = getFolderOrSend404(req, res);

  if (!folder) {
    return;
  }

  const fileId = Number(req.params.fileId);

  if (!Number.isInteger(fileId) || fileId <= 0) {
    res.status(400).json({ error: 'Invalid file id.' });
    return;
  }

  const deletedFile = deleteFileByIdForFolder(fileId, folder.id);

  if (!deletedFile) {
    res.status(404).json({ error: 'File not found.' });
    return;
  }

  const refreshedFolder = getWorkFolderByIdForUser(folder.id, req.auth.user.id);

  res.json({
    deletedFileId: deletedFile.id,
    deletedFileName: deletedFile.originalName,
    ...buildFilesPayload(refreshedFolder),
  });
});

app.post('/api/work-folders/:workFolderId/process', requireAuth, requirePasswordChangeClearance, requireCsrf, (req, res) => {
  const folder = getFolderOrSend404(req, res);

  if (!folder) {
    return;
  }

  const startProjectFileName = safeTrim(req.body.startProjectFileName);

  if (!startProjectFileName || !isXmlFileName(startProjectFileName)) {
    res.status(400).json({ error: 'Please choose a valid starting project XML file.' });
    return;
  }

  const fileMap = getFolderFileMap(folder.id);

  if (fileMap.size === 0) {
    res.status(400).json({ error: 'Upload one or more XML files before processing.' });
    return;
  }

  const graph = buildFlowGraph(startProjectFileName, fileMap);

  res.json({
    workFolder: folder,
    startProjectFileName,
    graph,
  });
});

app.use(express.static(PUBLIC_DIR, {
  index: 'index.html',
  extensions: ['html'],
}));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    next();
    return;
  }

  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_COUNT') {
      res.status(400).json({ error: `You can upload up to ${MAX_FILES_PER_UPLOAD} XML files at a time.` });
      return;
    }

    res.status(400).json({ error: error.message });
    return;
  }

  if (error instanceof SyntaxError && Object.prototype.hasOwnProperty.call(error, 'body')) {
    res.status(400).json({ error: 'Invalid JSON request body.' });
    return;
  }

  if (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'An unexpected server error occurred.' });
    return;
  }

  next();
});

const server = app.listen(PORT, () => {
  console.log(`GA Project Flow Utility is running at http://localhost:${PORT}`);
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
