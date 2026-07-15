#!/usr/bin/env python3
"""Build a source-visible Windows offline bundle.

The builder is intentionally explicit about runtime and model inputs.  It does
not download packages or model weights; prepare those inputs on a connected
build machine, then transfer the resulting directory/ZIP into the intranet.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


EXCLUDED_DIRS = {
    ".git",
    ".venv",
    ".local",
    ".pytest_cache",
    ".playwright-cli",
    ".playwright-mcp",
    "__pycache__",
    "node_modules",
    "data",
    "projects",
    "output",
    "product-builds",
    "test-results",
    "dist",
    "release",
}
EXCLUDED_FILES = {".env", "package-lock.json"}


def _ignore_source(_path: str, names: list[str]) -> set[str]:
    ignored: set[str] = set()
    for name in names:
        if name in EXCLUDED_DIRS or name in EXCLUDED_FILES:
            ignored.add(name)
        elif name.startswith(".env.") and name != ".env.example":
            ignored.add(name)
        elif name.endswith((".log", ".sqlite", ".sqlite3", ".db", ".zip")):
            ignored.add(name)
    return ignored


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _iter_files(root: Path) -> Iterable[Path]:
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.name != "manifest.json":
            yield path


def build_model_manifest(models_dir: Path, output_path: Path) -> dict[str, object]:
    models_dir.mkdir(parents=True, exist_ok=True)
    entries: list[dict[str, object]] = []
    for path in _iter_files(models_dir):
        relative = path.relative_to(output_path.parent.parent).as_posix()
        entries.append(
            {
                "id": path.relative_to(models_dir).as_posix(),
                "path": relative,
                "sha256": _sha256(path),
                "required": True,
            }
        )
    payload: dict[str, object] = {"schema_version": 1, "models": entries}
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return payload


def _git_revision(source_root: Path) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(source_root), "rev-parse", "--short", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    revision = result.stdout.strip()
    return revision or None


def _copy_runtime(runtime_dir: Path, bundle_root: Path) -> None:
    if not runtime_dir.is_dir():
        raise ValueError(f"runtime directory not found: {runtime_dir}")
    shutil.copytree(runtime_dir, bundle_root / "runtime")


def _copy_models(models_dir: Path | None, bundle_root: Path) -> dict[str, object]:
    target = bundle_root / "models"
    target.mkdir(parents=True, exist_ok=True)
    if models_dir is not None:
        if not models_dir.is_dir():
            raise ValueError(f"models directory not found: {models_dir}")
        for child in models_dir.iterdir():
            if child.name == "manifest.json":
                continue
            destination = target / child.name
            if child.is_dir():
                shutil.copytree(child, destination)
            else:
                shutil.copy2(child, destination)
    return build_model_manifest(target, target / "manifest.json")


def build_bundle(
    source_root: Path,
    output_dir: Path,
    *,
    runtime_dir: Path,
    models_dir: Path | None = None,
    zip_path: Path | None = None,
) -> Path:
    source_root = source_root.resolve()
    output_dir = output_dir.resolve()
    runtime_dir = runtime_dir.resolve()
    if output_dir.exists():
        raise FileExistsError(f"output already exists; choose another path: {output_dir}")
    if not (source_root / "frontend" / "dist" / "index.html").is_file():
        raise ValueError("frontend/dist/index.html not found; build the frontend before packaging")
    frontend_index = (source_root / "frontend" / "dist" / "index.html").read_text(encoding="utf-8")
    if 'name="notebi-product-mode" content="notebi"' not in frontend_index:
        raise ValueError(
            'frontend/dist was not built with VITE_PRODUCT_MODE=notebi; '
            "run ./build-notebi.sh before packaging"
        )

    output_dir.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source_root, output_dir, ignore=_ignore_source)
    _copy_runtime(runtime_dir, output_dir)
    _copy_models(models_dir, output_dir)

    dist_target = output_dir / "frontend" / "dist"
    shutil.copytree(source_root / "frontend" / "dist", dist_target)

    manifest = {
        "schema_version": 1,
        "product": "NoteBi",
        "platform": "windows-x64",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source_revision": _git_revision(source_root),
        "models_manifest": "models/manifest.json",
        "offline_runtime": True,
        "model_download_at_runtime": False,
    }
    (output_dir / "BUNDLE_MANIFEST.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    if zip_path is not None:
        zip_path = zip_path.resolve()
        if zip_path.exists():
            raise FileExistsError(f"zip already exists; choose another path: {zip_path}")
        zip_path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(output_dir.rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(output_dir.parent).as_posix())
    return output_dir


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--runtime", type=Path, required=True, help="prepared Windows runtime directory")
    parser.add_argument("--models", type=Path, default=None, help="prepared local model directory")
    parser.add_argument("--zip", type=Path, default=None, help="optional ZIP output path")
    args = parser.parse_args(argv)

    try:
        output = build_bundle(
            args.source_root,
            args.output,
            runtime_dir=args.runtime,
            models_dir=args.models,
            zip_path=args.zip,
        )
    except (FileExistsError, OSError, ValueError) as exc:
        print(f"Windows offline bundle failed: {exc}")
        return 1
    print(f"Windows offline bundle created: {output}")
    if args.zip:
        print(f"ZIP created: {args.zip.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
