import type { CaseRecord, Staff } from "./types";

const configuredApiOrigin = import.meta.env.VITE_API_BASE_URL?.trim().replace(
  /\/$/,
  "",
);
const apiRoot = configuredApiOrigin || "/api";

export interface ApiHealth {
  status: "ok";
  training_cases: number;
  authorization_rate: number;
  opc_ids: string[];
  boosting_rounds: number;
  models: {
    opc_id: string;
    training_cases: number;
    authorization_rate: number;
    boosting_rounds: number;
  }[];
}

export interface ApiPrediction {
  opc_id: string;
  probability: number;
}

export interface ApiTrainingResult {
  opc_id: string;
  case_index: number;
  training_cases: number;
  boosting_rounds: number;
  probability_before: number;
  probability_after: number;
}

export interface ApiDeleteResult {
  opc_id: string;
  training_cases: number;
  boosting_rounds: number;
}

export interface ApiCaseBrief {
  opc_id: string;
  probability: number;
  case_brief: string;
  match_rationale: string;
  source: "groq" | "local_fallback";
  source_detail: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiRoot}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error(
      "Cannot reach the FastAPI service. Start it on port 8000 and try again.",
    );
  }
  if (!response.ok) {
    let detail =
      response.status === 500
        ? "FastAPI encountered an internal error. Check the API terminal for its traceback."
        : `FastAPI returned HTTP ${response.status}.`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      /* The status line is enough when the server has no JSON body. */
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

const causeAliases: Record<string, string> = {
  "CVA / Stroke": "CVA/Stroke",
  "Head trauma": "Head Trauma",
};
const etiologyAliases: Record<string, string> = {
  "Anoxic brain injury": "Anoxia",
  "Intracerebral hemorrhage": "ICB / ICH",
  "Traumatic brain injury": "Head Trauma",
};
const mechanismAliases: Record<string, string> = {
  "Blunt injury": "Blunt Injury",
  "Drug intoxication": "Drug / Intoxication",
};
const circumstancesAliases: Record<string, string> = {
  "Natural causes": "Natural Causes",
  "Motor vehicle accident": "Motor Vehicle Accident",
};
const familyAliases: Record<string, string> = {
  "Accepting / Grieving": "Accepting",
  "Shutdown / Stoic": "Numb / Shocked",
  "Angered / Defensive": "Hostile",
  "Uncertain / Processing": "Ambivalent",
};

function apiCase(record: CaseRecord) {
  const cause =
    causeAliases[record.cause_of_death_unos] || record.cause_of_death_unos;
  const race: Record<string, string> = {
    White: "White / Caucasian",
    Black: "Black / African American",
    "Hispanic / Latino": "Hispanic",
  };
  return {
    age: record.age,
    gender:
      record.gender === "Male"
        ? "M"
        : record.gender === "Female"
          ? "F"
          : "Other / Unknown",
    race: race[record.race] || "Other / Unknown",
    brain_death: record.brain_death,
    cause_of_death_unos: cause,
    mechanism_of_death:
      mechanismAliases[record.mechanism_of_death] || record.mechanism_of_death,
    circumstances_of_death:
      circumstancesAliases[record.circumstances_of_death] ||
      record.circumstances_of_death,
    registry_status: record.registry_status
      ? "First Person Consent / Registered"
      : "Not Registered",
    primary_etiology:
      etiologyAliases[record.primary_etiology] || record.primary_etiology,
    donation_pathway: record.donation_pathway,
    premature_donation_mention: record.premature_donation_mention,
    multiple_decision_makers: record.multiple_decision_makers,
    family_estrangement: record.family_estrangement,
    medical_mistrust: record.medical_mistrust,
    interpreter_utilized: record.interpreter_utilized,
    patient_hemodynamically_unstable: record.patient_hemodynamically_unstable,
    late_referral_rushing_withdrawal: record.late_referral_rushing_withdrawal,
    family_emotional_state:
      familyAliases[record.family_emotional_state] ||
      record.family_emotional_state,
  };
}

export const api = {
  health: () => request<ApiHealth>("/health"),

  predict: (record: CaseRecord) =>
    request<ApiPrediction[]>("/output", {
      method: "POST",
      body: JSON.stringify(apiCase(record)),
    }),

  caseBrief: (
    record: CaseRecord,
    person: Staff,
    hospital: { name: string; city: string },
    distance_km: number,
  ) =>
    request<ApiCaseBrief>("/cases/brief", {
      method: "POST",
      body: JSON.stringify({
        case: apiCase(record),
        opc_id: person.modelId,
        staff_name: person.name,
        staff_location: person.location,
        staff_specialty: person.specialty,
        hospital_name: hospital.name,
        hospital_city: hospital.city,
        distance_km,
      }),
    }),

  trainOutcome: (
    record: CaseRecord,
    person: Staff,
    authorized: boolean,
    consent: boolean,
    notes: string,
  ) => {
    if (!person.modelId)
      throw new Error(`${person.name} has no API model mapping.`);
    return request<ApiTrainingResult>(
      `/opcs/${encodeURIComponent(person.modelId)}/cases`,
      {
        method: "POST",
        body: JSON.stringify({
          ...apiCase(record),
          case_id: record.case_id,
          authorized,
          consent_obtained: consent,
          notes: notes || null,
        }),
      },
    );
  },

  deleteOutcome: (person: Staff, caseId: string) => {
    if (!person.modelId)
      throw new Error(`${person.name} has no API model mapping.`);
    return request<ApiDeleteResult>(
      `/opcs/${encodeURIComponent(person.modelId)}/cases/${encodeURIComponent(caseId)}`,
      { method: "DELETE" },
    );
  },
};

export function mapApiPredictions(
  predictions: ApiPrediction[],
): Record<string, number> {
  return Object.fromEntries(
    predictions.map((prediction) => [
      prediction.opc_id,
      prediction.probability,
    ]),
  );
}
