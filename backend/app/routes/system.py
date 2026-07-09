from __future__ import annotations

import shutil
import subprocess
from typing import Any

import psutil
from fastapi import APIRouter

router = APIRouter(prefix="/system", tags=["system"])


def _query_nvidia_gpu() -> dict[str, Any] | None:
    if not shutil.which("nvidia-smi"):
        return None
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,utilization.gpu,memory.used,memory.total",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=2,
        )
        if result.returncode != 0:
            return None
        line = result.stdout.strip().splitlines()[0]
        name, util, used_mb, total_mb = [p.strip() for p in line.split(",")]
        return {
            "name": name,
            "utilization_percent": int(float(util)),
            "vram_used_gb": round(int(used_mb) / 1024, 1),
            "vram_total_gb": round(int(total_mb) / 1024, 1),
        }
    except (subprocess.TimeoutExpired, FileNotFoundError, ValueError, IndexError):
        return None


@router.get("/stats")
def get_system_stats() -> dict[str, Any]:
    mem = psutil.virtual_memory()
    return {
        "cpu": {
            "percent": psutil.cpu_percent(interval=0.1),
            "cores": psutil.cpu_count(logical=True) or 0,
        },
        "ram": {
            "used_gb": round(mem.used / 1024**3, 1),
            "total_gb": round(mem.total / 1024**3, 1),
            "percent": mem.percent,
        },
        "gpu": _query_nvidia_gpu(),
    }
