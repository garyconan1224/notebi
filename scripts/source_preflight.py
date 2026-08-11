#!/usr/bin/env python3
"""Dependency-free checks for a NoteBi source checkout."""

from __future__ import annotations

import argparse
from pathlib import Path


def check_source_tree(root: Path) -> list[str]:
    """Return minimal errors for the public source distribution."""

    root = root.resolve()
    required = (
        "backend/app/main.py",
        "frontend/package.json",
        "requirements.txt",
        "start.sh",
    )
    return [f"missing source file: {path}" for path in required if not (root / path).is_file()]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd(), help="NoteBi package root")
    args = parser.parse_args(argv)

    errors = check_source_tree(args.root)
    if errors:
        print("NoteBi source preflight failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    print("NoteBi source preflight passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
