from __future__ import annotations

from fastapi.testclient import TestClient

from backend.app.main import app


client = TestClient(app)


def test_local_models_lists_explicit_runtime_downloads() -> None:
    response = client.get("/local_models")

    assert response.status_code == 200
    models = response.json()["models"]
    ids = {entry["model_id"] for entry in models}
    assert "fast-whisper:base" in ids
    assert "mlx-whisper:base" in ids
    assert "sherpa-diarization" in ids
    assert "paddleocr-zh" in ids
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
