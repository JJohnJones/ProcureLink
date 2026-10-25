"""Per-OPC XGBoost models and FastAPI endpoints.

Run: uvicorn main:app --reload
Updates live in memory; run a single worker to share one model registry.
"""

from contextlib import asynccontextmanager
from functools import lru_cache
import os
import json
import asyncio
import shlex
import hashlib
import time
from collections import OrderedDict, defaultdict
from pathlib import Path
from threading import RLock

from ai4free_bridge import AI4FreeBridge

import pandas as pd
import xgboost as xgb
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder


def _load_local_env() -> None:
    """Load simple KEY=value entries from project .env without overriding exports."""
    env_file = Path(__file__).resolve().with_name(".env")
    if not env_file.is_file():
        return
    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, separator, raw_value = line.partition("=")
        key = key.strip()
        if not separator or not key or key in os.environ:
            continue
        try:
            parts = shlex.split(raw_value, comments=True, posix=True)
            value = " ".join(parts)
        except ValueError:
            value = raw_value.strip().strip("\"'")
        os.environ[key] = value


_load_local_env()
GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-20b")


ai4free_bridge = AI4FreeBridge()


def _ai4free_request(action: str, prompt: str = "") -> dict:
    if not os.environ.get("GROQ_API_KEY", "").strip():
        raise RuntimeError("GROQ_API_KEY is not configured in the FastAPI process.")
    return ai4free_bridge.request({"action": action, "model": GROQ_MODEL, "prompt": prompt})


def _groq_chat(prompt: str) -> str:
    return _ai4free_request("chat", prompt)["content"]


def _groq_failure_reason(error: Exception) -> str:
    """Redact credentials before returning the worker's actual diagnostic."""
    message = str(error) or "AI4Free request timed out. Try again."
    key = os.environ.get("GROQ_API_KEY", "").strip()
    if key:
        message = message.replace(key, "[redacted]")
    return message[:600]


class CaseFeatures(BaseModel):
    model_config = ConfigDict(
        extra="forbid", str_strip_whitespace=True, allow_inf_nan=False
    )

    age: float = Field(ge=0, le=120)
    gender: str = Field(min_length=1)
    race: str = Field(min_length=1)
    brain_death: bool
    cause_of_death_unos: str = Field(min_length=1)
    mechanism_of_death: str = Field(min_length=1)
    circumstances_of_death: str = Field(min_length=1)
    registry_status: str = Field(min_length=1)
    primary_etiology: str = Field(min_length=1)
    donation_pathway: str = Field(min_length=1)
    premature_donation_mention: bool
    multiple_decision_makers: bool
    family_estrangement: bool
    medical_mistrust: bool
    interpreter_utilized: bool
    patient_hemodynamically_unstable: bool
    late_referral_rushing_withdrawal: bool
    family_emotional_state: str = Field(min_length=1)


class CompletedCase(CaseFeatures):
    case_id: str | None = Field(default=None, min_length=1)
    authorized: bool
    consent_obtained: bool | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def consent_requires_authorization(self):
        if self.consent_obtained and not self.authorized:
            raise ValueError(
                "Consent cannot be obtained when the case was not authorized."
            )
        return self


class Prediction(BaseModel):
    opc_id: str
    probability: float


class TrainingResult(BaseModel):
    opc_id: str
    case_index: int
    training_cases: int
    boosting_rounds: int
    probability_before: float
    probability_after: float


class CaseBriefRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    case: CaseFeatures
    opc_id: str = Field(min_length=1)
    staff_name: str = Field(min_length=1)
    staff_location: str = Field(min_length=1)
    staff_specialty: str = Field(min_length=1)
    hospital_name: str = Field(min_length=1)
    hospital_city: str = Field(min_length=1)
    distance_km: float = Field(ge=0, le=1000)
    refresh: bool = False


class GeneratedBrief(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    case_overview: str = Field(min_length=100, max_length=1200)
    approach_context: str = Field(min_length=100, max_length=1200)
    conversation_priorities: list[str] = Field(min_length=2, max_length=4)
    verify_before_approach: list[str] = Field(min_length=1, max_length=3)

    @field_validator("conversation_priorities", "verify_before_approach", mode="before")
    @classmethod
    def clean_handoff_items(cls, value, info):
        if isinstance(value, list) and all(isinstance(item, str) for item in value):
            limit = 4 if info.field_name == "conversation_priorities" else 3
            return [item.strip() for item in value if item.strip()][:limit]
        return value

    @model_validator(mode="after")
    def substantive_brief(self):
        if len((self.case_overview + " " + self.approach_context).split()) < 60:
            raise ValueError("Brief must synthesize the case in at least 60 words.")
        for item in self.conversation_priorities + self.verify_before_approach:
            if not item.strip() or len(item) > 500:
                raise ValueError("Handoff items must be nonempty and concise.")
        return self


class CaseBrief(BaseModel):
    opc_id: str
    probability: float
    case_brief: str
    match_rationale: str
    conversation_priorities: list[str] = Field(default_factory=list)
    verify_before_approach: list[str] = Field(default_factory=list)
    source: str
    source_detail: str | None = None
    cached: bool = False


class OPCModels:
    """Keep a fixed encoder and continue only the requested OPC's booster."""

    def __init__(
        self, data: pd.DataFrame, initial_rounds: int = 100, update_rounds: int = 5
    ):
        if initial_rounds < 1 or update_rounds < 1:
            raise ValueError("Boosting rounds must be positive.")
        self.feature_columns = list(CaseFeatures.model_fields)
        required = self.feature_columns + ["opc_id", "authorized"]
        missing = set(required) - set(data.columns)
        if missing:
            raise ValueError(f"Dataset is missing columns: {sorted(missing)}")
        if data.empty or data[required].isna().any().any():
            raise ValueError("Dataset must contain complete case records.")
        # Parse labels explicitly: bool('False') would incorrectly produce True.
        labels = (
            data.authorized.astype(str)
            .str.lower()
            .map({"true": 1, "false": 0, "1": 1, "0": 0})
        )
        if labels.isna().any():
            raise ValueError("authorized must contain boolean or binary outcomes.")
        self.data = data[required].copy().reset_index(drop=True)
        self.data["authorized"] = labels.astype(int)
        self.data["opc_id"] = self.data.opc_id.astype(str)
        self.base_data = self.data.copy()
        self.initial_rounds = initial_rounds
        self.update_rounds = update_rounds
        self.lock = RLock()
        self.params = {
            "objective": "binary:logistic",
            "eval_metric": "logloss",
            "tree_method": "hist",
            "max_depth": 4,
            "eta": 0.05,
            "base_score": 0.5,
            "seed": 42,
            "nthread": 1,
        }
        self.categorical_columns = [
            name
            for name in self.feature_columns
            if CaseFeatures.model_fields[name].annotation is str
        ]
        numeric = [
            name
            for name in self.feature_columns
            if name not in self.categorical_columns
        ]
        self.encoder = ColumnTransformer(
            [
                (
                    "categorical",
                    OneHotEncoder(handle_unknown="ignore", sparse_output=False),
                    self.categorical_columns,
                ),
                ("numeric", "passthrough", numeric),
            ]
        )
        self.encoder.fit(self._features(self.data))
        self.models: dict[str, xgb.Booster] = {}
        for opc_id, group in self.data.groupby("opc_id", sort=True):
            self.models[opc_id] = xgb.train(
                self.params,
                self._matrix(group, labeled=True),
                num_boost_round=initial_rounds,
            )

    def _features(self, frame: pd.DataFrame) -> pd.DataFrame:
        frame = frame[self.feature_columns].copy()
        frame[self.categorical_columns] = frame[self.categorical_columns].astype(str)
        return frame

    def _matrix(self, frame: pd.DataFrame, *, labeled: bool = False) -> xgb.DMatrix:
        return xgb.DMatrix(
            self.encoder.transform(self._features(frame)),
            label=frame.authorized.to_numpy(dtype=int) if labeled else None,
            nthread=1,
        )

    def output(
        self, row_num: int = -4, *, case: CaseFeatures | None = None
    ) -> list[dict]:
        with self.lock:
            if case is None:
                if not -len(self.data) <= row_num < len(self.data):
                    raise IndexError("Case row is outside the dataset.")
                frame = self.data.iloc[[row_num]]
            else:
                frame = pd.DataFrame([case.model_dump()])
            sample = self._matrix(frame)
            predictions = [
                {"opc_id": opc_id, "probability": float(model.predict(sample)[0])}
                for opc_id, model in self.models.items()
            ]
            return sorted(
                predictions, key=lambda item: (-item["probability"], item["opc_id"])
            )

    def explanation(self, opc_id: str, case: CaseFeatures) -> dict:
        """Return one OPC score and strongest grouped XGBoost contributions."""
        with self.lock:
            if opc_id not in self.models:
                raise KeyError(opc_id)
            frame = pd.DataFrame([case.model_dump()])
            matrix = self._matrix(frame)
            booster = self.models[opc_id]
            probability = float(booster.predict(matrix)[0])
            contributions = booster.predict(matrix, pred_contribs=True)[0][:-1]
            encoded_names = self.encoder.get_feature_names_out()
            grouped: dict[str, float] = defaultdict(float)
            for encoded_name, contribution in zip(encoded_names, contributions):
                name = str(encoded_name).split("__", 1)[-1]
                source = next(
                    (field for field in self.feature_columns if name == field or name.startswith(field + "_")),
                    name,
                )
                grouped[source] += float(contribution)
            factors = sorted(grouped.items(), key=lambda item: abs(item[1]), reverse=True)[:5]
            return {
                "probability": probability,
                "factors": [
                    {"feature": field, "value": case.model_dump().get(field), "contribution": value}
                    for field, value in factors
                ],
            }

    def add_case(self, opc_id: str, case: CompletedCase) -> dict:
        with self.lock:
            if opc_id not in self.models:
                raise KeyError(opc_id)
            row = pd.DataFrame([{**case.model_dump(), "opc_id": opc_id}])
            sample = self._matrix(row)
            current = self.models[opc_id]
            before = float(current.predict(sample)[0])
            history = pd.concat(
                [self.data[self.data.opc_id == opc_id], row], ignore_index=True
            )
            # Replay this OPC's accumulated history while adding trees to its
            # existing booster; fitting only one case would rapidly overfit it.
            updated = xgb.train(
                self.params,
                self._matrix(history, labeled=True),
                num_boost_round=self.update_rounds,
                xgb_model=current,
            )
            after = float(updated.predict(sample)[0])
            case_index = len(self.data)
            next_data = pd.concat([self.data, row], ignore_index=True)
            # Commit only after training and prediction have both succeeded.
            self.data = next_data
            self.models[opc_id] = updated
            return {
                "opc_id": opc_id,
                "case_index": case_index,
                "training_cases": len(history),
                "boosting_rounds": updated.num_boosted_rounds(),
                "probability_before": before,
                "probability_after": after,
            }

    def remove_case(self, opc_id: str, case_id: str) -> dict:
        """Remove one API-submitted outcome and rebuild only its OPC model."""
        with self.lock:
            if opc_id not in self.models:
                raise KeyError(opc_id)
            added_rows = self.data.iloc[len(self.base_data) :]
            if added_rows.empty or "case_id" not in added_rows.columns:
                raise LookupError(case_id)
            matches = added_rows.index[
                (added_rows.opc_id == opc_id) & (added_rows.case_id == case_id)
            ]
            if len(matches) == 0:
                raise LookupError(case_id)
            next_data = self.data.drop(index=matches[0]).reset_index(drop=True)
            history = next_data[next_data.opc_id == opc_id]
            base_count = int((self.base_data.opc_id == opc_id).sum())
            extra_count = len(history) - base_count
            rounds = self.initial_rounds + self.update_rounds * extra_count
            rebuilt = xgb.train(
                self.params, self._matrix(history, labeled=True), num_boost_round=rounds
            )
            self.data = next_data
            self.models[opc_id] = rebuilt
            return {
                "opc_id": opc_id,
                "training_cases": len(history),
                "boosting_rounds": rebuilt.num_boosted_rounds(),
            }


@lru_cache(maxsize=1)
def get_models() -> OPCModels:
    dataset = Path(__file__).with_name("new_data.csv")
    return OPCModels(pd.read_csv(dataset))


def output(
    row_num: int = -4,
    *,
    case: CaseFeatures | dict | None = None,
    models: OPCModels | None = None,
) -> list[dict]:
    """Return authorization probabilities, highest first, for every OPC."""
    if isinstance(case, dict):
        case = CaseFeatures.model_validate(case)
    return (models if models is not None else get_models()).output(row_num, case=case)


def add_case(
    opc_id: str, case: CompletedCase | dict, *, models: OPCModels | None = None
) -> dict:
    """Add a labeled case and continue training the specified OPC's model."""
    if isinstance(case, dict):
        case = CompletedCase.model_validate(case)
    return (models if models is not None else get_models()).add_case(opc_id, case)


def create_app(models: OPCModels | None = None) -> FastAPI:
    brief_cache = OrderedDict()
    brief_pending = {}

    async def generate_brief(prompt, refresh):
        key = hashlib.sha256((GROQ_MODEL + prompt).encode()).hexdigest()
        if not refresh and key in brief_cache:
            expires, generated = brief_cache[key]
            if time.monotonic() < expires:
                brief_cache.move_to_end(key)
                return generated, True
            del brief_cache[key]

        async def produce():
            try:
                raw = await asyncio.wait_for(asyncio.to_thread(_groq_chat, prompt), timeout=30)
                if raw.startswith("```"):
                    raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
                generated = GeneratedBrief.model_validate_json(raw).model_dump()
                brief_cache[key] = (time.monotonic() + 600, generated)
                brief_cache.move_to_end(key)
                while len(brief_cache) > 64:
                    brief_cache.popitem(last=False)
                return generated
            finally:
                brief_pending.pop(key, None)

        if key not in brief_pending:
            brief_pending[key] = asyncio.create_task(produce())
        return await asyncio.shield(brief_pending[key]), False

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        application.state.models = models if models is not None else get_models()
        if models is None and os.environ.get("GROQ_API_KEY", "").strip():
            try:
                await asyncio.to_thread(_ai4free_request, "warm")
            except Exception:
                pass  # Prediction remains available if the optional LLM cannot start.
        try:
            yield
        finally:
            for task in list(brief_pending.values()):
                task.cancel()
            await asyncio.gather(*list(brief_pending.values()), return_exceptions=True)
            await asyncio.to_thread(ai4free_bridge.close)

    api = FastAPI(title="OPC Authorization Models", version="1.0.0", lifespan=lifespan)
    configured_origins = [
        origin.strip()
        for origin in os.environ.get(
            "OPC_API_ALLOW_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(",")
        if origin.strip()
    ]
    api.add_middleware(
        CORSMiddleware,
        allow_origins=configured_origins,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Accept", "Content-Type"],
    )

    def model_registry() -> OPCModels:
        return api.state.models

    @api.get("/health")
    def health(registry: OPCModels = Depends(model_registry)):
        """Return model readiness and aggregate counts; never return case rows."""
        models = []
        for opc_id, booster in sorted(registry.models.items()):
            history = registry.data[registry.data.opc_id == opc_id]
            models.append(
                {
                    "opc_id": opc_id,
                    "training_cases": len(history),
                    "authorization_rate": float(history.authorized.mean()),
                    "boosting_rounds": booster.num_boosted_rounds(),
                }
            )
        return {
            "status": "ok",
            "groq_key_configured": bool(os.environ.get("GROQ_API_KEY", "").strip()),
            "training_cases": len(registry.data),
            "authorization_rate": float(registry.data.authorized.mean()),
            "opc_ids": sorted(registry.models),
            "boosting_rounds": max(
                model.num_boosted_rounds() for model in registry.models.values()
            ),
            "models": models,
        }

    @api.get("/groq/status")
    def groq_status():
        """Check the same AI4Free worker and key used for brief generation."""
        configured = bool(os.environ.get("GROQ_API_KEY", "").strip())
        try:
            result = _ai4free_request("status")
            return {"configured": configured, "model": GROQ_MODEL, "transport": "ai4free",
                    "accessible": True, "detail": result["detail"]}
        except Exception as error:
            return {"configured": configured, "model": GROQ_MODEL, "transport": "ai4free",
                    "accessible": False, "detail": _groq_failure_reason(error)}

    @api.get("/output", response_model=list[Prediction])
    def output_row(
        row_num: int = Query(default=-4), registry: OPCModels = Depends(model_registry)
    ):
        """Rank all OPCs for a dataset row; negative indices are supported."""
        try:
            return output(row_num, models=registry)
        except IndexError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error

    @api.post("/output", response_model=list[Prediction])
    def output_case(case: CaseFeatures, registry: OPCModels = Depends(model_registry)):
        """Rank all OPCs for a submitted case without adding it to training."""
        return output(case=case, models=registry)

    @api.post("/cases/brief", response_model=CaseBrief)
    async def case_brief(request: CaseBriefRequest, registry: OPCModels = Depends(model_registry)):
        """Create an on-demand narrative brief for demo-only case data."""
        try:
            explanation = registry.explanation(request.opc_id, request.case)
        except KeyError as error:
            raise HTTPException(status_code=404, detail=f"Unknown OPC ID: {request.opc_id}") from error

        case = request.case
        documented_concerns = [description for field, description in [
            ("premature_donation_mention", "Donation was mentioned prematurely; clarify what was already discussed. This is about conversation timing, not the timing of death."),
            ("multiple_decision_makers", "Multiple decision makers are flagged."),
            ("family_estrangement", "Family estrangement is flagged."),
            ("medical_mistrust", "Medical mistrust is flagged."),
            ("patient_hemodynamically_unstable", "Hemodynamic instability is flagged; discussion timing requires coordination with the treating team."),
            ("late_referral_rushing_withdrawal", "Late referral or rushed withdrawal timing is flagged; coordinate with the treating team."),
        ] if getattr(case, field)]
        case_data = {
            "age_years": case.age,
            "brain_death_record": "marked confirmed" if case.brain_death else "not marked confirmed",
            "coded_cause_of_death": case.cause_of_death_unos,
            "mechanism_recorded": case.mechanism_of_death,
            "circumstances_recorded": case.circumstances_of_death,
            "primary_etiology_recorded": case.primary_etiology,
            "donation_pathway_recorded": case.donation_pathway,
            "registry_status_recorded": case.registry_status,
            "family_emotional_state_recorded": case.family_emotional_state,
            "documented_concerns": documented_concerns,
            "interpreter_record": "use is recorded; preferred language is unknown" if case.interpreter_utilized else "no use is recorded; language needs are unknown",
        }
        factors = explanation["factors"][:3]
        factor_text = "; ".join(
            f"{factor['feature'].replace('_', ' ')} is associated with a {('higher' if factor['contribution'] >= 0 else 'lower')} estimate"
            for factor in factors
        ) or "no feature contributions were available"
        rationale = (
            f"XGBoost estimates {explanation['probability']:.1%} authorization for {request.staff_name} with this fictional case. "
            f"The strongest model associations are: {factor_text}. "
            f"Staff are {request.distance_km:.1f} km from {request.hospital_name} in a straight line; this is not a driving-time estimate. "
            "Model associations are not causes, staff qualifications, or evidence of family consent."
        )
        prompt = (
            "Prepare a practical handoff for an OPO coordinator using only the fictional record below. "
            "Synthesize how the documented circumstances affect preparation for a family conversation; do not just list fields. "
            "Return JSON with exactly four keys: "
            "case_overview: a 40-60 word paragraph summarizing the referral and the most relevant documented concerns; "
            "approach_context: a separate 50-80 word paragraph explaining how those concerns shape preparation and what is still unknown; "
            "conversation_priorities: 2-4 concrete, case-specific discussion priorities, each tied to a recorded fact; "
            "verify_before_approach: 1-3 important unknowns or coordination checks, explicitly phrased as things to confirm; "

            "For mistrust, suggest inviting specific concerns and checking understanding. For multiple decision makers, suggest clarifying "
            "who should participate and aligning information. For instability or rushed timing, suggest coordination with the treating team. "
            "Make these preparation suggestions conditional, not claims about what the family thinks or what staff have already done. "
            "Only listed concerns are documented. An absent concern does not prove its opposite. Interpreter use does not establish language needs. "
            "Do not infer that coded death fields establish that death, testing, or recovery procedures have already occurred. "
            "Unknown checks must be open questions, such as 'Confirm what has already been discussed', never 'Confirm the family has not been told'. "
            "Do not speculate about motives, beliefs, willingness, or decision authority. Frame unknowns as questions for the team or family. "
            "Registry status is a recorded fact; do not propose changing it or infer what it legally permits. "
            "Do not discuss distance, logistics, prognosis, or model predictions in these paragraphs; the application supplies that separately. "
            "Never infer readiness, preferences, or behavior from race, age, or gender. Do not invent dialogue, staff qualifications, clinical "
            "prognosis, legal authority, treatment recommendations, or consent. Do not recommend pressure or a strategy to obtain authorization. "
            "Separate recorded facts from suggestions and unknowns. Use plain language and do not include reasoning steps.\nINPUT JSON:\n"
            + json.dumps({
                "case": case_data,
                "hospital": {"name": request.hospital_name, "city": request.hospital_city},
                "staff_name": request.staff_name,
                "model_snapshot_version": hashlib.sha256(json.dumps(explanation, sort_keys=True).encode()).hexdigest(),
            }, ensure_ascii=False)
        )
        source = "groq"
        source_detail = None
        cached = False
        conversation_priorities = []
        verify_before_approach = []
        try:
            generated, cached = await generate_brief(prompt, request.refresh)
            brief = generated["case_overview"] + "\n\n" + generated["approach_context"]
            conversation_priorities = generated["conversation_priorities"]
            verify_before_approach = generated["verify_before_approach"]
        except ValueError:
            source = "local_fallback"
            source_detail = "Groq returned an incomplete handoff. Try Refresh brief."
        except Exception as error:
            source = "local_fallback"
            source_detail = _groq_failure_reason(error)
        if source == "local_fallback":
            # Keep the workflow usable, while identifying non-LLM output.
            case = request.case
            registry_text = "registered donor" if case.registry_status.lower() in {"true", "yes", "registered donor", "first person consent / registered"} else "not registered"
            brief = (
                f"{case.age:g}-year-old {case.gender} referral at {request.hospital_name} in {request.hospital_city}. "
                f"Primary etiology: {case.primary_etiology}; cause of death: {case.cause_of_death_unos}. "
                f"Donation pathway: {case.donation_pathway}; registry status: {registry_text}. "
                f"Family emotional state is recorded as {case.family_emotional_state}."
            )
            brief += (
                "\n\nBefore starting a discussion, check what the family has already been told and what questions they want addressed. "
                "The record does not establish their understanding or readiness for a conversation. Use the documented concerns below "
                "to prepare with the bedside team, and confirm missing details rather than assuming them."
            )
            conversation_priorities = [
                f"Family emotional state is recorded as {case.family_emotional_state}. Ask what the family understands and whether they want further information now."
            ]
            for flag, priority in [
                (case.medical_mistrust, "Medical mistrust is flagged. Invite specific concerns and check understanding before introducing more information."),
                (case.multiple_decision_makers, "Multiple decision makers are flagged. Confirm who should participate and what information each person has received."),
                (case.family_estrangement, "Family estrangement is flagged. Coordinate appropriate contacts with the bedside team before arranging a joint discussion."),
                (case.premature_donation_mention, "Premature donation mention is flagged. Confirm what was previously said and address resulting questions without assuming consent."),
            ]:
                if flag:
                    conversation_priorities.append(priority)
            if len(conversation_priorities) == 1:
                conversation_priorities.append("Use the recorded donation pathway and registry status to prepare an explanation, then confirm the family's questions rather than assuming understanding.")
            conversation_priorities = conversation_priorities[:4]
            verify_before_approach = [
                "Confirm preferred language and whether interpreter support is needed; the utilization field alone does not establish language needs.",
                "Confirm who will be present and what has already been communicated by the treating team.",
            ]
            if case.patient_hemodynamically_unstable or case.late_referral_rushing_withdrawal:
                verify_before_approach.insert(0, "Instability or rushed withdrawal timing is flagged. Coordinate an appropriate discussion time with the treating team.")
        return {"opc_id": request.opc_id, "probability": explanation["probability"],
                "case_brief": brief, "match_rationale": rationale, "source": source,
                "conversation_priorities": conversation_priorities,
                "verify_before_approach": verify_before_approach,
                "source_detail": source_detail, "cached": cached}

    @api.post("/opcs/{opc_id}/cases", response_model=TrainingResult, status_code=201)
    def train_case(
        opc_id: str, case: CompletedCase, registry: OPCModels = Depends(model_registry)
    ):
        """Append a completed case and continue only this OPC's model."""
        try:
            return add_case(opc_id, case, models=registry)
        except KeyError as error:
            raise HTTPException(
                status_code=404, detail=f"Unknown OPC ID: {opc_id}"
            ) from error

    @api.delete("/opcs/{opc_id}/cases/{case_id}")
    def remove_case(
        opc_id: str, case_id: str, registry: OPCModels = Depends(model_registry)
    ):
        """Delete a submitted outcome and rebuild that OPC from retained cases."""
        try:
            return registry.remove_case(opc_id, case_id)
        except KeyError as error:
            raise HTTPException(
                status_code=404, detail=f"Unknown OPC ID: {opc_id}"
            ) from error
        except LookupError as error:
            raise HTTPException(
                status_code=404, detail=f"No submitted case found: {case_id}"
            ) from error

    return api


app = create_app()
