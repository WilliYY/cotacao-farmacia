import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPortalFailure, createSupplierIncident, FAILURE_CODES } from '../src/lib/resilience.js';

const rejectedLogin = 'Supplier portal rejected the configured login credentials.';

for (const value of [rejectedLogin, new Error(rejectedLogin)]) {
  test(`catalogue recognizes rejected configured login from ${typeof value}`, () => {
    const failure = classifyPortalFailure(value);
    assert.equal(failure.failureCode, FAILURE_CODES.AUTH_REQUIRED);
    assert.equal(failure.retryable, false);
    assert.equal(failure.blocksQuote, true);
    assert.equal(failure.technicalMessage, rejectedLogin);
  });
}

test('catalogue rejected login creates a permanent incident without automatic retry', () => {
  const incident = createSupplierIncident({ liveFailureReason: rejectedLogin }, 1_000, 5_000);
  assert.equal(incident.failureCode, FAILURE_CODES.AUTH_REQUIRED);
  assert.equal(incident.retryable, false);
  assert.equal(incident.blocksQuote, true);
  assert.equal(incident.retryAt, null);
});

for (const [message, expectedCode] of [
  ['Login request failed: net::ERR_INTERNET_DISCONNECTED', FAILURE_CODES.NETWORK_OFFLINE],
  ['Login request failed: ENOTFOUND', FAILURE_CODES.DNS_FAILURE],
  ['Login request failed: ECONNRESET', FAILURE_CODES.CONNECTION_FAILURE],
  ['Login request failed: 503 Service Unavailable', FAILURE_CODES.SERVICE_UNAVAILABLE],
  ['Login request failed: 429 Too Many Requests', FAILURE_CODES.RATE_LIMITED],
  ['Login request timed out', FAILURE_CODES.SUPPLIER_TIMEOUT],
  ['QUOTE_TIMEOUT', FAILURE_CODES.QUOTE_TIMEOUT]
]) {
  test(`catalogue preserves transient failure policy: ${expectedCode}`, () => {
    const failure = classifyPortalFailure(message);
    assert.equal(failure.failureCode, expectedCode);
    assert.equal(failure.retryable, true);
    assert.equal(failure.blocksQuote, false);
  });
}
