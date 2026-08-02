"""Automatic ASR hardware strategy is deterministic and inspectable."""

from __future__ import annotations

from backend.app.services import asr_hardware


def test_windows_nvidia_uses_cuda_in_auto_mode(monkeypatch) -> None:
    monkeypatch.setattr(asr_hardware.platform, "system", lambda: "Windows")
    monkeypatch.setattr(asr_hardware.platform, "machine", lambda: "AMD64")
    monkeypatch.setattr(asr_hardware, "_cuda_device_count", lambda: 1)
    monkeypatch.setattr(asr_hardware, "_mlx_available", lambda: False)

    status = asr_hardware.get_asr_hardware_status()

    assert status["recommended_engine"] == "fast-whisper"
    assert status["recommended_device"] == "cuda"
    assert status["strategy"] == "windows-nvidia-cuda"
    assert asr_hardware.resolve_asr_device("auto", "fast-whisper") == ("cuda", "检测到 1 张 NVIDIA CUDA 显卡")


def test_apple_silicon_prefers_mlx_and_cpu_fallback_is_explained(monkeypatch) -> None:
    monkeypatch.setattr(asr_hardware.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(asr_hardware.platform, "machine", lambda: "arm64")
    monkeypatch.setattr(asr_hardware, "_mlx_available", lambda: True)
    monkeypatch.setattr(asr_hardware, "_cuda_device_count", lambda: 0)

    status = asr_hardware.get_asr_hardware_status()

    assert status["recommended_engine"] == "mlx-whisper"
    assert status["recommended_device"] == "mps"
    assert status["fallback"] == "fast-whisper / CPU int8"
    assert asr_hardware.resolve_asr_device("cuda", "fast-whisper") == ("cpu", "未检测到可用 NVIDIA CUDA，已回退 CPU int8")


def test_apple_silicon_never_imports_cuda_runtime_just_to_render_status(monkeypatch) -> None:
    monkeypatch.setattr(asr_hardware.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(asr_hardware.platform, "machine", lambda: "arm64")
    monkeypatch.setattr(asr_hardware, "_mlx_available", lambda: True)

    def cuda_probe_must_not_run() -> int:
        raise AssertionError("Apple Silicon status must not import the CUDA runtime")

    monkeypatch.setattr(asr_hardware, "_cuda_device_count", cuda_probe_must_not_run)

    assert asr_hardware.get_asr_hardware_status()["strategy"] == "apple-silicon-mlx"


def test_hardware_endpoint_exposes_strategy_without_device_driver_details(monkeypatch) -> None:
    from fastapi.testclient import TestClient

    from backend.app.main import app
    import backend.app.routes.transcriber_config as route

    monkeypatch.setattr(route, "get_asr_hardware_status", lambda: {
        "platform": "Windows",
        "architecture": "amd64",
        "strategy": "windows-nvidia-cuda",
        "cuda_devices": 1,
        "mlx_available": False,
        "recommended_engine": "fast-whisper",
        "recommended_device": "cuda",
        "recommendation": "检测到 1 张 NVIDIA CUDA 显卡；使用 Faster Whisper float16 与批处理。",
        "fallback": "fast-whisper / CPU int8",
    })

    response = TestClient(app).get("/transcriber_config/hardware")

    assert response.status_code == 200
    assert response.json()["strategy"] == "windows-nvidia-cuda"
    assert response.json()["recommended_device"] == "cuda"


def test_transcriber_config_persists_auto_strategy(monkeypatch) -> None:
    import backend.app.routes.transcriber_config as route
    from shared.settings_store import AppSettings

    saved: list[AppSettings] = []
    monkeypatch.setattr(route, "load_settings", lambda: AppSettings())
    monkeypatch.setattr(route, "save_settings", saved.append)

    result = route.update_transcriber_config(
        route.TranscriberConfigUpdateRequest(type="auto", device="auto"),
    )

    assert result["type"] == "auto"
    assert result["device"] == "auto"
    assert saved[0].transcriber.type == "auto"
