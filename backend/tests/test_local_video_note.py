"""Bug #2 回归测试：本地视频路由到 note + 下载步跳过本地。

验证两个关键改动：
1. bridge 把 local video 路由到 "note"（而非旧的 "analyze"）
2. _download_note_source 遇到 source_type=local 时跳过下载、直接返回本地路径
"""

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from backend.app.models.workspace import (
    ItemType,
    PreflightConfig,
    WorkspaceItem,
    WorkspaceRecord,
)
from backend.app.routes.workspaces import _bridge_to_pipeline_payload
from backend.app.services.pipeline_tasks import _download_note_source


# ── test 1: bridge 路由 ─────────────────────────────────────────────────────


def test_bridge_local_video_routes_to_note():
    """source=local + type=video → task_type='note'，payload 含 source_type/local 等字段。"""
    item = WorkspaceItem(
        item_id="item-1",
        type=ItemType.VIDEO.value,
        source="local",
        source_value="x/y/demo.mp4",
        name="demo",
    )
    rec = WorkspaceRecord(workspace_id="ws-1", name="test-workspace")

    task_type, payload = _bridge_to_pipeline_payload(item, rec)

    assert task_type == "note"
    assert payload["source_type"] == "local"
    assert payload["video_basenames"] == ["demo.mp4"]
    assert payload.get("url"), "payload 必须含非空 url（满足 handle_note_task 校验）"


# ── test 2: 下载步跳过本地 ──────────────────────────────────────────────────


def test_download_note_source_local_skips_download(tmp_path):
    """source_type=local → 跳过下载，直接返回本地文件路径，不触发任何网络请求。"""
    # 准备假视频文件
    fake_video = tmp_path / "demo.mp4"
    fake_video.write_bytes(b"\x00" * 16)

    # mock runner（只需 append_log 不报错即可）
    runner = MagicMock()
    runner.append_log = MagicMock()

    record = MagicMock()
    record.project_id = "test-project"

    result = _download_note_source(
        url="x/y/demo.mp4",  # 本地分支不走 URL 解析
        payload={"source_type": "local", "video_basenames": ["demo.mp4"]},
        record=record,
        runner=runner,
        task_id="task-1",
        project_video_dir=tmp_path,
        dl_kwargs={},
    )

    assert result["ok"] is True
    assert result["kind_hint"] == "video"
    assert result["video_file"] == str(fake_video)
    assert result["source_path"] == str(fake_video)
    # 本地分支在 _classify_note_url 之前 return，不会调到任何下载逻辑


def test_download_note_source_local_finds_uploaded_file_in_workspace_root(tmp_path, monkeypatch):
    """上传文件在 workspace 根目录时，也能被本地 note 分支找到。"""
    workspace_root = tmp_path / "ws-1"
    workspace_root.mkdir()
    fake_video = workspace_root / "demo.mp4"
    fake_video.write_bytes(b"\x00" * 16)
    project_video_dir = tmp_path / "default_project" / "videos"
    project_video_dir.mkdir(parents=True)

    monkeypatch.setattr(
        "backend.app.services.pipeline_tasks.get_workspace_root",
        lambda _workspace_id: workspace_root if _workspace_id == "ws-1" else tmp_path / _workspace_id,
    )
    monkeypatch.setattr(
        "backend.app.services.pipeline_tasks.get_workspace_videos_dir",
        lambda _workspace_id: workspace_root / "videos" if _workspace_id == "ws-1" else tmp_path / _workspace_id / "videos",
    )

    runner = MagicMock()
    runner.append_log = MagicMock()

    record = MagicMock()
    record.project_id = "default_project"

    result = _download_note_source(
        url="x/y/demo.mp4",
        payload={"source_type": "local", "workspace_id": "ws-1", "video_basenames": ["demo.mp4"]},
        record=record,
        runner=runner,
        task_id="task-1",
        project_video_dir=project_video_dir,
        dl_kwargs={},
    )

    assert result["ok"] is True
    assert result["kind_hint"] == "video"
    assert result["video_file"] == str(fake_video)
    assert result["source_path"] == str(fake_video)
