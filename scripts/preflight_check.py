#!/usr/bin/env python3
"""Preflight checks before local run/deploy."""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from shared.config import DATA_DIR, ROOT_DIR
from shared.settings_store import load_settings


def _check_ffmpeg() -> list[str]:
    errs: list[str] = []
    if shutil.which("ffmpeg") is None:
        errs.append("ffmpeg not found in PATH")
    return errs


def _check_dirs() -> list[str]:
    errs: list[str] = []
    for d in (DATA_DIR, ROOT_DIR / ".local"):
        try:
            d.mkdir(parents=True, exist_ok=True)
        except Exception as err:  # noqa: BLE001
            errs.append(f"cannot create directory {d}: {err}")
    return errs


def _check_provider_config() -> list[str]:
    errs: list[str] = []
    settings = load_settings()
    if not settings.providers:
        errs.append("no provider profiles configured in settings")
        return errs
    enabled = [p for p in settings.providers if p.enabled]
    if not enabled:
        errs.append("all providers are disabled")
    for p in enabled:
        if not p.api_key.strip():
            errs.append(f"provider '{p.id}' missing api_key")
    return errs


def _optional_env_reminders() -> list[str]:
    """不阻断启动，仅提示可选环境变量。"""
    out: list[str] = []
    if not os.environ.get("GROQ_API_KEY"):
        out.append("GROQ_API_KEY 未设置（仅在使用 Groq ASR 回退时需要）")
    return out


def main() -> int:
    errors = _check_ffmpeg() + _check_dirs() + _check_provider_config()
    if errors:
        print("Preflight check failed:")
        for e in errors:
            print(f"- {e}")
        return 1
    reminders = _optional_env_reminders()
    if reminders:
        print("Optional reminders:")
        for r in reminders:
            print(f"- {r}")
    print("Preflight check passed.")
    print("Note: 本地开发请使用 ./start.sh 启动后端 + Vite 前端（见 README）。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
