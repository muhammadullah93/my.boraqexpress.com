import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('Password must contain at least 12 characters.');
  }
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [algorithm, saltText, hashText] = String(stored).split('$');
    if (algorithm !== 'scrypt' || !saltText || !hashText) return false;
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(hashText, 'base64url');
    const actual = Buffer.from(await scrypt(password, salt, expected.length));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function signature(body, secret) {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

export function signSession(payload, secret, ttlHours = 12) {
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ ...payload, iat: now, exp: now + ttlHours * 3600 })).toString('base64url');
  return `${body}.${signature(body, secret)}`;
}

export function verifySession(token, secret) {
  try {
    const [body, received] = String(token || '').split('.');
    if (!body || !received) return null;
    const expected = Buffer.from(signature(body, secret));
    const actual = Buffer.from(received);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.sub || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const index = part.indexOf('=');
    const key = index >= 0 ? part.slice(0, index) : part;
    const value = index >= 0 ? part.slice(index + 1) : '';
    try { return [decodeURIComponent(key), decodeURIComponent(value)]; } catch { return [key, value]; }
  }));
}

export function createCsrfToken() {
  return randomBytes(24).toString('base64url');
}

export function safeTextEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}
