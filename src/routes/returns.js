import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { orderForRole, orderScope } from '../access.js';
import { audit, query, transaction } from '../db.js';
import { requireRoles } from '../middleware.js';
import { ApiError, limit, money, returnNumber, text, wholeNumber } from '../utils.js';

export const returnsRouter = Router();

returnsRouter.get('/', async (req, res) => {
  const scope = orderScope(req.user);
  const rows = await query(
    `SELECT r.*, o.order_no, o.customer_name, o.supplier_user_id, o.dropshipper_user_id
       FROM \`returns\` r JOIN orders o ON o.id = r.order_id
      WHERE ${scope.sql} ORDER BY r.requested_at DESC LIMIT ?`,
    [...scope.params, limit(req.query.limit)]
  );
  if (!rows.length) return res.json({ returns: [] });
  const ids = rows.map(row => row.id);
  const placeholders = ids.map(() => '?').join(',');
  const items = await query(
    `SELECT ri.*, oi.product_name, oi.sku
       FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id
      WHERE ri.return_id IN (${placeholders})`,
    ids
  );
  res.json({ returns: rows.map(row => ({ ...orderForRole(row, req.user.role), items: items.filter(item => item.return_id === row.id) })) });
});

returnsRouter.post('/', requireRoles('admin', 'dropshipper'), async (req, res) => {
  const orderId = text(req.body?.orderId, 'Order', { max: 36 });
  const reason = text(req.body?.reason, 'Reason', { max: 500 });
  const notes = text(req.body?.notes, 'Notes', { required: false, max: 2000 }) || null;
  const scope = orderScope(req.user);
  const id = randomUUID();
  const number = returnNumber();
  await transaction(async connection => {
    const [orders] = await connection.execute(
      `SELECT o.* FROM orders o WHERE o.id = ? AND ${scope.sql} LIMIT 1 FOR UPDATE`,
      [orderId, ...scope.params]
    );
    const order = orders[0];
    if (!order) throw new ApiError(404, 'NOT_FOUND', 'Accessible order was not found.');
    if (!['delivered', 'complete'].includes(order.fulfillment_status)) {
      throw new ApiError(409, 'RETURN_NOT_ALLOWED', 'Only delivered or completed orders can be returned.');
    }
    const [orderItems] = await connection.execute('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
    const requested = Array.isArray(req.body?.items) && req.body.items.length
      ? req.body.items
      : orderItems.map(item => ({ orderItemId: item.id, quantity: item.quantity }));
    const byId = new Map(orderItems.map(item => [item.id, item]));
    const seen = new Set();
    const normalized = requested.map(item => {
      const orderItemId = text(item.orderItemId, 'Order item', { max: 36 });
      if (seen.has(orderItemId)) throw new ApiError(400, 'DUPLICATE_RETURN_ITEM', 'Each order item can appear only once in a return.');
      seen.add(orderItemId);
      const source = byId.get(orderItemId);
      if (!source) throw new ApiError(400, 'INVALID_RETURN_ITEM', 'A return item is not part of this order.');
      return { source, quantity: wholeNumber(item.quantity, 'Return quantity', { min: 1, max: Number(source.quantity) }) };
    });
    await connection.execute(
      `INSERT INTO \`returns\` (id, return_no, order_id, requested_by, reason, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, number, order.id, req.user.id, reason, notes]
    );
    for (const item of normalized) {
      await connection.execute(
        'INSERT INTO return_items (id, return_id, order_item_id, quantity) VALUES (?, ?, ?, ?)',
        [randomUUID(), id, item.source.id, item.quantity]
      );
    }
  });
  await audit(req.user.id, 'request_return', 'return', id, { orderId, returnNo: number });
  res.status(201).json({ id, returnNo: number });
});

returnsRouter.patch('/:id', requireRoles('admin'), async (req, res) => {
  const status = text(req.body?.status, 'Status', { max: 30 });
  const allowed = ['approved', 'rejected', 'received', 'restocked', 'refunded', 'closed'];
  if (!allowed.includes(status)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid return status.');
  const resolution = text(req.body?.resolution || 'pending', 'Resolution', { max: 30 });
  if (!['pending', 'refund', 'replacement', 'credit', 'no_action'].includes(resolution)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid return resolution.');
  }
  const refundAmount = money(req.body?.refundAmount ?? 0, 'Refund amount');
  const output = await transaction(async connection => {
    const [rows] = await connection.execute(
      `SELECT r.*, o.amount,
              (SELECT COALESCE(SUM(ri.quantity * oi.unit_price), 0)
                 FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id
                WHERE ri.return_id = r.id) AS return_value
         FROM \`returns\` r JOIN orders o ON o.id = r.order_id WHERE r.id = ? FOR UPDATE`,
      [req.params.id]
    );
    const record = rows[0];
    if (!record) throw new ApiError(404, 'NOT_FOUND', 'Return was not found.');
    const transitions = {
      requested: ['approved', 'rejected'],
      approved: ['received', 'refunded', 'rejected'],
      received: ['restocked', 'refunded', 'closed'],
      restocked: ['refunded', 'closed'],
      refunded: ['closed'],
      rejected: [],
      closed: []
    };
    if (!(transitions[record.status] || []).includes(status)) {
      throw new ApiError(409, 'INVALID_TRANSITION', `Return cannot move from ${record.status} to ${status}.`);
    }
    if (refundAmount > Number(record.return_value)) throw new ApiError(400, 'INVALID_REFUND', 'Refund cannot exceed the selected return item value.');
    if (status === 'refunded' && refundAmount <= 0) throw new ApiError(400, 'INVALID_REFUND', 'A refunded return requires a positive refund amount.');
    if (status !== 'refunded' && refundAmount !== 0) throw new ApiError(400, 'INVALID_REFUND', 'Refund amount can only be recorded when the return becomes refunded.');
    if (status === 'restocked') {
      const [items] = await connection.execute(
        `SELECT ri.*, oi.product_id, oi.sku
           FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id
          WHERE ri.return_id = ? FOR UPDATE`,
        [record.id]
      );
      for (const item of items.filter(value => !value.restocked && value.product_id)) {
        const [products] = await connection.execute('SELECT stock FROM products WHERE id = ? FOR UPDATE', [item.product_id]);
        if (!products[0]) continue;
        const balance = Number(products[0].stock) + Number(item.quantity);
        await connection.execute('UPDATE products SET stock = ? WHERE id = ?', [balance, item.product_id]);
        await connection.execute(
          `INSERT INTO inventory_movements
           (id, product_id, delta, reason, reference_type, reference_id, balance_after, created_by)
           VALUES (?, ?, ?, 'return_restock', 'return', ?, ?, ?)`,
          [randomUUID(), item.product_id, Number(item.quantity), record.id, balance, req.user.id]
        );
        await connection.execute('UPDATE return_items SET restocked = 1 WHERE id = ?', [item.id]);
      }
    }
    await connection.execute(
      `UPDATE \`returns\` SET status = ?, resolution = ?, refund_amount = ?, reviewed_by = ?,
       resolved_at = CASE WHEN ? = 1 THEN UTC_TIMESTAMP() ELSE resolved_at END
       WHERE id = ?`,
      [status, resolution, refundAmount, req.user.id,
        ['rejected', 'restocked', 'refunded', 'closed'].includes(status) ? 1 : 0,
        record.id]
    );
    return { from: record.status, to: status, refundAmount };
  });
  await audit(req.user.id, 'update_return', 'return', req.params.id, output);
  res.json({ success: true, ...output });
});
