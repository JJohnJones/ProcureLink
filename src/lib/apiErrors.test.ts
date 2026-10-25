import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, formatApiErrorDetail, isUnsupportedBriefRefresh } from './apiErrors.ts';

const refreshError = { type: 'extra_forbidden', loc: ['body', 'refresh'], msg: 'Extra inputs are not permitted', input: false };

test('FastAPI validation arrays become field-specific text instead of object strings', () => {
  assert.equal(formatApiErrorDetail([refreshError]), 'refresh: Extra inputs are not permitted');
  assert.equal(formatApiErrorDetail([{ loc: ['body', 'case', 'age'], msg: 'Must be positive' }]), 'case.age: Must be positive');
});

test('string and nested provider messages remain readable; unknown objects use a fallback', () => {
  assert.equal(formatApiErrorDetail('Request failed'), 'Request failed');
  assert.equal(formatApiErrorDetail({ error: { message: 'Provider unavailable' } }), 'Provider unavailable');
  assert.equal(formatApiErrorDetail({ unrelated: 'value' }), null);
  assert.equal(formatApiErrorDetail([null, {}]), null);
});

test('legacy refresh compatibility applies only to an unsupported top-level refresh field', () => {
  assert.ok(isUnsupportedBriefRefresh(new ApiError('validation failed', 422, [refreshError])));
  assert.equal(isUnsupportedBriefRefresh(new ApiError('validation failed', 422, [refreshError, { type: 'missing', loc: ['body', 'case'] }])), false);
  assert.equal(isUnsupportedBriefRefresh(new ApiError('validation failed', 422, [{ ...refreshError, loc: ['body', 'case', 'refresh'] }])), false);
  assert.equal(isUnsupportedBriefRefresh(new ApiError('server failed', 500, [refreshError])), false);
  assert.equal(isUnsupportedBriefRefresh(new Error('network failure')), false);
});
