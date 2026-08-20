import { randomBytes } from 'node:crypto';

export class ApiError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function text(value, field, { required = true, max = 255 } = {}) {
  const result = String(value ?? '').trim();
  if (required && !result) throw new ApiError(400, 'VALIDATION_ERROR', `${field} is required.`);
  if (result.length > max) throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be ${max} characters or fewer.`);
  return result;
}

export function email(value) {
  const result = text(value, 'Email', { max: 190 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new ApiError(400, 'VALIDATION_ERROR', 'Enter a valid email address.');
  return result;
}

export function wholeNumber(value, field, { min = 0, max = 1_000_000 } = {}) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < min || result > max) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a whole number between ${min} and ${max}.`);
  }
  return result;
}

export function money(value, field, { min = 0, max = 100_000_000 } = {}) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < min || result > max) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a valid amount.`);
  }
  return Math.round(result * 100) / 100;
}

export function limit(value, fallback = 100, max = 250) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(',');
}

export function orderNumber() {
  const date = new Date().toISOString().slice(2, 10).replaceAll('-', '');
  return `SF-${date}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

export function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    companyName: row.company_name,
    status: row.status,
    createdAt: row.created_at
  };
}
