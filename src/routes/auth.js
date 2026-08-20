import { Router } from 'express';
import { config } from '../config.js';
import { createCsrfToken, signSession, verifyPassword } from '../auth.js';
import { audit, query } from '../db.js';
import { loginRateLimit, requireAuth, requireCsrf } from '../middleware.js';
import { ApiError, email, publicUser, text } from '../utils.js';

export const authRouter = Router();

function cookieOptions(httpOnly) {
  return {
    httpOnly,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: config.sessionTtlHours * 3600 * 1000
  };
}

authRouter.post('/login', loginRateLimit, async (req, res) => {
  const loginEmail = email(req.body?.email);
  const password = text(req.body?.password, 'Password', { max: 500 });
  const rows = await query('SELECT * FROM users WHERE email = ? LIMIT 1', [loginEmail]);
  const user = rows[0];
  if (!user || user.status !== 'active' || !(await verifyPassword(password, user.password_hash))) {
    throw new ApiError(401, 'INVALID_LOGIN', 'Email or password is incorrect.');
  }
  const token = signSession({ sub: user.id, role: user.role, sv: user.session_version }, config.sessionSecret, config.sessionTtlHours);
  const csrf = createCsrfToken();
  res.cookie('sellflow_session', token, cookieOptions(true));
  res.cookie('sellflow_csrf', csrf, cookieOptions(false));
  await audit(user.id, 'login', 'session', null, { ip: req.ip });
  res.json({ user: publicUser(user), csrfToken: csrf });
});

authRouter.get('/me', requireAuth, (req, res) => {
  const csrf = req.cookies.sellflow_csrf || createCsrfToken();
  if (!req.cookies.sellflow_csrf) res.cookie('sellflow_csrf', csrf, cookieOptions(false));
  res.json({ user: req.user, csrfToken: csrf });
});

authRouter.post('/logout', requireAuth, requireCsrf, async (req, res) => {
  await audit(req.user.id, 'logout', 'session', null);
  res.clearCookie('sellflow_session', { path: '/' });
  res.clearCookie('sellflow_csrf', { path: '/' });
  res.status(204).end();
});
