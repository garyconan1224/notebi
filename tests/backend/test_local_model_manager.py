from __future__ import annotations

import sys
import types

from backend.app.services import local_model_manager
from shared.settings_store import AppSettings, TranscriberConfig


def test_fast_whisper_download_uses_same_resolved_repo_as_runtime(monkeypatch) -> None:
    downloaded: list[str] = []
    fake_hub = types.ModuleType("huggingface_hub")
    fake_hub.snapshot_download = downloaded.append  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "huggingface_hub", fake_hub)
    progress: list[tuple[float, str]] = []

    local_model_manager._run_download(
        "fast-whisper:large-v3-turbo",
        lambda value, message: progress.append((value, message)),
    )

    assert downloaded == ["mobiuslabsgmbh/faster-whisper-large-v3-turbo"]
    assert progress[-1][0] == 1.0


def test_activate_local_model_persists_selected_engine(monkeypatch) -> None:
    monkeypatch.setattr(
        local_model_manager,
        "list_local_models",
        lambda: [
            {
                "model_id": "fast-whisper:small",
                "family": "fast-whisper",
                "cached": True,
                "status": "ready",
            }
        ],
    )
    settings = AppSettings(
        transcriber=TranscriberConfig(
            type="mlx-whisper",
            whisper_model_size="tiny",
            device="mps",
        )
    )
    saved = []
    monkeypatch.setattr(local_model_manager, "load_settings", lambda: settings)
    monkeypatch.setattr(local_model_manager, "save_settings", saved.append)

    result = local_model_manager.activate_local_model("fast-whisper:small")

    assert result == {
        "model_id": "fast-whisper:small",
        "type": "fast-whisper",
        "whisper_model_size": "small",
    }
    assert saved[0].transcriber.type == "fast-whisper"
    assert saved[0].transcriber.whisper_model_size == "small"
    assert saved[0].transcriber.device == "cpu"
