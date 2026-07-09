#!/usr/bin/env python3
"""一次性脚本：清理开发期测试数据（task-store-refactor 任务 6）。

安全策略（白名单反选）：
- 保留：project_id 属于真实工作空间 UUID（从 workspace_store 加载，含 trashed）。
- 其余视为测试项目，且**仅删终结态**（SUCCESS/FAILED/CANCELLED）的任务。
- 默认 dry-run；加 --apply 才真正写回。

用法：
  python3 scripts/cleanup_test_tasks.py          # dry-run，只看不删
  python3 scripts/cleanup_test_tasks.py --apply  # 确认后执行删除
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

# 确保能找到 backend 模块
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
sys.path.insert(0, str(PROJECT_DIR))

from backend.app.services.workspace_store import WorkspaceStore  # noqa: E402

TASK_FILE = PROJECT_DIR / ".local" / "backend_tasks.json"
TERMINAL_STATUSES = frozenset({"SUCCESS", "FAILED", "CANCELLED"})


def _is_uuid_like(s: str) -> bool:
    """简单判断是否像 UUID（长度 >= 32 且含 -）。"""
    return len(s) >= 32 and "-" in s


def _fmt_size(n_bytes: int) -> str:
    if n_bytes >= 1_000_000:
        return f"{n_bytes / 1_000_000:.1f}MB"
    if n_bytes >= 1_000:
        return f"{n_bytes / 1_000:.1f}KB"
    return f"{n_bytes}B"


def run(dry_run: bool = True) -> None:
    # 1. 加载真实工作空间 ID 集合
    print("→ 加载工作空间列表...")
    ws_store = WorkspaceStore()
    real_ids = {ws.workspace_id for ws in ws_store.list_all(include_trashed=True)}
    print(f"  真实工作空间（含垃圾桶）: {len(real_ids)} 个")
    for ws_id in sorted(real_ids):
        ws = ws_store.get(ws_id)
        name = ws.name if ws else "?"
        trashed = "🗑" if (ws and ws.trashed) else " "
        print(f"    {trashed} {ws_id}  \"{name}\"")

    # 2. 加载任务文件
    if not TASK_FILE.is_file():
        print(f"\n✗ 任务文件不存在: {TASK_FILE}")
        sys.exit(1)

    size_before = TASK_FILE.stat().st_size
    print(f"\n→ 读取任务文件: {TASK_FILE} ({_fmt_size(size_before)})...")
    data = json.loads(TASK_FILE.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        print("✗ 任务文件格式异常（非 list），放弃。")
        sys.exit(1)
    total = len(data)
    print(f"  总任务数: {total}")

    # 3. 分类
    keep: list[dict] = []
    delete: list[dict] = []
    skip_non_terminal: list[dict] = []

    for item in data:
        pid = item.get("project_id", "")
        is_real = pid in real_ids

        # 如果 project_id 不像 UUID 但恰好是真实工作空间 ID，保留（安全网）
        if is_real or _is_uuid_like(pid):
            keep.append(item)
            continue

        # 测试项目：只删终结态
        if item.get("status") in TERMINAL_STATUSES:
            delete.append(item)
        else:
            skip_non_terminal.append(item)

    # 4. 分组统计
    from collections import Counter

    del_counts = Counter(item.get("project_id", "?") for item in delete)
    skip_counts = Counter(item.get("project_id", "?") for item in skip_non_terminal)

    print(f"\n{'[DRY-RUN] ' if dry_run else ''}分类结果:")
    print(f"  保留（真实工作空间/UUID）: {len(keep)} 条")
    print(f"  将删除（测试+终结态）:    {len(delete)} 条")
    print(f"  跳过（测试+非终结态）:    {len(skip_non_terminal)} 条")

    print(f"\n{'[DRY-RUN] ' if dry_run else ''}将删除明细（按 project_id 分组）:")
    for pid, cnt in del_counts.most_common():
        samples = [item.get("task_id", "?") for item in delete if item.get("project_id") == pid][:3]
        print(f"  {pid}: {cnt} 条  示例: {', '.join(samples)}")

    if skip_non_terminal:
        print(f"\n{'[DRY-RUN] ' if dry_run else ''}跳过非终结态（未动）:")
        for pid, cnt in skip_counts.most_common():
            samples = [
                f"{item.get('task_id','?')}/{item.get('status','?')}"
                for item in skip_non_terminal
                if item.get("project_id") == pid
            ]
            print(f"  {pid}: {cnt} 条  {samples}")

    if dry_run:
        print("\n→ 这是 DRY-RUN 模式。确认无误后加 --apply 执行。")
        return

    # 5. --apply：备份 + 写回
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    bak_path = TASK_FILE.with_suffix(f".json.bak.{ts}")
    print(f"\n→ 备份: {bak_path}")
    shutil.copy2(TASK_FILE, bak_path)
    print(f"  备份完成 ({_fmt_size(bak_path.stat().st_size)})")

    # 构建保留列表
    new_data = keep + skip_non_terminal
    print(f"→ 写回: {len(new_data)} 条任务 ({_fmt_size(TASK_FILE.stat().st_size)} → ...)")
    payload = new_data
    tmp_path = TASK_FILE.with_suffix(".tmp")
    tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp_path.replace(TASK_FILE)
    size_after = TASK_FILE.stat().st_size
    print(f"  完成！文件大小: {_fmt_size(size_before)} → {_fmt_size(size_after)}")
    print(f"  删除了 {len(delete)} 条测试任务，备份在: {bak_path.name}")


def main() -> None:
    parser = argparse.ArgumentParser(description="清理开发期测试任务")
    parser.add_argument("--apply", action="store_true", help="真正执行删除（默认 dry-run）")
    args = parser.parse_args()
    run(dry_run=not args.apply)


if __name__ == "__main__":
    main()
