import test from 'node:test';
import assert from 'node:assert/strict';
import { orderForRole, orderItemForRole, productForRole } from '../src/access.js';

test('dropshipper product output hides supplier identity, supplier price and raw stock internals', () => {
  const product = productForRole({
    id: 'product-1', supplier_user_id: 'supplier-1', supplier_name: 'Secret Supplier',
    supplier_price: '20.00', proposed_supplier_price: '22.00', platform_price: '25.00',
    srp: '35.00', stock: 50, reserved: 7, created_by: 'supplier-1'
  }, 'dropshipper');
  assert.equal(product.available, 43);
  for (const key of ['supplier_user_id', 'supplier_name', 'supplier_price', 'proposed_supplier_price', 'created_by', 'stock', 'reserved']) {
    assert.equal(key in product, false, `${key} should be hidden`);
  }
  assert.equal(product.platform_price, '25.00');
  assert.equal(product.srp, '35.00');
});

test('supplier order output hides dropshipper identity and commercial values', () => {
  const order = orderForRole({
    id: 'order-1', dropshipper_user_id: 'drop-1', dropshipper_name: 'Secret Seller',
    supplier_user_id: 'supplier-1', amount: '150.00', created_by: 'drop-1', customer_name: 'Customer'
  }, 'supplier');
  for (const key of ['dropshipper_user_id', 'dropshipper_name', 'amount', 'created_by']) {
    assert.equal(key in order, false, `${key} should be hidden`);
  }
  assert.equal(order.customer_name, 'Customer');
  assert.equal('unit_price' in orderItemForRole({ unit_price: '25.00', quantity: 2 }, 'supplier'), false);
});

test('supplier product output hides platform markup and recommended retail price', () => {
  const product = productForRole({
    id: 'product-1', supplier_user_id: 'supplier-1', supplier_price: '20.00',
    platform_price: '25.00', srp: '35.00', stock: 50, reserved: 7
  }, 'supplier');
  assert.equal(product.supplier_price, '20.00');
  assert.equal(product.available, 43);
  assert.equal('platform_price' in product, false);
  assert.equal('srp' in product, false);
});

test('dropshipper order output hides supplier identity', () => {
  const order = orderForRole({ supplier_user_id: 'supplier-1', supplier_name: 'Secret Supplier', amount: '80.00' }, 'dropshipper');
  assert.equal('supplier_user_id' in order, false);
  assert.equal('supplier_name' in order, false);
  assert.equal(order.amount, '80.00');
});
