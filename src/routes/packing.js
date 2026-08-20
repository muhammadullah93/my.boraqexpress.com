import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { orderForRole, orderScope } from '../access.js';
import { audit, query, transaction } from '../db.js';
import { requireRoles } from '../middleware.js';
import { ApiError, limit, text } from '../utils.js';

export const packingRouter = Router();

function sessionForRole(row, role) {
  const order = orderForRole({
    id: row.order_id,
    order_no: row.order_no,
    channel: row.channel,
    dropshipper_user_id: row.dropshipper_user_id,
    supplier_user_id: row.supplier_user_id,
    customer_name: row.customer_name,
    customer_phone: row.customer_phone,
    shipping_address: row.shipping_address,
    fulfillment_status: row.fulfillment_status,
    tracking_no: row.tracking_no
  }, role);
  const result = {
    id: row.id,
    barcode: row.barcode,
    status: row.status,
    evidenceStatus: row.evidence_status,
    evidenceUrl: row.evidence_url,
    retentionUntil: row.retention_until,
    notes: row.notes,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    operatorName: row.operator_name,
    order
  };
  if (role === 'dropshipper') delete result.operatorName;
  return result;
}

function evidenceUrl(value) {
  const input = text(value, 'Evidence URL', { required: false, max: 500 });
  if (!input) return null;
  try {
    const parsed = new URL(input);
    if (parsed.protocol !== 'https:') throw new Error('not https');
    return parsed.toString();
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Evidence URL must be a valid HTTPS URL.');
  }
}

const sessionSelect = `
  SELECT ps.*, o.order_no, o.channel, o.dropshipper_user_id, o.supplier_user_id,
         o.customer_name, o.customer_phone, o.shipping_address, o.fulfillment_status,
         o.tracking_no, u.name AS operator_name
    FROM packing_sessions ps
    JOIN orders o ON o.id = ps.order_id
    LEFT JOIN users u ON u.id = ps.operator_user_id`;

packingRouter.get('/', async (req, res) => {
  const scope = orderScope(req.user);
  const rows = await query(
    `${sessionSelect} WHERE ${scope.sql} ORDER BY ps.started_at DESC LIMIT ?`,
    [...scope.params, limit(req.query.limit)]
  );
  res.json({ sessions: rows.map(row => sessionForRole(row, req.user.role)) });
});

packingRouter.post('/scan', requireRoles('admin', 'supplier'), async (req, res) => {
  const barcode = text(req.body?.barcode, 'Barcode or airway bill', { max: 160 });
  const scope = orderScope(req.user);
  const result = await transaction(async connection => {
    const [rows] = await connection.execute(
      `SELECT o.* FROM orders o
        WHERE ${scope.sql} AND (o.order_no = ? OR o.tracking_no = ?)
        LIMIT 1 FOR UPDATE`,
      [...scope.params, barcode, barcode]
    );
    const order = rows[0];
    if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', 'No accessible order matches that barcode, order number, or airway bill.');
    if (['to_ship', 'shipped', 'delivered', 'cancelled', 'complete'].includes(order.fulfillment_status)) {
      throw new ApiError(409, 'ORDER_NOT_PACKABLE', `An order in ${order.fulfillment_status} status cannot be packed.`);
    }
    const [existingRows] = await connection.execute(
      "SELECT id FROM packing_sessions WHERE order_id = ? AND status = 'packing' ORDER BY started_at DESC LIMIT 1",
      [order.id]
    );
    if (existingRows[0]) return { sessionId: existingRows[0].id, orderId: order.id, resumed: true };
    const sessionId = randomUUID();
    await connection.execute(
      `INSERT INTO packing_sessions (id, order_id, barcode, operator_user_id, status, evidence_status)
       VALUES (?, ?, ?, ?, 'packing', 'pending')`,
      [sessionId, order.id, barcode, req.user.id]
    );
    await connection.execute(
      "UPDATE orders SET fulfillment_status = 'packing' WHERE id = ? AND fulfillment_status IN ('new', 'pending_payment')",
      [order.id]
    );
    return { sessionId, orderId: order.id, resumed: false };
  });
  const sessionId = result.sessionId;
  if (!result.resumed) {
    await audit(req.user.id, 'start_packing', 'packing_session', sessionId, { orderId: result.orderId, barcode });
  }
  const [session] = await query(`${sessionSelect} WHERE ps.id = ? LIMIT 1`, [sessionId]);
  res.status(result.resumed ? 200 : 201).json({ session: sessionForRole(session, req.user.role), resumed: result.resumed });
});

packingRouter.post('/:id/complete', requireRoles('admin', 'supplier'), async (req, res) => {
  const url = evidenceUrl(req.body?.evidenceUrl);
  const notes = text(req.body?.notes, 'Notes', { required: false, max: 2000 }) || null;
  const result = await transaction(async connection => {
    const [rows] = await connection.execute(
      `SELECT ps.*, o.supplier_user_id, o.fulfillment_status
         FROM packing_sessions ps JOIN orders o ON o.id = ps.order_id
        WHERE ps.id = ? FOR UPDATE`,
      [req.params.id]
    );
    const session = rows[0];
    if (!session) throw new ApiError(404, 'NOT_FOUND', 'Packing session was not found.');
    if (req.user.role === 'supplier' && session.supplier_user_id !== req.user.id) {
      throw new ApiError(403, 'FORBIDDEN', 'This order is not assigned to you.');
    }
    if (session.status === 'packed') throw new ApiError(409, 'ALREADY_COMPLETED', 'This packing session is already complete.');
    const evidenceStatus = url ? 'captured' : 'metadata_only';
    await connection.execute(
      `UPDATE packing_sessions
          SET status = 'packed', evidence_status = ?, evidence_url = ?, notes = ?,
              retention_until = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 DAY), completed_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      [evidenceStatus, url, notes, session.id]
    );
    await connection.execute(
      "UPDATE orders SET fulfillment_status = 'to_ship' WHERE id = ? AND fulfillment_status IN ('new', 'pending_payment', 'packing')",
      [session.order_id]
    );
    return { orderId: session.order_id, evidenceStatus };
  });
  await audit(req.user.id, 'complete_packing', 'packing_session', req.params.id, result);
  const [session] = await query(`${sessionSelect} WHERE ps.id = ? LIMIT 1`, [req.params.id]);
  res.json({ session: sessionForRole(session, req.user.role) });
});
