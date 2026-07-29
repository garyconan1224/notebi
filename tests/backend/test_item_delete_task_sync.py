from __future__ import annotations

"""删除素材时的任务同步契约测试（阶段 C / A3）。

契约：
  - 删除单个 item 会同时删除它 related_task_ids 里的原始任务与 summary 任务。
  - 同 workspace 其它 item 的任务不受影响。
  - 批量删除遵守相同契约。
"""

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.routes import workspaces as ws_module
from backend.app.models.workspace import WorkspaceItem, WorkspaceRecord
from backend.app.services.workspace_store import WorkspaceStore


@pytest.fixture()
def client_and_runner(tmp_path: Path):
    """隔离 store + mock pipeline runner，返回 (client, mock_runner)。"""
    isolated_store = WorkspaceStore(root=tmp_path / "workspaces")

    item_a = WorkspaceItem(
        item_id="item-a",
        type="video",
        source="url",
        source_value="https://example.com/a.mp4",
        name="素材 A",
        related_task_ids=["task-a-analyze", "task-a-summary"],
    )
    item_b = WorkspaceItem(
        item_id="item-b",
        type="audio",
        source="url",
        source_value="https://example.com/b.mp3",
        name="素材 B",
        related_task_ids=["task-b-analyze"],
    )
    isolated_store.create(
        WorkspaceRecord(workspace_id="ws-1", name="test", items=[item_a, item_b])
    )

    mock_runner = MagicMock()
    mock_runner.store.get.return_value = None

    app = FastAPI()
    with (
        patch.object(ws_module, "_store", isolated_store),
        patch.object(ws_module, "_pipeline_runner", mock_runner),
    ):
        app.include_router(ws_module.router)
        with TestClient(app) as c:
            yield c, mock_runner


def _deleted_tids(mock_runner: MagicMock) -> set[str]:
    return {call.args[0] for call in mock_runner.store.delete.call_args_list}


def test_delete_item_removes_its_analyze_and_summary_tasks(client_and_runner) -> None:
    client, runner = client_and_runner

    resp = client.delete("/workspaces/ws-1/items/item-a")
    assert resp.status_code == 200

    deleted = _deleted_tids(runner)
    assert "task-a-analyze" in deleted
    assert "task-a-summary" in deleted


def test_delete_item_does_not_touch_other_items_tasks(client_and_runner) -> None:
    client, runner = client_and_runner

    resp = client.delete("/workspaces/ws-1/items/item-a")
    assert resp.status_code == 200

    deleted = _deleted_tids(runner)
    assert "task-b-analyze" not in deleted


def test_batch_delete_items_removes_their_tasks(client_and_runner) -> None:
    client, runner = client_and_runner

    resp = client.post(
        "/workspaces/items/batch-delete",
        json={"items": [
            {"workspace_id": "ws-1", "item_id": "item-a"},
            {"workspace_id": "ws-1", "item_id": "item-b"},
        ]},
    )
    assert resp.status_code == 200
    assert resp.json()["removed"] == 2

    deleted = _deleted_tids(runner)
    assert "task-a-analyze" in deleted
    assert "task-a-summary" in deleted
    assert "task-b-analyze" in deleted
