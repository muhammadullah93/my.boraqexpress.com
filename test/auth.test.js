import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, parseCookies, safeTextEqual, signSession, verifyPassword, verifySession } from '../src/auth.js';

const secret = 'test-session-secret-that-is-longer-than-thirty-two-characters';

test('password hashing verifies the right password and rejects the wrong one', async () => {
  const hash = await hashPassword('A strong test password 123!');
  assert.match(hash, /^scrypt\$/);
  assert.equal(await verifyPassword('A strong test password 123!', hash), true);
  assert.equal(await verifyPassword('not the password', hash), false);
});

test('password hashing enforces the minimum length', async () => {
  await assert.rejects(() => hashPassword('short'), /at least 12 characters/);
});

test('signed sessions verify and reject tampering', () => {
  const token = signSession({ sub: 'user-123', role: 'admin', sv: 2 }, secret, 1);
  assert.equal(verifySession(token, secret).sub, 'user-123');
  const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
  assert.equal(verifySession(tampered, secret), null);
});

test('expired sessions are rejected', () => {
  const token = signSession({ sub: 'user-123', role: 'admin', sv: 1 }, secret, -1);
  assert.equal(verifySession(token, secret), null);
});

test('cookie parser and constant-time text equality handle expected values', () => {
  assert.deepEqual(parseCookies('one=hello%20world; two=value'), { one: 'hello world', two: 'value' });
  assert.equal(safeTextEqual('same-token', 'same-token'), true);
  assert.equal(safeTextEqual('same-token', 'different'), false);
});
