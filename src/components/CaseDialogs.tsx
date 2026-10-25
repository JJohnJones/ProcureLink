import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Activity, ArrowRight, ArrowUpRight, BrainCircuit, Check, CheckCheck, ChevronDown, Copy, GitBranch, MapPin, Plus, ShieldCheck, Sparkles, Undo2, UserMinus, Users, X } from 'lucide-react';
import { blankCase, causes, emotions, flags, getHospital, getStaff, hospitals, isActive, staff } from '../lib/data';
import { distanceKm, estimateEta, rankStaff } from '../lib/model';
import { api, type ApiCaseBrief } from '../lib/api';
import type { CaseRecord, Outcome } from '../lib/types';
import { Avatar, Badge, Modal, ModalHeader, statusTone } from './ui';

export function CreateCaseModal({ seed, onClose, onCreate }: { seed: CaseRecord | null; onClose: () => void; onCreate: (record: Omit<CaseRecord, 'case_id' | 'created_at'>) => void }) {
  const [draft, setDraft] = useState<Omit<CaseRecord, 'case_id' | 'created_at'>>(() => seed ? { ...seed, opc_id: null, authorized: null, consent_obtained: null, completed_at: undefined, notes: '', status: 'Needs assignment' } : blankCase());
  const [advanced, setAdvanced] = useState(false);
  const set = (key: keyof CaseRecord, value: string | number | boolean) => setDraft(d => ({ ...d, [key]: value }));
  function submit(e: FormEvent) { e.preventDefault(); onCreate(draft); }
  return <Modal title={seed ? 'Create similar case' : 'Create referral'} onClose={onClose}>
    <ModalHeader title={seed ? 'A new case. A new opportunity.' : 'Create a new referral'} eyebrow={seed ? `BASED ON ${seed.case_id}` : 'CASE MANAGEMENT'} onClose={onClose}><p>Start with the details. Find the right person to connect.</p></ModalHeader>
    <form onSubmit={submit}>
      <div className="modal-body form-body">
        {seed && <div className="info-note"><Copy size={17} /><span>Clinical and family context copied. Staff matches reflect all completed outcomes.</span></div>}
        <div className="form-section-label"><span>01</span>Referral details</div>
        <label className="field">Referring hospital<select value={draft.hospital_id} onChange={e => set('hospital_id', e.target.value)}>{hospitals.map(h => <option key={h.id} value={h.id}>{h.name} · {h.city}</option>)}</select></label>
        <div className="form-grid three"><label className="field">Age<input required type="number" min="0" max="120" value={draft.age} onChange={e => set('age', Number(e.target.value))} /></label><label className="field">Gender<select value={draft.gender} onChange={e => set('gender', e.target.value)}>{['Male', 'Female', 'Nonbinary', 'Unknown'].map(x => <option key={x}>{x}</option>)}</select></label><label className="field">Race / ethnicity<select value={draft.race} onChange={e => set('race', e.target.value)}>{['White', 'Black', 'Asian', 'Hispanic / Latino', 'Native American', 'Multiracial', 'Unknown'].map(x => <option key={x}>{x}</option>)}</select></label></div>
        <div className="form-grid"><label className="field">Cause of death · UNOS<select value={draft.cause_of_death_unos} onChange={e => set('cause_of_death_unos', e.target.value)}>{causes.map(x => <option key={x}>{x}</option>)}</select></label><label className="field">Primary etiology<input required value={draft.primary_etiology} onChange={e => set('primary_etiology', e.target.value)} /></label></div>
        <div className="form-grid"><label className="field">Donation pathway<select value={draft.donation_pathway} onChange={e => set('donation_pathway', e.target.value)}><option>DBD</option><option>DCD</option><option>Undetermined</option></select></label><label className="field">Registry status<select value={String(draft.registry_status)} onChange={e => set('registry_status', e.target.value === 'true')}><option value="true">Registered donor</option><option value="false">Not registered</option></select></label></div>
        <div className="form-section-label"><span>02</span>Family context</div>
        <label className="field">Family emotional state<select value={draft.family_emotional_state} onChange={e => set('family_emotional_state', e.target.value)}>{emotions.map(x => <option key={x}>{x}</option>)}</select></label>
        <div className="checkbox-grid">{flags.map(({ key, label }) => <label className="check-field" key={key}><input type="checkbox" checked={Boolean(draft[key as keyof typeof draft])} onChange={e => set(key, e.target.checked)} />{label}</label>)}</div>
        <button type="button" className="disclosure" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>Additional clinical details<ChevronDown size={16} className={advanced ? 'rotate-180' : ''} /></button>
        {advanced && <div className="advanced-fields"><label className="check-field"><input type="checkbox" checked={draft.brain_death} onChange={e => set('brain_death', e.target.checked)} />Brain death confirmed</label><div className="form-grid"><label className="field">Mechanism of death<input required value={draft.mechanism_of_death} onChange={e => set('mechanism_of_death', e.target.value)} /></label><label className="field">Circumstances of death<input required value={draft.circumstances_of_death} onChange={e => set('circumstances_of_death', e.target.value)} /></label></div></div>}
      </div>
      <div className="modal-footer"><span className="subtle text-xs">Saved locally in this browser</span><div className="flex gap-2"><button className="button secondary" type="button" onClick={onClose}>Cancel</button><button className="button primary" type="submit"><Plus size={16} />Create referral</button></div></div>
    </form>
  </Modal>;
}

export function CaseDetailModal({ record, cases, outcomes, onClose, onAssign, onUnassign, onReopen, reopening, onOutcome, onSimilar, apiScores, apiConnected }: { record: CaseRecord; cases: CaseRecord[]; outcomes: Outcome[]; onClose: () => void; onAssign: (caseId: string, staffId: string) => void; onUnassign: (caseId: string) => void; onReopen?: () => void; reopening?: boolean; onOutcome: () => void; onSimilar: () => void; apiScores?: Record<string, number> | null; apiConnected?: boolean }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [brief, setBrief] = useState<ApiCaseBrief | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState('');
  const briefRequestId = useRef(0);
  const hospital = getHospital(record.hospital_id);
  const ranked = rankStaff(record, staff, outcomes)
    .map(person => ({ ...person, probability: apiScores?.[person.modelId] ?? person.probability }))
    .sort((a, b) => b.probability - a.probability || a.id.localeCompare(b.id));
  const current = getStaff(record.opc_id);
  const closed = !isActive(record);
  const busy = (id: string) => cases.some(c => c.opc_id === id && isActive(c) && c.case_id !== record.case_id);
  const bestAvailable = ranked.find(s => !busy(s.id));
  const briefTarget = current ? ranked.find(person => person.id === current.id) : bestAvailable;
  useEffect(() => {
    briefRequestId.current += 1;
    setBrief(null); setBriefError(''); setBriefLoading(false);
    return () => { briefRequestId.current += 1; };
  }, [record, briefTarget?.id, briefTarget?.probability]);
  async function generateBrief() {
    if (!briefTarget || briefLoading) return;
    const requestId = ++briefRequestId.current;
    setBriefLoading(true); setBriefError('');
    try {
      const generated = await api.caseBrief(record, briefTarget, hospital, distanceKm(briefTarget.coordinates, hospital.coordinates), Boolean(brief));
      if (briefRequestId.current === requestId) setBrief(generated);
    } catch (error) {
      if (briefRequestId.current === requestId) setBriefError(error instanceof Error ? error.message : 'Unable to generate the case brief.');
    } finally {
      if (briefRequestId.current === requestId) setBriefLoading(false);
    }
  }
  const newCount = outcomes.filter(o => o.source === 'feedback').length;
  return <Modal title={`Case ${record.case_id}`} onClose={onClose} wide>
    <ModalHeader title={record.case_id} eyebrow="REFERRAL / STAFF MATCHING" onClose={onClose}><div className="flex items-center gap-3 mt-3"><Badge dot tone={statusTone(record.status)}>{record.status}</Badge><span className="subtle text-xs">{hospital.name} · {hospital.city}</span></div></ModalHeader>
    <div className="case-detail-grid">
      <div className="case-context">
        <div className="section-label"><Activity size={15} />CASE PROFILE</div>
        <div className="patient-summary"><strong className="mono">{record.age}<span>yrs</span></strong><div>{record.gender}<span>{record.race}</span></div><Badge>{record.donation_pathway}</Badge></div>
        <dl className="detail-list"><div><dt>Cause of death · UNOS</dt><dd>{record.cause_of_death_unos}</dd></div><div><dt>Primary etiology</dt><dd>{record.primary_etiology}</dd></div><div><dt>Registry status</dt><dd className={record.registry_status ? 'text-emerald-400' : ''}>{record.registry_status ? <><ShieldCheck size={14} />Registered donor</> : 'Not registered'}</dd></div><div><dt>Brain death</dt><dd>{record.brain_death ? 'Confirmed' : 'Not confirmed'}</dd></div></dl>
        <div className="section-label mt-7"><Users size={15} />FAMILY CONTEXT</div>
        <div className="emotion-card"><span className={`emotion-dot e-${emotions.indexOf(record.family_emotional_state)}`} /><span>{record.family_emotional_state}</span></div>
        <div className="context-flags">{flags.filter(f => record[f.key]).map(f => <span key={f.key}>{f.label}</span>)}{!flags.some(f => record[f.key]) && <p className="subtle text-xs">No additional context flags recorded.</p>}</div>
        <button className="disclosure" onClick={() => setDetailsOpen(!detailsOpen)} aria-expanded={detailsOpen}>Clinical details<ChevronDown size={15} className={detailsOpen ? 'rotate-180' : ''} /></button>
        {detailsOpen && <dl className="detail-list"><div><dt>Mechanism</dt><dd>{record.mechanism_of_death}</dd></div><div><dt>Circumstances</dt><dd>{record.circumstances_of_death}</dd></div><div><dt>Referred</dt><dd>{new Date(record.created_at).toLocaleString()}</dd></div></dl>}
        {current && <div className="assigned-card"><div className="assignment-heading"><span className="eyebrow">{closed ? 'ASSIGNED STAFF' : 'CURRENT ASSIGNMENT'}</span>{!closed && <button type="button" className="text-button unassign-button" onClick={() => onUnassign(record.case_id)}><UserMinus size={13} />Unassign staff</button>}</div><div className="flex items-center gap-3 mt-3"><Avatar person={current} /><div><strong>{current.name}</strong><p>{current.location}</p></div><Check className="ml-auto text-emerald-400" size={17} /></div></div>}
        {closed && <div className="outcome-summary"><Badge tone={record.authorized ? 'green' : 'rose'}>{record.authorized ? 'Authorization obtained' : 'Authorization declined'}</Badge><p>Consent obtained: {record.consent_obtained ? 'Yes' : 'No'}</p>{record.notes && <p>{record.notes}</p>}</div>}
      </div>
      <div className="staff-matcher"><div className="flex justify-between items-start gap-4"><div><h3><Sparkles size={18} className="text-emerald-400" />The right connection</h3><p className="subtle text-xs mt-2">Staff ranked by predicted authorization rate</p></div><Badge tone="green">Model v1.{newCount}</Badge></div>
        {apiConnected && <section className="case-brief"><div className="case-brief-heading"><div><span className="eyebrow">OPC HANDOFF</span><strong>{record.opc_id ? 'Assigned match' : 'Top available match'}{briefTarget ? ` · ${briefTarget.name}` : ''}</strong></div><button className="button secondary small" disabled={!briefTarget || briefLoading} onClick={() => void generateBrief()}><Sparkles size={13} />{briefLoading ? 'Writing…' : brief ? 'Refresh brief' : 'Generate brief'}</button></div><p className="case-brief-demo-label">{brief ? brief.source === 'groq' ? 'AI4Free · Groq · fictional demo records' : 'Local fallback · AI4Free unavailable' : 'Fictional demo records'}</p>{brief && <>{brief.source_detail && <p role="status" className="case-brief-hint">{brief.source_detail}</p>}<div className="case-brief-copy">{brief.case_brief.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>{Boolean(brief.conversation_priorities?.length) && <div className="case-brief-section"><h4>Conversation priorities</h4><ul>{brief.conversation_priorities.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}{Boolean(brief.verify_before_approach?.length) && <div className="case-brief-section"><h4>Confirm before approach</h4><ul>{brief.verify_before_approach.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}<div className="case-brief-rationale"><span>Match rationale · {(brief.probability * 100).toFixed(1)}%</span><p>{brief.match_rationale}</p></div></>}{briefError && <p role="alert" className="case-brief-error">{briefError}</p>}</section>}
        <div className="matcher-key"><span>STAFF / PROXIMITY</span><span>MATCH ESTIMATE</span></div>
        <div className="match-list">{ranked.map((person, i) => {
          const unavailable = busy(person.id), assigned = record.opc_id === person.id;
          const km = distanceKm(person.coordinates, hospital.coordinates);
          const isBest = person.id === bestAvailable?.id;
          return <div className={`match-row ${isBest && !closed ? 'best-match' : ''} ${unavailable ? 'unavailable' : ''}`} key={person.id}>
            <div className="match-row-top"><span className="rank mono">{String(i + 1).padStart(2, '0')}</span><Avatar person={person} size={39} /><div className="match-person"><strong>{person.name}{isBest && !closed && <span className="recommended">TOP AVAILABLE</span>}</strong><span>{person.location} <i>·</i> ~{estimateEta(km)} min</span></div><div className="match-rate mono">{(person.probability * 100).toFixed(1)}<span>%</span></div></div>
            <div className="match-row-bottom"><span>{person.specialty} <i>·</i> {person.experience} years experience</span>{!closed && <button className={`assign-button ${isBest ? 'accent' : ''}`} disabled={unavailable || assigned} onClick={() => onAssign(record.case_id, person.id)}>{assigned ? <><Check size={12} />Assigned</> : unavailable ? 'On a case' : <>Assign OPO Staff<ArrowUpRight size={12} /></>}</button>}</div>
          </div>;
        })}</div>
        <p className="model-caption"><BrainCircuit size={14} />{apiConnected ? 'Live XGBoost estimates from the case CSV and API training updates.' : `Demo estimates from ${outcomes.length} fictional outcomes.`} Model OPC IDs match the dataset. ETA uses straight-line distance at 65 km/h.</p>
      </div>
    </div>
    <div className="modal-footer"><span className="subtle text-xs flex items-center gap-2"><MapPin size={14} />Western Ohio network</span><div className="flex gap-2">{closed ? <>{onReopen && <button className="button secondary" disabled={reopening} onClick={onReopen}><Undo2 size={15} />{reopening ? 'Reverting…' : 'Revert to active'}</button>}<button className="button primary" onClick={onSimilar}><Copy size={15} />Create similar case</button></> : <><button className="button primary" disabled={!current} onClick={onOutcome}><CheckCheck size={16} />Log case outcome</button></>}</div></div>
  </Modal>;
}

export function FeedbackModal({ record, onClose, onSubmit, onSimilar, apiConnected = false }: { record: CaseRecord; onClose: () => void; onSubmit: (authorized: boolean, consent: boolean, notes: string) => Outcome | Promise<Outcome>; onSimilar: (record: CaseRecord) => void; apiConnected?: boolean }) {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [consent, setConsent] = useState(false);
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState<Outcome | null>(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const person = getStaff(record.opc_id)!;
  async function submit(e: FormEvent) {
    e.preventDefault(); if (authorized === null || sending) return;
    setSending(true);
    try { const event = await onSubmit(authorized, consent, notes); setResult(event); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to save outcome.'); }
    finally { setSending(false); }
  }
  return <Modal title={result ? 'Feedback recorded' : 'Log case outcome'} onClose={onClose}>
    {result ? <><div className="feedback-success"><div className="success-ring"><CheckCheck size={28} /></div><Badge tone="green">FEEDBACK LOOP COMPLETE</Badge><h2>Every outcome teaches us.</h2><p>Outcome saved for <span className="mono">{record.case_id}</span>.<br />Future staff matches now reflect this experience.</p><div className="pipeline"><div><Check size={17} /><span>Outcome logged</span></div><ArrowRight size={14} /><div><GitBranch size={17} /><span>{apiConnected ? 'XGBoost continued' : 'Model updated'}</span></div><ArrowRight size={14} /><div><Sparkles size={17} /><span>Matches refreshed</span></div></div><div className="learning-delta"><Avatar person={person} /><div><strong>{person.name}</strong><p>{apiConnected ? 'API model · this case' : 'Estimate for a similar case'}</p></div><span className="mono before">{((result.before || 0) * 100).toFixed(1)}%</span><ArrowRight size={15} /><strong className={`mono ${result.authorized ? 'text-emerald-400' : 'text-amber-400'}`}>{((result.after || 0) * 100).toFixed(1)}%</strong></div><p className="feedback-explanation">{apiConnected ? 'The assigned OPC’s XGBoost model was continued using its full recorded case history. These values are predictions for this completed case.' : result.authorized ? 'A successful outcome increases this staff member’s estimate for similar cases.' : 'A declined outcome lowers this staff member’s estimate, giving other staff a chance to be a stronger match.'}</p></div><div className="modal-footer"><button className="button secondary" onClick={onClose}>Done</button><button className="button primary" onClick={() => onSimilar(result.case)}><Copy size={15} />Try a similar case<ArrowRight size={15} /></button></div></> : <>
      <ModalHeader title="Close the loop." eyebrow="TRAINING DATA FEEDBACK" onClose={onClose}><p>Record the outcome. Improve the next connection.</p></ModalHeader><form onSubmit={submit}><div className="modal-body"><div className="feedback-case"><div><span className="mono">{record.case_id}</span><p>{getHospital(record.hospital_id).name}</p></div><div className="flex items-center gap-2"><Avatar person={person} size={30} /><span>{person.name}</span></div></div><label className="field-label">Was donation authorized?</label><div className="outcome-options"><button type="button" className={authorized === true ? 'chosen yes' : ''} onClick={() => { setAuthorized(true); setConsent(true); }}><Check size={20} /><strong>Authorized</strong><span>Family agreed to donation</span></button><button type="button" className={authorized === false ? 'chosen no' : ''} onClick={() => { setAuthorized(false); setConsent(false); }}><X size={20} /><strong>Not authorized</strong><span>Family declined donation</span></button></div><label className="check-field my-5"><input type="checkbox" checked={consent} disabled={!authorized} onChange={e => setConsent(e.target.checked)} />Consent documentation obtained</label><label className="field">Outcome notes <span className="subtle font-normal">(optional)</span><textarea rows={3} placeholder="Add context that may help with future cases…" value={notes} onChange={e => setNotes(e.target.value)} /></label><div className="info-note"><BrainCircuit size={19} /><span>{apiConnected ? 'The completed case and authorization result will be sent to this person’s CSV-trained XGBoost model before it is marked complete.' : 'This outcome will update the local demo estimates.'}</span></div>{error && <p role="alert" className="text-rose-400 text-sm mt-3">{error}</p>}</div><div className="modal-footer"><span className="subtle text-xs">Revert a completed case to active to replace its outcome</span><button type="submit" className="button primary" disabled={authorized === null || sending}><GitBranch size={15} />{sending ? 'Updating model…' : apiConnected ? 'Submit to model' : 'Submit & update model'}</button></div></form>
    </>}
  </Modal>;
}
