import type { AppState, CaseRecord, Emotion, Hospital, Outcome, Staff } from './types';

export const hospitals: Hospital[] = [
  { id: 'mvh', name: 'Miami Valley Hospital', short: 'Miami Valley', city: 'Dayton', coordinates: [-84.1838, 39.7453] },
  { id: 'toledo', name: 'ProMedica Toledo Hospital', short: 'ProMedica Toledo', city: 'Toledo', coordinates: [-83.5957, 41.6735] },
  { id: 'lima', name: 'Lima Memorial Hospital', short: 'Lima Memorial', city: 'Lima', coordinates: [-84.085, 40.7278] },
  { id: 'rita', name: 'Mercy Health – St. Rita’s', short: 'St. Rita’s Medical', city: 'Lima', coordinates: [-84.1187, 40.7376] },
  { id: 'kettering', name: 'Kettering Health Main Campus', short: 'Kettering Health', city: 'Kettering', coordinates: [-84.1916, 39.696] },
  { id: 'blanchard', name: 'Blanchard Valley Hospital', short: 'Blanchard Valley', city: 'Findlay', coordinates: [-83.6499, 41.0216] },
];
export const staff: Staff[] = [
  { id: 'OPC-101', modelId: 'OPC_01', name: 'Sarah Mitchell', gender: 'Female', title: 'Senior donation specialist', location: 'Dayton, OH', coordinates: [-84.23, 39.82], specialty: 'Anoxia', experience: 8, image: 'https://randomuser.me/api/portraits/women/45.jpg', color: '#70b8aa' },
  { id: 'OPC-102', modelId: 'OPC_02', name: 'James Carter', gender: 'Male', title: 'Family support specialist', location: 'Lima, OH', coordinates: [-84.17, 40.78], specialty: 'CVA / Stroke', experience: 6, image: 'https://randomuser.me/api/portraits/men/32.jpg', color: '#91aeca' },
  { id: 'OPC-103', modelId: 'OPC_03', name: 'Emily Chen', gender: 'Female', title: 'Senior donation specialist', location: 'Toledo, OH', coordinates: [-83.67, 41.61], specialty: 'Head trauma', experience: 9, image: 'https://randomuser.me/api/portraits/women/68.jpg', color: '#c4a68c' },
  { id: 'OPC-104', modelId: 'OPC_04', name: 'Michael Brooks', gender: 'Male', title: 'Donation specialist', location: 'Findlay, OH', coordinates: [-83.71, 41.08], specialty: 'Anoxia', experience: 5, image: 'https://randomuser.me/api/portraits/men/75.jpg', color: '#9bada1' },
  { id: 'OPC-105', modelId: 'OPC_05', name: 'Olivia Bennett', gender: 'Female', title: 'Family support specialist', location: 'Dayton, OH', coordinates: [-84.14, 39.9], specialty: 'CVA / Stroke', experience: 7, image: 'https://randomuser.me/api/portraits/women/25.jpg', color: '#b5a1c0' },
  { id: 'OPC-106', modelId: 'OPC_06', name: 'Daniel Rivera', gender: 'Male', title: 'Donation specialist', location: 'Bowling Green, OH', coordinates: [-83.65, 41.37], specialty: 'Head trauma', experience: 4, image: 'https://randomuser.me/api/portraits/men/23.jpg', color: '#a7b799' },
  { id: 'OPC-107', modelId: 'OPC_07', name: 'Alex Morgan', gender: 'Female', title: 'Senior donation specialist', location: 'Troy, OH', coordinates: [-84.2, 40.04], specialty: 'Anoxia', experience: 11, image: 'https://randomuser.me/api/portraits/women/89.jpg', color: '#b8a68c' },
  { id: 'OPC-108', modelId: 'OPC_08', name: 'Jordan Ellis', gender: 'Male', title: 'Family support specialist', location: 'Perrysburg, OH', coordinates: [-83.63, 41.55], specialty: 'CVA / Stroke', experience: 6, image: 'https://randomuser.me/api/portraits/men/10.jpg', color: '#83a8b8' },
  { id: 'OPC-109', modelId: 'OPC_09', name: 'Ava Foster', gender: 'Female', title: 'Donation specialist', location: 'Dayton, OH', coordinates: [-84.3, 39.72], specialty: 'Anoxia', experience: 4, image: 'https://randomuser.me/api/portraits/women/54.jpg', color: '#c8ae88' },
  { id: 'OPC-110', modelId: 'OPC_10', name: 'Noah Patel', gender: 'Male', title: 'Family support specialist', location: 'Lima, OH', coordinates: [-84.0, 40.68], specialty: 'CVA / Stroke', experience: 7, image: 'https://randomuser.me/api/portraits/men/61.jpg', color: '#86b5ac' },
  { id: 'OPC-111', modelId: 'OPC_11', name: 'Grace Walker', gender: 'Female', title: 'Donation specialist', location: 'Toledo, OH', coordinates: [-83.78, 41.78], specialty: 'Head trauma', experience: 5, image: 'https://randomuser.me/api/portraits/women/72.jpg', color: '#b59aac' },
  { id: 'OPC-112', modelId: 'OPC_12', name: 'Ethan Hayes', gender: 'Male', title: 'Senior donation specialist', location: 'Findlay, OH', coordinates: [-83.55, 41.13], specialty: 'Anoxia', experience: 10, image: 'https://randomuser.me/api/portraits/men/17.jpg', color: '#93aebe' },
  { id: 'OPC-113', modelId: 'OPC_13', name: 'Mia Thompson', gender: 'Female', title: 'Family support specialist', location: 'Troy, OH', coordinates: [-84.05, 40.12], specialty: 'CVA / Stroke', experience: 6, image: 'https://randomuser.me/api/portraits/women/31.jpg', color: '#c39a86' },
  { id: 'OPC-114', modelId: 'OPC_14', name: 'Lucas Nguyen', gender: 'Male', title: 'Donation specialist', location: 'Bowling Green, OH', coordinates: [-83.77, 41.28], specialty: 'Head trauma', experience: 3, image: 'https://randomuser.me/api/portraits/men/80.jpg', color: '#88b19a' },
  { id: 'OPC-115', modelId: 'OPC_15', name: 'Sofia Reed', gender: 'Female', title: 'Senior donation specialist', location: 'Perrysburg, OH', coordinates: [-83.5, 41.47], specialty: 'Anoxia', experience: 9, image: 'https://randomuser.me/api/portraits/women/12.jpg', color: '#a99bc4' },
];
export const emotions: Emotion[] = ['Accepting / Grieving', 'Shutdown / Stoic', 'Angered / Defensive', 'Uncertain / Processing'];
export const causes = ['Anoxia', 'CVA / Stroke', 'Head trauma', 'Other'];
export const flags: { key: keyof CaseRecord; label: string }[] = [
  { key: 'premature_donation_mention', label: 'Premature donation mention' },
  { key: 'multiple_decision_makers', label: 'Multiple decision makers' },
  { key: 'family_estrangement', label: 'Family estrangement' },
  { key: 'medical_mistrust', label: 'Medical mistrust' },
  { key: 'interpreter_utilized', label: 'Interpreter utilized' },
  { key: 'patient_hemodynamically_unstable', label: 'Hemodynamically unstable' },
  { key: 'late_referral_rushing_withdrawal', label: 'Late referral / rushed withdrawal' },
];
export function blankCase(): Omit<CaseRecord, 'case_id' | 'created_at'> {
  return { age: 45, gender: 'Male', race: 'White', brain_death: true,
    cause_of_death_unos: 'Anoxia', mechanism_of_death: 'Cardiovascular', circumstances_of_death: 'Natural causes',
    registry_status: false, primary_etiology: 'Anoxic brain injury', donation_pathway: 'DBD',
    premature_donation_mention: false, multiple_decision_makers: false, family_estrangement: false,
    medical_mistrust: false, interpreter_utilized: false, patient_hemodynamically_unstable: false,
    late_referral_rushing_withdrawal: false, family_emotional_state: 'Uncertain / Processing',
    hospital_id: 'mvh', opc_id: null, authorized: null, consent_obtained: null, status: 'Needs assignment' };
}

export function createInitialState(): AppState {
  const now = Date.now();
  const specs: [number, string, string, string, number, number, boolean][] = [
    [42, 'Male', 'White', 'mvh', 0, 1, true], [58, 'Female', 'Black', 'toledo', 1, 0, false],
    [29, 'Male', 'White', 'lima', 2, 2, false], [64, 'Female', 'White', 'kettering', 1, 0, true],
    [36, 'Male', 'Hispanic / Latino', 'mvh', 0, 3, false], [51, 'Female', 'White', 'rita', 0, 1, true],
    [23, 'Male', 'Black', 'toledo', 2, 2, false], [47, 'Female', 'Asian', 'blanchard', 1, 3, true],
    [62, 'Male', 'White', 'mvh', 0, 0, true], [39, 'Female', 'White', 'lima', 2, 1, false],
    [55, 'Male', 'Black', 'toledo', 1, 0, true], [33, 'Female', 'White', 'kettering', 0, 3, false],
  ];
  const cases: CaseRecord[] = specs.map(([age, gender, race, hospital_id, c, e, registry_status], i) => ({
    ...blankCase(), case_id: `OH-${String(2026 + i).padStart(4, '0')}`, age, gender, race, hospital_id,
    cause_of_death_unos: causes[c], primary_etiology: ['Anoxic brain injury', 'Intracerebral hemorrhage', 'Traumatic brain injury'][c],
    mechanism_of_death: c === 2 ? 'Blunt injury' : 'Cardiovascular', circumstances_of_death: c === 2 ? 'Motor vehicle accident' : 'Natural causes',
    family_emotional_state: emotions[e], registry_status, brain_death: i % 3 !== 0, donation_pathway: i % 3 === 0 ? 'DCD' : 'DBD',
    multiple_decision_makers: i % 3 === 0, medical_mistrust: e === 2,
    created_at: new Date(now - (i * 23 + 8) * 60000).toISOString(),
    status: [3, 6, 9].includes(i) ? 'Staff assigned' : 'Needs assignment',
    opc_id: i === 3 ? 'OPC-105' : i === 6 ? 'OPC-103' : i === 9 ? 'OPC-102' : null,
  }));
  // Entirely fictional, reproducible training history. No source CSV is shipped to the browser.
  let seed = 2026;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const outcomes: Outcome[] = staff.flatMap(person => Array.from({ length: 24 }, (_, i) => {
    const source = cases[Math.floor(random() * cases.length)];
    const success = random() < .67 + (source.cause_of_death_unos === person.specialty ? .17 : 0);
    const recordedAt = new Date(now - (24 - i) * 86400000).toISOString();
    const record: CaseRecord = { ...source, case_id: `HIST-${person.id}-${i + 1}`, opc_id: person.id,
      created_at: recordedAt, completed_at: recordedAt, authorized: success, consent_obtained: success,
      status: success ? 'Authorized' : 'Not authorized' };
    return { id: `seed-${person.id}-${i}`, case: record, staffId: person.id, authorized: success,
      consent_obtained: success, recordedAt, source: 'seed' };
  }));
  return { version: 1, cases, outcomes };
}

export const getHospital = (id: string) => hospitals.find(h => h.id === id)!;
export const getStaff = (id: string | null) => staff.find(s => s.id === id);
export const isActive = (c: CaseRecord) => c.status === 'Needs assignment' || c.status === 'Staff assigned';
