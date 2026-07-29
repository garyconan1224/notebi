"""NoteShell 结构化 AI 产物 API。"""

from __future__ import annotations

import pathlib
import tempfile
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from backend.app.models.tasks import TaskRecord
from backend.app.models.workspace import WorkspaceItem, WorkspaceRecord
from backend.app.services.workspace_store import WorkspaceStore


def _make_store() -> WorkspaceStore:
    store = WorkspaceStore(root=pathlib.Path(tempfile.mkdtemp()))
    item = WorkspaceItem.from_dict({
        "item_id": "item-1",
        "type": "text",
        "source": "local",
        "source_value": "manual",
        "name": "测试笔记",
        "status": "done",
        "results": {"content": "这是用于生成结构化产物的正文。"},
    })
    record = WorkspaceRecord(workspace_id="ws-1", name="测试工作空间")
    record.items.append(item)
    store.create(record)
    return store


@pytest.fixture(autouse=True)
def _patch_store(monkeypatch: pytest.MonkeyPatch) -> WorkspaceStore:
    import backend.app.routes.workspaces as ws_module

    store = _make_store()
    monkeypatch.setattr(ws_module, "_store", store)
    return store


from backend.app.main import app  # noqa: E402

client = TestClient(app)


def _task(task_id: str = "artifact-task-1") -> TaskRecord:
    return TaskRecord(
        task_id=task_id,
        project_id="ws-1",
        task_type="note_artifact",
        payload={"workspace_id": "ws-1", "item_id": "item-1", "kind": "mind_map"},
    )


def test_list_artifacts_is_empty_initially() -> None:
    response = client.get("/workspaces/ws-1/items/item-1/artifacts")
    assert response.status_code == 200
    assert response.json() == []


def test_create_artifact_task_and_link_to_item(
    monkeypatch: pytest.MonkeyPatch,
    _patch_store: WorkspaceStore,
) -> None:
    import backend.app.routes.workspaces as ws_module

    captured: dict[str, object] = {}

    def fake_create(project_id: str, task_type: str, payload: dict[str, object]) -> TaskRecord:
        captured.update(payload)
        assert task_type == "note_artifact"
        return _task()

    monkeypatch.setattr(ws_module._pipeline_runner, "create_task", fake_create)

    response = client.post(
        "/workspaces/ws-1/items/item-1/artifacts",
        json={"kind": "mind_map"},
    )

    assert response.status_code == 201
    assert response.json()["task_id"] == "artifact-task-1"
    assert captured["kind"] == "mind_map"
    assert "artifact-task-1" in _patch_store.get_item("ws-1", "item-1").related_task_ids


def test_selection_rewrite_requires_selected_text() -> None:
    response = client.post(
        "/workspaces/ws-1/items/item-1/artifacts",
        json={"kind": "selection_rewrite"},
    )
    assert response.status_code == 400
    assert "选中文本" in response.json()["detail"]


def test_artifact_handler_persists_independently_from_summaries(
    monkeypatch: pytest.MonkeyPatch,
    _patch_store: WorkspaceStore,
) -> None:
    import backend.app.routes.workspaces as ws_module

    generated = {
        "artifact_id": "artifact-1",
        "kind": "mind_map",
        "title": "思维导图",
        "content_md": "- 核心\n  - 分支",
        "source_scope": "full_note",
        "model_used": "provider/model",
        "created_at": "2026-07-29T00:00:00+00:00",
    }
    monkeypatch.setattr(
        ws_module,
        "generate_note_artifact",
        lambda *args, **kwargs: generated,
    )
    runner = MagicMock()

    result = ws_module._handle_note_artifact_task(_task(), runner)

    item = _patch_store.get_item("ws-1", "item-1")
    assert item.summaries == []
    assert item.results["ai_artifacts"] == [generated]
    assert result["artifact"] == generated


def test_delete_artifact() -> None:
    import backend.app.routes.workspaces as ws_module

    item = ws_module._store.get_item("ws-1", "item-1")
    item.results["ai_artifacts"] = [{
        "artifact_id": "artifact-1",
        "kind": "timeline",
        "title": "时间线",
        "content_md": "- 00:00 开始",
    }]
    ws_module._store.update_item("ws-1", "item-1", results=dict(item.results))

    response = client.delete("/workspaces/ws-1/items/item-1/artifacts/artifact-1")
    assert response.status_code == 200
    assert response.json()["artifact_id"] == "artifact-1"
    assert ws_module._store.get_item("ws-1", "item-1").results["ai_artifacts"] == []
