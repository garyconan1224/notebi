"""4 个 summary API endpoint 测试。"""

from __future__ import annotations

import tempfile
import pathlib
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.app.models.workspace import ItemSummary, WorkspaceItem, WorkspaceRecord
from backend.app.models.tasks import TaskRecord
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


def _fake_summary_task(task_id: str = "summary-task-1") -> TaskRecord:
    return TaskRecord(
        task_id=task_id,
        project_id="ws-1",
        task_type="summary",
        payload={"workspace_id": "ws-1", "item_id": "item-1", "template": "concise"},
    )


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
    def test_create_success(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import backend.app.routes.workspaces as ws_module

        captured: dict[str, object] = {}

        def fake_create_task(project_id: str, task_type: str, payload: dict[str, object]) -> TaskRecord:
            captured.update(payload)
            return _fake_summary_task()

        monkeypatch.setattr(ws_module._pipeline_runner, "create_task", fake_create_task)
        resp = client.post("/workspaces/ws-1/items/item-1/summaries", json={
            "template": "concise",
            "background_for_summary": "背景信息",
        })
        assert resp.status_code == 201
        data = resp.json()
        assert data == {
            "status": "accepted",
            "task_id": "summary-task-1",
            "workspace_id": "ws-1",
            "item_id": "item-1",
        }
        assert captured["template"] == "concise"
        assert captured["background_for_summary"] == "背景信息"

    def test_create_passes_single_run_language_override_to_task(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        import backend.app.routes.workspaces as ws_module

        captured: dict[str, object] = {}
        def fake_create_task(project_id: str, task_type: str, payload: dict[str, object]) -> TaskRecord:
            captured.update(payload)
            return _fake_summary_task("summary-language")

        monkeypatch.setattr(ws_module._pipeline_runner, "create_task", fake_create_task)
        resp = client.post("/workspaces/ws-1/items/item-1/summaries", json={
            "template": "concise",
            "summary_language": "custom",
            "summary_language_custom": "fr-CA",
        })

        assert resp.status_code == 201
        assert captured["summary_language"] == "custom"
        assert captured["summary_language_custom"] == "fr-CA"

    def test_create_rejects_invalid_single_run_language(self) -> None:
        resp = client.post("/workspaces/ws-1/items/item-1/summaries", json={
            "template": "concise", "summary_language": "not-a-language",
        })
        assert resp.status_code == 422

    def test_create_appends_task_id_to_item_related_task_ids(
        self, monkeypatch: pytest.MonkeyPatch, _patch_store: WorkspaceStore,
    ) -> None:
        """创建 summary task 后，task_id 必须立即写入 item.related_task_ids。

        否则删除 item 时无法通过 related_task_ids 清理该 summary task，
        它会成为孤儿任务，仍被任务列表返回并在首页渲染成对象导致崩溃。
        """
        import backend.app.routes.workspaces as ws_module

        task = _fake_summary_task("summary-task-link")
        monkeypatch.setattr(ws_module._pipeline_runner, "create_task", lambda *a, **k: task)

        resp = client.post("/workspaces/ws-1/items/item-1/summaries", json={"template": "concise"})
        assert resp.status_code == 201

        item = _patch_store.get_item("ws-1", "item-1")
        assert "summary-task-link" in item.related_task_ids

    def test_create_appends_without_duplicating_existing_task_ids(
        self, monkeypatch: pytest.MonkeyPatch, _patch_store: WorkspaceStore,
    ) -> None:
        """追加 task_id 不能覆盖或重复已有的 related_task_ids。"""
        import backend.app.routes.workspaces as ws_module

        # 预置一个已有关联任务
        _patch_store.update_item("ws-1", "item-1", related_task_ids=["existing-task"])
        task = _fake_summary_task("summary-task-new")
        monkeypatch.setattr(ws_module._pipeline_runner, "create_task", lambda *a, **k: task)

        resp = client.post("/workspaces/ws-1/items/item-1/summaries", json={"template": "concise"})
        assert resp.status_code == 201

        item = _patch_store.get_item("ws-1", "item-1")
        assert item.related_task_ids == ["existing-task", "summary-task-new"]

    def test_create_cleans_up_task_when_link_fails(
        self, monkeypatch: pytest.MonkeyPatch, _patch_store: WorkspaceStore,
    ) -> None:
        """创建 task 成功但关联 item 失败时，必须清理刚创建的任务，不留孤儿。"""
        import backend.app.routes.workspaces as ws_module

        task = _fake_summary_task("summary-task-orphan")
        monkeypatch.setattr(ws_module._pipeline_runner, "create_task", lambda *a, **k: task)
        # 让关联写入失败
        def boom(*a, **k):
            raise RuntimeError("store write failed")
        monkeypatch.setattr(_patch_store, "update_item", boom)
        deleted: list[str] = []
        monkeypatch.setattr(ws_module._pipeline_runner.store, "delete", lambda tid: deleted.append(tid))

        resp = client.post("/workspaces/ws-1/items/item-1/summaries", json={"template": "concise"})
        assert resp.status_code == 500
        assert "summary-task-orphan" in deleted

    def test_create_version_increment_is_deferred_to_task_handler(
        self, monkeypatch: pytest.MonkeyPatch, _patch_store: WorkspaceStore,
    ) -> None:
        """版本号在后台 handler 中分配，HTTP 请求只负责入队。"""
        import backend.app.routes.workspaces as ws_module

        task = _fake_summary_task()
        monkeypatch.setattr(ws_module._pipeline_runner, "create_task", lambda *args, **kwargs: task)
        resp = client.post("/workspaces/ws-1/items/item-1/summaries", json={
            "template": "concise",
        })
        assert resp.status_code == 201
        assert resp.json()["task_id"] == task.task_id

        generated = ItemSummary(
            summary_id="s-1", template="concise", version=0, content_md="v0",
        )
        monkeypatch.setattr(ws_module, "generate_summary", lambda *args, **kwargs: generated)
        fake_runner = MagicMock()
        ws_module._handle_summary_task(task, fake_runner)
        assert _patch_store.get_item("ws-1", "item-1").summaries[0].version == 0

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

    def test_speaker_aware_mode_accepts_video_with_speaker_segments(
        self, monkeypatch: pytest.MonkeyPatch, _patch_store: WorkspaceStore,
    ) -> None:
        import backend.app.routes.workspaces as ws_module

        item = _patch_store.get_item("ws-1", "item-1")
        item.results = {
            "transcript_segments": [
                {"start": 0, "speaker": "SPEAKER_00", "text": "视频主持人发言"},
            ],
        }
        captured: dict[str, object] = {}

        def fake_create_task(project_id: str, task_type: str, payload: dict[str, object]) -> TaskRecord:
            captured.update(payload)
            return _fake_summary_task("video-speaker-task")

        monkeypatch.setattr(ws_module._pipeline_runner, "create_task", fake_create_task)

        resp = client.post("/workspaces/ws-1/items/item-1/summaries", json={
            "template": "speaker_meeting",
            "summary_mode": "speaker_aware",
        })

        assert resp.status_code == 201
        assert resp.json()["task_id"] == "video-speaker-task"
        assert captured["summary_mode"] == "speaker_aware"

    def test_speaker_aware_mode_passed_to_generator(
        self, monkeypatch: pytest.MonkeyPatch, _patch_store: WorkspaceStore,
    ) -> None:
        import backend.app.routes.workspaces as ws_module

        item = _patch_store.get_item("ws-1", "item-1")
        item.type = "audio"
        item.results = {
            "transcript_segments": [
                {"t_sec": 0, "speaker": "SPEAKER_00", "text": "发言"},
            ],
        }
        captured: dict[str, object] = {}

        def fake_create_task(project_id: str, task_type: str, payload: dict[str, object]) -> TaskRecord:
            captured.update(payload)
            return _fake_summary_task("speaker-task")

        monkeypatch.setattr(ws_module._pipeline_runner, "create_task", fake_create_task)
        resp = client.post("/workspaces/ws-1/items/item-1/summaries", json={
            "template": "concise",
            "summary_mode": "speaker_aware",
        })
        assert resp.status_code == 201
        assert resp.json()["task_id"] == "speaker-task"
        assert captured["summary_mode"] == "speaker_aware"

    def test_speaker_map_updates_existing_speaker_summary_in_place(
        self, _patch_store: WorkspaceStore,
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
        assert resp.json()["summary_refresh"]["updated_count"] == 2
        summaries = _patch_store.get_item("ws-1", "item-1").summaries
        assert [s.version for s in summaries] == [0, 1]
        assert summaries[0].content_md == "主持人 提出旧总结"
        assert summaries[1].content_md == "主持人 出现在普通总结中"

    def test_speaker_profile_keeps_name_and_role_for_future_summary(
        self, _patch_store: WorkspaceStore,
    ) -> None:
        item = _patch_store.get_item("ws-1", "item-1")
        item.type = "audio"
        item.results = {
            "transcript_segments": [
                {"t_sec": 0, "speaker": "SPEAKER_00", "text": "我们先讨论客户目标"},
            ],
        }
        resp = client.patch("/workspaces/ws-1/items/item-1/speaker_map", json={
            "speaker_map": {"SPEAKER_00": "李总"},
            "speaker_roles": {"SPEAKER_00": "客户"},
        })

        assert resp.status_code == 200
        assert resp.json()["speaker_map"] == {"SPEAKER_00": "李总"}
        assert resp.json()["speaker_roles"] == {"SPEAKER_00": "客户"}
        saved = _patch_store.get_item("ws-1", "item-1")
        assert saved.results["speaker_map"] == {"SPEAKER_00": "李总"}
        assert saved.results["speaker_roles"] == {"SPEAKER_00": "客户"}

    def test_llm_failure_is_reported_by_background_handler(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        import backend.app.routes.workspaces as ws_module

        task = _fake_summary_task("failing-summary-task")
        monkeypatch.setattr(
            ws_module,
            "generate_summary",
            MagicMock(side_effect=RuntimeError("未配置 chat model")),
        )
        with pytest.raises(RuntimeError, match="未配置 chat model"):
            ws_module._handle_summary_task(task, ws_module._pipeline_runner)


# ── GET detail ──────────────────────────────────────────────────


class TestGetSummary:
    def test_not_found(self) -> None:
        resp = client.get("/workspaces/ws-1/items/item-1/summaries/nonexistent")
        assert resp.status_code == 404

    def test_get_after_background_task_persist(self, _patch_store: WorkspaceStore) -> None:
        _patch_store.get_item("ws-1", "item-1").summaries.append(ItemSummary(
            summary_id="s-detail", template="detailed", version=1, content_md="详细内容",
        ))

        resp = client.get("/workspaces/ws-1/items/item-1/summaries/s-detail")
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
        (note_dir / "note.md").write_text(
            "---\ntitle: SPEAKER_00 会议\n---\nSPEAKER_00：正文\n",
            encoding="utf-8",
        )
        summary_dir = note_dir / "summaries" / "speaker_consultant_detailed"
        summary_dir.mkdir(parents=True)
        (summary_dir / "v0.md").write_text(
            "SPEAKER_00：总结\n", encoding="utf-8"
        )

        with patch.object(ws_module, "note_dir", return_value=note_dir):
            resp = client.get("/workspaces/ws-1/items/item-1/note")

        assert resp.status_code == 200
        assert resp.json()["speaker_map"] == {"SPEAKER_00": "主持人"}
        assert "SPEAKER_00" not in resp.json()["note_md"]
        assert "主持人" in resp.json()["note_md"]
        assert resp.json()["summaries"][0]["content"] == "主持人：总结\n"


# ── DELETE ──────────────────────────────────────────────────────


class TestDeleteSummary:
    def test_delete_not_found(self) -> None:
        resp = client.delete("/workspaces/ws-1/items/item-1/summaries/nonexistent")
        assert resp.status_code == 404

    def test_delete_after_background_task_persist(self, _patch_store: WorkspaceStore) -> None:
        _patch_store.get_item("ws-1", "item-1").summaries.append(ItemSummary(
            summary_id="s-del", template="concise", version=1, content_md="要删的",
        ))

        # 删除
        del_resp = client.delete("/workspaces/ws-1/items/item-1/summaries/s-del")
        assert del_resp.status_code == 200
        assert del_resp.json()["status"] == "deleted"

        # 列表变空
        list_resp = client.get("/workspaces/ws-1/items/item-1/summaries")
        assert list_resp.status_code == 200
        assert list_resp.json() == []
