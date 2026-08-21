import { randomUUID } from 'node:crypto';

async function walletFor(connection, userId) {
  if (!userId) return null;
  const [rows] = await connection.execute('SELECT * FROM wallet_accounts WHERE user_id = ? FOR UPDATE', [userId]);
  if (rows[0]) return rows[0];
  const id = randomUUID();
  await connection.execute(
    "INSERT INTO wallet_accounts (id, user_id, currency) VALUES (?, ?, 'MYR')",
    [id, userId]
  );
  const [created] = await connection.execute('SELECT * FROM wallet_accounts WHERE id = ? FOR UPDATE', [id]);
  return created[0];
}

async function supplierPayable(connection, orderId) {
  const [rows] = await connection.execute(
    `SELECT o.supplier_user_id,
            ROUND(SUM(oi.quantity * COALESCE(oi.supplier_unit_price, p.supplier_price)), 2) AS payable
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN products p ON p.id = oi.product_id
      WHERE o.id = ?
      GROUP BY o.supplier_user_id`,
    [orderId]
  );
  return rows[0] || null;
}

export async function ensureSupplierPending(connection, orderId, actorUserId) {
  const payable = await supplierPayable(connection, orderId);
  const amount = Number(payable?.payable || 0);
  if (!payable?.supplier_user_id || amount <= 0) return null;
  const wallet = await walletFor(connection, payable.supplier_user_id);
  const [existing] = await connection.execute(
    "SELECT id FROM wallet_transactions WHERE wallet_id = ? AND type = 'supplier_pending' AND reference_type = 'order' AND reference_id = ? LIMIT 1",
    [wallet.id, orderId]
  );
  if (existing[0]) return { walletId: wallet.id, amount, existing: true };
  const balance = Number(wallet.pending_balance) + amount;
  await connection.execute('UPDATE wallet_accounts SET pending_balance = ? WHERE id = ?', [balance, wallet.id]);
  await connection.execute(
    `INSERT INTO wallet_transactions
     (id, wallet_id, type, bucket, amount, balance_after, reference_type, reference_id, description, created_by)
     VALUES (?, ?, 'supplier_pending', 'pending', ?, ?, 'order', ?, 'Supplier payable after delivery', ?)`,
    [randomUUID(), wallet.id, amount, balance, orderId, actorUserId]
  );
  return { walletId: wallet.id, amount, existing: false };
}

export async function settleSupplierPayable(connection, orderId, actorUserId) {
  const pending = await ensureSupplierPending(connection, orderId, actorUserId);
  if (!pending) return null;
  const [settled] = await connection.execute(
    "SELECT id FROM wallet_transactions WHERE wallet_id = ? AND type = 'supplier_settled' AND reference_type = 'order' AND reference_id = ? LIMIT 1",
    [pending.walletId, orderId]
  );
  if (settled[0]) return { ...pending, existing: true };
  const [walletRows] = await connection.execute('SELECT * FROM wallet_accounts WHERE id = ? FOR UPDATE', [pending.walletId]);
  const wallet = walletRows[0];
  if (Number(wallet.pending_balance) < pending.amount) {
    throw new Error(`Supplier pending balance is inconsistent for order ${orderId}.`);
  }
  const pendingBalance = Number(wallet.pending_balance) - pending.amount;
  const availableBalance = Number(wallet.available_balance) + pending.amount;
  await connection.execute(
    'UPDATE wallet_accounts SET pending_balance = ?, available_balance = ? WHERE id = ?',
    [pendingBalance, availableBalance, wallet.id]
  );
  await connection.execute(
    `INSERT INTO wallet_transactions
     (id, wallet_id, type, bucket, amount, balance_after, reference_type, reference_id, description, created_by)
     VALUES (?, ?, 'supplier_settled', 'available', ?, ?, 'order', ?, 'Supplier payable released after completion', ?)`,
    [randomUUID(), wallet.id, pending.amount, availableBalance, orderId, actorUserId]
  );
  return { walletId: wallet.id, amount: pending.amount, existing: false };
}
