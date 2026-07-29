#!/usr/bin/env python3
"""Start NoteBi from a Windows source checkout with the local dev toolchain."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

try:
    from scripts.windows_start import PID_FILE, _terminate, _wait_for, _write_pid_file
except ModuleNotFoundError:  # direct execution: python scripts/windows_dev_start.py
    from windows_start import PID_FILE, _terminate, _wait_for, _write_pid_file


def start(root: Path, *, backend_port: int = 8001, frontend_port: int = 5181) -> int:
    root = root.resolve()
    python_exe = root / ".venv" / "Scripts" / "python.exe"
    if not python_exe.is_file():
        print(f"未找到 Windows 虚拟环境: {python_exe}")
        return 1

    npm = shutil.which("npm.cmd") or shutil.which("npm")
    if not npm:
        print("未找到 npm，请安装 Node.js 18+ 后再启动源码模式。")
        return 1

    logs = root / ".local"
    logs.mkdir(parents=True, exist_ok=True)
    backend_log = (logs / "backend.log").open("a", encoding="utf-8")
    frontend_log = (logs / "frontend.log").open("a", encoding="utf-8")
    environment = os.environ.copy()
    environment.update(
        {
            "BACKEND_PORT": str(backend_port),
            "VITE_PORT": str(frontend_port),
            "VITE_BACKEND_PORT": str(backend_port),
            "VITE_BACKEND_BASE_URL": f"http://127.0.0.1:{backend_port}",
            "PYTHONPATH": str(root),
        }
    )
    creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    backend = subprocess.Popen(
        [str(python_exe), "-m", "uvicorn", "backend.app.main:app", "--reload", "--host", "127.0.0.1", "--port", str(backend_port)],
        cwd=root,
        env=environment,
        stdout=backend_log,
        stderr=subprocess.STDOUT,
        text=True,
        creationflags=creationflags,
    )
    frontend = subprocess.Popen(
        [npm, "run", "dev", "--", "--host", "127.0.0.1", "--port", str(frontend_port)],
        cwd=root / "frontend",
        env=environment,
        stdout=frontend_log,
        stderr=subprocess.STDOUT,
        text=True,
        creationflags=creationflags,
    )
    try:
        _wait_for(f"http://127.0.0.1:{backend_port}/health", backend)
        _wait_for(f"http://127.0.0.1:{frontend_port}/", frontend)
        _write_pid_file(root, backend, frontend)
        url = f"http://127.0.0.1:{frontend_port}"
        print(f"NoteBi 源码模式已启动: {url}")
        print(f"停止方式: {root / 'stop-notebi.bat'}")
        webbrowser.open(url)
        while backend.poll() is None and frontend.poll() is None:
            time.sleep(1)
        raise RuntimeError("backend or frontend process exited")
    except KeyboardInterrupt:
        print("正在停止 NoteBi...")
    except Exception as exc:  # noqa: BLE001 - show actionable startup failure
        print(f"NoteBi 源码模式启动失败: {exc}")
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    args = parser.parse_args()
    return start(args.root)


if __name__ == "__main__":
    raise SystemExit(main())
