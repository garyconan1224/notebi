from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from backend.app.models.tasks import TaskRecord
from backend.app.models.workspace import WorkspaceItem, WorkspaceRecord
from backend.app.services import replica_purge
from backend.app.services.replica_purge import (
    _resolve_asset_dir,
    purge_legacy_replica_workspaces,
)
from backend.app.services.task_store import TaskStore
from backend.app.services.workspace_store import WorkspaceStore


def _record(workspace_id: str, kind: str, name: str) -> WorkspaceRecord:
    return WorkspaceRecord(
        workspace_id=workspace_id,
        name=name,
        kind=kind,
        items=[
            WorkspaceItem(
                item_id=f"{workspace_id}-item",
                type="text",
                source="local",
                source_value=f"{name}.txt",
                name=f"{name} item",
                results={"summary": f"{name} summary"},
            )
        ],
    )


def _task(task_id: str, project_id: str) -> TaskRecord:
    return TaskRecord(
        task_id=task_id,
        project_id=project_id,
        task_type="note",
        payload={},
    )


def _make_stores(tmp_path: Path):
    ws_root = tmp_path / "workspaces"
    store = WorkspaceStore(root=ws_root)
    tasks = TaskStore(path=tmp_path / "backend_tasks.json")
    return store, tasks, ws_root


def _write_asset(ws_root: Path, workspace_id: str) -> Path:
    asset_dir = ws_root / workspace_id
    asset_dir.mkdir(parents=True, exist_ok=True)
    (asset_dir / "frame.png").write_bytes(b"fake-image-bytes")
    return asset_dir


def test_purge_deletes_only_replica_keeps_note(tmp_path):
    store, tasks, ws_root = _make_stores(tmp_path)
    store.create(_record("note-1", "note", "Note"))
    store.create(_record("replica-1", "replica", "Replica"))

    result = purge_legacy_replica_workspaces(store, tasks)

    assert result["workspaces_deleted"] == 1
    assert store.get("note-1") is not None
    assert store.get("replica-1") is None
    assert (ws_root / "note-1.json").exists()
    assert not (ws_root / "replica-1.json").exists()


def test_purge_removes_metadata_assets_and_tasks(tmp_path):
    store, tasks, ws_root = _make_stores(tmp_path)
    store.create(_record("replica-1", "replica", "Replica"))
    asset_dir = _write_asset(ws_root, "replica-1")
    tasks.create(_task("task-replica", "replica-1"))

    result = purge_legacy_replica_workspaces(store, tasks)

    assert result["workspaces_deleted"] == 1
    assert result["items_deleted"] == 1
    assert result["tasks_deleted"] == 1
    assert result["errors"] == 0
    # metadata、资产目录、关联任务全部删除
    assert not (ws_root / "replica-1.json").exists()
    assert not asset_dir.exists()
    assert tasks.get("task-replica") is None


def test_purge_leaves_note_data_and_other_tasks_untouched(tmp_path):
    store, tasks, ws_root = _make_stores(tmp_path)
    store.create(_record("note-1", "note", "Note"))
    note_asset = _write_asset(ws_root, "note-1")
    tasks.create(_task("task-note", "note-1"))
    tasks.create(_task("task-orphan", "some-other-project"))
    # 与任何 workspace 无关的目录
    other_dir = tmp_path / "unrelated"
    other_dir.mkdir()
    (other_dir / "keep.txt").write_text("keep")

    result = purge_legacy_replica_workspaces(store, tasks)

    assert result["workspaces_deleted"] == 0
    assert result["tasks_deleted"] == 0
    assert store.get("note-1") is not None
    assert note_asset.exists()
    assert tasks.get("task-note") is not None
    assert tasks.get("task-orphan") is not None
    assert (other_dir / "keep.txt").read_text() == "keep"


def test_purge_skips_missing_or_unknown_kind(tmp_path):
    ws_root = tmp_path / "workspaces"
    ws_root.mkdir(parents=True, exist_ok=True)
    # 直接写原始 JSON，模拟升级用户的历史数据：缺失 kind / 未知 kind
    (ws_root / "legacy-no-kind.json").write_text(
        json.dumps({"workspace_id": "legacy-no-kind", "name": "NoKind", "items": []}),
        encoding="utf-8",
    )
    (ws_root / "legacy-weird-kind.json").write_text(
        json.dumps(
            {"workspace_id": "legacy-weird-kind", "name": "Weird", "kind": "weird", "items": []}
        ),
        encoding="utf-8",
    )
    store = WorkspaceStore(root=ws_root)
    tasks = TaskStore(path=tmp_path / "backend_tasks.json")

    result = purge_legacy_replica_workspaces(store, tasks)

    assert result["workspaces_deleted"] == 0
    # 反序列化层把缺失/未知 kind 归一为 note，因此绝不删除
    assert store.get("legacy-no-kind") is not None
    assert store.get("legacy-weird-kind") is not None
    assert (ws_root / "legacy-no-kind.json").exists()
    assert (ws_root / "legacy-weird-kind.json").exists()


def test_resolve_asset_dir_rejects_unsafe_targets(tmp_path):
    root = tmp_path / "workspaces"
    root.mkdir(parents=True, exist_ok=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("secret")

    # 空 ID / 点 / 上级穿越 / 含分隔符 → 拒绝
    assert _resolve_asset_dir(root, "") is None
    assert _resolve_asset_dir(root, ".") is None
    assert _resolve_asset_dir(root, "..") is None
    assert _resolve_asset_dir(root, "../outside") is None
    assert _resolve_asset_dir(root, "a/b") is None
    assert _resolve_asset_dir(root, "a\\b") is None

    # 符号链接 → 拒绝
    link = root / "sym-replica"
    os.symlink(outside, link)
    assert _resolve_asset_dir(root, "sym-replica") is None

    # 合法 ID → 允许，且解析后仍在 root 之内
    ok = _resolve_asset_dir(root, "good-id")
    assert ok is not None
    assert ok == (root / "good-id").resolve()
    # 外部目标未被触碰
    assert (outside / "secret.txt").read_text() == "secret"


def test_purge_rejects_path_traversal_and_keeps_record(tmp_path):
    store, tasks, ws_root = _make_stores(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("secret")
    # 被污染的 ID：含路径穿越
    store.create(_record("../outside", "replica", "Evil"))

    result = purge_legacy_replica_workspaces(store, tasks)

    # 拒绝删除：记录保留、外部目录完好、计入错误
    assert result["workspaces_deleted"] == 0
    assert result["errors"] == 1
    assert store.get("../outside") is not None
    assert (outside / "secret.txt").read_text() == "secret"


def test_purge_is_idempotent(tmp_path):
    store, tasks, ws_root = _make_stores(tmp_path)
    store.create(_record("replica-1", "replica", "Replica"))
    _write_asset(ws_root, "replica-1")
    tasks.create(_task("task-replica", "replica-1"))

    first = purge_legacy_replica_workspaces(store, tasks)
    second = purge_legacy_replica_workspaces(store, tasks)

    assert first["workspaces_deleted"] == 1
    assert second == {
        "workspaces_deleted": 0,
        "items_deleted": 0,
        "tasks_deleted": 0,
        "errors": 0,
    }


def test_purge_invalidates_global_cache_when_replica_present(tmp_path, monkeypatch):
    store, tasks, ws_root = _make_stores(tmp_path)
    store.create(_record("note-1", "note", "Note"))
    store.create(_record("replica-1", "replica", "Replica"))

    invalidated = []
    monkeypatch.setattr(
        replica_purge,
        "invalidate_global_knowledge_caches",
        lambda: invalidated.append(True),
    )

    purge_legacy_replica_workspaces(store, tasks)

    assert invalidated == [True]


def test_purge_no_replica_does_not_invalidate_cache(tmp_path, monkeypatch):
    store, tasks, ws_root = _make_stores(tmp_path)
    store.create(_record("note-1", "note", "Note"))

    invalidated = []
    monkeypatch.setattr(
        replica_purge,
        "invalidate_global_knowledge_caches",
        lambda: invalidated.append(True),
    )

    result = purge_legacy_replica_workspaces(store, tasks)

    assert result["workspaces_deleted"] == 0
    assert invalidated == []


def test_purge_also_removes_trashed_replica(tmp_path):
    store, tasks, ws_root = _make_stores(tmp_path)
    trashed = _record("replica-trashed", "replica", "Trashed")
    trashed.trashed = True
    store.create(trashed)

    result = purge_legacy_replica_workspaces(store, tasks)

    assert result["workspaces_deleted"] == 1
    assert store.get("replica-trashed") is None
    assert not (ws_root / "replica-trashed.json").exists()
