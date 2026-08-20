import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { productScope } from '../access.js';
import { audit, query, transaction } from '../db.js';
import { requireRoles } from '../middleware.js';
import { ApiError, limit, text } from '../utils.js';

export const inventoryRouter = Router();

inventoryRouter.get('/', async (req, res) => {
  const scope = productScope(req.user);
  const rows = await query(
    `SELECT m.*, p.sku, p.name AS product_name
       FROM inventory_movements m JOIN products p ON p.id = m.product_id
      WHERE ${scope.sql}
      ORDER BY m.created_at DESC LIMIT ?`,
    [...scope.params, limit(req.query.limit)]
  );
  res.json({ movements: rows });
});

inventoryRouter.post('/adjustments', requireRoles('admin', 'supplier'), async (req, res) => {
  const productId = text(req.body?.productId, 'Product', { max: 36 });
  const delta = Number(req.body?.delta);
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1_000_000) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Adjustment must be a non-zero whole number.');
  }
  const reason = text(req.body?.reason, 'Reason', { max: 80 });
  const movementId = randomUUID();
  const balance = await transaction(async connection => {
    const [rows] = await connection.execute('SELECT * FROM products WHERE id = ? FOR UPDATE', [productId]);
    const product = rows[0];
    if (!product) throw new ApiError(404, 'NOT_FOUND', 'Product was not found.');
    if (req.user.role === 'supplier' && product.supplier_user_id !== req.user.id) throw new ApiError(403, 'FORBIDDEN', 'You can adjust only your own inventory.');
    const next = Number(product.stock) + delta;
    if (next < Number(product.reserved)) throw new ApiError(409, 'STOCK_RESERVED', 'Stock cannot be reduced below the reserved quantity.');
    if (next < 0) throw new ApiError(409, 'NEGATIVE_STOCK', 'Stock cannot become negative.');
    await connection.execute('UPDATE products SET stock = ? WHERE id = ?', [next, productId]);
    await connection.execute(
      `INSERT INTO inventory_movements
       (id, product_id, delta, reason, reference_type, reference_id, balance_after, created_by)
       VALUES (?, ?, ?, ?, 'manual', NULL, ?, ?)`,
      [movementId, productId, delta, reason, next, req.user.id]
    );
    return next;
  });
  await audit(req.user.id, 'inventory_adjustment', 'product', productId, { delta, reason, balance });
  res.status(201).json({ movementId, balance });
});
