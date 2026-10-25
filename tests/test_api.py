import pandas as pd
import pytest
import json
import sys
from types import SimpleNamespace
from fastapi.testclient import TestClient

import main


def test_ai4free_bridge_uses_isolated_process_and_stdin(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-key-never-in-arguments")
    monkeypatch.setenv("AI4FREE_PYTHON", sys.executable)
    calls = []

    def worker(command, **kwargs):
        calls.append((command, kwargs))
        return SimpleNamespace(returncode=0, stdout=json.dumps({"ok": True, "content": "brief"}))

    monkeypatch.setattr(main.subprocess, "run", worker)
    assert main._groq_chat("fictional case") == "brief"
    command, options = calls[0]
    assert command[0] == sys.executable
    assert command[1].endswith("ai4free_worker.py")
    assert "test-key-never-in-arguments" not in str(command)
    assert json.loads(options["input"])["prompt"] == "fictional case"
    assert options["timeout"] == 28


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
        "ok": True, "content": json.dumps({"case_brief": "Fictional case brief.", "match_rationale": "Model estimate."}),
    })
    with TestClient(main.create_app(models)) as client:
        brief = client.post("/cases/brief", json=request).json()
        assert brief["source"] == "groq"
        assert brief["case_brief"] == "Fictional case brief."

        def fail(*args):
            raise RuntimeError("AI4Free: Groq returned HTTP 403: No JSON error was returned.")

        monkeypatch.setattr(main, "_ai4free_request", fail)
        fallback = client.post("/cases/brief", json=request).json()
        assert fallback["source"] == "local_fallback"
        assert "No JSON error" in fallback["source_detail"]
        assert "Enable the model" not in fallback["source_detail"]


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
