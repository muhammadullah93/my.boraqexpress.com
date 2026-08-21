import test from 'node:test';
import assert from 'node:assert/strict';
import { clearLoginRateLimit, loginRateLimit, requestContext, requireCsrf, securityHeaders } from '../src/middleware.js';

function responseStub() {
  const headers = {};
  return {
    headers,
    set(name, value) {
      if (typeof name === 'object') Object.assign(headers, name);
      else headers[name] = value;
      return this;
    }
  };
}

test('request context adds correlation and no-store headers to API responses', () => {
  const req = { path: '/api/orders' };
  const res = responseStub();
  let called = false;
  requestContext(req, res, () => { called = true; });
  assert.equal(called, true);
  assert.match(req.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(res.headers['X-Request-ID'], req.requestId);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('security headers prevent embedding and cross-origin resource reuse', () => {
  const res = responseStub();
  securityHeaders({}, res, () => {});
  assert.equal(res.headers['X-Frame-Options'], 'DENY');
  assert.equal(res.headers['Cross-Origin-Opener-Policy'], 'same-origin');
  assert.equal(res.headers['Cross-Origin-Resource-Policy'], 'same-origin');
});

test('CSRF middleware accepts a matching double-submit token and rejects mismatches', () => {
  const accepted = [];
  requireCsrf({ cookies: { sellflow_csrf: 'token' }, get: () => 'token' }, {}, error => accepted.push(error));
  assert.equal(accepted[0], undefined);
  const rejected = [];
  requireCsrf({ cookies: { sellflow_csrf: 'token' }, get: () => 'other' }, {}, error => rejected.push(error));
  assert.equal(rejected[0].code, 'CSRF_INVALID');
});

test('login limiter blocks repeated attempts and can be cleared after success', () => {
  const req = { ip: '203.0.113.10', socket: {} };
  let lastError;
  for (let index = 0; index < 11; index += 1) {
    loginRateLimit(req, {}, error => { lastError = error; });
  }
  assert.equal(lastError.code, 'RATE_LIMITED');
  assert.ok(lastError.details.retryAfterSeconds > 0);
  clearLoginRateLimit(req);
  lastError = 'not-called';
  loginRateLimit(req, {}, error => { lastError = error; });
  assert.equal(lastError, undefined);
  clearLoginRateLimit(req);
});
