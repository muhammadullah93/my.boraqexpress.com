import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { hashPassword } from '../auth.js';
import { audit, query } from '../db.js';
import { requireRoles } from '../middleware.js';
import { ApiError, email, publicUser, text } from '../utils.js';

export const usersRouter = Router();
usersRouter.use(requireRoles('admin'));

usersRouter.get('/', async (_req, res) => {
  const rows = await query('SELECT id, name, email, role, company_name, status, created_at FROM users ORDER BY created_at DESC');
  res.json({ users: rows.map(publicUser) });
});

usersRouter.post('/', async (req, res) => {
  const role = text(req.body?.role, 'Role', { max: 30 });
  if (!['admin', 'supplier', 'dropshipper'].includes(role)) throw new ApiError(400, 'VALIDATION_ERROR', 'Role must be admin, supplier, or dropshipper.');
  const password = text(req.body?.password, 'Temporary password', { max: 500 });
  const user = {
    id: randomUUID(),
    name: text(req.body?.name, 'Name', { max: 120 }),
    email: email(req.body?.email),
    role,
    companyName: text(req.body?.companyName, 'Company name', { required: false, max: 190 }) || null,
    passwordHash: await hashPassword(password)
  };
  await query(
    `INSERT INTO users (id, name, email, password_hash, role, company_name, status)
     VALUES (?, ?, ?, ?, ?, ?, 'active')`,
    [user.id, user.name, user.email, user.passwordHash, user.role, user.companyName]
  );
  await audit(req.user.id, 'create_user', 'user', user.id, { role: user.role, email: user.email });
  const [created] = await query('SELECT id, name, email, role, company_name, status, created_at FROM users WHERE id = ?', [user.id]);
  res.status(201).json({ user: publicUser(created) });
});

usersRouter.patch('/:id/status', async (req, res) => {
  if (req.params.id === req.user.id) throw new ApiError(400, 'SELF_STATUS_CHANGE', 'You cannot disable your own account.');
  const status = text(req.body?.status, 'Status', { max: 20 });
  if (!['active', 'disabled'].includes(status)) throw new ApiError(400, 'VALIDATION_ERROR', 'Status must be active or disabled.');
  const result = await query('UPDATE users SET status = ?, session_version = session_version + 1 WHERE id = ?', [status, req.params.id]);
  if (!result.affectedRows) throw new ApiError(404, 'NOT_FOUND', 'User was not found.');
  await audit(req.user.id, 'change_user_status', 'user', req.params.id, { status });
  res.json({ success: true });
});

usersRouter.post('/:id/reset-password', async (req, res) => {
  const password = text(req.body?.password, 'New password', { max: 500 });
  const passwordHash = await hashPassword(password);
  const result = await query(
    'UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?',
    [passwordHash, req.params.id]
  );
  if (!result.affectedRows) throw new ApiError(404, 'NOT_FOUND', 'User was not found.');
  await audit(req.user.id, 'reset_password', 'user', req.params.id);
  res.json({ success: true });
});
