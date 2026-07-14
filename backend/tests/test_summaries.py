"""4 个 summary API endpoint 测试。"""

from __future__ import annotations

import tempfile
import pathlib
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.app.models.workspace import ItemSummary, WorkspaceItem, WorkspaceRecord
from backend.app.services.workspace_store import WorkspaceStore


def _make_test_store() -> WorkspaceStore:
    """创建含一个 workspace + item 的临时 store。"""
    tmp = tempfile.mkdtemp()
    store = WorkspaceStore(root=pathlib.Path(tmp))
    item = WorkspaceItem.from_dict({
        "item_id": "item-1",
        "type": "video",
        "source": "local",
        "source_value": "/tmp/test.mp4",
        "name": "测试视频",
        "status": "done",
        "results": {"transcript": "测试转写文本"},
    })
    rec = WorkspaceRecord(workspace_id="ws-1", name="测试工作空间")
    rec.items.append(item)
    store.create(rec)
    return store


@pytest.fixture(autouse=True)
def _patch_store(monkeypatch: pytest.MonkeyPatch) -> WorkspaceStore:
    """用临时 store 替换路由模块的全局 _store。"""
    import backend.app.routes.workspaces as ws_module
    store = _make_test_store()
    monkeypatch.setattr(ws_module, "_store", store)
    return store


# 在 fixture 之后导入，确保 monkeypatch 生效
from backend.app.main import app  # noqa: E402

client = TestClient(app)


# ── GET list ────────────────────────────────────────────────────


class TestListSummaries:
    def test_empty_list(self) -> None:
        resp = client.get("/workspaces/ws-1/items/item-1/summaries")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_workspace_not_found(self) -> None:
        resp = client.get("/workspaces/nonexistent/items/item-1/summaries")
        assert resp.status_code == 404

    def test_item_not_found(self) -> None:
        resp = client.get("/workspaces/ws-1/items/nonexistent/summaries")
        assert resp.status_code == 404

    def test_list_orders_versions_globally_across_templates(
        self, _patch_store: WorkspaceStore,
    ) -> None:
        item = _patch_store.get_item("ws-1", "item-1")
        item.summaries.extend([
            ItemSummary(summary_id="v0", template="standard", version=0),
            ItemSummary(summary_id="v2", template="speaker_consultant_detailed", version=2),
            ItemSummary(summary_id="v1", template="speaker_consultant_meeting_customer_voice", version=1),
        ])

        resp = client.get("/workspaces/ws-1/items/item-1/summaries")
        assert resp.status_code == 200
        assert [summary["summary_id"] for summary in resp.json()] == ["v0", "v1", "v2"]

    def test_list_applies_saved_speaker_names_to_existing_summary(
        self, _patch_store: WorkspaceStore,
    ) -> None:
        item = _patch_store.get_item("ws-1", "item-1")
        item.results["speaker_map"] = {"SPEAKER_00": "主持人"}
        item.summaries.append(ItemSummary(
            summary_id="speaker-v0", template="concise", version=0,
            summary_mode="speaker_aware",
            content_md="# 待确认_SPEAKER_00\n\nSPEAKER_00 提出关键结论",
        ))

        resp = client.get("/workspaces/ws-1/items/item-1/summaries")

        assert resp.status_code == 200
        assert resp.json()[0]["content_md"] == "# 待确认_主持人\n\n主持人 提出关键结论"


# ── POST create ────────────────────────────────────────────────


class TestCreateSummary:
    @patch("backend.app.routes.workspaces.generate_summary")
    def test_create_success(self, mock_gen: MagicMock) -> None:
        mock_gen.return_value = ItemSummary(
            summary_id="s-1",
            template="concise",
            version=1,
            content_md="# 摘要\n\n生成内容",
            model_used="openai/gpt-4o",
        )
        resp = client.post("/workspaces/ws-1/items/item-1/summaries", json={
            "template": "concise",
            "background_for_summary": "背景信息",
        })
        assert resp.status_code == 201
        data = resp.json()
        assert data["template"] == "concise"
        assert data["content_md"] == "# 摘要\n\n生成内容"
        assert data["model_used"] == "openai/gpt-4o"
        assert data["version"] == 0  # 首版 = v0

    @patch("backend.app.routes.workspaces.generate_summary")
    def test_create_version_increment(self, mock_gen: MagicMock) -> None:
        """同模板第二次生成 → version=1。"""
        mock_gen.return_value = ItemSummary(
            summary_id="s-1", template="concise", version=0, content_md="v0",
        )
        client.post("/workspaces/ws-1/items/item-1/summaries", json={
            "template": "concise",
        })

        mock_gen.return_value = ItemSummary(
            summary_id="s-2", template="concise", version=1, content_md="v1",
        )
        resp = client.post("/workspaces/ws-1/items/item-1/summaries", json={
            "template": "concise",
        })
        assert resp.status_code == 201
        assert resp.json()["version"] == 1

    def test_invalid_template(self) -> None:
        resp = client.post("/workspaces/ws-1/items/item-1/summaries", json={
            "template": "nonexistent_template",
        })
        assert resp.status_code == 400
        assert "未知模板" in resp.json()["detail"]

    def test_speaker_aware_requires_speaker_segments(self) -> None:
        resp = client.post("/workspaces/ws-1/items/item-1/summaries", json={
            "template": "concise",
            "summary_mode": "speaker_aware",
        })
        assert resp.status_code == 409
        assert "说话人识别" in resp.json()["detail"]

    @patch("backend.app.routes.workspaces.generate_summary")
    def test_speaker_aware_mode_accepts_video_with_speaker_segments(
        self, mock_gen: MagicMock, _patch_store: WorkspaceStore,
    ) -> None:
        item = _patch_store.get_item("ws-1", "item-1")
        item.results = {
            "transcript_segments": [
                {"start": 0, "speaker": "SPEAKER_00", "text": "视频主持人发言"},
            ],
        }
        mock_gen.return_value = ItemSummary(
            summary_id="video-speaker-summary", template="speaker_meeting", version=0,
            summary_mode="speaker_aware", content_md="视频逐人总结",
        )

        resp = client.post("/workspaces/ws-1/items/item-1/summaries", json={
            "template": "speaker_meeting",
            "summary_mode": "speaker_aware",
        })

        assert resp.status_code == 201
        assert resp.json()["summary_mode"] == "speaker_aware"
        assert mock_gen.call_args.kwargs["summary_mode"] == "speaker_aware"

    @patch("backend.app.routes.workspaces.generate_summary")
    def test_speaker_aware_mode_passed_to_generator(
        self, mock_gen: MagicMock, _patch_store: WorkspaceStore,
    ) -> None:
        item = _patch_store.get_item("ws-1", "item-1")
        item.type = "audio"
        item.results = {
            "transcript_segments": [
                {"t_sec": 0, "speaker": "SPEAKER_00", "text": "发言"},
            ],
        }
        mock_gen.return_value = ItemSummary(
            summary_id="speaker-summary", template="concise", version=0,
            summary_mode="speaker_aware", content_md="按说话人总结",
        )
        resp = client.post("/workspaces/ws-1/items/item-1/summaries", json={
            "template": "concise",
            "summary_mode": "speaker_aware",
        })
        assert resp.status_code == 201
        assert resp.json()["summary_mode"] == "speaker_aware"
        assert mock_gen.call_args.kwargs["summary_mode"] == "speaker_aware"

    @patch("backend.app.routes.workspaces.generate_summary")
    def test_speaker_map_updates_existing_speaker_summary_in_place(
        self, mock_gen: MagicMock, _patch_store: WorkspaceStore,
    ) -> None:
        item = _patch_store.get_item("ws-1", "item-1")
        item.type = "audio"
        item.results = {
            "transcript_segments": [
                {"t_sec": 0, "speaker": "SPEAKER_00", "text": "发言"},
            ],
        }
        item.summaries.append(ItemSummary(
            summary_id="speaker-v0", template="concise", version=0,
            summary_mode="speaker_aware", content_md="SPEAKER_00 提出旧总结",
        ))
        item.summaries.append(ItemSummary(
            summary_id="general-v1", template="concise", version=1,
            summary_mode="general", content_md="SPEAKER_00 出现在普通总结中",
        ))

        resp = client.patch("/workspaces/ws-1/items/item-1/speaker_map", json={
            "speaker_map": {"SPEAKER_00": "主持人"},
        })
        assert resp.status_code == 200
        assert resp.json()["summary_refresh"]["status"] == "updated"
        assert resp.json()["summary_refresh"]["updated_count"] == 1
        mock_gen.assert_not_called()
        summaries = _patch_store.get_item("ws-1", "item-1").summaries
        assert [s.version for s in summaries] == [0, 1]
        assert summaries[0].content_md == "主持人 提出旧总结"
        assert summaries[1].content_md == "SPEAKER_00 出现在普通总结中"

    @patch("backend.app.routes.workspaces.generate_summary")
    def test_llm_failure(self, mock_gen: MagicMock) -> None:
        mock_gen.side_effect = RuntimeError("未配置 chat model")
        resp = client.post("/workspaces/ws-1/items/item-1/summaries", json={
            "template": "concise",
        })
        assert resp.status_code == 500


# ── GET detail ──────────────────────────────────────────────────


class TestGetSummary:
    def test_not_found(self) -> None:
        resp = client.get("/workspaces/ws-1/items/item-1/summaries/nonexistent")
        assert resp.status_code == 404

    @patch("backend.app.routes.workspaces.generate_summary")
    def test_get_after_create(self, mock_gen: MagicMock) -> None:
        mock_gen.return_value = ItemSummary(
            summary_id="s-detail", template="detailed", version=1, content_md="详细内容",
        )
        create_resp = client.post("/workspaces/ws-1/items/item-1/summaries", json={
            "template": "detailed",
        })
        sid = create_resp.json()["summary_id"]

        resp = client.get(f"/workspaces/ws-1/items/item-1/summaries/{sid}")
        assert resp.status_code == 200
        assert resp.json()["content_md"] == "详细内容"

    def test_audio_note_echoes_speaker_map(
        self, _patch_store: WorkspaceStore, tmp_path: pathlib.Path,
    ) -> None:
        """音频 /note 刷新后应回显已保存的说话人名称映射。"""
        import backend.app.routes.workspaces as ws_module

        item = _patch_store.get_item("ws-1", "item-1")
        item.type = "audio"
        item.source_value = "/tmp/test.mp3"
        item.results = {
            "speaker_map": {"SPEAKER_00": "主持人"},
            "transcript_segments": [
                {"t_sec": 0, "speaker": "SPEAKER_00", "text": "开场"},
            ],
        }
        note_dir = tmp_path / "note"
        note_dir.mkdir()
        (note_dir / "note.md").write_text("---\ntitle: 测试音频\n---\n正文\n", encoding="utf-8")

        with patch.object(ws_module, "note_dir", return_value=note_dir):
            resp = client.get("/workspaces/ws-1/items/item-1/note")

        assert resp.status_code == 200
        assert resp.json()["speaker_map"] == {"SPEAKER_00": "主持人"}


# ── DELETE ──────────────────────────────────────────────────────


class TestDeleteSummary:
    def test_delete_not_found(self) -> None:
        resp = client.delete("/workspaces/ws-1/items/item-1/summaries/nonexistent")
        assert resp.status_code == 404

    @patch("backend.app.routes.workspaces.generate_summary")
    def test_delete_after_create(self, mock_gen: MagicMock) -> None:
        mock_gen.return_value = ItemSummary(
            summary_id="s-del", template="concise", version=1, content_md="要删的",
        )
        create_resp = client.post("/workspaces/ws-1/items/item-1/summaries", json={
            "template": "concise",
        })
        sid = create_resp.json()["summary_id"]

        # 删除
        del_resp = client.delete(f"/workspaces/ws-1/items/item-1/summaries/{sid}")
        assert del_resp.status_code == 200
        assert del_resp.json()["status"] == "deleted"

        # 列表变空
        list_resp = client.get("/workspaces/ws-1/items/item-1/summaries")
        assert list_resp.status_code == 200
        assert list_resp.json() == []
