"""Phase 3C.4：分析任务 SUCCESS 后自动打标钩子测试。

直接测同步入口 _autotag_items_for_task；线程封装是 trivial 的，不重复测。
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from backend.app.models.tasks import TaskRecord, TaskStatus
from backend.app.models.workspace import WorkspaceItem, WorkspaceRecord
from backend.app.routes import workspaces as ws_module
from backend.app.services.workspace_store import WorkspaceStore


def _seed(tmp_path: Path) -> tuple[WorkspaceStore, str, str, str]:
    """造一个含 2 个 item 的 workspace：一个已打标、一个未打标且关联 task_id。"""
    store = WorkspaceStore(root=tmp_path / "workspaces")
    rec = WorkspaceRecord(workspace_id="ws_a", name="A 空间")
    rec.items = [
        WorkspaceItem(
            item_id="it_tagged",
            type="video",
            source="url",
            source_value="https://x/v1",
            name="已打标的",
            results={"video_title": "已打标的", "summary": "已经有 tags"},
            tags={"content_type": "教程"},
            related_task_ids=["analyze-existing"],
        ),
        WorkspaceItem(
            item_id="it_pending",
            type="video",
            source="url",
            source_value="https://x/v2",
            name="待打标的",
            results={"video_title": "待打标的", "summary": "等着 LLM 打标签"},
            related_task_ids=["analyze-fresh"],
        ),
    ]
    store.create(rec)
    return store, rec.workspace_id, "it_pending", "analyze-fresh"


def _make_task(task_id: str) -> TaskRecord:
    return TaskRecord(
        task_id=task_id,
        project_id="p1",
        task_type="analyze",
        payload={},
        status=TaskStatus.SUCCESS.value,
        result={"video_basenames": ["foo.mp4"]},
    )


def test_autotag_happy_path(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    store, wid, target_iid, task_id = _seed(tmp_path)
    monkeypatch.setattr(ws_module, "_store", store)

    # Mock generate_tags 返回固定 dict
    expected_tags = {
        "content_type": "评测",
        "subject_domain": "科技",
        "custom_tags": ["x"],
        "_generated_at": "2026-05-18T00:00:00Z",
        "_generated_model": "fake-model",
    }
    fake_generate = MagicMock(return_value=expected_tags)
    monkeypatch.setattr(
        "backend.app.services.tag_generator.generate_tags",
        fake_generate,
    )

    fake_runner = MagicMock()
    fake_runner.store = MagicMock()

    ws_module._autotag_items_for_task(_make_task(task_id), fake_runner)

    # 待打标 item 应被更新
    rec = store.get(wid)
    target = next(it for it in rec.items if it.item_id == target_iid)
    assert target.tags == expected_tags
    # 已打标 item 不应被改
    tagged = next(it for it in rec.items if it.item_id == "it_tagged")
    assert tagged.tags == {"content_type": "教程"}
    # generate_tags 只被调一次（只为未打标的）
    assert fake_generate.call_count == 1


def test_autotag_generate_failure_keeps_tags_empty(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    store, wid, target_iid, task_id = _seed(tmp_path)
    monkeypatch.setattr(ws_module, "_store", store)

    # generate_tags 抛异常 → 应被 except 吃掉，item.tags 保持空 dict
    fake_generate = MagicMock(side_effect=RuntimeError("LLM down"))
    monkeypatch.setattr(
        "backend.app.services.tag_generator.generate_tags",
        fake_generate,
    )

    fake_runner = MagicMock()
    fake_runner.store = MagicMock()

    ws_module._autotag_items_for_task(_make_task(task_id), fake_runner)

    rec = store.get(wid)
    target = next(it for it in rec.items if it.item_id == target_iid)
    assert target.tags == {}


def test_autotag_generate_returns_empty_dict_keeps_tags_empty(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """generate_tags 返回 {} 时不应触发 store.update_item（避免空写）。"""
    store, wid, target_iid, task_id = _seed(tmp_path)
    monkeypatch.setattr(ws_module, "_store", store)

    monkeypatch.setattr(
        "backend.app.services.tag_generator.generate_tags",
        MagicMock(return_value={}),
    )

    fake_runner = MagicMock()
    fake_runner.store = MagicMock()

    ws_module._autotag_items_for_task(_make_task(task_id), fake_runner)

    rec = store.get(wid)
    target = next(it for it in rec.items if it.item_id == target_iid)
    assert target.tags == {}
