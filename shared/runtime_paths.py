"""Writable runtime paths shared by source runs and packaged desktop sidecars."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping


@dataclass(frozen=True)
class RuntimePaths:
    source_root: Path
    data_dir: Path
    state_dir: Path
    projects_dir: Path


def _env_path(environ: Mapping[str, str], key: str, fallback: Path) -> Path:
    raw = str(environ.get(key) or "").strip()
    return Path(raw).expanduser().resolve() if raw else fallback.resolve()


def resolve_runtime_paths(
    *,
    source_root: Path | None = None,
    environ: Mapping[str, str] | None = None,
) -> RuntimePaths:
    root = (source_root or Path(__file__).resolve().parent.parent).resolve()
    env = os.environ if environ is None else environ
    return RuntimePaths(
        source_root=root,
        data_dir=_env_path(env, "NOTEBI_DATA_DIR", root / "data"),
        state_dir=_env_path(env, "NOTEBI_STATE_DIR", root / ".local"),
        projects_dir=_env_path(env, "NOTEBI_PROJECTS_DIR", root / "projects"),
    )


RUNTIME_PATHS = resolve_runtime_paths()
SOURCE_ROOT = RUNTIME_PATHS.source_root
DATA_DIR = RUNTIME_PATHS.data_dir
STATE_DIR = RUNTIME_PATHS.state_dir
PROJECTS_DIR = RUNTIME_PATHS.projects_dir
