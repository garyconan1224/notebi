#!/usr/bin/env python3
"""Serve a Vite build with history-api fallback for the portable package."""

from __future__ import annotations

import argparse
import functools
import http.server
from pathlib import Path


class SPARequestHandler(http.server.SimpleHTTPRequestHandler):
    """Return index.html for client-side routes that are not files."""

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
        requested = self.translate_path(self.path.split("?", 1)[0])
        if not Path(requested).is_file():
            original_path = self.path
            self.path = "/index.html"
            try:
                super().do_GET()
            finally:
                self.path = original_path
            return
        super().do_GET()

    def log_message(self, format: str, *args: object) -> None:
        print(f"[frontend] {format % args}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True, help="frontend/dist directory")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5181)
    args = parser.parse_args()

    root = args.root.resolve()
    if not (root / "index.html").is_file():
        parser.error(f"frontend build not found: {root / 'index.html'}")

    handler = functools.partial(SPARequestHandler, directory=str(root))
    server = http.server.ThreadingHTTPServer((args.host, args.port), handler)
    print(f"NoteBi frontend listening on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
