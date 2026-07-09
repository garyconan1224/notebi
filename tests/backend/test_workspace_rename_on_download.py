"""R13.4：download SUCCESS 后自动把 hostname-时间戳 格式的 ws 名改为「平台 · 视频标题」。"""
from __future__ import annotations
from backend.app.routes import workspaces as ws_routes
from backend.app.services.workspace_store import WorkspaceStore
from backend.app.models.workspace import WorkspaceRecord, WorkspaceItem


def test_workspace_renamed_when_auto_generated(tmp_path):
    """自动生成名（Bilibili · 0525-2001）应被替换为「平台 · 视频标题」。"""
    store = WorkspaceStore()
    ws = WorkspaceRecord(
        workspace_id="ws-test-1",
        name="Bilibili · 0525-2001",
    )
    item = WorkspaceItem(
        item_id="item-1",
        type="video",
        source="url",
        source_value="https://www.bilibili.com/video/BV1xxx",
        related_task_ids=["note-xxx"],
    )
    ws.items = [item]
    store._records["ws-test-1"] = ws

    created: list = []

    class _FakeRunner:
        @staticmethod
        def create_task(project_id, task_type, payload):
            rec = type("T", (), {"task_id": "analyze-fake-xxx"})()
            created.append({"project_id": project_id, "task_type": task_type, "payload": payload})
            return rec

    fake_runner = _FakeRunner()

    fake_dl = type("DL", (), {
        "task_id": "note-xxx",
        "project_id": "ws-test-1",
        "result": {
            "save_path": str(tmp_path / "三代封神！那四代呢？-BV1xxx.mp4"),
            "video_title": "三代封神！那四代呢？",
            "video_duration": 402,
        },
        "payload": {"url": "https://www.bilibili.com/video/BV1xxx"},
    })()
    (tmp_path / "三代封神！那四代呢？-BV1xxx.mp4").touch()

    # monkey-patch _store for _on_download_success to use our test store
    orig_store = ws_routes._store
    ws_routes._store = store
    try:
        ws_routes._on_download_success(fake_dl, fake_runner)
    finally:
        ws_routes._store = orig_store

    updated_ws = store.get("ws-test-1")
    assert updated_ws is not None
    assert updated_ws.name == "bilibili · 三代封神！那四代呢？", f"got: {updated_ws.name}"


def test_workspace_not_renamed_when_user_named(tmp_path):
    """用户自定义名不受影响。"""
    store = WorkspaceStore()
    ws = WorkspaceRecord(
        workspace_id="ws-test-2",
        name="我的自定义空间",
    )
    item = WorkspaceItem(
        item_id="item-2",
        type="video",
        source="url",
        source_value="https://www.bilibili.com/video/BV1xxx",
        related_task_ids=["note-xxx"],
    )
    ws.items = [item]
    store._records["ws-test-2"] = ws

    created: list = []

    class _FakeRunner:
        @staticmethod
        def create_task(project_id, task_type, payload):
            rec = type("T", (), {"task_id": "analyze-fake-xxx"})()
            created.append({"project_id": project_id, "task_type": task_type, "payload": payload})
            return rec

    fake_runner = _FakeRunner()

    fake_dl = type("DL", (), {
        "task_id": "note-xxx",
        "project_id": "ws-test-2",
        "result": {
            "save_path": str(tmp_path / "三代封神！那四代呢？-BV1xxx.mp4"),
            "video_title": "三代封神！那四代呢？",
        },
        "payload": {"url": "https://www.bilibili.com/video/BV1xxx"},
    })()
    (tmp_path / "三代封神！那四代呢？-BV1xxx.mp4").touch()

    orig_store = ws_routes._store
    ws_routes._store = store
    try:
        ws_routes._on_download_success(fake_dl, fake_runner)
    finally:
        ws_routes._store = orig_store

    updated_ws = store.get("ws-test-2")
    assert updated_ws is not None
    assert updated_ws.name == "我的自定义空间", f"got: {updated_ws.name}"
