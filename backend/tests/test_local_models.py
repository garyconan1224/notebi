from __future__ import annotations

from fastapi.testclient import TestClient

from backend.app.main import app
from shared.settings_store import AppSettings


client = TestClient(app)


def test_local_models_lists_explicit_runtime_downloads() -> None:
    response = client.get("/local_models")

    assert response.status_code == 200
    models = response.json()["models"]
    ids = {entry["model_id"] for entry in models}
    assert "fast-whisper:base" in ids
    assert "mlx-whisper:base" in ids
    assert "paddleocr-zh" in ids
    assert "wespeaker" in ids
    assert all("status" in entry and "cache_dir" in entry for entry in models)


def test_local_model_download_requires_known_explicit_model(monkeypatch) -> None:
    import backend.app.routes.transcriber_config as route

    captured: list[str] = []
    def fake_start(model_id: str):
        if model_id == "not-a-model":
            raise KeyError(model_id)
        captured.append(model_id)
        return {"status": "downloading"}
    monkeypatch.setattr(route, "start_local_model_download", fake_start)

    accepted = client.post("/local_models/fast-whisper:base/download")
    missing = client.post("/local_models/not-a-model/download")

    assert accepted.status_code == 202
    assert accepted.json()["model_id"] == "fast-whisper:base"
    assert captured == ["fast-whisper:base"]
    assert missing.status_code == 404


def test_local_model_storage_directory_round_trips(tmp_path, monkeypatch) -> None:
    import backend.app.routes.transcriber_config as route

    current = AppSettings()
    saved: list[AppSettings] = []
    monkeypatch.setattr(route, "load_settings", lambda: saved[-1] if saved else current)
    monkeypatch.setattr(route, "save_settings", saved.append)

    target = tmp_path / "notebi-models"
    response = client.put("/local_models/storage", json={"directory": str(target)})

    assert response.status_code == 200
    assert response.json() == {
        "directory": str(target),
        "effective_cache_dir": str(target / "huggingface" / "hub"),
    }
    assert saved[-1].model_storage_dir == str(target)
    assert client.get("/local_models/storage").json() == response.json()


def test_local_model_storage_rejects_relative_directory() -> None:
    response = client.put("/local_models/storage", json={"directory": "relative/models"})

    assert response.status_code == 422
