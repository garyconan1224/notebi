from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    settings_path = tmp_path / "settings.json"
    monkeypatch.setattr("shared.settings_store.SETTINGS_PATH", settings_path)
    monkeypatch.setattr("shared.settings_store.SETTINGS_DIR", tmp_path)

    from backend.app.main import app

    with TestClient(app) as test_client:
        test_client.app.state.task_defaults_settings_path = settings_path
        yield test_client


def test_get_task_defaults_uses_existing_code_defaults(client: TestClient) -> None:
    response = client.get("/task_defaults")

    assert response.status_code == 200
    assert response.json() == {
        "summary_template": "standard",
        "video_frame_analysis": True,
        "frame_interval_sec": 5,
        "diarize": False,
        "speaker_count": None,
        "summary_language": "zh-Hans",
        "summary_language_custom": "",
    }


def test_patch_task_defaults_round_trip_and_whitelist(
    client: TestClient,
) -> None:
    payload = {
        "summary_template": "detailed",
        "video_frame_analysis": False,
        "frame_interval_sec": 12,
        "diarize": True,
        "speaker_count": 3,
        "summary_language": "en",
        "summary_language_custom": "",
    }

    patched = client.patch("/task_defaults", json=payload)
    read_back = client.get("/task_defaults")

    assert patched.status_code == 200
    assert patched.json() == payload
    assert read_back.json() == payload
    saved = json.loads(
        client.app.state.task_defaults_settings_path.read_text(encoding="utf-8")
    )
    assert saved["task_defaults"] == payload
    assert "models" not in saved["task_defaults"]
    assert "music_analysis" not in saved["task_defaults"]


def test_patch_task_defaults_preserves_omitted_fields(
    client: TestClient,
) -> None:
    client.patch(
        "/task_defaults",
        json={
            "summary_template": "concise",
            "video_frame_analysis": False,
            "frame_interval_sec": 9,
            "diarize": True,
            "speaker_count": 2,
            "summary_language": "custom",
            "summary_language_custom": "fr-CA",
        },
    )

    response = client.patch(
        "/task_defaults",
        json={"frame_interval_sec": 15, "speaker_count": None},
    )

    assert response.status_code == 200
    assert response.json() == {
        "summary_template": "concise",
        "video_frame_analysis": False,
        "frame_interval_sec": 15,
        "diarize": True,
        "speaker_count": None,
        "summary_language": "custom",
        "summary_language_custom": "fr-CA",
    }


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"summary_template": ""}, "summary_template"),
        ({"frame_interval_sec": 0}, "frame_interval_sec"),
        ({"frame_interval_sec": -5}, "frame_interval_sec"),
        ({"speaker_count": 1}, "speaker_count"),
        ({"speaker_count": 6}, "speaker_count"),
        ({"music_analysis": True}, "music_analysis"),
        ({"vision_model": "model-id"}, "vision_model"),
        ({"summary_language": "unsupported"}, "summary_language"),
        ({"summary_language": "custom", "summary_language_custom": "not a tag"}, "summary_language_custom"),
    ],
)
def test_patch_task_defaults_rejects_invalid_or_retired_fields(
    client: TestClient,
    payload: dict,
    field: str,
) -> None:
    response = client.patch("/task_defaults", json=payload)

    assert response.status_code == 422
    assert field in response.text


def test_legacy_unknown_fields_are_not_written_back(client: TestClient) -> None:
    path = client.app.state.task_defaults_settings_path
    path.write_text(
        json.dumps(
            {
                "task_defaults": {
                    "summary_template": "concise",
                    "music_analysis": True,
                    "unknown_old_toggle": True,
                }
            }
        ),
        encoding="utf-8",
    )

    response = client.patch("/task_defaults", json={"diarize": True})

    assert response.status_code == 200
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved["task_defaults"]["summary_template"] == "concise"
    assert saved["task_defaults"]["diarize"] is True
    assert "music_analysis" not in saved["task_defaults"]
    assert "unknown_old_toggle" not in saved["task_defaults"]


@pytest.mark.parametrize("interval", [300, 600, 121])
def test_large_frame_interval_accepted(client: TestClient, interval: int) -> None:
    """S2: 手动截帧间隔不设人为上限，只要求正整数。"""
    response = client.patch("/task_defaults", json={"frame_interval_sec": interval})
    assert response.status_code == 200
    assert response.json()["frame_interval_sec"] == interval
    # GET 回读一致
    read_back = client.get("/task_defaults")
    assert read_back.json()["frame_interval_sec"] == interval


def test_frame_interval_beyond_32bit_round_trip(client: TestClient) -> None:
    """Task A: 超过 2**31 的正整数 PATCH→GET→落盘 round-trip 不变（无硬编码上限）。"""
    huge = 2**31 + 12345

    patched = client.patch("/task_defaults", json={"frame_interval_sec": huge})
    read_back = client.get("/task_defaults")

    assert patched.status_code == 200
    assert patched.json()["frame_interval_sec"] == huge
    assert read_back.json()["frame_interval_sec"] == huge
    saved = json.loads(
        client.app.state.task_defaults_settings_path.read_text(encoding="utf-8")
    )
    assert saved["task_defaults"]["frame_interval_sec"] == huge
