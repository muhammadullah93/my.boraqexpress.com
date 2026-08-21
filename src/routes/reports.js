import { Router } from 'express';
import { orderScope, productScope } from '../access.js';
import { query } from '../db.js';
import { requireRoles } from '../middleware.js';
import { limit } from '../utils.js';

export const reportsRouter = Router();

reportsRouter.get('/summary', async (req, res) => {
  const orders = orderScope(req.user);
  const products = productScope(req.user);
  const [orderRows, productRows, shipmentRows, returnRows] = await Promise.all([
    query(
      `SELECT COUNT(*) total_orders,
              SUM(CASE WHEN fulfillment_status = 'complete' THEN 1 ELSE 0 END) completed_orders,
              SUM(CASE WHEN fulfillment_status != 'cancelled' THEN amount ELSE 0 END) order_value
         FROM orders o WHERE ${orders.sql}`,
      orders.params
    ),
    query(
      `SELECT COUNT(*) total_products, SUM(stock) stock_units,
              SUM(CASE WHEN stock - reserved <= 10 THEN 1 ELSE 0 END) low_stock
         FROM products p WHERE ${products.sql}`,
      products.params
    ),
    query(`SELECT COUNT(*) total_shipments, SUM(status = 'delivered') delivered_shipments FROM shipments s JOIN orders o ON o.id = s.order_id WHERE ${orders.sql}`, orders.params),
    query(`SELECT COUNT(*) total_returns, SUM(r.status IN ('requested','approved','received')) open_returns FROM \`returns\` r JOIN orders o ON o.id = r.order_id WHERE ${orders.sql}`, orders.params)
  ]);
  res.json({
    orders: { ...orderRows[0], order_value: req.user.role === 'supplier' ? null : Number(orderRows[0]?.order_value || 0) },
    products: productRows[0] || {},
    shipments: shipmentRows[0] || {},
    returns: returnRows[0] || {}
  });
});

reportsRouter.get('/audit', requireRoles('admin'), async (req, res) => {
  const rows = await query(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.details_json, a.created_at,
            u.name AS user_name, u.email AS user_email
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.created_at DESC LIMIT ?`,
    [limit(req.query.limit, 100, 250)]
  );
  res.json({ logs: rows.map(row => ({ ...row, details_json: typeof row.details_json === 'string' ? JSON.parse(row.details_json) : row.details_json })) });
});
