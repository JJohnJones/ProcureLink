import pandas as pd
import pytest
import json
from fastapi.testclient import TestClient

import main


def test_ai4free_request_passes_prompt_without_credentials(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-key-never-in-payload")
    calls = []

    def worker(payload):
        calls.append(payload)
        return {"ok": True, "content": "brief"}

    monkeypatch.setattr(main.ai4free_bridge, "request", worker)
    assert main._groq_chat("fictional case") == "brief"
    assert calls[0]["action"] == "chat"
    assert calls[0]["prompt"] == "fictional case"
    assert "test-key-never-in-payload" not in json.dumps(calls[0])


GENERATED = {
    "case_overview": (
        "This fictional referral concerns a 45-year-old patient at Miami Valley Hospital with anoxic injury and a recorded DBD pathway. "
        "Registry status is not registered, and the documented family emotional state should guide the pace of the initial conversation. "
        "Do not assume that this recorded label establishes understanding or readiness."
    ),
    "approach_context": (
        "Before approaching the family, coordinate with the bedside team about prior discussions, who should be present, and the questions "
        "the family wants addressed. Confirm the preferred language and any interpreter needs rather than treating the absence of recorded "
        "interpreter use as evidence that language support is unnecessary."
    ),
    "conversation_priorities": ["Check what the family understands about the documented injury.", "Ask whether the family wants more information now."],
    "verify_before_approach": ["Confirm preferred language and any interpreter support needed."],
}


def test_handoff_validation_discards_empty_model_bullets():
    generated = main.GeneratedBrief.model_validate({
        **GENERATED,
        "conversation_priorities": [*GENERATED["conversation_priorities"], " ", ""],
    })
    assert generated.conversation_priorities == GENERATED["conversation_priorities"]


def test_ai4free_status_reports_worker_failure_without_leaking_key(models, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "private-key")

    def fail(*args):
        raise RuntimeError("AI4Free: transport failed for private-key")

    monkeypatch.setattr(main, "_ai4free_request", fail)
    with TestClient(main.create_app(models)) as client:
        status = client.get("/groq/status").json()
    assert status["configured"] is True
    assert status["accessible"] is False
    assert status["transport"] == "ai4free"
    assert "private-key" not in status["detail"]
    assert "[redacted]" in status["detail"]


def test_case_brief_uses_ai4free_result_and_labels_failed_generation(models, features, monkeypatch):
    request = {
        "case": features, "opc_id": "OPC_01", "staff_name": "Demo Staff",
        "staff_location": "Dayton", "staff_specialty": "Family support",
        "hospital_name": "Miami Valley", "hospital_city": "Dayton", "distance_km": 5,
    }
    monkeypatch.setattr(main, "_ai4free_request", lambda *args: {
        "ok": True, "content": json.dumps(GENERATED),
    })
    with TestClient(main.create_app(models)) as client:
        brief = client.post("/cases/brief", json=request).json()
        assert brief["source"] == "groq"
        assert brief["case_brief"] == GENERATED["case_overview"] + "\n\n" + GENERATED["approach_context"]
        assert "not causes" in brief["match_rationale"]
        assert brief["conversation_priorities"] == GENERATED["conversation_priorities"]

        def fail(*args):
            raise RuntimeError("AI4Free: Groq returned HTTP 403: No JSON error was returned.")

        monkeypatch.setattr(main, "_ai4free_request", fail)
        fallback = client.post("/cases/brief", json={**request, "refresh": True}).json()
        assert fallback["source"] == "local_fallback"
        assert "No JSON error" in fallback["source_detail"]
        assert "Enable the model" not in fallback["source_detail"]


def test_brief_cache_refresh_and_training_invalidation(models, features, monkeypatch):
    calls = []

    def generate(*args):
        calls.append(args)
        return {"ok": True, "content": json.dumps(GENERATED)}

    monkeypatch.setattr(main, "_ai4free_request", generate)
    request = {
        "case": features, "opc_id": "OPC_01", "staff_name": "Demo Staff",
        "staff_location": "Dayton", "staff_specialty": "Family support",
        "hospital_name": "Miami Valley", "hospital_city": "Dayton", "distance_km": 5,
    }
    with TestClient(main.create_app(models)) as client:
        assert client.post("/cases/brief", json=request).json()["cached"] is False
        assert client.post("/cases/brief", json=request).json()["cached"] is True
        assert len(calls) == 1
        assert client.post("/cases/brief", json={**request, "refresh": True}).json()["cached"] is False
        assert len(calls) == 2
        changed = {**request, "case": {**features, "medical_mistrust": True}}
        assert client.post("/cases/brief", json=changed).json()["cached"] is False
        assert len(calls) == 3
        client.post("/opcs/OPC_01/cases", json={**features, "authorized": True})
        assert client.post("/cases/brief", json=request).json()["cached"] is False
        assert len(calls) == 4


def test_one_sentence_and_failed_briefs_are_not_cached(models, features, monkeypatch):
    request = {
        "case": {**features, "medical_mistrust": True, "multiple_decision_makers": True},
        "opc_id": "OPC_01", "staff_name": "Demo Staff", "staff_location": "Dayton",
        "staff_specialty": "Family support", "hospital_name": "Miami Valley",
        "hospital_city": "Dayton", "distance_km": 5,
    }
    calls = []

    def generate(*args):
        calls.append(args)
        data = {**GENERATED, "case_overview": "This is a one-sentence restatement."} if len(calls) == 1 else GENERATED
        return {"ok": True, "content": json.dumps(data)}

    monkeypatch.setattr(main, "_ai4free_request", generate)
    with TestClient(main.create_app(models)) as client:
        first = client.post("/cases/brief", json=request).json()
        assert first["source"] == "local_fallback"
        assert len(first["conversation_priorities"]) >= 3
        assert any("mistrust" in item.lower() for item in first["conversation_priorities"])
        assert first["verify_before_approach"]
        assert client.post("/cases/brief", json=request).json()["source"] == "groq"
        assert client.post("/cases/brief", json=request).json()["cached"] is True
        assert len(calls) == 2


@pytest.fixture
def features():
    return {
        "age": 45, "gender": "M", "race": "White", "brain_death": True,
        "cause_of_death_unos": "Anoxia", "mechanism_of_death": "Cardiovascular",
        "circumstances_of_death": "Natural causes", "registry_status": "Not Registered",
        "primary_etiology": "Anoxic brain injury", "donation_pathway": "DBD",
        "premature_donation_mention": False, "multiple_decision_makers": False,
        "family_estrangement": False, "medical_mistrust": False, "interpreter_utilized": False,
        "patient_hemodynamically_unstable": False, "late_referral_rushing_withdrawal": False,
        "family_emotional_state": "Shutdown/Stoic",
    }


@pytest.fixture
def models(features):
    records = [{**features, "opc_id": opc_id, "authorized": i % 2 == 0}
               for opc_id in ["OPC_01", "OPC_02"] for i in range(40)]
    return main.OPCModels(pd.DataFrame(records), initial_rounds=8, update_rounds=3)


def test_continuation_retains_history_and_updates_only_selected_opc(models, features):
    before = {key: bytes(model.save_raw()) for key, model in models.models.items()}
    result = main.add_case("OPC_01", {**features, "authorized": True}, models=models)
    assert result["case_index"] == 80
    assert result["training_cases"] == 41
    assert result["boosting_rounds"] == 11
    assert result["probability_after"] > result["probability_before"]
    assert bytes(models.models["OPC_01"].save_raw()) != before["OPC_01"]
    assert bytes(models.models["OPC_02"].save_raw()) == before["OPC_02"]
    result = main.add_case("OPC_01", {**features, "authorized": False}, models=models)
    assert result["training_cases"] == 42
    assert result["boosting_rounds"] == 14
    assert len(models.data) == 82
    assert models.data.iloc[-1].authorized == 0


def test_output_supports_new_cases_rows_and_unseen_categories(models, features):
    expected = main.output(0, models=models)
    assert main.output(case=features, models=models) == expected
    assert main.output(-1, models=models) == expected
    predicted = main.output(case={**features, "mechanism_of_death": "New category"}, models=models)
    assert len(predicted) == 2
    assert all(0 <= entry["probability"] <= 1 for entry in predicted)
    assert predicted == sorted(predicted, key=lambda entry: (-entry["probability"], entry["opc_id"]))


def test_fastapi_predictions_and_continuation(models, features):
    with TestClient(main.create_app(models)) as client:
        baseline = client.post("/output", json=features)
        assert baseline.status_code == 200
        assert client.get("/output?row_num=0").json() == baseline.json()
        assert client.get("/output?row_num=-1").json() == baseline.json()
        response = client.post("/opcs/OPC_01/cases", json={**features, "authorized": True})
        assert response.status_code == 201
        assert response.json()["boosting_rounds"] == 11
        assert response.json()["training_cases"] == 41
        updated = client.post("/output", json=features).json()
        assert updated[0]["opc_id"] == "OPC_01"
        assert updated[0]["probability"] == response.json()["probability_after"]
        assert client.get("/output?row_num=80").json() == updated
        assert "/opcs/{opc_id}/cases" in client.get("/openapi.json").json()["paths"]


def test_api_rejects_unknown_opcs_invalid_rows_and_invalid_cases(models, features):
    with TestClient(main.create_app(models)) as client:
        assert client.post("/opcs/UNKNOWN/cases", json={**features, "authorized": True}).status_code == 404
        assert client.get("/output?row_num=80").status_code == 404
        assert client.get("/output?row_num=-81").status_code == 404
        assert client.get("/output?row_num=abc").status_code == 422
        assert client.post("/opcs/OPC_01/cases", json=features).status_code == 422
        assert client.post("/output", json={**features, "age": -1}).status_code == 422
        assert client.post("/output", json={**features, "authorized": True}).status_code == 422
        assert len(models.data) == 80


def test_failed_training_does_not_commit_case_or_model(models, features, monkeypatch):
    before = bytes(models.models["OPC_01"].save_raw())

    def fail(*args, **kwargs):
        raise RuntimeError("Training failed")

    monkeypatch.setattr(main.xgb, "train", fail)
    with pytest.raises(RuntimeError, match="Training failed"):
        main.add_case("OPC_01", {**features, "authorized": True}, models=models)
    assert len(models.data) == 80
    assert bytes(models.models["OPC_01"].save_raw()) == before
