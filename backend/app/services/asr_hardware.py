"""ASR 硬件能力探测与自动设备选择。

这里不初始化 Whisper 模型。CUDA 的 CTranslate2 探测只会在 Windows 执行，
避免 Apple Silicon 状态页导入不需要的 CUDA/PyTorch 原生扩展。策略只覆盖 Apple Silicon 和 Windows NVIDIA：
其他平台始终保持 faster-whisper / CPU int8 的可预期回退。
"""

from __future__ import annotations

import platform
from typing import Literal, TypedDict


AsrDevice = Literal["cpu", "cuda", "mps"]


class AsrHardwareStatus(TypedDict):
    platform: str
    architecture: str
    strategy: str
    cuda_devices: int
    mlx_available: bool
    recommended_engine: str
    recommended_device: AsrDevice
    recommendation: str
    fallback: str


def _cuda_device_count() -> int:
    """返回 CTranslate2 可实际使用的 CUDA 设备数量，而非仅看显卡名称。"""
    try:
        import ctranslate2

        count = getattr(ctranslate2, "get_cuda_device_count", None)
        return max(0, int(count())) if callable(count) else 0
    except Exception:  # noqa: BLE001 -- 缺依赖/驱动不匹配都应走 CPU
        return 0


def _mlx_available() -> bool:
    try:
        from backend.app.services.asr_mlx_whisper import is_mlx_whisper_available

        return is_mlx_whisper_available()
    except Exception:  # noqa: BLE001 -- 设置页状态不能因探测失败报 500
        return False


def get_asr_hardware_status() -> AsrHardwareStatus:
    system = platform.system()
    machine = platform.machine().lower()
    # CTranslate2 can load native CUDA/Torch code during import. Apple Silicon
    # never uses CUDA for this product, so probing it there is both irrelevant
    # and unsafe in settings polling or pipeline worker threads.
    cuda_devices = _cuda_device_count() if system == "Windows" else 0
    is_apple_silicon = system == "Darwin" and machine in {"arm64", "aarch64"}
    mlx_available = _mlx_available() if is_apple_silicon else False

    if is_apple_silicon:
        return {
            "platform": system,
            "architecture": machine,
            "strategy": "apple-silicon-mlx" if mlx_available else "apple-silicon-cpu-fallback",
            "cuda_devices": cuda_devices,
            "mlx_available": mlx_available,
            "recommended_engine": "mlx-whisper" if mlx_available else "fast-whisper",
            "recommended_device": "mps" if mlx_available else "cpu",
            "recommendation": "Apple Silicon 使用 MLX Whisper；模型或依赖未就绪时自动使用 CPU int8。"
            if mlx_available
            else "已识别 Apple Silicon，但 MLX Whisper 未就绪；当前将使用 faster-whisper / CPU int8。",
            "fallback": "fast-whisper / CPU int8",
        }

    if system == "Windows" and cuda_devices > 0:
        return {
            "platform": system,
            "architecture": machine,
            "strategy": "windows-nvidia-cuda",
            "cuda_devices": cuda_devices,
            "mlx_available": False,
            "recommended_engine": "fast-whisper",
            "recommended_device": "cuda",
            "recommendation": f"检测到 {cuda_devices} 张 NVIDIA CUDA 显卡；使用 Faster Whisper float16 与批处理。",
            "fallback": "fast-whisper / CPU int8",
        }

    return {
        "platform": system,
        "architecture": machine,
        "strategy": "cpu-int8-fallback",
        "cuda_devices": cuda_devices,
        "mlx_available": False,
        "recommended_engine": "fast-whisper",
        "recommended_device": "cpu",
        "recommendation": "未检测到可用的 Apple MLX 或 Windows NVIDIA CUDA；使用 Faster Whisper / CPU int8。",
        "fallback": "fast-whisper / CPU int8",
    }


def resolve_asr_device(requested_device: str, engine: str) -> tuple[AsrDevice, str]:
    """把用户偏好安全地解析成可执行设备，并返回可写入任务日志的原因。"""
    status = get_asr_hardware_status()
    requested = (requested_device or "auto").lower()

    if engine == "mlx-whisper":
        if status["recommended_device"] == "mps":
            return "mps", "Apple Silicon 使用 MLX Whisper"
        return "cpu", "MLX Whisper 不可用，后续回退 faster-whisper / CPU int8"

    if requested == "auto":
        if status["recommended_device"] == "cuda":
            return "cuda", f"检测到 {status['cuda_devices']} 张 NVIDIA CUDA 显卡"
        return "cpu", "未使用可用 CUDA，使用 CPU int8"

    if requested == "cuda":
        if status["cuda_devices"] > 0:
            return "cuda", f"使用手动选择的 NVIDIA CUDA（{status['cuda_devices']} 张）"
        return "cpu", "未检测到可用 NVIDIA CUDA，已回退 CPU int8"

    # CTranslate2 faster-whisper 不支持 MPS；MLX 的分支在上方提前返回。
    if requested == "mps":
        return "cpu", "Faster Whisper 不支持 Apple MPS，已回退 CPU int8"
    return "cpu", "使用手动选择的 CPU int8"
