from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
RELEASE_SCRIPT = REPO_ROOT / "scripts" / "create_release.sh"


def _run(*args: str, cwd: Path, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=cwd,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )


def _prepare_release_repo(tmp_path: Path) -> tuple[Path, dict[str, str]]:
    repo = tmp_path / "repo"
    (repo / "scripts").mkdir(parents=True)
    shutil.copy2(RELEASE_SCRIPT, repo / "scripts" / "create_release.sh")

    (repo / "frontend").mkdir()
    (repo / "frontend" / "package.json").write_text(
        json.dumps({"version": "0.3.0"}) + "\n",
        encoding="utf-8",
    )
    (repo / "frontend" / "pnpm-lock.yaml").write_text("lockfileVersion: '9.0'\n", encoding="utf-8")

    for relative_path in (
        "frontend/src/__tests__/useHealthPulse.test.ts",
        "frontend/src/__tests__/configStore.main.test.ts",
        "frontend/src/__tests__/integration-dataflow.test.tsx",
        "frontend/src/__tests__/performance-audit.test.ts",
        "tests/e2e_comprehensive_workflow.py",
        "docs/QUALITY_ASSURANCE_REPORT.md",
    ):
        path = repo / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("test fixture\n", encoding="utf-8")

    python = repo / ".venv" / "bin" / "python"
    python.parent.mkdir(parents=True)
    python.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    python.chmod(0o755)

    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    pnpm = fake_bin / "pnpm"
    pnpm.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    pnpm.chmod(0o755)

    _run("git", "init", "-b", "main", cwd=repo)
    _run("git", "config", "user.name", "NoteBi Test", cwd=repo)
    _run("git", "config", "user.email", "notebi-test@example.invalid", cwd=repo)
    _run("git", "add", ".", cwd=repo)
    commit = _run("git", "commit", "-m", "initial", cwd=repo)
    assert commit.returncode == 0, commit.stderr

    env = os.environ.copy()
    env["PATH"] = f"{fake_bin}{os.pathsep}{env['PATH']}"
    return repo, env


def test_release_script_tags_existing_commit_without_creating_release_commit(tmp_path: Path) -> None:
    repo, env = _prepare_release_repo(tmp_path)
    before = _run("git", "rev-parse", "HEAD", cwd=repo).stdout.strip()

    result = _run("bash", "scripts/create_release.sh", "v0.3.0", cwd=repo, env=env)

    assert result.returncode == 0, result.stdout + result.stderr
    assert _run("git", "rev-parse", "HEAD", cwd=repo).stdout.strip() == before
    assert _run("git", "status", "--porcelain", cwd=repo).stdout == ""
    assert _run("git", "tag", "--list", "v0.3.0", cwd=repo).stdout.strip() == "v0.3.0"


def test_release_script_rejects_untracked_files(tmp_path: Path) -> None:
    repo, env = _prepare_release_repo(tmp_path)
    (repo / "personal-plan.md").write_text("do not publish\n", encoding="utf-8")

    result = _run("bash", "scripts/create_release.sh", "v0.3.0", cwd=repo, env=env)

    assert result.returncode != 0
    assert "personal-plan.md" in result.stdout
    assert _run("git", "tag", "--list", "v0.3.0", cwd=repo).stdout == ""
