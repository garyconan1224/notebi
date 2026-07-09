#!/usr/bin/env python3
"""Serve the three product-mode bundles and the shared backend locally."""

from __future__ import annotations

import argparse
import contextlib
import functools
import http.server
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path
from typing import Iterable


ROOT_DIR = Path(__file__).resolve().parent.parent
BUILD_ROOT = ROOT_DIR / "product-builds"
LOCAL_DIR = ROOT_DIR / ".local"
PRODUCTS = (
    ("nibi", 4301),
    ("notebi", 4302),
    ("replicabi", 4303),
)


class SPAServerHandler(http.server.SimpleHTTPRequestHandler):
    """Static file handler with React Router index fallback."""

    def __init__(self, *args, directory: str | os.PathLike[str], **kwargs) -> None:
        super().__init__(*args, directory=str(directory), **kwargs)

    def send_head(self):  # noqa: D401 - signature dictated by stdlib
        translated = Path(self.translate_path(self.path))
        if translated.is_dir():
            translated = translated / "index.html"
        if not translated.exists():
            self.path = "/index.html"
        return super().send_head()

    def log_message(self, fmt: str, *args) -> None:
        sys.stdout.write(f"[frontend:{self.server.server_port}] {fmt % args}\n")


def wait_for_http(url: str, *, timeout_s: float) -> bool:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1.0) as response:
                if response.status < 500:
                    return True
        except (OSError, urllib.error.URLError):
            time.sleep(0.25)
    return False


def port_open(port: int) -> bool:
    with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
        sock.settimeout(0.2)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def ensure_bundles() -> None:
    missing = [name for name, _port in PRODUCTS if not (BUILD_ROOT / name / "index.html").is_file()]
    if missing:
        names = ", ".join(missing)
        raise SystemExit(
            f"Missing product bundle(s): {names}\n"
            f"Run first: {ROOT_DIR / 'scripts' / 'build_product_bundles.sh'}"
        )


def start_backend(port: int) -> subprocess.Popen[str] | None:
    health_url = f"http://127.0.0.1:{port}/health"
    if wait_for_http(health_url, timeout_s=0.5):
        print(f"Backend already running: {health_url}")
        return None

    if port_open(port):
        raise SystemExit(f"Port {port} is in use, but backend health did not respond: {health_url}")

    LOCAL_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOCAL_DIR / "product-backend.log"
    uvicorn_bin = ROOT_DIR / ".venv" / "bin" / "uvicorn"
    if uvicorn_bin.is_file():
        command = [str(uvicorn_bin), "backend.app.main:app", "--host", "127.0.0.1", "--port", str(port)]
    else:
        python_bin = ROOT_DIR / ".venv" / "bin" / "python"
        command = [
            str(python_bin if python_bin.is_file() else "python3"),
            "-m",
            "uvicorn",
            "backend.app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ]

    print(f"Starting backend on http://127.0.0.1:{port}")
    log_file = log_path.open("a", encoding="utf-8")
    process = subprocess.Popen(
        command,
        cwd=ROOT_DIR,
        stdout=log_file,
        stderr=subprocess.STDOUT,
        text=True,
    )
    if not wait_for_http(health_url, timeout_s=20):
        process.terminate()
        raise SystemExit(f"Backend did not become ready. Check log: {log_path}")
    print(f"Backend ready. Log: {log_path}")
    return process


def start_frontend(name: str, port: int) -> http.server.ThreadingHTTPServer:
    if port_open(port):
        raise SystemExit(f"Port {port} is already in use; stop that process and run again.")
    directory = BUILD_ROOT / name
    handler = functools.partial(SPAServerHandler, directory=directory)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, name=f"serve-{name}", daemon=True)
    thread.start()
    return server


def stop_all(servers: Iterable[http.server.ThreadingHTTPServer], backend: subprocess.Popen[str] | None) -> None:
    for server in servers:
        server.shutdown()
        server.server_close()
    if backend and backend.poll() is None:
        backend.terminate()
        try:
            backend.wait(timeout=5)
        except subprocess.TimeoutExpired:
            backend.kill()


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve Nibi, NoteBi, and ReplicaBi local bundles.")
    parser.add_argument("--backend-port", type=int, default=8000)
    parser.add_argument("--no-open", action="store_true", help="Do not open browser tabs automatically.")
    args = parser.parse_args()

    ensure_bundles()
    backend = start_backend(args.backend_port)
    servers: list[http.server.ThreadingHTTPServer] = []
    try:
        urls: list[tuple[str, str]] = []
        for name, port in PRODUCTS:
            servers.append(start_frontend(name, port))
            urls.append((name, f"http://127.0.0.1:{port}"))

        print("\nProduct launch URLs:")
        for name, url in urls:
            print(f"  {name:<9} {url}")
        print(f"  backend   http://127.0.0.1:{args.backend_port}")
        print("\nPress Ctrl+C in this terminal to stop all local servers.\n")

        if not args.no_open:
            for _name, url in urls:
                webbrowser.open(url)

        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        print("\nStopping product servers...")
    finally:
        stop_all(servers, backend)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
