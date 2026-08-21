import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { createCsrfToken, parseCookies, safeTextEqual, verifySession } from './auth.js';
import { query } from './db.js';
import { ApiError, publicUser } from './utils.js';

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPT_LIMIT = 10;

function loginAttemptKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function removeExpiredLoginAttempts(now) {
  for (const [key, value] of loginAttempts) {
    if (value.resetAt <= now) loginAttempts.delete(key);
  }
}

export function requestContext(req, res, next) {
  req.requestId = randomUUID();
  res.set('X-Request-ID', req.requestId);
  if (req.path === '/api' || req.path.startsWith('/api/')) {
    res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
  }
  next();
}

export function cookies(req, _res, next) {
  req.cookies = parseCookies(req.headers.cookie || '');
  next();
}

export function securityHeaders(_req, res, next) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  };
  if (config.nodeEnv === 'production') headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  res.set(headers);
  next();
}

export function loginRateLimit(req, _res, next) {
  const now = Date.now();
  removeExpiredLoginAttempts(now);
  const key = loginAttemptKey(req);
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return next();
  }
  current.count += 1;
  if (current.count > LOGIN_ATTEMPT_LIMIT) {
    return next(new ApiError(429, 'RATE_LIMITED', 'Too many login attempts. Try again later.', {
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
    }));
  }
  next();
}

export function clearLoginRateLimit(req) {
  loginAttempts.delete(loginAttemptKey(req));
}

export async function requireAuth(req, _res, next) {
  const payload = verifySession(req.cookies.sellflow_session, config.sessionSecret);
  if (!payload) return next(new ApiError(401, 'UNAUTHENTICATED', 'Please sign in.'));
  const rows = await query(
    'SELECT id, name, email, role, company_name, status, session_version, created_at FROM users WHERE id = ? LIMIT 1',
    [payload.sub]
  );
  const user = rows[0];
  if (!user || user.status !== 'active' || Number(user.session_version) !== Number(payload.sv)) {
    return next(new ApiError(401, 'SESSION_EXPIRED', 'Your session is no longer valid.'));
  }
  req.user = publicUser(user);
  req.user.sessionVersion = Number(user.session_version);
  next();
}

export function requireRoles(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return next(new ApiError(403, 'FORBIDDEN', 'You do not have permission for this action.'));
    next();
  };
}

export function requireCsrf(req, _res, next) {
  const cookie = req.cookies.sellflow_csrf;
  const header = req.get('x-csrf-token');
  if (!cookie || !header || !safeTextEqual(cookie, header)) {
    return next(new ApiError(403, 'CSRF_INVALID', 'Security token is missing or invalid. Refresh and try again.'));
  }
  next();
}

export function ensureCsrfCookie(req, res) {
  const existing = req.cookies.sellflow_csrf;
  if (existing) return existing;
  const token = createCsrfToken();
  res.cookie('sellflow_csrf', token, {
    httpOnly: false,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: config.sessionTtlHours * 3600 * 1000
  });
  return token;
}

export function notFound(req, _res, next) {
  next(new ApiError(404, 'NOT_FOUND', `No endpoint exists at ${req.method} ${req.path}.`));
}

export function errorHandler(error, _req, res, _next) {
  if (error?.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: { code: 'DUPLICATE', message: 'A record with that unique value already exists.' } });
  }
  if (error?.code === 'ER_LOCK_WAIT_TIMEOUT' || error?.code === 'ER_LOCK_DEADLOCK') {
    console.error(error);
    return res.status(503).json({
      error: {
        code: 'DATABASE_BUSY',
        message: 'The database is busy processing another inventory change. Please retry.',
        ...(_req.requestId ? { requestId: _req.requestId } : {})
      }
    });
  }
  const status = Number(error.status) || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: status >= 500 ? 'An unexpected server error occurred.' : error.message,
      ...(_req.requestId ? { requestId: _req.requestId } : {}),
      ...(error.details ? { details: error.details } : {})
    }
  });
}
