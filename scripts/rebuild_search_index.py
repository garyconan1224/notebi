#!/usr/bin/env python3
"""Rebuild the local, derived SQLite exact-search index."""

from __future__ import annotations

import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.services.exact_search_service import ExactSearchService


def main() -> None:
    print(json.dumps(ExactSearchService().rebuild(), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
