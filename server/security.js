const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { IS_PRODUCTION, SESSION_COOKIE_NAME, SESSION_TTL_MS } = require('./config');
const { createSessionRecord, getSessionWithUser, deleteSessionByHash, deleteExpiredSessions } = require('./store');
const { safeTrim } = require('./utils');

function hashPassword(password) {
  return bcrypt.hashSync(password, 12);
}

function verifyPassword(password, passwordHash) {
  return bcrypt.compareSync(password, passwordHash);
}

function validatePassword(password, username) {
  const value = safeTrim(password);

  if (value.length < 10 || value.length > 128) {
    return 'Password must be between 10 and 128 characters long.';
  }

  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value)) {
    return 'Password must include at least one lowercase letter, one uppercase letter, and one number.';
  }

  if (username && value.toLowerCase().includes(safeTrim(username).toLowerCase())) {
    return 'Password cannot contain your username.';
  }

  return null;
}

function buildSessionHash(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function generateToken(size = 32) {
  return crypto.randomBytes(size).toString('hex');
}

function createSession(user, req) {
  deleteExpiredSessions();
  const rawSessionToken = generateToken(32);
  const csrfToken = generateToken(24);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const sessionHash = buildSessionHash(rawSessionToken);

  createSessionRecord({
    sessionHash,
    userId: user.id,
    csrfToken,
    expiresAt,
    userAgent: req.get('user-agent') || '',
    ipAddress: req.ip || '',
  });

  return {
    rawSessionToken,
    csrfToken,
    expiresAt,
  };
}

function setSessionCookie(res, rawSessionToken) {
  res.cookie(SESSION_COOKIE_NAME, rawSessionToken, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'strict',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'strict',
    path: '/',
  });
}

function authenticationMiddleware(req, res, next) {
  const rawSessionToken = req.cookies[SESSION_COOKIE_NAME];

  if (!rawSessionToken) {
    return next();
  }

  const session = getSessionWithUser(buildSessionHash(rawSessionToken));

  if (!session) {
    clearSessionCookie(res);
    return next();
  }

  req.auth = {
    rawSessionToken,
    sessionId: session.id,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
    user: {
      id: session.user.id,
      username: session.user.username,
      isAdmin: session.user.isAdmin,
      mustChangePassword: session.user.mustChangePassword,
      createdAt: session.user.createdAt,
      updatedAt: session.user.updatedAt,
    },
  };

  return next();
}

function requireAuth(req, res, next) {
  if (!req.auth || !req.auth.user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  return next();
}

function requireAdmin(req, res, next) {
  if (!req.auth || !req.auth.user || !req.auth.user.isAdmin) {
    return res.status(403).json({ error: 'Administrator access is required.' });
  }

  return next();
}

function requirePasswordChangeClearance(req, res, next) {
  if (req.auth && req.auth.user && req.auth.user.mustChangePassword) {
    return res.status(403).json({
      error: 'You must change your password before continuing.',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
  }

  return next();
}

function requireCsrf(req, res, next) {
  const method = req.method.toUpperCase();

  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }

  if (!req.auth || !req.auth.user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const csrfToken = req.get('x-csrf-token');

  if (!csrfToken || csrfToken !== req.auth.csrfToken) {
    return res.status(403).json({ error: 'Invalid CSRF token.' });
  }

  return next();
}

function destroySession(req, res) {
  if (req.auth && req.auth.rawSessionToken) {
    deleteSessionByHash(buildSessionHash(req.auth.rawSessionToken));
  }

  clearSessionCookie(res);
}

module.exports = {
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
};
