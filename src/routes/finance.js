import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { audit, query, transaction } from '../db.js';
import { requireRoles } from '../middleware.js';
import { ApiError, limit, money, text } from '../utils.js';

export const financeRouter = Router();

async function ensureWallet(connection, userId) {
  const [users] = await connection.execute("SELECT id, role FROM users WHERE id = ? AND role IN ('supplier','dropshipper') LIMIT 1", [userId]);
  if (!users[0]) throw new ApiError(404, 'WALLET_USER_NOT_FOUND', 'A supplier or dropshipper account was not found.');
  const [rows] = await connection.execute('SELECT * FROM wallet_accounts WHERE user_id = ? FOR UPDATE', [userId]);
  if (rows[0]) return rows[0];
  const id = randomUUID();
  await connection.execute("INSERT INTO wallet_accounts (id, user_id, currency) VALUES (?, ?, 'MYR')", [id, userId]);
  const [created] = await connection.execute('SELECT * FROM wallet_accounts WHERE id = ? FOR UPDATE', [id]);
  return created[0];
}

financeRouter.get('/', async (req, res) => {
  const params = [];
  const filter = req.user.role === 'admin' ? '1 = 1' : 'w.user_id = ?';
  if (req.user.role !== 'admin') params.push(req.user.id);
  const wallets = await query(
    `SELECT w.*, u.name, u.email, u.role, u.company_name
       FROM wallet_accounts w JOIN users u ON u.id = w.user_id
      WHERE ${filter} ORDER BY u.name`,
    params
  );
  const walletIds = wallets.map(wallet => wallet.id);
  if (!walletIds.length) return res.json({ wallets: [], transactions: [], payouts: [] });
  const placeholders = walletIds.map(() => '?').join(',');
  const [transactions, payouts] = await Promise.all([
    query(
      `SELECT wt.*, u.name AS created_by_name
         FROM wallet_transactions wt LEFT JOIN users u ON u.id = wt.created_by
        WHERE wt.wallet_id IN (${placeholders}) ORDER BY wt.created_at DESC LIMIT ?`,
      [...walletIds, limit(req.query.limit)]
    ),
    query(
      `SELECT pr.*, w.user_id, u.name
         FROM payout_requests pr JOIN wallet_accounts w ON w.id = pr.wallet_id
         JOIN users u ON u.id = w.user_id
        WHERE pr.wallet_id IN (${placeholders}) ORDER BY pr.requested_at DESC LIMIT ?`,
      [...walletIds, limit(req.query.limit)]
    )
  ]);
  res.json({ wallets, transactions, payouts });
});

financeRouter.post('/adjustments', requireRoles('admin'), async (req, res) => {
  const userId = text(req.body?.userId, 'Account', { max: 36 });
  const bucket = text(req.body?.bucket || 'available', 'Bucket', { max: 20 });
  if (!['pending', 'available'].includes(bucket)) throw new ApiError(400, 'VALIDATION_ERROR', 'Bucket must be pending or available.');
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 100_000_000) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Adjustment must be a non-zero valid amount.');
  }
  const rounded = Math.round(amount * 100) / 100;
  const description = text(req.body?.description, 'Description', { max: 255 });
  const result = await transaction(async connection => {
    const wallet = await ensureWallet(connection, userId);
    const column = bucket === 'pending' ? 'pending_balance' : 'available_balance';
    const balance = Number(wallet[column]) + rounded;
    if (balance < 0) throw new ApiError(409, 'INSUFFICIENT_BALANCE', 'Adjustment would make the balance negative.');
    await connection.execute(`UPDATE wallet_accounts SET ${column} = ? WHERE id = ?`, [balance, wallet.id]);
    const transactionId = randomUUID();
    await connection.execute(
      `INSERT INTO wallet_transactions
       (id, wallet_id, type, bucket, amount, balance_after, reference_type, reference_id, description, created_by)
       VALUES (?, ?, 'manual_adjustment', ?, ?, ?, 'manual', ?, ?, ?)`,
      [transactionId, wallet.id, bucket, rounded, balance, transactionId, description, req.user.id]
    );
    return { walletId: wallet.id, transactionId, balance };
  });
  await audit(req.user.id, 'wallet_adjustment', 'wallet', result.walletId, { userId, bucket, amount: rounded, description });
  res.status(201).json(result);
});

financeRouter.post('/payouts', requireRoles('supplier', 'dropshipper'), async (req, res) => {
  const amount = money(req.body?.amount, 'Payout amount', { min: 0.01 });
  const result = await transaction(async connection => {
    const wallet = await ensureWallet(connection, req.user.id);
    if (Number(wallet.available_balance) < amount) throw new ApiError(409, 'INSUFFICIENT_BALANCE', 'Available balance is too low.');
    const payoutId = randomUUID();
    const balance = Number(wallet.available_balance) - amount;
    await connection.execute('UPDATE wallet_accounts SET available_balance = ? WHERE id = ?', [balance, wallet.id]);
    await connection.execute(
      "INSERT INTO payout_requests (id, wallet_id, amount, status) VALUES (?, ?, ?, 'requested')",
      [payoutId, wallet.id, amount]
    );
    await connection.execute(
      `INSERT INTO wallet_transactions
       (id, wallet_id, type, bucket, amount, balance_after, reference_type, reference_id, description, created_by)
       VALUES (?, ?, 'payout_hold', 'available', ?, ?, 'payout', ?, 'Payout requested', ?)`,
      [randomUUID(), wallet.id, -amount, balance, payoutId, req.user.id]
    );
    return { payoutId, balance };
  });
  await audit(req.user.id, 'request_payout', 'payout', result.payoutId, { amount });
  res.status(201).json(result);
});

financeRouter.patch('/payouts/:id', requireRoles('admin'), async (req, res) => {
  const status = text(req.body?.status, 'Status', { max: 30 });
  if (!['paid', 'rejected'].includes(status)) throw new ApiError(400, 'VALIDATION_ERROR', 'Status must be paid or rejected.');
  const paymentReference = text(req.body?.paymentReference, 'Payment reference', { required: false, max: 160 }) || null;
  const result = await transaction(async connection => {
    const [rows] = await connection.execute(
      `SELECT pr.*, w.available_balance FROM payout_requests pr
       JOIN wallet_accounts w ON w.id = pr.wallet_id WHERE pr.id = ? FOR UPDATE`,
      [req.params.id]
    );
    const payout = rows[0];
    if (!payout) throw new ApiError(404, 'NOT_FOUND', 'Payout request was not found.');
    if (payout.status !== 'requested') throw new ApiError(409, 'PAYOUT_FINAL', 'This payout request is already final.');
    let balance = Number(payout.available_balance);
    if (status === 'rejected') {
      balance += Number(payout.amount);
      await connection.execute('UPDATE wallet_accounts SET available_balance = ? WHERE id = ?', [balance, payout.wallet_id]);
      await connection.execute(
        `INSERT INTO wallet_transactions
         (id, wallet_id, type, bucket, amount, balance_after, reference_type, reference_id, description, created_by)
         VALUES (?, ?, 'payout_released', 'available', ?, ?, 'payout', ?, 'Rejected payout returned', ?)`,
        [randomUUID(), payout.wallet_id, Number(payout.amount), balance, payout.id, req.user.id]
      );
    }
    await connection.execute(
      'UPDATE payout_requests SET status = ?, payment_reference = ?, processed_at = UTC_TIMESTAMP(), processed_by = ? WHERE id = ?',
      [status, paymentReference, req.user.id, payout.id]
    );
    return { status, balance };
  });
  await audit(req.user.id, 'process_payout', 'payout', req.params.id, { status, paymentReference });
  res.json({ success: true, ...result });
});
