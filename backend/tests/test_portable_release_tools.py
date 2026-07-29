from __future__ import annotations

import hashlib
import json
from pathlib import Path

from scripts import portable_preflight
from scripts.build_windows_offline_bundle import build_bundle


def _write_bundle_skeleton(root: Path) -> None:
    (root / "backend" / "app").mkdir(parents=True)
    (root / "backend" / "app" / "main.py").write_text("# test\n", encoding="utf-8")
    (root / "frontend" / "dist").mkdir(parents=True)
    (root / "frontend" / "dist" / "index.html").write_text(
        '<meta name="notebi-build" content="1">', encoding="utf-8"
    )
    (root / "runtime" / "python").mkdir(parents=True)
    (root / "runtime" / "python" / "python.exe").write_bytes(b"python")
    (root / "runtime" / "ffmpeg" / "bin").mkdir(parents=True)
    (root / "runtime" / "ffmpeg" / "bin" / "ffmpeg.exe").write_bytes(b"ffmpeg")
    (root / "runtime" / "ffmpeg" / "bin" / "ffprobe.exe").write_bytes(b"ffprobe")
    (root / "models").mkdir()


def test_offline_bundle_preflight_rejects_missing_required_runtime(tmp_path: Path) -> None:
    _write_bundle_skeleton(tmp_path)
    (tmp_path / "runtime" / "python" / "python.exe").unlink()

    errors = portable_preflight.check_offline_bundle(tmp_path)

    assert any("runtime/python/python.exe" in error for error in errors)


def test_model_manifest_verifies_required_model_hash(tmp_path: Path) -> None:
    _write_bundle_skeleton(tmp_path)
    model = tmp_path / "models" / "asr.bin"
    model.write_bytes(b"offline-model")
    digest = hashlib.sha256(model.read_bytes()).hexdigest()
    (tmp_path / "models" / "manifest.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "models": [
                    {
                        "id": "asr",
                        "path": "models/asr.bin",
                        "sha256": digest,
                        "required": True,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    errors = portable_preflight.check_offline_bundle(tmp_path)

    assert errors == []


def test_model_manifest_reports_hash_mismatch(tmp_path: Path) -> None:
    _write_bundle_skeleton(tmp_path)
    model = tmp_path / "models" / "asr.bin"
    model.write_bytes(b"offline-model")
    (tmp_path / "models" / "manifest.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "models": [
                    {
                        "id": "asr",
                        "path": "models/asr.bin",
                        "sha256": "0" * 64,
                        "required": True,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    errors = portable_preflight.check_offline_bundle(tmp_path)

    assert any("sha256 mismatch" in error for error in errors)


def test_offline_bundle_preflight_rejects_frontend_without_notebi_marker(tmp_path: Path) -> None:
    _write_bundle_skeleton(tmp_path)
    index = tmp_path / "frontend" / "dist" / "index.html"
    index.write_text('<meta name="notebi-build" content="0">', encoding="utf-8")

    errors = portable_preflight.check_offline_bundle(tmp_path)

    assert any("not a NoteBi build" in error for error in errors)


def test_windows_bundle_keeps_source_but_excludes_local_runtime_data(tmp_path: Path) -> None:
    source = tmp_path / "source"
    (source / "backend" / "app").mkdir(parents=True)
    (source / "backend" / "app" / "main.py").write_text("# app\n", encoding="utf-8")
    (source / "frontend" / "dist").mkdir(parents=True)
    (source / "frontend" / "dist" / "index.html").write_text(
        '<meta name="notebi-build" content="1">', encoding="utf-8"
    )
    (source / "frontend" / "dist" / "assets.js").write_text("assets\n", encoding="utf-8")
    (source / "scripts").mkdir()
    (source / "scripts" / "windows_start.py").write_text("# launcher\n", encoding="utf-8")
    (source / ".env").write_text("SECRET=do-not-copy\n", encoding="utf-8")
    (source / "data").mkdir()
    (source / "data" / "private.txt").write_text("private\n", encoding="utf-8")

    runtime = tmp_path / "runtime"
    (runtime / "python").mkdir(parents=True)
    (runtime / "python" / "python.exe").write_bytes(b"python")
    models = tmp_path / "models"
    models.mkdir()
    (models / "asr.bin").write_bytes(b"model")

    output = tmp_path / "bundle"
    build_bundle(source, output, runtime_dir=runtime, models_dir=models)

    assert (output / "backend" / "app" / "main.py").is_file()
    assert (output / "frontend" / "dist" / "index.html").is_file()
    assert (output / "runtime" / "python" / "python.exe").is_file()
    assert (output / "models" / "manifest.json").is_file()
    assert not (output / ".env").exists()
    assert not (output / "data").exists()

    errors = portable_preflight.check_offline_bundle(output)
    assert any("ffmpeg.exe" in error for error in errors)
