"""PyInstaller entry point for the NoteBi desktop backend sidecar."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


if not getattr(sys, "frozen", False):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def main() -> None:
    parser = argparse.ArgumentParser(description="NoteBi local desktop backend")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8001)
    args = parser.parse_args()

    os.environ.setdefault("PYTHONUNBUFFERED", "1")

    from shared.config import ensure_data_dirs
    from shared.runtime_paths import PROJECTS_DIR, STATE_DIR

    ensure_data_dirs()
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)

    import uvicorn
    from backend.app.main import app

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
