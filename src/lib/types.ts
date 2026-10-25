export type Emotion = 'Accepting / Grieving' | 'Shutdown / Stoic' | 'Angered / Defensive' | 'Uncertain / Processing';
export type CaseStatus = 'Needs assignment' | 'Staff assigned' | 'Authorized' | 'Not authorized';
export type View = 'Dashboard' | 'Active Cases' | 'Map View' | 'Staff Analytics' | 'Training Data Loop';
export interface CaseRecord {
  case_id: string;
  age: number;
  gender: string;
  race: string;
  brain_death: boolean;
  cause_of_death_unos: string;
  mechanism_of_death: string;
  circumstances_of_death: string;
  registry_status: boolean;
  primary_etiology: string;
  donation_pathway: string;
  premature_donation_mention: boolean;
  multiple_decision_makers: boolean;
  family_estrangement: boolean;
  medical_mistrust: boolean;
  interpreter_utilized: boolean;
  patient_hemodynamically_unstable: boolean;
  late_referral_rushing_withdrawal: boolean;
  family_emotional_state: Emotion;
  hospital_id: string;
  opc_id: string | null;
  authorized: boolean | null;
  consent_obtained: boolean | null;
  status: CaseStatus;
  created_at: string;
  completed_at?: string;
  notes?: string;
}
export interface Staff {
  id: string;
  modelId: string;
  name: string;
  gender: 'Female' | 'Male';
  title: string;
  location: string;
  coordinates: [number, number];
  specialty: string;
  experience: number;
  image: string;
  color: string;
}
export interface Hospital {
  id: string;
  name: string;
  short: string;
  city: string;
  coordinates: [number, number];
}
export interface Outcome {
  id: string;
  case: CaseRecord;
  staffId: string;
  authorized: boolean;
  consent_obtained: boolean;
  recordedAt: string;
  source: 'seed' | 'feedback';
  before?: number;
  after?: number;
}
export interface AppState {
  version: 1;
  cases: CaseRecord[];
  outcomes: Outcome[];
}
