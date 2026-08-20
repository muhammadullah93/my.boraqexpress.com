import { Router } from 'express';
import { orderForRole, orderScope, productScope } from '../access.js';
import { query } from '../db.js';

export const dashboardRouter = Router();

dashboardRouter.get('/', async (req, res) => {
  const orders = orderScope(req.user);
  const products = productScope(req.user);
  const [orderTotals, statusRows, productTotals, recentOrders, userTotals] = await Promise.all([
    query(
      `SELECT COUNT(*) AS total_orders,
              SUM(CASE WHEN o.fulfillment_status IN ('new','pending_payment','packing','to_ship') THEN 1 ELSE 0 END) AS open_orders,
              SUM(CASE WHEN o.fulfillment_status = 'to_ship' THEN 1 ELSE 0 END) AS to_ship,
              SUM(CASE WHEN o.fulfillment_status NOT IN ('cancelled') THEN o.amount ELSE 0 END) AS revenue
         FROM orders o WHERE ${orders.sql}`,
      orders.params
    ),
    query(
      `SELECT o.fulfillment_status AS status, COUNT(*) AS total
         FROM orders o WHERE ${orders.sql}
        GROUP BY o.fulfillment_status ORDER BY total DESC`,
      orders.params
    ),
    query(
      `SELECT COUNT(*) AS total_products,
              SUM(CASE WHEN (p.stock - p.reserved) <= 10 THEN 1 ELSE 0 END) AS low_stock,
              SUM(p.stock) AS total_units,
              SUM(p.reserved) AS reserved_units
         FROM products p WHERE ${products.sql}`,
      products.params
    ),
    query(
      `SELECT o.*, s.name AS supplier_name, d.name AS dropshipper_name
         FROM orders o
         LEFT JOIN users s ON s.id = o.supplier_user_id
         LEFT JOIN users d ON d.id = o.dropshipper_user_id
        WHERE ${orders.sql} ORDER BY o.created_at DESC LIMIT 8`,
      orders.params
    ),
    req.user.role === 'admin'
      ? query("SELECT role, COUNT(*) AS total FROM users WHERE status = 'active' GROUP BY role")
      : Promise.resolve([])
  ]);

  const orderStats = orderTotals[0] || {};
  const productStats = productTotals[0] || {};
  res.json({
    kpis: {
      totalOrders: Number(orderStats.total_orders || 0),
      openOrders: Number(orderStats.open_orders || 0),
      toShip: Number(orderStats.to_ship || 0),
      revenue: req.user.role === 'supplier' ? null : Number(orderStats.revenue || 0),
      revenueVisible: req.user.role !== 'supplier',
      totalProducts: Number(productStats.total_products || 0),
      lowStock: Number(productStats.low_stock || 0),
      totalUnits: req.user.role === 'dropshipper' ? null : Number(productStats.total_units || 0),
      reservedUnits: req.user.role === 'dropshipper' ? null : Number(productStats.reserved_units || 0)
    },
    statuses: statusRows.map(row => ({ status: row.status, total: Number(row.total) })),
    users: userTotals.map(row => ({ role: row.role, total: Number(row.total) })),
    recentOrders: recentOrders.map(row => orderForRole(row, req.user.role))
  });
});
