import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { orderForRole, orderScope } from '../access.js';
import { audit, query, transaction } from '../db.js';
import { requireRoles } from '../middleware.js';
import { ApiError, limit, text } from '../utils.js';

export const shipmentsRouter = Router();

function optionalHttps(value, field) {
  const input = text(value, field, { required: false, max: 500 });
  if (!input) return null;
  try {
    const parsed = new URL(input);
    if (parsed.protocol !== 'https:') throw new Error('https required');
    return parsed.toString();
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a valid HTTPS URL.`);
  }
}

const shipmentSelect = `
  SELECT s.*, o.order_no, o.supplier_user_id, o.dropshipper_user_id,
         o.customer_name, o.fulfillment_status
    FROM shipments s JOIN orders o ON o.id = s.order_id`;

shipmentsRouter.get('/', async (req, res) => {
  const scope = orderScope(req.user);
  const rows = await query(
    `${shipmentSelect} WHERE ${scope.sql} ORDER BY s.created_at DESC LIMIT ?`,
    [...scope.params, limit(req.query.limit)]
  );
  res.json({ shipments: rows.map(row => orderForRole(row, req.user.role)) });
});

shipmentsRouter.post('/', requireRoles('admin', 'supplier'), async (req, res) => {
  const orderId = text(req.body?.orderId, 'Order', { max: 36 });
  const courier = text(req.body?.courier, 'Courier', { max: 100 });
  const service = text(req.body?.service, 'Service', { required: false, max: 100 }) || null;
  const trackingNo = text(req.body?.trackingNo, 'Tracking number', { max: 160 });
  const labelUrl = optionalHttps(req.body?.labelUrl, 'Label URL');
  const scope = orderScope(req.user);
  const id = randomUUID();
  await transaction(async connection => {
    const [orders] = await connection.execute(
      `SELECT o.* FROM orders o WHERE o.id = ? AND ${scope.sql} LIMIT 1 FOR UPDATE`,
      [orderId, ...scope.params]
    );
    const order = orders[0];
    if (!order) throw new ApiError(404, 'NOT_FOUND', 'Accessible order was not found.');
    if (!['to_ship', 'shipped', 'delivered'].includes(order.fulfillment_status)) {
      throw new ApiError(409, 'PACKING_REQUIRED', 'Complete PackProof before booking a shipment.');
    }
    const status = order.fulfillment_status === 'delivered' ? 'delivered' : order.fulfillment_status === 'shipped' ? 'shipped' : 'booked';
    const [existing] = await connection.execute('SELECT id FROM shipments WHERE order_id = ? FOR UPDATE', [order.id]);
    if (existing[0]) {
      await connection.execute(
        'UPDATE shipments SET courier = ?, service = ?, tracking_no = ?, label_url = ?, status = ? WHERE id = ?',
        [courier, service, trackingNo, labelUrl, status, existing[0].id]
      );
    } else {
      await connection.execute(
        `INSERT INTO shipments
         (id, order_id, courier, service, tracking_no, label_url, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, order.id, courier, service, trackingNo, labelUrl, status, req.user.id]
      );
    }
    await connection.execute('UPDATE orders SET tracking_no = ? WHERE id = ?', [trackingNo, order.id]);
  });
  await audit(req.user.id, 'book_shipment', 'order', orderId, { courier, trackingNo });
  const [created] = await query(`${shipmentSelect} WHERE s.order_id = ? LIMIT 1`, [orderId]);
  res.status(201).json({ shipment: orderForRole(created, req.user.role) });
});
