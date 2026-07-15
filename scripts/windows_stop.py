#!/usr/bin/env python3
"""Stop NoteBi processes started by the Windows offline launcher."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path


def _kill(pid: int) -> None:
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return
    try:
        os.kill(pid, 15)
    except ProcessLookupError:
        pass


def stop(root: Path) -> int:
    pid_file = root.resolve() / ".local" / "windows_pids.json"
    if not pid_file.is_file():
        print("NoteBi 当前没有可停止的离线包进程记录。")
        return 0

    try:
        payload = json.loads(pid_file.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        print(f"无法读取进程记录: {exc}")
        return 1

    for key in ("frontend_pid", "backend_pid"):
        try:
            pid = int(payload.get(key, 0))
        except (TypeError, ValueError):
            pid = 0
        if pid > 0:
            _kill(pid)
            print(f"已停止 {key}: {pid}")

    pid_file.unlink(missing_ok=True)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    return stop(parser.parse_args().root)


if __name__ == "__main__":
    raise SystemExit(main())
