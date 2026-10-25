import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDownUp, ArrowRight, ArrowUpRight, Bell, BrainCircuit, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, ClipboardList, Download, Expand, GitBranch, Heart, LayoutDashboard, Map, MapPin, Menu, PanelLeftClose, Plus, Radio, Search, ShieldCheck, SlidersHorizontal, Sparkles, Undo2, UserMinus, Users, X } from 'lucide-react';
import { CreateCaseModal, CaseDetailModal, FeedbackModal } from './components/CaseDialogs';
import { Avatar, Badge, Empty, Modal, ModalHeader, Sparkline, statusTone } from './components/ui';
import { createInitialState, emotions, getHospital, getStaff, hospitals, isActive, staff } from './lib/data';
import { applyOutcome } from './lib/model';
import { api, mapApiPredictions, type ApiHealth } from './lib/api';
import type { AppState, CaseRecord, Outcome, View } from './lib/types';

const RegionMap = lazy(() => import('./components/RegionMap'));
const STORAGE_KEY = 'relay-opo-state-v1';
const navigation = [{ name: 'Dashboard', icon: LayoutDashboard }, { name: 'Active Cases', icon: ClipboardList }, { name: 'Map View', icon: Map }, { name: 'Staff Analytics', icon: Users }, { name: 'Training Data Loop', icon: GitBranch }] as const;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const value = JSON.parse(raw) as AppState;
      if (value.version === 1 && Array.isArray(value.cases) && Array.isArray(value.outcomes)
        && value.cases.every(c => c.case_id && hospitals.some(h => h.id === c.hospital_id) && (!c.opc_id || staff.some(s => s.id === c.opc_id)))
        && value.outcomes.every(o => o.case && typeof o.authorized === 'boolean' && staff.some(s => s.id === o.staffId))) return value;
    }
  } catch { /* Invalid browser data falls back to the self-contained demo. */ }
  return createInitialState();
}
function downloadCSV(records: object[], name: string) {
  if (!records.length) return;
  const fields = [...new Set(records.flatMap(r => Object.keys(r)))];
  const escape = (v: unknown) => { const text = v == null ? '' : String(v); return `"${(/^[=+\-@]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`; };
  const csv = [fields.join(','), ...records.map(r => fields.map(f => escape((r as Record<string, unknown>)[f])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

export default function App() {
  const [state, setState] = useState<AppState>(loadState);
  const stateRef = useRef(state); stateRef.current = state;
  const [view, setView] = useState<View>('Dashboard');
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [search, setSearch] = useState('');
  const [hospitalFilter, setHospitalFilter] = useState('all');
  const [emotionFilter, setEmotionFilter] = useState('all');
  const [caseTab, setCaseTab] = useState('All referrals');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'age'>('newest');
  const [dateRange, setDateRange] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [create, setCreate] = useState<{ seed: CaseRecord | null } | null>(null);
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [staffOpen, setStaffOpen] = useState(true);
  const [staffQuery, setStaffQuery] = useState('');
  const [staffAvailability, setStaffAvailability] = useState('all');
  const [staffSpecialty, setStaffSpecialty] = useState('all');
  const [staffSort, setStaffSort] = useState('authorization');
  const [trainingFilter, setTrainingFilter] = useState('feedback');
  const [reopeningCaseId, setReopeningCaseId] = useState<string | null>(null);
  const [apiHealth, setApiHealth] = useState<ApiHealth | null>(null);
  const [apiProblem, setApiProblem] = useState('');
  const [apiPredictions, setApiPredictions] = useState<Record<string, number> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { cases, outcomes } = state;
  const active = cases.filter(isActive);
  const awaiting = active.filter(c => c.status === 'Needs assignment');
  const available = staff.filter(s => !active.some(c => c.opc_id === s.id));
  const feedback = outcomes.filter(o => o.source === 'feedback');
  const localRate = outcomes.filter(o => o.authorized).length / (outcomes.length || 1);
  const rate = apiHealth?.authorization_rate ?? localRate;
  const apiConnected = apiHealth !== null;
  const trainingRecords = apiConnected ? feedback : outcomes;
  const staffSpecialties = [...new Set(staff.map(person => person.specialty))].sort();
  const staffAnalytics = staff.map(person => {
    const history = outcomes.filter(outcome => outcome.staffId === person.id);
    const assigned = active.find(record => record.opc_id === person.id);
    const model = apiHealth?.models.find(item => item.opc_id === person.modelId);
    return { ...person, assigned, model, completedCases: model?.training_cases ?? history.length,
      authorization: model?.authorization_rate ?? history.filter(outcome => outcome.authorized).length / (history.length || 1) };
  }).filter(person => (staffAvailability === 'all' || (staffAvailability === 'available' ? !person.assigned : Boolean(person.assigned)))
    && (staffSpecialty === 'all' || person.specialty === staffSpecialty)
    && (!staffQuery || `${person.name} ${person.location} ${person.specialty} ${person.modelId}`.toLowerCase().includes(staffQuery.toLowerCase())))
    .sort((a, b) => staffSort === 'authorization-low' ? a.authorization - b.authorization
      : staffSort === 'experience' ? b.experience - a.experience
      : staffSort === 'cases' ? b.completedCases - a.completedCases
      : staffSort === 'name' ? a.name.localeCompare(b.name)
      : staffSort === 'availability' ? Number(Boolean(a.assigned)) - Number(Boolean(b.assigned))
      : b.authorization - a.authorization || a.name.localeCompare(b.name));
  const selected = cases.find(c => c.case_id === selectedId);
  const selectedOutcome = outcomes.find(o => o.source === 'feedback' && o.case.case_id === selectedId);
  const feedbackCase = cases.find(c => c.case_id === feedbackId);
  const title = view === 'Dashboard' ? 'Dashboard' : view === 'Map View' ? 'Regional map' : view === 'Staff Analytics' ? 'Staff analytics' : view === 'Training Data Loop' ? 'Training data' : 'Active cases';
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); setStorageError(false); } catch { setStorageError(true); } }, [state]);
  useEffect(() => {
    let active = true;
    const connect = async () => {
      try {
        const health = await api.health();
        if (!active) return;
        const apiOpcIds = new Set(health.opc_ids);
        const missing = staff.filter(person => !apiOpcIds.has(person.modelId));
        if (missing.length) throw new Error(`The API is missing staff models: ${missing.map(person => person.modelId).join(', ')}.`);
        setApiHealth(previous => previous && JSON.stringify(previous) === JSON.stringify(health) ? previous : health);
        setApiProblem('');
      } catch (error) {
        if (!active) return;
        setApiHealth(null);
        setApiProblem(error instanceof Error ? error.message : 'The prediction API is unavailable.');
      }
    };
    void connect();
    const timer = window.setInterval(connect, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    let active = true;
    const record = cases.find(c => c.case_id === selectedId);
    if (!apiHealth || !record) { setApiPredictions(null); return; }
    setApiPredictions(null);
    api.predict(record).then(predictions => {
      if (active) setApiPredictions(mapApiPredictions(predictions));
    }).catch(error => {
      if (active) { setApiHealth(null); setApiProblem(error instanceof Error ? error.message : 'Unable to get predictions.'); }
    });
    return () => { active = false; };
  }, [apiHealth, selectedId, cases]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 5000); return () => clearTimeout(id); }, [toast]);
  useEffect(() => { setPage(1); }, [search, hospitalFilter, emotionFilter, caseTab, sort, dateRange, pageSize, view]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); searchRef.current?.focus(); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  function navigate(next: View) { setView(next); setMobileMenu(false); setNoticeOpen(false); setSearch(''); setCaseTab('All referrals'); }
  function notify(message: string) { setToast(message); }
  function createCase(draft: Omit<CaseRecord, 'case_id' | 'created_at'>) {
    const existing = stateRef.current;
    const max = Math.max(2037, ...existing.cases.map(c => Number(c.case_id.split('-').at(-1)) || 0));
    const record: CaseRecord = { ...draft, case_id: `OH-${max + 1}`, created_at: new Date().toISOString(), completed_at: undefined, opc_id: null, authorized: null, consent_obtained: null, status: 'Needs assignment' };
    const next = { ...existing, cases: [record, ...existing.cases] }; stateRef.current = next; setState(next);
    setCreate(null); setSelectedId(record.case_id); notify(`${record.case_id} created. Staff matches are ready.`);
  }
  function assign(caseId: string, staffId: string) {
    const existing = stateRef.current;
    const record = existing.cases.find(c => c.case_id === caseId);
    if (!record || !isActive(record) || existing.cases.some(c => c.opc_id === staffId && isActive(c) && c.case_id !== caseId)) { notify('This staff member is no longer available. Choose another match.'); return; }
    const next: AppState = { ...existing, cases: existing.cases.map(c => c.case_id === caseId ? { ...c, opc_id: staffId, status: 'Staff assigned' } : c) };
    stateRef.current = next; setState(next); notify(`${getStaff(staffId)?.name} assigned to ${caseId}. Route added to map.`);
  }
  function unassign(caseId: string) {
    const existing = stateRef.current;
    const record = existing.cases.find(c => c.case_id === caseId);
    if (!record || !isActive(record) || !record.opc_id) return;
    const next: AppState = { ...existing, cases: existing.cases.map(c => c.case_id === caseId ? { ...c, opc_id: null, status: 'Needs assignment' } : c) };
    stateRef.current = next; setState(next); setApiPredictions(null); notify(`${getStaff(record.opc_id)?.name || 'Staff'} unassigned from ${caseId}. Referral needs assignment.`);
  }
  async function complete(authorized: boolean, consent: boolean, notes: string): Promise<Outcome> {
    const record = stateRef.current.cases.find(c => c.case_id === feedbackId);
    const person = record && getStaff(record.opc_id);
    if (!record || !person) throw new Error('The case assignment is missing. Assign an OPC before logging an outcome.');
    // Train the matching CSV model before finalizing the browser record. Keep
    // the case open if the API rejects training so model and site stay aligned.
    const trained = apiHealth ? await api.trainOutcome(record, person, authorized, consent, notes) : null;
    const result = applyOutcome(stateRef.current.cases, stateRef.current.outcomes, feedbackId!, authorized, consent, notes);
    const next: AppState = { version: 1, cases: result.cases, outcomes: result.outcomes }; stateRef.current = next; setState(next);
    if (trained && apiHealth) {
      const previousCount = apiHealth.training_cases;
      setApiHealth({ ...apiHealth, training_cases: trained.training_cases,
        authorization_rate: (apiHealth.authorization_rate * previousCount + Number(authorized)) / (previousCount + 1),
        boosting_rounds: trained.boosting_rounds });
      return { ...result.event, before: trained.probability_before, after: trained.probability_after };
    }
    return result.event;
  }
  async function deleteOutcome(outcome: Outcome) {
    if (reopeningCaseId || outcome.source !== 'feedback') return;
    if (!window.confirm(`Revert ${outcome.case.case_id} to active? This deletes its recorded outcome and removes that outcome from model training.`)) return;
    const person = getStaff(outcome.staffId);
    if (!person) return;
    setReopeningCaseId(outcome.case.case_id);
    try {
      if (apiConnected) {
        try {
          await api.deleteOutcome(person, outcome.case.case_id);
          try { setApiHealth(await api.health()); } catch { /* The delete succeeded; next poll will refresh API status. */ }
        } catch (error) {
          // An outcome logged while offline is local only; deleting it should
          // still work if the API has no matching submitted case.
          if (!(error instanceof Error) || !error.message.startsWith('No submitted case found:')) throw error;
        }
      }
      const existing = stateRef.current;
      const next: AppState = {
        version: 1,
        outcomes: existing.outcomes.filter(item => item.id !== outcome.id),
        cases: existing.cases.map(item => {
          if (item.case_id !== outcome.case.case_id) return item;
          // Completion releases staff; they may now be supporting another case.
          const assigned = item.opc_id && !existing.cases.some(other =>
            other.case_id !== item.case_id && isActive(other) && other.opc_id === item.opc_id);
          return { ...item, opc_id: assigned ? item.opc_id : null, authorized: null,
            consent_obtained: null, completed_at: undefined, notes: '',
            status: assigned ? 'Staff assigned' : 'Needs assignment' };
        }),
      };
      stateRef.current = next; setState(next); setApiPredictions(null);
      navigate('Active Cases'); setHospitalFilter('all'); setEmotionFilter('all'); setDateRange('all');
      setFeedbackId(null); setSelectedId(outcome.case.case_id);
      notify(`${outcome.case.case_id} reverted to active. Previous outcome removed.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not revert the referral to active.';
      notify(message === 'Not Found'
        ? 'Restart FastAPI so it loads the outcome-delete route, then try again.'
        : message);
    } finally { setReopeningCaseId(null); }
  }
  function similar(record: CaseRecord) { setSelectedId(null); setFeedbackId(null); setCreate({ seed: record }); }
  function openLearningNextStep() {
    const nextCase = active.find(record => record.opc_id);
    if (nextCase) setSelectedId(nextCase.case_id);
    else { navigate('Active Cases'); setCaseTab('Needs assignment'); }
  }
  const filtered = useMemo(() => cases.filter(c => {
    const hospital = getHospital(c.hospital_id);
    const haystack = `${c.case_id} ${hospital.name} ${hospital.city} ${c.primary_etiology} ${c.cause_of_death_unos} ${getStaff(c.opc_id)?.name || ''}`.toLowerCase();
    return (!search || haystack.includes(search.toLowerCase())) && (hospitalFilter === 'all' || c.hospital_id === hospitalFilter)
      && (emotionFilter === 'all' || c.family_emotional_state === emotionFilter)
      && (caseTab === 'All referrals' || (caseTab === 'Needs assignment' && c.status === 'Needs assignment') || (caseTab === 'In progress' && c.status === 'Staff assigned') || (caseTab === 'Completed' && !isActive(c)))
      && (dateRange === 'all' || (Date.now() - new Date(c.created_at).getTime()) < (dateRange === 'today' ? 1 : 7) * 86400000);
  }).sort((a, b) => sort === 'age' ? b.age - a.age : sort === 'oldest' ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at)), [cases, search, hospitalFilter, emotionFilter, caseTab, sort, dateRange]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const actualPage = Math.min(page, pageCount);
  const paginated = filtered.slice((actualPage - 1) * pageSize, actualPage * pageSize);
  function exportCases() { downloadCSV(filtered, 'procurelink-referred-cases.csv'); notify(`${filtered.length} case records exported.`); }

  function CasesPanel() {
    return <section className="panel cases-panel"><div className="panel-heading"><div><h2>Cases <span className="count-pill mono">{cases.length}</span></h2></div><div className="flex items-center gap-4"><button className="text-button" disabled={!filtered.length} onClick={exportCases}><Download size={14} />Export</button><button className="text-button" onClick={() => setCreate({ seed: null })}><Plus size={15} />Add case</button></div></div>
      <div className="case-tabs">{['All referrals', 'Needs assignment', 'In progress', 'Completed'].map(tab => <button key={tab} className={caseTab === tab ? 'active' : ''} onClick={() => setCaseTab(tab)}>{tab}{tab === 'Needs assignment' && <span>{awaiting.length}</span>}</button>)}</div>
      <div className="table-toolbar"><div className="table-search"><Search size={15} /><input aria-label="Search cases" placeholder="Search case ID, hospital, or etiology…" value={search} onChange={e => setSearch(e.target.value)} />{search && <button onClick={() => setSearch('')} aria-label="Clear case search"><X size={13} /></button>}</div><div className="table-controls"><select className="control hospital-filter" aria-label="Filter by hospital" value={hospitalFilter} onChange={e => setHospitalFilter(e.target.value)}><option value="all">All hospitals</option>{hospitals.map(h => <option key={h.id} value={h.id}>{h.short}</option>)}</select><button className={`button small secondary ${showFilters ? 'filter-active' : ''}`} onClick={() => setShowFilters(!showFilters)}><SlidersHorizontal size={14} />Filters{emotionFilter !== 'all' && <span className="filter-dot" />}</button><select className="control sort-control" aria-label="Sort cases" value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="age">Age: high to low</option></select></div></div>
      {showFilters && <div className="expanded-filters"><label>Family emotional state<select className="control" value={emotionFilter} onChange={e => setEmotionFilter(e.target.value)}><option value="all">All emotional states</option>{emotions.map(e => <option key={e}>{e}</option>)}</select></label><button className="text-button" onClick={() => { setEmotionFilter('all'); setHospitalFilter('all'); setSearch(''); setDateRange('all'); }}>Reset filters</button></div>}
      <div className="table-scroll"><table className="case-table"><thead><tr><th><button onClick={() => setSort(sort === 'newest' ? 'oldest' : 'newest')}>CASE / HOSPITAL<ArrowDownUp size={11} /></button></th><th>PATIENT</th><th>CAUSE / ETIOLOGY</th><th>REGISTRY</th><th>FAMILY EMOTIONAL STATE</th><th>STATUS</th><th aria-label="Referral actions" /></tr></thead><tbody>{paginated.map(c => { const h = getHospital(c.hospital_id); return <tr key={c.case_id} onClick={() => setSelectedId(c.case_id)}><td><button className="case-id mono" onClick={() => setSelectedId(c.case_id)}>{c.case_id}</button><span className="cell-sub">{h.short} <span className="city-separator">· {h.city}</span></span></td><td><span className="mono patient-data">{c.age} <span>/</span> {c.gender === 'Male' ? 'M' : c.gender === 'Female' ? 'F' : c.gender}</span><span className="cell-sub">{c.race}</span></td><td><span>{c.cause_of_death_unos}</span><span className="cell-sub">{c.primary_etiology}</span></td><td>{c.registry_status ? <span className="registry yes"><ShieldCheck size={13} />Registered</span> : <span className="registry"><span className="mini-dash" />Not registered</span>}</td><td><span className="emotion"><span className={`emotion-dot e-${emotions.indexOf(c.family_emotional_state)}`} />{c.family_emotional_state}</span></td><td><Badge dot tone={statusTone(c.status)}>{c.status}</Badge></td><td><div className="referral-actions">{c.opc_id && isActive(c) && <button type="button" className="text-button unassign-button" aria-label={`Unassign staff from ${c.case_id}`} onClick={event => { event.stopPropagation(); unassign(c.case_id); }}><UserMinus size={13} />Unassign</button>}<button className="row-open" aria-label={`Open ${c.case_id}`}><ArrowUpRight size={16} /></button></div></td></tr>; })}</tbody></table></div>
      {filtered.length === 0 && <Empty title="No cases match this view" text="Try another search or reset your filters." action={<button className="button secondary small" onClick={() => { setSearch(''); setHospitalFilter('all'); setEmotionFilter('all'); setCaseTab('All referrals'); setDateRange('all'); }}>Clear filters</button>} />}
      <div className="table-footer"><span><strong>{filtered.length ? (actualPage - 1) * pageSize + 1 : 0}–{Math.min(actualPage * pageSize, filtered.length)}</strong> of <strong>{filtered.length}</strong></span><label className="page-size-control">Rows<select className="control" aria-label="Rows per page" value={pageSize} onChange={e => setPageSize(Number(e.target.value))}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label><div className="pagination"><button aria-label="Previous page" disabled={actualPage === 1} onClick={() => setPage(actualPage - 1)}><ChevronLeft size={15} /></button>{Array.from({ length: pageCount }, (_, i) => i + 1).filter(n => n === 1 || n === pageCount || Math.abs(n - actualPage) <= 1).map(n => <button key={n} className={n === actualPage ? 'current' : ''} onClick={() => setPage(n)}>{n}</button>)}<button aria-label="Next page" disabled={actualPage >= pageCount} onClick={() => setPage(actualPage + 1)}><ChevronRight size={15} /></button></div></div>
    </section>;
  }

  return <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
    {mobileMenu && <button className="mobile-overlay" onClick={() => setMobileMenu(false)} aria-label="Close navigation" />}
    <aside className={`sidebar ${mobileMenu ? 'mobile-open' : ''}`}><a className="brand" href="#" onClick={e => { e.preventDefault(); navigate('Dashboard'); }}><span className="brand-icon"><Plus size={27} strokeWidth={3.6} /></span><span className="brand-name">ProcureLink</span></a><div className="workspace-switch"><div className="workspace-icon"><Activity size={17} /></div><div><strong>Western Ohio</strong></div><Radio size={13} className="text-emerald-400" /></div>
      <nav>{navigation.map(({ name, icon: Icon }) => <button key={name} title={collapsed ? name : undefined} className={`nav-item ${view === name ? 'active' : ''}`} onClick={() => navigate(name)}><Icon size={18} /><span>{name}</span>{name === 'Active Cases' && <b className="nav-count mono">{active.length}</b>}{name === 'Training Data Loop' && <i className="nav-dot" />}</button>)}</nav>
      <div className="sidebar-bottom"><div className="model-status"><div className="model-status-title"><span className="live-dot" /><span>Model status</span><GitBranch size={14} /></div><p>{apiConnected ? 'CSV models online' : 'Local demo model'}</p><div className="model-version mono">{feedback.length} new outcomes<span>{apiConnected ? 'API' : 'DEMO'}</span></div></div><button className="nav-item help-button" onClick={() => setHelpOpen(true)}><CircleHelp size={18} /><span>Help & resources</span><ArrowUpRight size={14} /></button><div className="sidebar-profile"><span className="user-avatar">AC</span><div><strong>Alex Cooper</strong><span>OPO Administrator</span></div><button className="icon-button" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed(!collapsed)}><PanelLeftClose size={16} /></button></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileMenu(true)}><Menu size={20} /></button></div><div className="topbar-right"><div className="global-search"><Search size={14} /><input ref={searchRef} aria-label="Global case search" placeholder="Search anything…" value={search} onChange={e => { setSearch(e.target.value); if (!['Dashboard', 'Active Cases'].includes(view)) setView('Active Cases'); }} /><kbd>⌘ K</kbd></div><span className="topbar-divider" /><div className="notification-wrapper"><button className="notification-button" aria-label="View notifications" onClick={() => setNoticeOpen(!noticeOpen)}><Bell size={18} /><i /></button>{noticeOpen && <div className="notification-popover"><h3>Workspace activity</h3><p>{awaiting.length} referrals are waiting for a staff match.</p>{feedback.slice(-3).reverse().map(o => <button key={o.id} onClick={() => { setSelectedId(o.case.case_id); setNoticeOpen(false); }}><GitBranch size={15} /><span><strong>{o.case.case_id}</strong> outcome logged<small>Model updated · {new Date(o.recordedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></span></button>)}<button onClick={() => { navigate('Active Cases'); setCaseTab('Needs assignment'); }}>Review waiting cases<ArrowRight size={14} /></button></div>}</div></div></header>
      <main><div className="page-heading"><h1>{title}</h1>{!(['Dashboard', 'Active Cases'] as View[]).includes(view) && <div className="heading-actions"><button className="button primary" onClick={() => setCreate({ seed: null })}><Plus size={16} />New referral</button></div>}</div>
        {!apiConnected && apiProblem && <div className="api-status-note" role="status"><BrainCircuit size={15} /><span>{apiProblem} The page is using its browser demo model.</span></div>}
        {storageError && <div className="storage-warning" role="alert">Browser storage is unavailable. Changes will last for this session only. Export records to keep a copy.</div>}
        {view === 'Dashboard' && <><div className="overview-toolbar"><span /><div className="flex items-center gap-2"><div className="date-select"><CalendarDays size={14} /><select aria-label="Date range" value={dateRange} onChange={e => setDateRange(e.target.value)}><option value="all">All referrals</option><option value="today">Past 24 hours</option><option value="week">Past 7 days</option></select></div></div></div>
        <div className="metrics-grid"><Metric label="Active referrals" value={String(active.length).padStart(2, '0')} detail={`${awaiting.length} awaiting a staff match`} icon={<ClipboardList size={17} />} values={[3, 4, 4, 7, 5, 8, 7, active.length]} chartId="referrals" onClick={() => { navigate('Active Cases'); }} /><Metric label="Authorization rate" value={(rate * 100).toFixed(1)} suffix="%" detail={apiHealth ? `${apiHealth.training_cases.toLocaleString()} CSV + API training cases` : `${outcomes.filter(o => o.authorized).length} of ${outcomes.length} demo outcomes`} icon={<Heart size={17} />} values={apiHealth ? [rate * 100, rate * 100, rate * 100, rate * 100, rate * 100, rate * 100, rate * 100, rate * 100] : cumulativeRates(outcomes)} chartId="authorization" positive /><Metric label="Available staff" value={String(available.length).padStart(2, '0')} suffix={`/ ${staff.length}`} detail="Across the Western Ohio region" icon={<Users size={17} />} values={[5, 5, 6, 4, 5, 3, 5, available.length]} chartId="staff" color="#7caac5" onClick={() => navigate('Staff Analytics')} /><Metric label="Learning records" value={String(apiHealth?.training_cases ?? outcomes.length)} detail={apiHealth ? `${apiHealth.opc_ids.length} trained OPC models · ${feedback.length} site submissions` : `${feedback.length} new demo outcomes`} icon={<BrainCircuit size={17} />} values={[40, 65, 80, 110, 130, 156, 178, apiHealth?.training_cases ?? outcomes.length]} chartId="learning" color="#8fafa5" onClick={() => navigate('Training Data Loop')} /></div>
        {view === 'Dashboard' && <div className={`overview-grid ${!staffOpen ? 'staff-panel-collapsed' : ''}`}><section className="panel map-panel"><div className="panel-heading"><div><h2>Regional coverage <Badge tone="green" dot>Live</Badge></h2></div><button className="icon-button" aria-label="Expand regional map" onClick={() => navigate('Map View')}><Expand size={15} /></button></div><Suspense fallback={<div className="map-loading"><Map size={24} /><span>Connecting to the region…</span></div>}><RegionMap cases={cases} onCase={setSelectedId} /></Suspense><div className="map-footer"><span><strong className="mono">{hospitals.length}</strong> partner hospitals</span><span><strong className="mono">{active.filter(c => c.opc_id).length}</strong> active assignments</span><button className="text-button" onClick={() => navigate('Map View')}>Open map<ArrowUpRight size={13} /></button></div></section><section className="panel available-panel"><div className="panel-heading"><div><h2>On the ground <span className="count-pill mono">{available.length}</span></h2></div><button className="icon-button" aria-label={staffOpen ? 'Collapse staff panel' : 'Expand staff panel'} aria-expanded={staffOpen} onClick={() => setStaffOpen(!staffOpen)}><ChevronDown className={!staffOpen ? '-rotate-90' : ''} size={16} /></button></div>{staffOpen && <><div className="available-staff">{available.slice(0, 4).map(person => <button className="available-staff-row" key={person.id} onClick={() => { if (awaiting[0]) setSelectedId(awaiting[0].case_id); else navigate('Staff Analytics'); }}><div className="avatar-wrap"><Avatar person={person} size={36} /><i /></div><div><strong>{person.name}</strong><span><MapPin size={11} />{person.location}</span></div><span className="availability-status">Available</span><ArrowUpRight size={14} /></button>)}{available.length === 0 && <div className="p-6 text-sm subtle">All staff are supporting active cases.</div>}</div><button className="staff-view-all" onClick={() => navigate('Staff Analytics')}>View all staff<ArrowRight size={14} /></button></>}</section></div>}
        {CasesPanel()}</>}{view === 'Active Cases' && CasesPanel()}
        {view === 'Map View' && <><div className="map-view-stats"><Badge dot tone="green">{active.length} active cases</Badge><Badge tone="cyan">{active.filter(c => c.opc_id).length} assigned routes</Badge></div><section className="panel full-map-panel"><Suspense fallback={<div className="map-loading">Loading regional map…</div>}><RegionMap cases={cases} expanded onCase={setSelectedId} /></Suspense></section><div className="assignment-strip">{active.filter(c => c.opc_id).map(c => <button key={c.case_id} className="assignment-tile" onClick={() => setSelectedId(c.case_id)}><Avatar person={getStaff(c.opc_id)!} /><div><strong>{getStaff(c.opc_id)!.name}</strong><span>{getHospital(c.hospital_id).name}</span></div><span className="mono">{c.case_id}</span><ArrowUpRight size={15} /></button>)}</div></>}
        {view === 'Staff Analytics' && <>
          <section className="staff-controls panel">
            <label className="staff-search"><Search size={15} /><input aria-label="Search staff" placeholder="Search name, location, or OPC ID" value={staffQuery} onChange={e => setStaffQuery(e.target.value)} /></label>
            <select className="control" aria-label="Filter staff availability" value={staffAvailability} onChange={e => setStaffAvailability(e.target.value)}><option value="all">All availability</option><option value="available">Available</option><option value="assigned">On a case</option></select>
            <select className="control" aria-label="Filter staff specialty" value={staffSpecialty} onChange={e => setStaffSpecialty(e.target.value)}><option value="all">All specialties</option>{staffSpecialties.map(specialty => <option key={specialty}>{specialty}</option>)}</select>
            <select className="control" aria-label="Sort staff" value={staffSort} onChange={e => setStaffSort(e.target.value)}><option value="authorization">Authorization: high to low</option><option value="authorization-low">Authorization: low to high</option><option value="experience">Most experience</option><option value="cases">Most training cases</option><option value="availability">Available first</option><option value="name">Name: A to Z</option></select>
            <span className="staff-result-count">{staffAnalytics.length} of {staff.length}</span>
          </section>
          {staffAnalytics.length === 0 ? <Empty title="No staff match these filters" text="Change the search or filters to see the roster." action={<button className="button secondary small" onClick={() => { setStaffQuery(''); setStaffAvailability('all'); setStaffSpecialty('all'); }}>Clear filters</button>} /> : <div className="staff-analytics-grid">{staffAnalytics.map(person => <section className="panel staff-card" key={person.id}>
            <div className="flex justify-between items-start"><Avatar person={person} size={46} /><Badge dot tone={person.assigned ? 'cyan' : 'green'}>{person.assigned ? 'On a case' : 'Available'}</Badge></div>
            <h2>{person.name}</h2><p>{person.title}</p>
            <div className="staff-location"><MapPin size={13} />{person.location}<span className="mono">{person.modelId}</span></div>
            <div className="staff-card-stats"><div><span>Authorization rate</span><strong className="mono text-emerald-400">{pct(person.authorization)}</strong></div><div><span>{person.model ? 'Training cases' : 'Demo cases'}</span><strong className="mono">{person.completedCases.toLocaleString()}</strong></div></div>
            <div className="staff-card-meta"><span>{person.specialty}</span><span>{person.experience} years</span></div>
            <div className="staff-card-footer"><span>{person.assigned ? person.assigned.case_id : person.model ? `${person.model.boosting_rounds} model rounds` : 'Ready for assignment'}</span><button className="text-button" onClick={() => { if (person.assigned) setSelectedId(person.assigned.case_id); else if (awaiting[0]) setSelectedId(awaiting[0].case_id); else { navigate('Active Cases'); setCaseTab('Needs assignment'); } }}>{person.assigned ? 'View case' : 'Match case'}<ArrowUpRight size={14} /></button></div>
          </section>)}</div>}
        </>}
        {view === 'Training Data Loop' && <><section className="panel learning-hero">
          <div className="learning-summary"><div className="learning-summary-title"><span className="learning-icon"><GitBranch size={20} /></span><div><span className="eyebrow">MODEL LEARNING</span><h2>Outcome pipeline</h2></div></div><p>{apiConnected ? `${apiHealth?.opc_ids.length} OPC models learn from completed outcomes.` : 'Demo estimates update as completed outcomes are logged.'}</p><Badge dot tone={apiConnected ? 'green' : 'muted'}>{apiConnected ? 'XGBOOST CONNECTED' : 'LOCAL DEMO'}</Badge></div>
          <div className="learning-stat"><span>Training cases</span><strong className="mono">{(apiHealth?.training_cases ?? outcomes.length).toLocaleString()}</strong></div>
          <div className="learning-stat"><span>New outcomes</span><strong className="mono text-emerald-400">{feedback.length}</strong></div>
          <div className="learning-stat"><span>Authorization rate</span><strong className="mono">{pct(rate)}</strong></div>
          <button className="button primary learning-action" onClick={openLearningNextStep}><ClipboardList size={15} />{active.some(record => record.opc_id) ? 'Open active case' : 'View case queue'}<ArrowUpRight size={14} /></button>
        </section><section className="panel"><div className="panel-heading"><div><h2>Outcome history <span className="count-pill">{trainingFilter === 'feedback' ? feedback.length : trainingRecords.length}</span></h2></div><div className="flex gap-2"><select aria-label="Outcome history filter" className="control" value={trainingFilter} onChange={e => setTrainingFilter(e.target.value)}><option value="feedback">New feedback</option><option value="all">All history</option></select><button className="button secondary small" onClick={() => { downloadCSV(outcomes.map(o => ({ ...o.case, authorized: o.authorized, consent_obtained: o.consent_obtained, source: o.source, model_before: o.before, model_after: o.after })), 'procurelink-training-outcomes.csv'); notify('Training outcome history exported.'); }}><Download size={14} />Export</button></div></div>{(trainingFilter === 'feedback' ? feedback : trainingRecords).length === 0 ? <Empty title="No outcomes yet" text="Log a completed case to add the first outcome." action={<button className="button primary small" onClick={openLearningNextStep}>Open case queue<ArrowRight size={14} /></button>} /> : <div className="table-scroll"><table className="training-table"><thead><tr><th>CASE</th><th>ASSIGNED STAFF</th><th>OUTCOME</th><th>CONSENT</th><th>ESTIMATE UPDATE</th><th>RECORDED</th><th /></tr></thead><tbody>{(trainingFilter === 'feedback' ? feedback : trainingRecords).slice().reverse().slice(0, 50).map(o => <tr key={o.id}><td className="mono">{o.case.case_id}</td><td><div className="flex items-center gap-2"><Avatar person={getStaff(o.staffId)!} size={27} />{getStaff(o.staffId)!.name}</div></td><td><Badge tone={o.authorized ? 'green' : 'rose'}>{o.authorized ? 'Authorized' : 'Not authorized'}</Badge></td><td>{o.consent_obtained ? 'Obtained' : 'Not obtained'}</td><td className="mono">{o.before !== undefined ? <span className="inline-flex items-center gap-2"><span className="subtle">{pct(o.before)}</span><ArrowRight size={12} /><span className={o.authorized ? 'text-emerald-400' : 'text-amber-400'}>{pct(o.after!)}</span></span> : <span className="subtle">Seed history</span>}</td><td className="subtle">{new Date(o.recordedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td><td><div className="flex items-center gap-3"><button className="text-button" onClick={() => similar(o.case)}>Try similar<ArrowUpRight size={13} /></button>{o.source === 'feedback' && <button className="text-button" aria-label={`Revert ${o.case.case_id} to active`} disabled={Boolean(reopeningCaseId)} onClick={() => void deleteOutcome(o)}><Undo2 size={14} />{reopeningCaseId === o.case.case_id ? 'Reverting…' : 'Revert to active'}</button>}</div></td></tr>)}</tbody></table>{trainingFilter === 'all' && trainingRecords.length > 50 && <p className="table-footer">Showing the 50 most recent records. Export to view all {trainingRecords.length}.</p>}</div>}</section></>}
        
      </main>
    </div>
    {toast && <div className="toast" role="status"><span className="toast-check"><Check size={15} /></span>{toast}<button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={14} /></button></div>}
    {selected && !create && !feedbackCase && <CaseDetailModal record={selected} cases={cases} outcomes={outcomes} onClose={() => setSelectedId(null)} onAssign={assign} onUnassign={unassign} onReopen={selectedOutcome ? () => void deleteOutcome(selectedOutcome) : undefined} reopening={Boolean(reopeningCaseId)} onOutcome={() => { setFeedbackId(selected.case_id); setSelectedId(null); }} onSimilar={() => similar(selected)} apiScores={apiPredictions} apiConnected={apiConnected && Boolean(apiPredictions)} />}
    {create && <CreateCaseModal seed={create.seed} onClose={() => setCreate(null)} onCreate={createCase} />}
    {feedbackCase && <FeedbackModal record={feedbackCase} onClose={() => setFeedbackId(null)} onSubmit={complete} onSimilar={similar} apiConnected={apiConnected} />}
    {helpOpen && <Modal title="About ProcureLink" onClose={() => setHelpOpen(false)}><ModalHeader title="Made for meaningful connections." eyebrow="WELCOME TO PROCURELINK" onClose={() => setHelpOpen(false)} /><div className="modal-body help-content"><p>ProcureLink is an OPO case management workspace for Western Ohio.</p><ol><li><strong>Create a referral.</strong> Enter clinical details and family context.</li><li><strong>Find a match.</strong> Compare the 15 OPC models trained from your CSV and assign a person.</li><li><strong>Close the loop.</strong> Log the completed outcome. The matching OPC’s XGBoost model learns from the case before it is marked complete.</li><li><strong>See what changes.</strong> Open a similar case and compare updated model predictions.</li></ol><div className="info-note"><BrainCircuit size={20} /><span>{apiConnected ? `${apiHealth?.training_cases.toLocaleString()} CSV and API outcomes · ${apiHealth?.opc_ids.length} live OPC models.` : 'The API is offline, so ProcureLink is using its local demo data. Start FastAPI and Vite to enable live predictions and training.'}</span></div><p className="subtle text-xs mt-4">The FastAPI endpoint receives completed cases in memory. Run a single worker; model updates reset when the service restarts.</p></div><div className="modal-footer"><span className="subtle text-xs">ProcureLink · Version 1.0</span><button className="button primary" onClick={() => setHelpOpen(false)}>Let’s connect<ArrowRight size={15} /></button></div></Modal>}
  </div>;
}

function Metric({ label, value, suffix, detail, icon, values, chartId, color, positive, onClick }: { label: string; value: string; suffix?: string; detail: string; icon: React.ReactNode; values: number[]; chartId: string; color?: string; positive?: boolean; onClick?: () => void }) {
  return <div className={`metric-card ${onClick ? 'metric-clickable' : ''}`} onClick={onClick} onKeyDown={e => { if (onClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick(); } }} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}><div className="metric-top"><span>{label}</span><span className="metric-icon">{icon}</span></div><div className="metric-middle"><div className="metric-value mono">{value}<span className={suffix?.includes('/') ? 'metric-denominator' : ''}>{suffix}</span></div><Sparkline values={values} color={color} id={chartId} /></div><div className="metric-detail">{positive ? <span className="text-emerald-400"><ArrowUpRight size={12} /></span> : <span className={`metric-dot ${chartId}`} />}<span>{detail}</span></div></div>;
}
function cumulativeRates(outcomes: Outcome[]) { return [24, 48, 72, 96, 120, 144, 168, outcomes.length].map(n => { const subset = outcomes.slice(0, n); return subset.filter(o => o.authorized).length / subset.length * 100; }); }
