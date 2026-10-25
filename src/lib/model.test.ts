import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOutcome, distanceKm, predict, similarity } from './model.ts';
import type { CaseRecord } from './types.ts';

const record = { case_id: 'TEST-1', opc_id: 'OPC-101', authorized: null, consent_obtained: null, status: 'Staff assigned', age: 45,
  gender: 'Male', race: 'White', cause_of_death_unos: 'Anoxia', primary_etiology: 'Anoxic brain injury', donation_pathway: 'DBD',
  brain_death: true, family_emotional_state: 'Shutdown / Stoic', registry_status: false } as CaseRecord;

test('failure lowers the assigned staff estimate, successful similar case raises the other staff estimate', () => {
  const before = predict(record, 'OPC-101', []);
  const failed = applyOutcome([record], [], record.case_id, false, false, 'Declined');
  assert.ok(predict(record, 'OPC-101', failed.outcomes) < before);
  assert.equal(predict(record, 'OPC-102', failed.outcomes), before);
  const second = { ...record, case_id: 'TEST-2', opc_id: 'OPC-102' };
  const success = applyOutcome([...failed.cases, second], failed.outcomes, second.case_id, true, true, 'Authorized');
  assert.ok(predict(second, 'OPC-102', success.outcomes) > before);
  assert.ok(predict(second, 'OPC-102', success.outcomes) > predict(second, 'OPC-101', success.outcomes));
  assert.equal(success.cases[1].status, 'Authorized');
});
test('each case enters the training loop once and requires assigned staff', () => {
  const next = applyOutcome([record], [], record.case_id, true, true, '');
  assert.throws(() => applyOutcome(next.cases, next.outcomes, record.case_id, false, false, ''));
  assert.throws(() => applyOutcome([{ ...record, opc_id: null }], [], record.case_id, true, true, ''));
  assert.throws(() => applyOutcome([record], [], record.case_id, false, true, ''));
});
test('protected demographics do not influence similarity or prediction', () => {
  const other = { ...record, age: 80, gender: 'Female', race: 'Asian' };
  assert.equal(similarity(record, record), similarity(record, other));
});
test('distance uses actual coordinates', () => {
  assert.equal(distanceKm([-84.18, 39.75], [-84.18, 39.75]), 0);
  const distance = distanceKm([-84.18, 39.75], [-83.59, 41.67]);
  assert.ok(distance > 200 && distance < 230);
});
