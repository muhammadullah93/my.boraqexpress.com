import test from 'node:test';
import assert from 'node:assert/strict';
import { money, orderNumber, returnNumber, wholeNumber } from '../src/utils.js';

test('order and return references use distinct auditable prefixes', () => {
  assert.match(orderNumber(), /^SF-\d{6}-[A-F0-9]{6}$/);
  assert.match(returnNumber(), /^RT-\d{6}-[A-F0-9]{6}$/);
});

test('money and quantity validation reject invalid operational values', () => {
  assert.equal(money('12.345', 'Amount'), 12.35);
  assert.equal(wholeNumber('4', 'Quantity', { min: 1, max: 10 }), 4);
  assert.throws(() => money(-1, 'Amount'), /valid amount/);
  assert.throws(() => wholeNumber(0, 'Quantity', { min: 1, max: 10 }), /between 1 and 10/);
});
