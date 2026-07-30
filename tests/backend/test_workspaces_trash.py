"""Phase N1 — 任务垃圾桶 / 软删除 路由测试。

覆盖：
- 软删除（DELETE /workspaces/{id}）后主列表不见、trashed_only 能查到
- 恢复（POST /workspaces/{id}/restore）后主列表回归
- 彻底删除（DELETE /workspaces/{id}/permanent）需先软删；JSON 与上传目录被清理
- 清空垃圾桶（DELETE /workspaces/trash）批量物理删
- 老数据 status="completed" 自动映射为 "analyzed"
- from_dict 静默忽略老 project_id 字段
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.models.workspace import WorkspaceItem, WorkspaceRecord, WorkspaceStatus
from backend.app.routes import workspaces as ws_module
from backend.app.services.workspace_store import WorkspaceStore


@pytest.fixture()
def client(tmp_path: Path):
    store = WorkspaceStore(root=tmp_path / "workspaces")
    mock_runner = MagicMock()
    mock_runner.store.get.return_value = None

    app = FastAPI()
    with (
        patch.object(ws_module, "_store", store),
        patch.object(ws_module, "_pipeline_runner", mock_runner),
        patch.object(
            ws_module, "WORKSPACE_UPLOAD_ROOT", tmp_path / "uploads", create=False
        ),
    ):
        app.include_router(ws_module.router)
        with TestClient(app) as c:
            yield c, store


def _make_ws(c: TestClient, name: str = "n1-test") -> str:
    r = c.post("/workspaces", json={"name": name})
    assert r.status_code == 200, r.text
    return r.json()["workspace_id"]


def test_soft_delete_then_restore_then_permanent(client):
    c, store = client
    wid = _make_ws(c, "soft-del-test")

    # 软删除：主列表消失、trash 可见
    r = c.delete(f"/workspaces/{wid}")
    assert r.status_code == 200
    assert r.json()["trashed"] is True
    assert wid not in {w["workspace_id"] for w in c.get("/workspaces").json()}
    assert wid in {w["workspace_id"] for w in c.get("/workspaces?trashed_only=true").json()}

    # 软删除幂等
    r = c.delete(f"/workspaces/{wid}")
    assert r.status_code == 200
    assert r.json().get("already") is True

    # 恢复：主列表回归
    r = c.post(f"/workspaces/{wid}/restore")
    assert r.status_code == 200
    assert wid in {w["workspace_id"] for w in c.get("/workspaces").json()}
    rec = store.get(wid)
    assert rec is not None and rec.trashed is False
    # 原 status 应该是 active（默认值），未被覆盖
    assert rec.status == WorkspaceStatus.ACTIVE.value

    # 未软删时不能彻底删
    r = c.delete(f"/workspaces/{wid}/permanent")
    assert r.status_code == 400

    # 软删除后再彻底删
    c.delete(f"/workspaces/{wid}")
    r = c.delete(f"/workspaces/{wid}/permanent")
    assert r.status_code == 200
    assert store.get(wid) is None
    assert c.get(f"/workspaces/{wid}").status_code == 404


def test_empty_trash(client):
    c, store = client
    w1 = _make_ws(c, "trash-a")
    w2 = _make_ws(c, "trash-b")
    w3 = _make_ws(c, "keep-c")  # 不进垃圾桶
    c.delete(f"/workspaces/{w1}")
    c.delete(f"/workspaces/{w2}")

    r = c.delete("/workspaces/trash")
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 2
    assert set(body["deleted"]) == {w1, w2}

    # 未软删的留着
    assert store.get(w3) is not None
    # 软删的都没了
    assert store.get(w1) is None and store.get(w2) is None


def test_from_dict_migrates_completed_and_ignores_project_id():
    """老数据兼容：旧 status="completed" → "analyzed"；project_id 字段静默忽略。"""
    old = {
        "workspace_id": "legacy-001",
        "name": "old workspace",
        "project_id": "some-old-project",
        "status": "completed",
    }
    rec = WorkspaceRecord.from_dict(old)
    assert rec.status == WorkspaceStatus.ANALYZED.value
    assert rec.trashed is False
    # project_id 不应出现在 to_dict 输出
    assert "project_id" not in rec.to_dict()


def test_to_dict_includes_trashed():
    rec = WorkspaceRecord(workspace_id="w1", name="n", trashed=True)
    d = rec.to_dict()
    assert d["trashed"] is True
    assert d["status"] == WorkspaceStatus.ACTIVE.value


def test_delete_collection_keeps_unique_content_in_stable_inbox(client):
    c, store = client
    wid = _make_ws(c, "keep-unique")
    store.add_item(
        wid,
        WorkspaceItem(
            item_id="unique",
            type="text",
            source="local",
            source_value="manual",
            lineage_id="lineage-unique",
        ),
    )

    response = c.delete(f"/workspaces/{wid}")
    assert response.status_code == 200
    assert response.json()["moved_to_inbox"] == 1
    inbox = store.get("__inbox__")
    assert inbox is not None
    assert [item.lineage_id for item in inbox.items] == ["lineage-unique"]

    c.post(f"/workspaces/{wid}/restore")
    second = c.delete(f"/workspaces/{wid}")
    assert second.json()["moved_to_inbox"] == 0
    assert second.json()["already_elsewhere"] == 1
    assert len(store.get("__inbox__").items) == 1


def test_delete_collection_does_not_duplicate_shared_content(client):
    c, store = client
    first = _make_ws(c, "first")
    second = _make_ws(c, "second")
    for workspace_id, item_id in ((first, "a"), (second, "b")):
        store.add_item(
            workspace_id,
            WorkspaceItem(
                item_id=item_id,
                type="text",
                source="local",
                source_value="manual",
                lineage_id="shared-lineage",
            ),
        )

    response = c.delete(f"/workspaces/{first}")
    assert response.json()["moved_to_inbox"] == 0
    assert response.json()["already_elsewhere"] == 1


def test_delete_collection_unlinks_shared_member_but_keeps_canonical_note(client):
    c, store = client
    source = _make_ws(c, "canonical-source")
    target = _make_ws(c, "shared-target")
    store.add_item(
        source,
        WorkspaceItem(
            item_id="canonical-note",
            type="text",
            source="local",
            source_value="manual",
        ),
    )
    assert store.add_item_membership(target, source, "canonical-note") is True

    response = c.delete(f"/workspaces/{target}")

    assert response.status_code == 200
    assert store.get_item(source, "canonical-note").item_id == "canonical-note"
    with pytest.raises(KeyError):
        store.get_item(target, "canonical-note")


def test_permanently_deleting_original_collection_keeps_shared_canonical_note(client):
    """删除合集不能借由永久删除把仍归入其它合集的笔记一并删除。"""
    c, store = client
    source = _make_ws(c, "canonical-source")
    target = _make_ws(c, "shared-target")
    store.add_item(
        source,
        WorkspaceItem(
            item_id="canonical-note",
            type="text",
            source="local",
            source_value="manual",
        ),
    )
    assert store.add_item_membership(target, source, "canonical-note") is True

    assert c.delete(f"/workspaces/{source}").status_code == 200
    response = c.delete(f"/workspaces/{source}/permanent")

    assert response.status_code == 200
    assert store.get(source) is None
    assert store.get_item(target, "canonical-note").item_id == "canonical-note"
    assert store.get_item("__inbox__", "canonical-note").item_id == "canonical-note"


def test_legacy_trash_policy_still_preserves_collection_content(client):
    c, store = client
    wid = _make_ws(c, "trash-content")
    store.add_item(
        wid,
        WorkspaceItem(
            item_id="trash",
            type="text",
            source="local",
            source_value="manual",
        ),
    )
    response = c.delete(f"/workspaces/{wid}?content_policy=trash")
    assert response.status_code == 200
    assert response.json()["moved_to_inbox"] == 1
    assert response.json()["trashed_count"] == 0
    assert store.get_item("__inbox__", "trash").item_id == "trash"


def test_invalid_content_policy_is_rejected(client):
    c, _store = client
    wid = _make_ws(c)
    response = c.delete(f"/workspaces/{wid}?content_policy=destroy")
    assert response.status_code == 422
