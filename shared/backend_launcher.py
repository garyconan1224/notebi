"""Manual backend launcher for Streamlit pages."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from shared.backend_client import backend_health
from shared.config import ROOT_DIR, get_backend_base_url


@dataclass(frozen=True)
class LaunchResult:
    ok: bool
    message: str
    pid: int | None = None


def _parse_host_port(base_url: str) -> tuple[str, int, str]:
    raw = (base_url or "").strip()
    if not raw:
        raw = get_backend_base_url()
    if "://" not in raw:
        raw = f"http://{raw}"
    parsed = urlparse(raw)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 8000

    probe_host = host
    if host in {"0.0.0.0", "::"}:
        probe_host = "127.0.0.1"
    probe_url = f"http://{probe_host}:{port}"
    return host, port, probe_url


def _build_env() -> dict[str, str]:
    env = dict(os.environ)
    root = str(ROOT_DIR)
    cur = (env.get("PYTHONPATH") or "").strip()
    if cur:
        if root not in cur.split(os.pathsep):
            env["PYTHONPATH"] = root + os.pathsep + cur
    else:
        env["PYTHONPATH"] = root
    return env


def _python_version_tuple(executable: str) -> tuple[int, int, int] | None:
    for _ in range(2):
        try:
            proc = subprocess.run(  # noqa: S603
                [executable, "-c", "import sys;print(f'{sys.version_info[0]}.{sys.version_info[1]}.{sys.version_info[2]}')"],
                check=True,
                capture_output=True,
                text=True,
                timeout=4.0,
            )
            s = (proc.stdout or "").strip()
            parts = s.split(".")
            if len(parts) != 3:
                continue
            return int(parts[0]), int(parts[1]), int(parts[2])
        except Exception:
            continue
    return None


def _can_import_uvicorn(executable: str) -> bool:
    try:
        subprocess.run(  # noqa: S603
            [executable, "-c", "import uvicorn;print('ok')"],
            check=True,
            capture_output=True,
            text=True,
            timeout=2.0,
        )
        return True
    except Exception:
        return False


def _select_python_for_backend() -> tuple[str, str, bool]:
    preferred = (os.environ.get("VIDMIRROR_BACKEND_PYTHON") or "").strip()
    candidates_raw = [preferred, sys.executable, "python3.12", "python3.11", "python3.10", "python3"]
    candidates: list[str] = []
    for item in candidates_raw:
        if not item:
            continue
        exe = item
        if os.path.sep not in item:
            found = shutil.which(item)
            if not found:
                continue
            exe = found
        if exe not in candidates:
            candidates.append(exe)

    best: tuple[str, tuple[int, int, int], bool] | None = None
    for exe in candidates:
        ver = _python_version_tuple(exe)
        if ver is None or ver < (3, 10, 0):
            continue
        has_uvicorn = _can_import_uvicorn(exe)
        if best is None or ver > best[1] or (ver == best[1] and has_uvicorn and not best[2]):
            best = (exe, ver, has_uvicorn)
    if best is not None:
        exe, ver, has_uvicorn = best
        return exe, f"{ver[0]}.{ver[1]}.{ver[2]}", has_uvicorn

    fallback_ver = _python_version_tuple(sys.executable)
    return (
        sys.executable,
        f"{fallback_ver[0]}.{fallback_ver[1]}.{fallback_ver[2]}" if fallback_ver else "unknown",
        _can_import_uvicorn(sys.executable),
    )


def _build_python_readiness_hint() -> str:
    names = ["python3.12", "python3.11", "python3.10", "python3"]
    records: list[dict[str, object]] = []
    for name in names:
        exe = shutil.which(name)
        if not exe:
            continue
        ver = _python_version_tuple(exe)
        has_uvicorn = _can_import_uvicorn(exe)
        records.append({"name": name, "exe": exe, "version": ver, "has_uvicorn": has_uvicorn})
    if not records:
        return (
            "未发现 python3.10+ 解释器。请先安装 Python 3.10+，"
            "再执行：python3.10 -m pip install -r requirements.txt"
        )
    for rec in records:
        ver = rec.get("version")
        if isinstance(ver, tuple) and ver >= (3, 10, 0) and not rec.get("has_uvicorn", False):
            exe = str(rec.get("exe"))
            return (
                f"检测到可用解释器 {exe} 但未安装 uvicorn/依赖。"
                f"请执行：{exe} -m pip install -r requirements.txt"
            )
    return "请确认后端运行环境使用 Python 3.10+ 且已安装 requirements 依赖。"


def _install_backend_requirements(executable: str) -> tuple[bool, str]:
    req = ROOT_DIR / "requirements.txt"
    if not req.is_file():
        return False, f"未找到依赖文件：{req}"
    cmd = [executable, "-m", "pip", "install", "-r", str(req)]
    try:
        proc = subprocess.run(  # noqa: S603
            cmd,
            cwd=str(ROOT_DIR),
            env=_build_env(),
            capture_output=True,
            text=True,
            timeout=180.0,
        )
        if proc.returncode == 0:
            return True, "依赖自动安装成功。"
        err_text = ((proc.stderr or "") + "\n" + (proc.stdout or "")).strip()
        tail = "\n".join([line for line in err_text.splitlines() if line][-15:])
        return False, f"依赖自动安装失败（exit={proc.returncode}）。\n{tail}"
    except Exception as err:  # noqa: BLE001
        return False, f"依赖自动安装异常：{err}"


def start_backend_once(base_url: str | None = None, *, wait_timeout_sec: float = 8.0) -> LaunchResult:
    target = (base_url or get_backend_base_url()).strip()
    if backend_health(target):
        return LaunchResult(ok=True, message="后端已在运行，无需重复启动。")

    host, port, probe_url = _parse_host_port(target)
    py_exec, py_ver, has_uvicorn = _select_python_for_backend()
    selected_ver = _python_version_tuple(py_exec)
    if selected_ver is None or selected_ver < (3, 10, 0):
        hint = _build_python_readiness_hint()
        return LaunchResult(
            ok=False,
            message=(
                f"自动启动失败：当前解释器 `{py_exec}` (Python {py_ver}) 不兼容后端。"
                f"\n{hint}\n"
                "可选：设置环境变量 `VIDMIRROR_BACKEND_PYTHON` 指向可用解释器后重试。"
            ),
        )
    if not has_uvicorn:
        ok, msg = _install_backend_requirements(py_exec)
        if not ok:
            return LaunchResult(
                ok=False,
                message=(
                    f"自动启动失败：解释器 `{py_exec}` (Python {py_ver}) 依赖缺失且自动安装失败。"
                    f"\n{msg}\n"
                    f"请手动执行：{py_exec} -m pip install -r {ROOT_DIR / 'requirements.txt'}"
                ),
            )
        if not _can_import_uvicorn(py_exec):
            return LaunchResult(
                ok=False,
                message=(
                    f"自动安装后仍无法导入 uvicorn（解释器 `{py_exec}`）。\n"
                    f"请手动执行：{py_exec} -m pip install -r {ROOT_DIR / 'requirements.txt'}"
                ),
            )

    cmd = [
        py_exec,
        "-m",
        "uvicorn",
        "backend.app.main:app",
        "--host",
        host,
        "--port",
        str(port),
    ]
    log_file = Path(ROOT_DIR) / ".local" / "backend_autostart.log"
    log_file.parent.mkdir(parents=True, exist_ok=True)

    try:
        with log_file.open("ab") as out:
            proc = subprocess.Popen(  # noqa: S603
                cmd,
                cwd=str(ROOT_DIR),
                env=_build_env(),
                stdout=out,
                stderr=out,
            )
    except Exception as err:  # noqa: BLE001
        manual = f"{py_exec} -m uvicorn backend.app.main:app --host {host} --port {port}"
        return LaunchResult(ok=False, message=f"启动失败：{err}\n可手动执行：{manual}")

    deadline = time.monotonic() + max(1.0, wait_timeout_sec)
    while time.monotonic() < deadline:
        if backend_health(probe_url, timeout_sec=0.8):
            return LaunchResult(ok=True, message=f"后端已启动：{probe_url}", pid=proc.pid)
        if proc.poll() is not None:
            break
        time.sleep(0.4)

    if proc.poll() is None:
        proc.terminate()
        time.sleep(0.2)
        if proc.poll() is None:
            proc.kill()
    manual = f"{py_exec} -m uvicorn backend.app.main:app --host {host} --port {port}"
    return LaunchResult(
        ok=False,
        message=f"自动启动后端超时或失败，请查看日志：{log_file}\n可手动执行：{manual}",
        pid=proc.pid,
    )

