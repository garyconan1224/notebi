"""list_tasks 轻量模式仍注入 result 展示字段白名单（封面/标题/类型）。

回归用户反馈：首页「最近任务」往期已完成任务卡无封面，点进详情才有。
根因是轻量列表 include_result=False 把整个 result 清空；修复是注入展示字段白名单，
但仍排除总结 md / 转录等重量级字段，保持列表轻量。
"""

from pathlib import Path

from backend.app.models.tasks import TaskRecord, TaskStatus
from backend.app.models.workspace import WorkspaceRecord
from backend.app.routes import pipeline
from backend.app.services.task_store import TaskStore
from backend.app.services.workspace_store import WorkspaceStore


def _seed_store(tmp_path: Path) -> TaskStore:
    store = TaskStore(path=tmp_path / "backend_tasks.json")
    store.create(
        TaskRecord(
            task_id="t-cover",
            project_id="ws-1",
            task_type="note",
            payload={"url": "https://www.bilibili.com/video/BV1"},
            status=TaskStatus.SUCCESS.value,
            result={
                "video_title": "标题",
                "video_thumbnail_url": "/static/x.jpg",
                "note_kind": "video",
                # 重量级字段：不应出现在轻量列表里
                "summary_md": "# 很长的总结" * 1000,
                "segments": [{"t": 0}],
            },
        )
    )
    return store


def _seed_ws_store(tmp_path: Path) -> WorkspaceStore:
    """创建含 ws-1 的 workspace store，让 1-A 过滤能通过。"""
    ws_tmp = tmp_path / "ws_data"
    ws_tmp.mkdir()
    ws = WorkspaceStore(root=ws_tmp)
    ws.create(WorkspaceRecord(workspace_id="ws-1", name="test"))
    return ws


def test_list_tasks_light_includes_cover_fields(tmp_path, monkeypatch):
    monkeypatch.setattr(pipeline, "_store", _seed_store(tmp_path))
    # 1-A 过滤需要 workspace store 包含 task 的 project_id，否则任务被滤掉
    import backend.app.routes.workspaces as ws_mod

    monkeypatch.setattr(ws_mod, "_store", _seed_ws_store(tmp_path))
    rows = pipeline.list_tasks(include_result=False)
    assert len(rows) == 1
    result = rows[0]["result"]
    # 展示字段在（卡片渲染所需）
    assert result["video_thumbnail_url"] == "/static/x.jpg"
    assert result["video_title"] == "标题"
    assert result["note_kind"] == "video"
    # 重量级字段不在（保持列表轻量）
    assert "summary_md" not in result
    assert "segments" not in result


def test_list_tasks_full_includes_everything(tmp_path, monkeypatch):
    monkeypatch.setattr(pipeline, "_store", _seed_store(tmp_path))
    import backend.app.routes.workspaces as ws_mod

    monkeypatch.setattr(ws_mod, "_store", _seed_ws_store(tmp_path))
    rows = pipeline.list_tasks(include_result=True)
    result = rows[0]["result"]
    assert "summary_md" in result
    assert result["video_thumbnail_url"] == "/static/x.jpg"
