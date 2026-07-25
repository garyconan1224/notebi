#!/usr/bin/env python3
"""Manage the JSON content-identity migration."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.services.content_identity_migration import (
    inspect_content_identities,
    migrate_content_identities,
    rollback_content_identities,
)
from shared.config import DATA_DIR


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--rollback", type=Path)
    parser.add_argument("--root", type=Path, default=DATA_DIR / "workspaces")
    parser.add_argument("--backup-root", type=Path, default=DATA_DIR / "backups")
    args = parser.parse_args()
    if args.rollback:
        result = rollback_content_identities(args.root, args.rollback)
    elif args.apply:
        result = migrate_content_identities(args.root, args.backup_root)
    else:
        result = inspect_content_identities(args.root)
        result.pop("payloads", None)
        result["dry_run"] = True
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
