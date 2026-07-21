"""Legacy replica data purge (NoteBi single-product cleanup, Phase 2).

NoteBi 是单一产品后，历史遗留的 ``kind == "replica"`` 复刻合集不再有任何业务入口。
用户已明确选择：检测到旧复刻数据时**永久删除**——不移入回收站、不转换成普通笔记、
不保留备份。

本模块提供幂等的启动期清理：

1. 严格匹配 ``WorkspaceRecord.kind == "replica"``（反序列化层已把缺失/未知 kind 归一为
   ``note``，因此只有真正的 replica 记录会被选中）；
2. 删除该合集的素材产物目录 ``data/workspaces/<workspace_id>/``；
3. 删除 ``data/workspaces/<workspace_id>.json`` 记录（同时从内存索引移除）；
4. 删除 ``.local/tasks/`` 中 ``project_id == workspace_id`` 的关联任务；
5. 失效全局知识库缓存（``__global__`` 与 ``__global_sub__:*``）。

安全约束：

- 删除目标必须由已解析、已校验的 workspace ID 生成；
- ``resolve()`` 后必须仍位于 ``data/workspaces`` 根目录之内，且不等于根目录；
- 拒绝空 ID、``.``/``..``、含路径分隔符、符号链接或解析后越界的目标；
- 部分删除失败时记录明确错误并保留记录，使下次启动可继续重试。
"""

from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Dict, List, Optional

from backend.app.services.global_knowledge import invalidate_global_knowledge_caches
from backend.app.services.task_store import TaskStore
from backend.app.services.workspace_store import WorkspaceStore

logger = logging.getLogger(__name__)

# 严格匹配 replica；note / 缺失 / 未知 kind 在反序列化层已归一为 note，绝不删除。
_REPLICA_KIND = "replica"


def _resolve_asset_dir(root: Path, workspace_id: str) -> Optional[Path]:
    """把 workspace_id 解析成位于 ``root`` 之内的素材目录，非法目标返回 None。

    拒绝：空 ID、``.``/``..``、含 ``/`` 或 ``\\``、符号链接，以及 ``resolve()`` 后越界或
    等于根目录的路径。这样即使记录里出现被污染的 ID，也不会触发对根目录或外部路径的
    递归删除。
    """

    wid = (workspace_id or "").strip()
    if not wid or wid in {".", ".."} or "/" in wid or "\\" in wid:
        return None

    raw = root / wid
    if raw.is_symlink():
        return None

    root_resolved = root.resolve()
    candidate = raw.resolve()
    if candidate == root_resolved:
        return None
    try:
        candidate.relative_to(root_resolved)
    except ValueError:
        return None
    return candidate


def purge_legacy_replica_workspaces(
    workspace_store: WorkspaceStore,
    task_store: TaskStore,
) -> Dict[str, int]:
    """永久删除所有 ``kind == "replica"`` 的旧复刻合集及其关联数据。

    幂等：没有 replica 记录时返回全 0，不触发缓存失效。部分失败会记录错误并保留对应
    记录，使下次启动可继续重试。返回删除计数（不输出素材正文）。
    """

    # include_trashed=True：回收站里的旧 replica 也一并永久删除。
    replicas: List = [
        rec
        for rec in workspace_store.list_all(include_trashed=True)
        if rec.kind == _REPLICA_KIND
    ]
    result = {
        "workspaces_deleted": 0,
        "items_deleted": 0,
        "tasks_deleted": 0,
        "errors": 0,
    }
    if not replicas:
        return result

    all_tasks = task_store.list_all()
    for rec in replicas:
        wid = rec.workspace_id
        item_count = len(rec.items)

        # 1. 先删素材产物目录；失败则保留 JSON 记录，下次启动重试。
        asset_dir = _resolve_asset_dir(workspace_store.root, wid)
        if asset_dir is None:
            logger.error("replica purge: 拒绝不安全的素材目录目标 workspace_id=%r", wid)
            result["errors"] += 1
            continue
        if asset_dir.is_dir():
            try:
                shutil.rmtree(asset_dir)
            except OSError:
                logger.exception("replica purge: 删除素材目录失败 workspace_id=%s", wid)
                result["errors"] += 1
                continue

        # 2. 删除关联任务（project_id == workspace_id）。
        for task in [t for t in all_tasks if t.project_id == wid]:
            try:
                if task_store.delete(task.task_id):
                    result["tasks_deleted"] += 1
            except Exception:  # noqa: BLE001 - 记录错误后继续，不中断整体清理
                logger.exception("replica purge: 删除关联任务失败 task_id=%s", task.task_id)
                result["errors"] += 1

        # 3. 删除 JSON 记录并从内存索引移除。
        try:
            if workspace_store.delete(wid):
                result["workspaces_deleted"] += 1
                result["items_deleted"] += item_count
            else:
                logger.error("replica purge: 记录删除返回 False workspace_id=%s", wid)
                result["errors"] += 1
        except Exception:  # noqa: BLE001
            logger.exception("replica purge: 删除 workspace 记录失败 workspace_id=%s", wid)
            result["errors"] += 1

    # 4. 只要发生过删除，就失效全局与子范围知识库缓存。
    if result["workspaces_deleted"] > 0:
        try:
            invalidate_global_knowledge_caches()
        except Exception:  # noqa: BLE001
            logger.exception("replica purge: 失效全局知识库缓存失败")
            result["errors"] += 1

    logger.info(
        "replica purge: 永久删除 workspaces=%d items=%d tasks=%d errors=%d",
        result["workspaces_deleted"],
        result["items_deleted"],
        result["tasks_deleted"],
        result["errors"],
    )
    return result
