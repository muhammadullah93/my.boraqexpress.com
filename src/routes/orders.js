import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { orderForRole, orderItemForRole, orderScope } from '../access.js';
import { audit, query, transaction } from '../db.js';
import { requireRoles } from '../middleware.js';
import { ensureSupplierPending, settleSupplierPayable } from '../services/finance.js';
import { ApiError, limit, orderNumber, placeholders, text, wholeNumber } from '../utils.js';

export const ordersRouter = Router();

async function attachItems(orders, role) {
  if (!orders.length) return [];
  const ids = orders.map(order => order.id);
  const items = await query(`SELECT * FROM order_items WHERE order_id IN (${placeholders(ids.length)}) ORDER BY created_at`, ids);
  const byOrder = new Map();
  for (const item of items) {
    const group = byOrder.get(item.order_id) || [];
    group.push(orderItemForRole(item, role));
    byOrder.set(item.order_id, group);
  }
  return orders.map(order => ({ ...orderForRole(order, role), items: byOrder.get(order.id) || [] }));
}

ordersRouter.get('/', async (req, res) => {
  const scope = orderScope(req.user);
  const status = text(req.query.status, 'Status', { required: false, max: 30 });
  const search = text(req.query.search, 'Search', { required: false, max: 100 });
  let where = scope.sql;
  const params = [...scope.params];
  if (status) { where += ' AND o.fulfillment_status = ?'; params.push(status); }
  if (search) {
    where += ' AND (o.order_no LIKE ? OR o.tracking_no LIKE ? OR o.customer_name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  params.push(limit(req.query.limit));
  const rows = await query(
    `SELECT o.*, s.name AS supplier_name, d.name AS dropshipper_name
       FROM orders o
       LEFT JOIN users s ON s.id = o.supplier_user_id
       LEFT JOIN users d ON d.id = o.dropshipper_user_id
      WHERE ${where}
      ORDER BY o.created_at DESC LIMIT ?`,
    params
  );
  res.json({ orders: await attachItems(rows, req.user.role) });
});

ordersRouter.post('/', requireRoles('admin', 'dropshipper'), async (req, res) => {
  if (!Array.isArray(req.body?.items) || req.body.items.length < 1 || req.body.items.length > 50) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Order must contain between 1 and 50 items.');
  }
  const itemTotals = new Map();
  for (const item of req.body.items) {
    const productId = text(item.productId, 'Product', { max: 36 });
    const quantity = wholeNumber(item.quantity, 'Quantity', { min: 1, max: 10_000 });
    const combined = (itemTotals.get(productId) || 0) + quantity;
    if (combined > 10_000) throw new ApiError(400, 'VALIDATION_ERROR', 'Combined product quantity cannot exceed 10,000.');
    itemTotals.set(productId, combined);
  }
  const requestedItems = [...itemTotals].map(([productId, quantity]) => ({ productId, quantity }));
  const uniqueIds = [...new Set(requestedItems.map(item => item.productId))];
  const id = randomUUID();
  const number = orderNumber();

  const created = await transaction(async connection => {
    const [products] = await connection.execute(
      `SELECT * FROM products WHERE id IN (${placeholders(uniqueIds.length)}) FOR UPDATE`,
      uniqueIds
    );
    const byId = new Map(products.map(product => [product.id, product]));
    const suppliers = new Set();
    let amount = 0;
    const items = requestedItems.map(item => {
      const product = byId.get(item.productId);
      if (!product || product.status !== 'active') throw new ApiError(409, 'PRODUCT_UNAVAILABLE', 'One or more products are not available.');
      const available = Number(product.stock) - Number(product.reserved);
      if (available < item.quantity) throw new ApiError(409, 'INSUFFICIENT_STOCK', `${product.sku} has only ${available} available.`);
      suppliers.add(product.supplier_user_id || '__platform__');
      const unitPrice = Number(product.platform_price);
      amount += unitPrice * item.quantity;
      return { ...item, product, unitPrice, supplierUnitPrice: Number(product.supplier_price) };
    });
    if (suppliers.size > 1) throw new ApiError(409, 'MULTI_SUPPLIER_ORDER', 'The MVP creates one supplier fulfilment order at a time. Split these items by supplier.');
    const supplierOwner = suppliers.values().next().value;
    const supplierUserId = supplierOwner === '__platform__' ? null : supplierOwner;
    const dropshipperUserId = req.user.role === 'dropshipper'
      ? req.user.id
      : text(req.body?.dropshipperUserId, 'Dropshipper', { required: false, max: 36 }) || null;
    if (dropshipperUserId) {
      const [dropshippers] = await connection.execute(
        "SELECT id FROM users WHERE id = ? AND role = 'dropshipper' AND status = 'active' LIMIT 1",
        [dropshipperUserId]
      );
      if (!dropshippers[0]) throw new ApiError(400, 'INVALID_DROPSHIPPER', 'Choose an active dropshipper account.');
    }
    const customerName = text(req.body?.customerName, 'Customer name', { max: 160 });
    const customerPhone = text(req.body?.customerPhone, 'Customer phone', { required: false, max: 60 }) || null;
    const shippingAddress = text(req.body?.shippingAddress, 'Shipping address', { required: false, max: 2000 }) || null;
    const channel = text(req.body?.channel || 'manual', 'Channel', { max: 40 });
    const total = Math.round(amount * 100) / 100;

    await connection.execute(
      `INSERT INTO orders
       (id, order_no, channel, dropshipper_user_id, supplier_user_id, customer_name, customer_phone,
        shipping_address, amount, payment_status, fulfillment_status, warehouse, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'new', ?, ?)`,
      [id, number, channel, dropshipperUserId, supplierUserId, customerName, customerPhone, shippingAddress, total,
        text(req.body?.warehouse, 'Warehouse', { required: false, max: 120 }) || null, req.user.id]
    );
    for (const item of items) {
      await connection.execute(
        `INSERT INTO order_items (id, order_id, product_id, product_name, sku, quantity, unit_price, supplier_unit_price)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), id, item.product.id, item.product.name, item.product.sku, item.quantity, item.unitPrice, item.supplierUnitPrice]
      );
      await connection.execute('UPDATE products SET reserved = reserved + ? WHERE id = ?', [item.quantity, item.product.id]);
    }
    return { id, number, amount: total, supplierUserId, dropshipperUserId };
  });
  await audit(req.user.id, 'create_order', 'order', id, created);
  const [row] = await query('SELECT * FROM orders WHERE id = ?', [id]);
  res.status(201).json({ order: (await attachItems([row], req.user.role))[0] });
});

const transitions = {
  new: ['pending_payment', 'packing', 'cancelled'],
  pending_payment: ['packing', 'cancelled'],
  packing: ['cancelled'],
  to_ship: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: ['complete'],
  complete: [],
  cancelled: []
};

ordersRouter.patch('/:id/status', async (req, res) => {
  const nextStatus = text(req.body?.status, 'Status', { max: 30 });
  const result = await transaction(async connection => {
    const [rows] = await connection.execute('SELECT * FROM orders WHERE id = ? FOR UPDATE', [req.params.id]);
    const order = rows[0];
    if (!order) throw new ApiError(404, 'NOT_FOUND', 'Order was not found.');
    if (req.user.role === 'supplier' && order.supplier_user_id !== req.user.id) throw new ApiError(403, 'FORBIDDEN', 'This order is not assigned to you.');
    if (req.user.role === 'dropshipper' && order.dropshipper_user_id !== req.user.id) throw new ApiError(403, 'FORBIDDEN', 'This is not your order.');
    if (!(transitions[order.fulfillment_status] || []).includes(nextStatus)) {
      throw new ApiError(409, 'INVALID_TRANSITION', `Order cannot move from ${order.fulfillment_status} to ${nextStatus}.`);
    }
    if (req.user.role === 'supplier' && !['packing', 'shipped', 'delivered'].includes(nextStatus)) {
      throw new ApiError(403, 'FORBIDDEN', 'Supplier cannot apply that status.');
    }
    if (req.user.role === 'dropshipper' && !['cancelled', 'complete'].includes(nextStatus)) {
      throw new ApiError(403, 'FORBIDDEN', 'Dropshipper cannot apply that status.');
    }
    const [items] = await connection.execute('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
    if (nextStatus === 'cancelled') {
      for (const item of items) {
        await connection.execute('UPDATE products SET reserved = GREATEST(0, reserved - ?) WHERE id = ?', [item.quantity, item.product_id]);
      }
    }
    if (nextStatus === 'shipped') {
      for (const item of items) {
        const [productRows] = await connection.execute('SELECT stock, reserved FROM products WHERE id = ? FOR UPDATE', [item.product_id]);
        const product = productRows[0];
        if (!product || Number(product.stock) < Number(item.quantity)) throw new ApiError(409, 'INSUFFICIENT_STOCK', `${item.sku} cannot be shipped due to insufficient stock.`);
        const balance = Number(product.stock) - Number(item.quantity);
        await connection.execute('UPDATE products SET stock = ?, reserved = GREATEST(0, reserved - ?) WHERE id = ?', [balance, item.quantity, item.product_id]);
        await connection.execute(
          `INSERT INTO inventory_movements
           (id, product_id, delta, reason, reference_type, reference_id, balance_after, created_by)
           VALUES (?, ?, ?, 'order_shipped', 'order', ?, ?, ?)`,
          [randomUUID(), item.product_id, -Number(item.quantity), order.id, balance, req.user.id]
        );
      }
    }
    const tracking = req.body?.trackingNo == null ? order.tracking_no : text(req.body.trackingNo, 'Tracking number', { required: false, max: 120 }) || null;
    let settlement = null;
    if (nextStatus === 'delivered') settlement = await ensureSupplierPending(connection, order.id, req.user.id);
    if (nextStatus === 'complete') settlement = await settleSupplierPayable(connection, order.id, req.user.id);
    await connection.execute('UPDATE orders SET fulfillment_status = ?, tracking_no = ? WHERE id = ?', [nextStatus, tracking, order.id]);
    if (['shipped', 'delivered'].includes(nextStatus)) {
      await connection.execute(
        `UPDATE shipments SET status = ?, shipped_at = COALESCE(shipped_at, UTC_TIMESTAMP()),
             delivered_at = CASE WHEN ? = 'delivered' THEN COALESCE(delivered_at, UTC_TIMESTAMP()) ELSE delivered_at END
         WHERE order_id = ?`,
        [nextStatus, nextStatus, order.id]
      );
    }
    return { from: order.fulfillment_status, to: nextStatus, trackingNo: tracking, settlement };
  });
  await audit(req.user.id, 'change_order_status', 'order', req.params.id, result);
  res.json({ success: true, ...result });
});
