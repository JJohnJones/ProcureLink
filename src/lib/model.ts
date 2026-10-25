import type { CaseRecord, Outcome, Staff } from './types.ts';

// Similarity-weighted Beta-Bernoulli estimator. New feedback receives additional
// weight so the demo visibly adapts; estimates are not clinically validated.
// Protected demographic fields are displayed but excluded from scoring.
export function similarity(a: CaseRecord, b: CaseRecord): number {
  const features: [keyof CaseRecord, number][] = [
    ['cause_of_death_unos', .24], ['primary_etiology', .12], ['donation_pathway', .10],
    ['brain_death', .05], ['family_emotional_state', .20], ['registry_status', .08],
    ['medical_mistrust', .04], ['multiple_decision_makers', .04], ['interpreter_utilized', .03],
    ['premature_donation_mention', .02], ['family_estrangement', .02],
    ['patient_hemodynamically_unstable', .02], ['late_referral_rushing_withdrawal', .02],
    ['mechanism_of_death', .01], ['circumstances_of_death', .01],
  ];
  return features.reduce((sum, [key, weight]) => sum + (a[key] === b[key] ? weight : 0), 0);
}

export function predict(record: CaseRecord, staffId: string, outcomes: Outcome[]): number {
  let success = 2;
  let total = 3;
  for (const outcome of outcomes) {
    if (outcome.staffId !== staffId) continue;
    const weight = Math.pow(similarity(record, outcome.case), 4) * (outcome.source === 'feedback' ? 3 : .65);
    success += weight * Number(outcome.authorized);
    total += weight;
  }
  return success / total;
}

export function distanceKm(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export const estimateEta = (km: number) => Math.max(1, Math.round(km / 65 * 60));
export function rankStaff(record: CaseRecord, people: Staff[], outcomes: Outcome[]) {
  return people.map(person => ({ ...person, probability: predict(record, person.id, outcomes) }))
    .sort((a, b) => b.probability - a.probability || a.id.localeCompare(b.id));
}

export function applyOutcome(cases: CaseRecord[], outcomes: Outcome[], caseId: string, authorized: boolean, consent: boolean, notes: string) {
  const record = cases.find(c => c.case_id === caseId);
  if (!record || !record.opc_id || record.authorized !== null) throw new Error('Only an assigned, open case can be finalized.');
  if (!authorized && consent) throw new Error('Consent cannot be obtained on a non-authorized case.');
  const before = predict(record, record.opc_id, outcomes);
  const completed_at = new Date().toISOString();
  const updated: CaseRecord = { ...record, authorized, consent_obtained: consent, notes, completed_at, status: authorized ? 'Authorized' : 'Not authorized' };
  const event: Outcome = { id: `feedback-${caseId}`, case: updated, staffId: record.opc_id, authorized,
    consent_obtained: consent, recordedAt: completed_at, source: 'feedback', before };
  const next = [...outcomes, event];
  event.after = predict(record, record.opc_id, next);
  return { cases: cases.map(c => c.case_id === caseId ? updated : c), outcomes: next, event };
}
