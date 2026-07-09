#!/usr/bin/env python3
"""
清理 .local/backend_tasks.json 中的冗余失败记录。

默认行为：对「同一 project_id + 同一 URL」且状态为 failed、错误与 append_log 相关的
download 任务，仅保留 updated_at 最新的一条，删除其余重复项。

用法：
  python scripts/prune_backend_tasks.py          # 执行清理并写回
  python scripts/prune_backend_tasks.py --dry-run   # 只打印将删除的 task_id
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path


def _norm_url(payload: object) -> str:
    if not isinstance(payload, dict):
        return ""
    return str(payload.get("url") or "").strip().lower()


def _has_append_log_bug(rec: dict) -> bool:
    err = str(rec.get("error") or "")
    blob = err
    for e in rec.get("log") or []:
        if isinstance(e, dict):
            blob += " " + str(e.get("message") or "")
    return "append_log" in blob


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="不写入文件，仅打印")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    path = root / ".local" / "backend_tasks.json"
    if not path.is_file():
        print(f"无任务文件: {path}")
        return

    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        print("任务文件格式异常（应为 JSON 数组）")
        return

    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for rec in raw:
        if not isinstance(rec, dict):
            continue
        if rec.get("task_type") != "download" or rec.get("status") != "failed":
            continue
        if not _has_append_log_bug(rec):
            continue
        pid = str(rec.get("project_id") or "")
        key = (pid, _norm_url(rec.get("payload")))
        groups[key].append(rec)

    remove_ids: set[str] = set()
    for (_pid, _url), recs in groups.items():
        if len(recs) < 2:
            continue
        recs.sort(key=lambda r: str(r.get("updated_at") or r.get("created_at") or ""), reverse=True)
        for r in recs[1:]:
            tid = str(r.get("task_id") or "")
            if tid:
                remove_ids.add(tid)

    if not remove_ids:
        print("未发现需按规则合并删除的重复 append_log 失败下载任务。")
        return

    print(f"将删除 {len(remove_ids)} 条重复任务: {sorted(remove_ids)}")
    if args.dry_run:
        return

    new_list = [rec for rec in raw if isinstance(rec, dict) and str(rec.get("task_id") or "") not in remove_ids]
    path.write_text(json.dumps(new_list, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已写回 {path}，剩余 {len(new_list)} 条记录。")


if __name__ == "__main__":
    main()
