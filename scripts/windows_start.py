#!/usr/bin/env python3
"""Start the editable Windows offline package without installing anything."""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path
from typing import TextIO

try:
    from scripts.portable_preflight import check_offline_bundle
except ModuleNotFoundError:  # direct execution: python scripts/windows_start.py
    from portable_preflight import check_offline_bundle


PID_FILE = Path(".local") / "windows_pids.json"


def _port_is_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            return True
    except OSError:
        return False


def _terminate(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    else:
        process.terminate()
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=3)


def _wait_for(url: str, process: subprocess.Popen[str], timeout: float = 45) -> None:
    deadline = time.monotonic() + timeout
    last_error = "not ready"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"process exited early with code {process.returncode}")
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if 200 <= response.status < 500:
                    return
        except Exception as exc:  # noqa: BLE001 - startup polling
            last_error = str(exc)
        time.sleep(0.5)
    raise RuntimeError(f"timed out waiting for {url}: {last_error}")


def _write_pid_file(root: Path, backend: subprocess.Popen[str], frontend: subprocess.Popen[str]) -> Path:
    local_dir = root / ".local"
    local_dir.mkdir(parents=True, exist_ok=True)
    path = root / PID_FILE
    path.write_text(
        json.dumps(
            {
                "backend_pid": backend.pid,
                "frontend_pid": frontend.pid,
                "created_by": "scripts/windows_start.py",
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return path


def _read_ports() -> tuple[int, int]:
    backend = int(os.environ.get("BACKEND_PORT", "8001"))
    frontend = int(os.environ.get("VITE_PORT", "5181"))
    return backend, frontend


def start(root: Path, *, backend_port: int, frontend_port: int, open_browser: bool = True) -> int:
    root = root.resolve()
    errors = check_offline_bundle(root)
    if errors:
        print("NoteBi Windows offline preflight failed:")
        for error in errors:
            print(f"- {error}")
        print("请先补齐 runtime、frontend/dist 和 models，再启动懒人包。")
        return 1

    if _port_is_open(backend_port) or _port_is_open(frontend_port):
        print(f"端口 {backend_port} 或 {frontend_port} 已被占用，请先运行 stop-notebi.bat。")
        return 1

    logs = root / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    backend_log: TextIO = (logs / "backend.log").open("a", encoding="utf-8")
    frontend_log: TextIO = (logs / "frontend.log").open("a", encoding="utf-8")

    environment = os.environ.copy()
    environment.update(
        {
            "NOTEBI_ROOT": str(root),
            "VITE_PRODUCT_MODE": "notebi",
            "BACKEND_PORT": str(backend_port),
            "VITE_PORT": str(frontend_port),
            "VITE_BACKEND_PORT": str(backend_port),
            "VITE_BACKEND_BASE_URL": f"http://127.0.0.1:{backend_port}",
            "PYTHONPATH": str(root),
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
            "HF_DATASETS_OFFLINE": "1",
            "HF_HOME": str(root / "models" / ".cache"),
            "HF_HUB_CACHE": str(root / "models" / ".cache" / "hub"),
            "NOTEBI_SHERPA_MODEL_DIR": str(root / "models" / "sherpa"),
        }
    )

    creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    backend = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "backend.app.main:app", "--host", "127.0.0.1", "--port", str(backend_port)],
        cwd=root,
        env=environment,
        stdout=backend_log,
        stderr=subprocess.STDOUT,
        text=True,
        creationflags=creationflags,
    )
    frontend = subprocess.Popen(
        [
            sys.executable,
            str(root / "scripts" / "serve_static.py"),
            "--root",
            str(root / "frontend" / "dist"),
            "--host",
            "127.0.0.1",
            "--port",
            str(frontend_port),
        ],
        cwd=root,
        env=environment,
        stdout=frontend_log,
        stderr=subprocess.STDOUT,
        text=True,
        creationflags=creationflags,
    )

    try:
        _wait_for(f"http://127.0.0.1:{backend_port}/health", backend)
        _wait_for(f"http://127.0.0.1:{frontend_port}/", frontend)
        pid_file = _write_pid_file(root, backend, frontend)
        url = f"http://127.0.0.1:{frontend_port}"
        print(f"NoteBi 已启动: {url}")
        print(f"日志目录: {logs}")
        print(f"停止方式: {root / 'stop-notebi.bat'}")
        print(f"进程记录: {pid_file}")
        if open_browser:
            webbrowser.open(url)
        while backend.poll() is None and frontend.poll() is None:
            time.sleep(1)
        raise RuntimeError("backend or frontend process exited")
    except KeyboardInterrupt:
        print("正在停止 NoteBi...")
    except Exception as exc:  # noqa: BLE001 - show actionable startup failure
        print(f"NoteBi 启动失败: {exc}")
        print(f"请查看日志: {logs / 'backend.log'} 和 {logs / 'frontend.log'}")
        return 1
    finally:
        _terminate(frontend)
        _terminate(backend)
        backend_log.close()
        frontend_log.close()
        pid_file = root / PID_FILE
        if pid_file.exists():
            pid_file.unlink()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--backend-port", type=int, default=None)
    parser.add_argument("--frontend-port", type=int, default=None)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args(argv)
    default_backend, default_frontend = _read_ports()
    return start(
        args.root,
        backend_port=args.backend_port or default_backend,
        frontend_port=args.frontend_port or default_frontend,
        open_browser=not args.no_browser,
    )


if __name__ == "__main__":
    raise SystemExit(main())
