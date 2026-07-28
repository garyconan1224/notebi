"""S3 Task 7: 批次 API 测试。"""

from __future__ import annotations

import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path: Path, monkeypatch):
    """创建隔离的测试客户端。"""
    from backend.app.services.task_batch_service import TaskBatchService
    from backend.app.services.task_batch_store import TaskBatchStore
    from backend.app.services.task_runner import TaskRunner
    from backend.app.services.task_store import TaskStore

    store = TaskBatchStore(tmp_path / "batch-data")
    task_store = TaskStore(tmp_path / "backend_tasks.json")
    runner = TaskRunner(task_store, max_workers=1)
    release = threading.Event()
    runner.register("note", lambda _record, _runner: (release.wait(timeout=2), {})[1])
    service = TaskBatchService(
        batch_store=store,
        runner=runner,
        concurrency_limit=lambda: 1,
    )
    monkeypatch.setattr(
        "backend.app.routes.task_batches.get_default_batch_store",
        lambda: store,
    )
    monkeypatch.setattr(
        "backend.app.routes.task_batches.get_batch_service",
        lambda: service,
    )

    from backend.app.main import app

    with TestClient(app) as test_client:
        yield test_client
    release.set()
    runner._executor.shutdown(wait=True)


# ── 预览 ─────────────────────────────────────────────────────────────────────


def test_preview_returns_items(client: TestClient) -> None:
    """预览返回项。"""
    resp = client.post(
        "/pipeline/batches/preview",
        json={"urls": ["https://example.com/1", "https://example.com/2"]},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2
    assert len(data["items"]) == 2


# ── 创建 ─────────────────────────────────────────────────────────────────────


def test_create_batch(client: TestClient) -> None:
    """创建批次。"""
    resp = client.post(
        "/pipeline/batches",
        json={
            "name": "test batch",
            "items": [
                {"batch_item_id": "i1", "source_url": "https://example.com/1"},
                {"batch_item_id": "i2", "source_url": "https://example.com/2"},
            ],
            "workspace_id": "ws-1",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "test batch"
    assert data["status"] in {"queued", "running"}
    assert len(data["items"]) == 2


def test_create_batch_idempotent(client: TestClient) -> None:
    """幂等键重复返回原批次。"""
    payload = {
        "name": "idempotent",
        "items": [{"batch_item_id": "i1", "source_url": "https://example.com/1"}],
        "idempotency_key": "key-123",
    }
    resp1 = client.post("/pipeline/batches", json=payload)
    resp2 = client.post("/pipeline/batches", json=payload)
    assert resp1.json()["batch_id"] == resp2.json()["batch_id"]


# ── 列表 ─────────────────────────────────────────────────────────────────────


def test_list_batches(client: TestClient) -> None:
    """列出批次。"""
    client.post("/pipeline/batches", json={"name": "b1", "items": []})
    client.post("/pipeline/batches", json={"name": "b2", "items": []})

    resp = client.get("/pipeline/batches")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2


# ── 详情 ─────────────────────────────────────────────────────────────────────


def test_get_batch(client: TestClient) -> None:
    """获取批次详情。"""
    create_resp = client.post("/pipeline/batches", json={"name": "detail", "items": []})
    batch_id = create_resp.json()["batch_id"]

    resp = client.get(f"/pipeline/batches/{batch_id}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "detail"


def test_get_batch_not_found(client: TestClient) -> None:
    """批次不存在返回 404。"""
    resp = client.get("/pipeline/batches/nonexistent")
    assert resp.status_code == 404


# ── 暂停/恢复 ────────────────────────────────────────────────────────────────


def test_pause_and_resume(client: TestClient) -> None:
    """暂停和恢复。"""
    create_resp = client.post(
        "/pipeline/batches",
        json={"name": "pause-test", "items": [{"batch_item_id": "i1", "source_url": "x"}]},
    )
    batch_id = create_resp.json()["batch_id"]

    # 暂停
    pause_resp = client.post(f"/pipeline/batches/{batch_id}/pause")
    assert pause_resp.status_code == 200
    assert pause_resp.json()["status"] == "paused"

    # 恢复
    resume_resp = client.post(f"/pipeline/batches/{batch_id}/resume")
    assert resume_resp.status_code == 200
    assert resume_resp.json()["status"] in {"queued", "running"}


def test_pause_is_not_cancel(client: TestClient) -> None:
    """暂停不等于取消。"""
    create_resp = client.post(
        "/pipeline/batches",
        json={"name": "p", "items": [{"batch_item_id": "i1", "source_url": "x"}]},
    )
    batch_id = create_resp.json()["batch_id"]

    client.post(f"/pipeline/batches/{batch_id}/pause")
    resp = client.get(f"/pipeline/batches/{batch_id}")
    # 暂停只阻止后续调度；已经启动的项允许完成当前阶段，但绝不能被当作取消。
    assert resp.json()["items"][0]["status"] in {"pending", "running"}
    assert resp.json()["items"][0]["status"] != "cancelled"


# ── 取消 ─────────────────────────────────────────────────────────────────────


def test_cancel_batch(client: TestClient) -> None:
    """取消批次。"""
    create_resp = client.post(
        "/pipeline/batches",
        json={"name": "cancel-test", "items": [{"batch_item_id": "i1", "source_url": "x"}]},
    )
    batch_id = create_resp.json()["batch_id"]

    cancel_resp = client.post(f"/pipeline/batches/{batch_id}/cancel")
    assert cancel_resp.status_code == 200
    assert cancel_resp.json()["status"] == "cancelled"


# ── 删除 ─────────────────────────────────────────────────────────────────────


def test_delete_terminal_batch(client: TestClient) -> None:
    """删除终态批次。"""
    create_resp = client.post(
        "/pipeline/batches",
        json={"name": "del-test", "items": [{"batch_item_id": "i1", "source_url": "x"}]},
    )
    batch_id = create_resp.json()["batch_id"]

    # 先取消变成终态
    client.post(f"/pipeline/batches/{batch_id}/cancel")

    # 删除
    del_resp = client.delete(f"/pipeline/batches/{batch_id}")
    assert del_resp.status_code == 200

    # 确认已删除
    get_resp = client.get(f"/pipeline/batches/{batch_id}")
    assert get_resp.status_code == 404


def test_delete_running_batch_fails(client: TestClient) -> None:
    """运行中批次不能删除。"""
    create_resp = client.post(
        "/pipeline/batches",
        json={"name": "running", "items": [{"batch_item_id": "i1", "source_url": "x"}]},
    )
    batch_id = create_resp.json()["batch_id"]

    del_resp = client.delete(f"/pipeline/batches/{batch_id}")
    assert del_resp.status_code == 409
