import test from 'node:test';
import assert from 'node:assert/strict';
import { parseContentRange, safeDriveName } from '../src/services/google-drive.js';

test('PackProof file names are safe for a Drive date folder', () => {
  assert.equal(safeDriveName(' ORD/123: proof?.webm '), 'ORD-123- proof-.webm');
  assert.equal(safeDriveName(''), 'packproof-video');
});

test('PackProof content range parsing validates chunk boundaries', () => {
  assert.deepEqual(parseContentRange('bytes 0-1048575/2097152'), {
    start: 0,
    end: 1048575,
    total: 2097152,
    length: 1048576
  });
  assert.throws(() => parseContentRange('0-10/20'), error => error.code === 'INVALID_CONTENT_RANGE');
  assert.throws(() => parseContentRange('bytes 10-20/20'), error => error.code === 'INVALID_CONTENT_RANGE');
});
