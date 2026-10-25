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
import subprocess
from collections import defaultdict
from pathlib import Path
from threading import RLock

import pandas as pd
import xgboost as xgb
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, model_validator
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


def _ai4free_request(action: str, prompt: str = "") -> dict:
    """Run the legacy AI4Free dependency in its separate Python environment."""
    if not os.environ.get("GROQ_API_KEY", "").strip():
        raise RuntimeError("GROQ_API_KEY is not configured in the FastAPI process.")
    root = Path(__file__).resolve().parent
    python = Path(os.environ.get("AI4FREE_PYTHON", str(root / ".venv-ai4free/bin/python")))
    if not python.is_file():
        raise RuntimeError("AI4Free environment is missing. Install requirements-ai4free.txt into .venv-ai4free.")
    try:
        result = subprocess.run(
            [str(python), str(root / "ai4free_worker.py")],
            input=json.dumps({"action": action, "model": GROQ_MODEL, "prompt": prompt}),
            capture_output=True, text=True, timeout=28, check=False,
        )
    except subprocess.TimeoutExpired as error:
        raise RuntimeError("AI4Free request timed out. Try again.") from error
    try:
        payload = json.loads(result.stdout)
    except (ValueError, TypeError) as error:
        raise RuntimeError("AI4Free worker failed to start or returned invalid output. Check its environment.") from error
    if result.returncode or not payload.get("ok"):
        raise RuntimeError(payload.get("error", "AI4Free worker failed."))
    return payload


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


class CaseBrief(BaseModel):
    opc_id: str
    probability: float
    case_brief: str
    match_rationale: str
    source: str
    source_detail: str | None = None


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
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        application.state.models = models if models is not None else get_models()
        yield

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

        case_data = request.case.model_dump()
        prompt = (
            "Write a concise handoff brief for an OPO coordinator and a separate short explanation of the selected staff match. "
            "Use only facts in the supplied JSON. Do not infer missing clinical or family facts, recommend authorization, "
            "or present model associations as causes. The match explanation must describe the supplied XGBoost probability, "
            "the strongest supplied feature contributions, and straight-line distance; do not invent staff qualifications. "
            "Return only a JSON object with string keys case_brief and match_rationale. Keep the case brief under 90 words "
            "and the rationale under 45 words.\n\nINPUT JSON:\n"
            + json.dumps({
                "case": case_data,
                "hospital": {"name": request.hospital_name, "city": request.hospital_city},
                "staff": {"name": request.staff_name, "location": request.staff_location, "specialty": request.staff_specialty},
                "xgboost_match": {"authorization_probability": explanation["probability"], "top_feature_contributions": explanation["factors"]},
                "straight_line_distance_km": request.distance_km,
            }, ensure_ascii=False)
        )
        source = "groq"
        source_detail = None
        try:
            raw = await asyncio.wait_for(asyncio.to_thread(_groq_chat, prompt), timeout=30)
        except Exception as error:
            source = "local_fallback"
            source_detail = _groq_failure_reason(error)
        if source == "groq":
            try:
                # Some providers wrap otherwise valid JSON in a Markdown code fence.
                if raw.startswith("```"):
                    raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
                parsed = json.loads(raw)
                brief = str(parsed["case_brief"]).strip()
                rationale = str(parsed["match_rationale"]).strip()
                if not brief or not rationale or len(brief) > 1200 or len(rationale) > 600:
                    raise ValueError("Response fields are empty or too long.")
            except (json.JSONDecodeError, KeyError, TypeError, ValueError):
                source = "local_fallback"
                source_detail = "Groq responded, but its brief was not valid JSON. Try again."
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
            factors = explanation["factors"][:3]
            factor_text = "; ".join(
                f"{factor['feature'].replace('_', ' ')} is associated with a {('higher' if factor['contribution'] >= 0 else 'lower')} estimate"
                for factor in factors
            ) or "no feature contributions were available"
            rationale = (
                f"The model estimates {explanation['probability']:.1%} for {request.staff_name}. "
                f"The strongest case associations are: {factor_text}. "
                f"Straight-line distance is {request.distance_km:.1f} km. These are model associations, not causes."
            )
        return {"opc_id": request.opc_id, "probability": explanation["probability"],
                "case_brief": brief, "match_rationale": rationale, "source": source,
                "source_detail": source_detail}

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
