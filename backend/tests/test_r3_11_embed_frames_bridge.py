"""R3.11 验收测试：preflight embed_frames / max_embed_frames 能通过桥接进入 note task payload。

覆盖：
- URL 视频桥接把 tasks.summary 中的 embed_frames / max_embed_frames 写入 payload["preflight"]
- embed_frames=False 时 payload 正确传递
- max_embed_frames 为 0 或缺失时不影响默认行为
"""
import pytest

from backend.app.models.workspace import (
    ItemType,
    ItemStatus,
    PreflightConfig,
    WorkspaceItem,
    WorkspaceRecord,
)
from backend.app.routes.workspaces import _bridge_to_pipeline_payload


def _make_video_item(
    source: str = "url",
    source_value: str = "https://www.bilibili.com/video/BV1i57D62EBM",
    tasks: dict | None = None,
) -> WorkspaceItem:
    """构造一个带 preflight 的视频 item。"""
    return WorkspaceItem(
        item_id="item-1",
        type=ItemType.VIDEO.value,
        source=source,
        source_value=source_value,
        name="测试视频",
        status=ItemStatus.PENDING.value,
        preflight=PreflightConfig(tasks=tasks),
    )


_ws = WorkspaceRecord(workspace_id="ws-1", name="测试工作空间")


class TestEmbedFramesBridge:
    """R3.11: embed_frames / max_embed_frames 从 tasks.summary 透传到 payload.preflight。"""

    def test_embed_frames_false_passed_to_payload(self):
        """用户关闭嵌图 → payload.preflight.embed_frames = False。"""
        item = _make_video_item(tasks={
            "summary": {
                "on": True,
                "embed_frames": False,
                "max_embed_frames": 3,
            },
        })
        task_type, payload = _bridge_to_pipeline_payload(item, _ws)
        assert task_type == "note"
        pf = payload.get("preflight", {})
        assert pf.get("embed_frames") is False
        assert pf.get("max_embed_frames") == 3

    def test_embed_frames_true_passed_to_payload(self):
        """用户开启嵌图 → payload.preflight.embed_frames = True。"""
        item = _make_video_item(tasks={
            "summary": {
                "on": True,
                "embed_frames": True,
                "max_embed_frames": 12,
            },
        })
        _, payload = _bridge_to_pipeline_payload(item, _ws)
        pf = payload.get("preflight", {})
        assert pf.get("embed_frames") is True
        assert pf.get("max_embed_frames") == 12

    def test_no_summary_config_no_preflight_key(self):
        """没有 summary 配置时，payload 不含 preflight 或不含 embed_frames。"""
        item = _make_video_item(tasks={})
        _, payload = _bridge_to_pipeline_payload(item, _ws)
        pf = payload.get("preflight") or {}
        assert "embed_frames" not in pf
        assert "max_embed_frames" not in pf

    def test_empty_tasks_no_crash(self):
        """tasks=None 时不崩溃。"""
        item = _make_video_item(tasks=None)
        task_type, payload = _bridge_to_pipeline_payload(item, _ws)
        assert task_type == "note"

    def test_url_video_returns_note_task_type(self):
        """URL 视频统一走 note task（Track K）。"""
        item = _make_video_item(source="url")
        task_type, _ = _bridge_to_pipeline_payload(item, _ws)
        assert task_type == "note"

    def test_other_summary_fields_not_leaked(self):
        """summary 组的其它字段（如 summary_path）不应进入 payload.preflight。"""
        item = _make_video_item(tasks={
            "summary": {
                "on": True,
                "summary_path": "音视频综合",
                "summary_depth": "详细",
                "embed_frames": False,
                "max_embed_frames": 5,
            },
        })
        _, payload = _bridge_to_pipeline_payload(item, _ws)
        pf = payload.get("preflight") or {}
        # 只有 embed_frames 和 max_embed_frames 应该在 preflight 里
        assert pf.get("embed_frames") is False
        assert pf.get("max_embed_frames") == 5
        assert "summary_path" not in pf
        assert "summary_depth" not in pf
