"""InlineFrame dataclass + 推荐算法 + API 测试。"""

from __future__ import annotations

import pytest

from backend.app.models.workspace import InlineFrame, PreflightConfig, WorkspaceItem


# ── InlineFrame roundtrip ─────────────────────────────────────


class TestInlineFrameRoundtrip:
    def test_to_dict_and_from_dict(self) -> None:
        f = InlineFrame(
            segment_idx=3,
            frame_timestamp=42.5,
            frame_path="json_data/xxx/frames/003.jpg",
            source="suggested",
            created_at="2026-05-28T12:00:00+00:00",
        )
        d = f.to_dict()
        assert d["segment_idx"] == 3
        assert d["frame_timestamp"] == 42.5
        assert d["frame_path"] == "json_data/xxx/frames/003.jpg"
        assert d["source"] == "suggested"

        f2 = InlineFrame.from_dict(d)
        assert f2.segment_idx == 3
        assert f2.frame_timestamp == 42.5
        assert f2.frame_path == "json_data/xxx/frames/003.jpg"
        assert f2.source == "suggested"

    def test_from_dict_defaults(self) -> None:
        f = InlineFrame.from_dict({"segment_idx": 1, "frame_timestamp": 10.0, "frame_path": "a.jpg"})
        assert f.source == "user"
        assert f.created_at  # 非空


class TestWorkspaceItemInlineFrames:
    def test_inline_frames_in_to_dict(self) -> None:
        item = WorkspaceItem(
            item_id="i1",
            type="video",
            source="local",
            source_value="/tmp/v.mp4",
            inline_frames=[
                InlineFrame(segment_idx=0, frame_timestamp=5.0, frame_path="f.jpg"),
            ],
        )
        d = item.to_dict()
        assert len(d["inline_frames"]) == 1
        assert d["inline_frames"][0]["segment_idx"] == 0

    def test_inline_frames_from_dict(self) -> None:
        d = {
            "item_id": "i1",
            "type": "video",
            "source": "local",
            "source_value": "/tmp/v.mp4",
            "inline_frames": [
                {"segment_idx": 2, "frame_timestamp": 30.0, "frame_path": "x.jpg", "source": "user"},
            ],
        }
        item = WorkspaceItem.from_dict(d)
        assert len(item.inline_frames) == 1
        assert item.inline_frames[0].segment_idx == 2

    def test_inline_frames_empty_default(self) -> None:
        item = WorkspaceItem.from_dict({"item_id": "i1", "type": "video", "source": "local", "source_value": "/tmp/v.mp4"})
        assert item.inline_frames == []


class TestPreflightIntent:
    def test_intent_in_to_dict(self) -> None:
        p = PreflightConfig(intent="learning")
        d = p.to_dict()
        assert d["intent"] == "learning"

    def test_intent_from_dict(self) -> None:
        p = PreflightConfig.from_dict({"intent": "replica"})
        assert p.intent == "replica"

    def test_intent_default_empty(self) -> None:
        p = PreflightConfig()
        assert p.intent == ""


# ── 推荐算法 ──────────────────────────────────────────────────


class TestSuggestInlineFrames:
    def test_basic_suggestion(self) -> None:
        from backend.app.services.inline_frame_suggester import suggest_inline_frames

        frames = [
            {"timestamp": 10.0, "image_path": "f1.jpg", "scene_description": "场景1"},
            {"timestamp": 30.0, "image_path": "f2.jpg", "scene_description": "场景2"},
            {"timestamp": 60.0, "image_path": "f3.jpg", "scene_description": "场景3"},
        ]
        segments = [
            {"start": 5.0, "text": "段落0"},
            {"start": 25.0, "text": "段落1"},
            {"start": 55.0, "text": "段落2"},
        ]
        result = suggest_inline_frames(frames, segments)
        assert len(result) == 3
        assert result[0]["frame_path"] == "f1.jpg"
        assert result[1]["frame_path"] == "f2.jpg"
        assert result[2]["frame_path"] == "f3.jpg"

    def test_dedup_adjacent_same_frame(self) -> None:
        from backend.app.services.inline_frame_suggester import suggest_inline_frames

        frames = [
            {"timestamp": 10.0, "image_path": "f1.jpg"},
            {"timestamp": 50.0, "image_path": "f2.jpg"},
        ]
        segments = [
            {"start": 8.0, "text": "段落0"},
            {"start": 12.0, "text": "段落1"},  # 也最近 f1
            {"start": 48.0, "text": "段落2"},
        ]
        result = suggest_inline_frames(frames, segments)
        # 段落0和段落1都最近f1，去重后只保留给段落1
        assert len(result) == 2
        assert result[0]["segment_idx"] == 1
        assert result[0]["frame_path"] == "f1.jpg"
        assert result[1]["segment_idx"] == 2
        assert result[1]["frame_path"] == "f2.jpg"

    def test_empty_input(self) -> None:
        from backend.app.services.inline_frame_suggester import suggest_inline_frames

        assert suggest_inline_frames([], [{"start": 1, "text": "x"}]) == []
        assert suggest_inline_frames([{"timestamp": 1, "image_path": "f.jpg"}], []) == []

    def test_string_timestamp(self) -> None:
        from backend.app.services.inline_frame_suggester import suggest_inline_frames

        frames = [{"timestamp": "1:30", "image_path": "f.jpg"}]
        segments = [{"start": 90, "text": "正好1分30秒"}]
        result = suggest_inline_frames(frames, segments)
        assert len(result) == 1
        assert result[0]["frame_timestamp"] == 90.0


# ── API 测试（需要 TestClient）────────────────────────────────


class TestInlineFramesAPI:
    @pytest.fixture()
    def client(self):
        from fastapi.testclient import TestClient
        from backend.app.routes.workspaces import router, _store
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)
        return TestClient(app)

    @pytest.fixture()
    def ws_with_learning_item(self, client):
        """创建一个 learning 模式的 workspace + item。"""
        resp = client.post("/workspaces", json={
            "name": "test-ws",
        })
        assert resp.status_code == 200
        ws = resp.json()
        ws_id = ws["workspace_id"]

        # 添加 item
        resp = client.post(f"/workspaces/{ws_id}/items", json={
            "type": "video",
            "source": "local",
            "source_value": "/tmp/test.mp4",
            "name": "test-video",
        })
        assert resp.status_code == 200
        rec_data = resp.json()
        # add_item 返回整个 workspace record，取最后一个 item
        item_id = rec_data["items"][-1]["item_id"]

        # 直接改 store 设置 preflight intent
        from backend.app.routes.workspaces import _store
        rec = _store.get(ws_id)
        for it in rec.items:
            if it.item_id == item_id:
                it.preflight.intent = "learning"
                break

        return ws_id, item_id

    def test_list_empty(self, client, ws_with_learning_item):
        ws_id, item_id = ws_with_learning_item
        resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/inline-frames")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_save_and_list(self, client, ws_with_learning_item):
        ws_id, item_id = ws_with_learning_item
        frames = [
            {"segment_idx": 0, "frame_timestamp": 10.0, "frame_path": "f1.jpg", "source": "user"},
            {"segment_idx": 2, "frame_timestamp": 30.0, "frame_path": "f2.jpg", "source": "suggested"},
        ]
        resp = client.put(
            f"/workspaces/{ws_id}/items/{item_id}/inline-frames",
            json={"inline_frames": frames},
        )
        assert resp.status_code == 200
        assert resp.json()["count"] == 2

        resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/inline-frames")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert data[0]["segment_idx"] == 0
        assert data[1]["segment_idx"] == 2

    def test_suggested_empty_for_non_learning(self, client):
        """非 learning 模式返回空推荐。"""
        resp = client.post("/workspaces", json={"name": "ws-replica"})
        ws_id = resp.json()["workspace_id"]
        resp = client.post(f"/workspaces/{ws_id}/items", json={
            "type": "video", "source": "local", "source_value": "/tmp/v.mp4", "name": "v",
        })
        rec_data = resp.json()
        item_id = rec_data["items"][-1]["item_id"]

        resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/inline-frames/suggested")
        assert resp.status_code == 200
        assert resp.json() == []
