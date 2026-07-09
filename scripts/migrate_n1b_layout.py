#!/usr/bin/env python3
"""N1b 磁盘布局迁移：data/projects/<id>/ → data/workspaces/<id>/

用法：
    python scripts/migrate_n1b_layout.py            # 默认 --dry-run，只列出会搬什么
    python scripts/migrate_n1b_layout.py --apply     # 真搬，原目录改名为 data/projects.bak.<ts>/

安全机制：
    - 默认 dry-run，不改任何文件
    - --apply 时先检查后端端口是否在监听，是则 abort
    - 搬完后原目录改名为 .bak，不删除
"""

from __future__ import annotations

import argparse
import os
import shutil
import socket
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from shared.config import DATA_DIR, WORKSPACES_DATA_DIR

OLD_DIR: Path = DATA_DIR / "projects"


def _is_port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def _check_backend_running() -> None:
    port = int(os.environ.get("BACKEND_PORT", "8000"))
    if _is_port_in_use(port):
        print(f"❌ 后端正在监听 :{port}，请先停止再迁移（避免运行中读写冲突）。")
        sys.exit(1)


def scan() -> list[tuple[str, Path]]:
    """扫描 data/projects/，返回 (workspace_id, old_path) 列表。"""
    if not OLD_DIR.is_dir():
        return []
    entries: list[tuple[str, Path]] = []
    for child in sorted(OLD_DIR.iterdir()):
        if child.is_dir():
            entries.append((child.name, child))
    return entries


def migrate(dry_run: bool = True) -> None:
    entries = scan()
    if not entries:
        print("ℹ️  data/projects/ 为空或不存在，无需迁移。")
        return

    print(f"{'[DRY-RUN] ' if dry_run else ''}发现 {len(entries)} 个目录待迁移：\n")

    for ws_id, old_path in entries:
        dest = WORKSPACES_DATA_DIR / ws_id
        if dest.exists():
            print(f"  ⚠️  {ws_id}  → 目标已存在，跳过")
            continue
        print(f"  {old_path}")
        print(f"    → {dest}")

    print()

    if dry_run:
        print("💡 这是 dry-run。确认无误后执行：")
        print("   python scripts/migrate_n1b_layout.py --apply")
        return

    # --apply 模式
    _check_backend_running()

    migrated = 0
    skipped = 0
    errors: list[str] = []

    for ws_id, old_path in entries:
        dest = WORKSPACES_DATA_DIR / ws_id
        if dest.exists():
            print(f"  ⚠️  跳过 {ws_id}（目标已存在）")
            skipped += 1
            continue
        try:
            shutil.move(str(old_path), str(dest))
            print(f"  ✅ {ws_id}")
            migrated += 1
        except Exception as e:
            print(f"  ❌ {ws_id}: {e}")
            errors.append(f"{ws_id}: {e}")

    # 重命名旧目录为 .bak
    if migrated > 0:
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        bak_path = OLD_DIR.parent / f"projects.bak.{ts}"
        try:
            OLD_DIR.rename(bak_path)
            print(f"\n📦 旧目录已重命名为 {bak_path}")
        except OSError as e:
            print(f"\n⚠️  无法重命名旧目录：{e}")
            print(f"   请手动删除 {OLD_DIR}")

    print(f"\n完成：迁移 {migrated} 个，跳过 {skipped} 个，错误 {len(errors)} 个。")
    if errors:
        print("错误详情：")
        for err in errors:
            print(f"  - {err}")
    if migrated > 0:
        print(f"\n⚠️  .bak 目录保留了原始数据，确认无误后可手动删除。")


def main() -> None:
    parser = argparse.ArgumentParser(description="N1b 磁盘布局迁移")
    parser.add_argument(
        "--apply",
        action="store_true",
        default=False,
        help="执行迁移（默认 dry-run）",
    )
    args = parser.parse_args()
    migrate(dry_run=not args.apply)


if __name__ == "__main__":
    main()
