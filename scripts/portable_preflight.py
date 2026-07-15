#!/usr/bin/env python3
"""Dependency-free checks for a NoteBi portable/offline package.

This module deliberately uses only Python's standard library so it can run
before the bundled application dependencies are imported.  It never installs
packages, contacts a model registry, or rewrites NoteBi settings.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any


REQUIRED_OFFLINE_PATHS = (
    "backend/app/main.py",
    "frontend/dist/index.html",
    "runtime/python/python.exe",
    "runtime/ffmpeg/bin/ffmpeg.exe",
    "runtime/ffmpeg/bin/ffprobe.exe",
    "models/manifest.json",
)


def _inside_root(root: Path, relative_path: str) -> Path | None:
    """Resolve a manifest path, rejecting absolute paths and traversal."""

    candidate = (root / relative_path).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError:
        return None
    return candidate


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _check_required_paths(root: Path) -> list[str]:
    errors: list[str] = []
    for relative_path in REQUIRED_OFFLINE_PATHS:
        if not (root / relative_path).is_file():
            errors.append(f"missing required file: {relative_path}")
    return errors


def _check_frontend_product_mode(root: Path) -> list[str]:
    """Reject a static bundle compiled in legacy Nibi mode."""

    index_path = root / "frontend" / "dist" / "index.html"
    try:
        index = index_path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        return [f"cannot read frontend/dist/index.html: {exc}"]
    if 'name="notebi-product-mode" content="notebi"' not in index:
        return [
            "frontend/dist is not compiled for NoteBi mode; "
            "rebuild with VITE_PRODUCT_MODE=notebi"
        ]
    return []


def _check_model_manifest(root: Path) -> list[str]:
    manifest_path = root / "models" / "manifest.json"
    if not manifest_path.is_file():
        return []

    try:
        payload: Any = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        return [f"invalid models/manifest.json: {exc}"]

    if not isinstance(payload, dict) or payload.get("schema_version") != 1:
        return ["models/manifest.json must use schema_version=1"]

    entries = payload.get("models")
    if not isinstance(entries, list):
        return ["models/manifest.json must contain a models list"]

    errors: list[str] = []
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            errors.append(f"models/manifest.json entry {index} is not an object")
            continue

        model_id = str(entry.get("id") or f"entry-{index}")
        relative_path = str(entry.get("path") or "")
        expected_hash = str(entry.get("sha256") or "").lower()
        required = bool(entry.get("required", True))

        if not relative_path:
            errors.append(f"model '{model_id}' has no path")
            continue
        if len(expected_hash) != 64 or any(char not in "0123456789abcdef" for char in expected_hash):
            errors.append(f"model '{model_id}' has an invalid sha256")
            continue

        model_path = _inside_root(root, relative_path)
        if model_path is None:
            errors.append(f"model '{model_id}' path escapes bundle root: {relative_path}")
            continue
        if not model_path.is_file():
            if required:
                errors.append(f"required model missing: {relative_path}")
            continue

        try:
            actual_hash = _sha256(model_path)
        except OSError as exc:
            errors.append(f"model '{model_id}' cannot be read: {exc}")
            continue
        if actual_hash != expected_hash:
            errors.append(
                f"model '{model_id}' sha256 mismatch: expected {expected_hash}, got {actual_hash}"
            )

    return errors


def check_offline_bundle(root: Path) -> list[str]:
    """Return human-readable errors for a Windows offline bundle."""

    root = root.resolve()
    return _check_required_paths(root) + _check_frontend_product_mode(root) + _check_model_manifest(root)


def check_source_tree(root: Path) -> list[str]:
    """Return minimal errors for the public source distribution."""

    root = root.resolve()
    required = (
        "backend/app/main.py",
        "frontend/package.json",
        "requirements.txt",
        "start.sh",
    )
    return [f"missing source file: {path}" for path in required if not (root / path).is_file()]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd(), help="NoteBi package root")
    parser.add_argument(
        "--mode",
        choices=("offline", "source"),
        default="offline",
        help="check a Windows offline bundle or a public source tree",
    )
    args = parser.parse_args(argv)

    errors = (
        check_offline_bundle(args.root)
        if args.mode == "offline"
        else check_source_tree(args.root)
    )
    if errors:
        print("NoteBi preflight failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    print(f"NoteBi preflight passed ({args.mode}).")
    if args.mode == "offline":
        print("Offline mode: no package installation or model download will be attempted.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
