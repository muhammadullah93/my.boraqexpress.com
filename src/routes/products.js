import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { productForRole, productScope } from '../access.js';
import { audit, query, transaction } from '../db.js';
import { requireRoles } from '../middleware.js';
import { ApiError, limit, money, text, wholeNumber } from '../utils.js';

export const productsRouter = Router();

async function supplierIdFor(req) {
  if (req.user.role === 'supplier') return req.user.id;
  const requested = text(req.body?.supplierUserId, 'Supplier', { required: false, max: 36 }) || null;
  if (!requested) return null;
  const rows = await query("SELECT id FROM users WHERE id = ? AND role = 'supplier' AND status = 'active'", [requested]);
  if (!rows[0]) throw new ApiError(400, 'INVALID_SUPPLIER', 'Choose an active supplier account.');
  return requested;
}

productsRouter.get('/', async (req, res) => {
  const scope = productScope(req.user);
  const search = text(req.query.search, 'Search', { required: false, max: 100 });
  const status = text(req.query.status, 'Status', { required: false, max: 30 });
  const params = [...scope.params];
  let filters = scope.sql;
  if (search) {
    filters += ' AND (p.name LIKE ? OR p.sku LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (status && req.user.role !== 'dropshipper') {
    filters += ' AND p.status = ?';
    params.push(status);
  }
  params.push(limit(req.query.limit));
  const rows = await query(
    `SELECT p.*, u.name AS supplier_name
       FROM products p LEFT JOIN users u ON u.id = p.supplier_user_id
      WHERE ${filters}
      ORDER BY p.updated_at DESC LIMIT ?`,
    params
  );
  res.json({ products: rows.map(row => productForRole(row, req.user.role)) });
});

productsRouter.post('/', requireRoles('admin', 'supplier'), async (req, res) => {
  const supplierUserId = await supplierIdFor(req);
  const supplierPrice = money(req.body?.supplierPrice, 'Supplier price');
  const platformPrice = Math.round((req.user.role === 'admin' && req.body?.platformPrice != null
    ? money(req.body.platformPrice, 'Platform price')
    : supplierPrice * 1.05) * 100) / 100;
  const requestedSrp = req.body?.srp == null ? platformPrice * 1.3 : money(req.body.srp, 'SRP');
  const srp = Math.round(Math.max(requestedSrp, platformPrice * 1.3) * 100) / 100;
  const stock = wholeNumber(req.body?.stock ?? 0, 'Stock');
  const id = randomUUID();
  const status = req.user.role === 'supplier' ? 'pending_review' : text(req.body?.status || 'draft', 'Status', { max: 30 });
  if (!['draft', 'active', 'paused', 'pending_review'].includes(status)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid product status.');

  await transaction(async connection => {
    await connection.execute(
      `INSERT INTO products
       (id, supplier_user_id, sku, name, description, supplier_price, platform_price, srp, stock, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        supplierUserId,
        text(req.body?.sku, 'SKU', { max: 80 }).toUpperCase(),
        text(req.body?.name, 'Product name', { max: 190 }),
        text(req.body?.description, 'Description', { required: false, max: 5000 }) || null,
        supplierPrice,
        platformPrice,
        srp,
        stock,
        status,
        req.user.id
      ]
    );
    if (stock > 0) {
      await connection.execute(
        `INSERT INTO inventory_movements
         (id, product_id, delta, reason, reference_type, reference_id, balance_after, created_by)
         VALUES (?, ?, ?, 'initial_stock', 'product', ?, ?, ?)`,
        [randomUUID(), id, stock, id, stock, req.user.id]
      );
    }
  });
  await audit(req.user.id, 'create_product', 'product', id, { status, stock });
  const [created] = await query('SELECT p.*, u.name AS supplier_name FROM products p LEFT JOIN users u ON u.id = p.supplier_user_id WHERE p.id = ?', [id]);
  res.status(201).json({ product: productForRole(created, req.user.role) });
});

productsRouter.patch('/:id', requireRoles('admin', 'supplier'), async (req, res) => {
  const [current] = await query('SELECT * FROM products WHERE id = ?', [req.params.id]);
  if (!current) throw new ApiError(404, 'NOT_FOUND', 'Product was not found.');
  if (req.user.role === 'supplier' && current.supplier_user_id !== req.user.id) throw new ApiError(403, 'FORBIDDEN', 'You can update only your own products.');

  const name = req.body?.name == null ? current.name : text(req.body.name, 'Product name', { max: 190 });
  const description = req.body?.description == null ? current.description : text(req.body.description, 'Description', { required: false, max: 5000 }) || null;
  let supplierPrice = Number(current.supplier_price);
  let proposedPrice = current.proposed_supplier_price;
  let status = current.status;

  if (req.body?.supplierPrice != null) {
    const requested = money(req.body.supplierPrice, 'Supplier price');
    if (req.user.role === 'supplier' && requested > supplierPrice) {
      proposedPrice = requested;
      status = 'price_review';
    } else {
      supplierPrice = requested;
      proposedPrice = null;
    }
  }

  let platformPrice = Number(current.platform_price);
  if (req.user.role === 'admin' && req.body?.platformPrice != null) platformPrice = money(req.body.platformPrice, 'Platform price');
  else if (supplierPrice !== Number(current.supplier_price)) platformPrice = Math.round(supplierPrice * 1.05 * 100) / 100;
  let srp = req.body?.srp == null ? Number(current.srp) : money(req.body.srp, 'SRP');
  srp = Math.round(Math.max(srp, platformPrice * 1.3) * 100) / 100;

  if (req.user.role === 'admin' && req.body?.status != null) {
    status = text(req.body.status, 'Status', { max: 30 });
    if (!['draft', 'active', 'paused', 'pending_review', 'price_review'].includes(status)) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid product status.');
  }

  await query(
    `UPDATE products SET name = ?, description = ?, supplier_price = ?, proposed_supplier_price = ?,
     platform_price = ?, srp = ?, status = ? WHERE id = ?`,
    [name, description, supplierPrice, proposedPrice, platformPrice, srp, status, current.id]
  );
  await audit(req.user.id, 'update_product', 'product', current.id, { status, priceReview: Boolean(proposedPrice) });
  const [updated] = await query('SELECT p.*, u.name AS supplier_name FROM products p LEFT JOIN users u ON u.id = p.supplier_user_id WHERE p.id = ?', [current.id]);
  res.json({ product: productForRole(updated, req.user.role) });
});

productsRouter.post('/:id/approve-price', requireRoles('admin'), async (req, res) => {
  const [current] = await query('SELECT * FROM products WHERE id = ?', [req.params.id]);
  if (!current) throw new ApiError(404, 'NOT_FOUND', 'Product was not found.');
  if (current.proposed_supplier_price == null) throw new ApiError(409, 'NO_PRICE_REVIEW', 'No supplier price increase is waiting for approval.');
  const supplierPrice = Number(current.proposed_supplier_price);
  const platformPrice = Math.round(supplierPrice * 1.05 * 100) / 100;
  const srp = Math.round(Math.max(Number(current.srp), platformPrice * 1.3) * 100) / 100;
  await query(
    "UPDATE products SET supplier_price = ?, proposed_supplier_price = NULL, platform_price = ?, srp = ?, status = 'active' WHERE id = ?",
    [supplierPrice, platformPrice, srp, current.id]
  );
  await audit(req.user.id, 'approve_price_increase', 'product', current.id, { supplierPrice, platformPrice });
  res.json({ success: true });
});
