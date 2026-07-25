#!/usr/bin/env python3
"""Compare exact, smart, and hybrid retrieval on representative queries."""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.services.retrieval_service import RetrievalService

DEFAULT_QUERIES = ["产品", "offline", "2026", "Qwen3"]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--modes", default="exact")
    parser.add_argument("--query", action="append", dest="queries")
    parser.add_argument("--top-k", type=int, default=10)
    args = parser.parse_args()
    service = RetrievalService()
    rows = []
    for mode in [value.strip() for value in args.modes.split(",") if value.strip()]:
        for query in args.queries or DEFAULT_QUERIES:
            started = time.perf_counter()
            try:
                result = service.search(
                    query=query,
                    mode=mode,
                    top_k=args.top_k,
                )
                rows.append({
                    "mode": mode,
                    "query": query,
                    "latency_ms": round((time.perf_counter() - started) * 1000, 3),
                    "source_count": len(result.get("sources", [])),
                    "source_ids": [
                        source.get("source_id")
                        for source in result.get("sources", [])[:3]
                    ],
                    "error": None,
                })
            except Exception as error:  # noqa: BLE001
                rows.append({
                    "mode": mode,
                    "query": query,
                    "latency_ms": round((time.perf_counter() - started) * 1000, 3),
                    "source_count": 0,
                    "source_ids": [],
                    "error": str(error),
                })
    successful = [row["latency_ms"] for row in rows if not row["error"]]
    print(json.dumps({
        "rows": rows,
        "successful_queries": len(successful),
        "latency_p50_ms": round(statistics.median(successful), 3)
        if successful else None,
        "latency_max_ms": max(successful, default=None),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
