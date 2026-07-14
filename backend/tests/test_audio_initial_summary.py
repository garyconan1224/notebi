from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

from backend.app.models.tasks import TaskRecord, TaskStatus
from backend.app.models.workspace import WorkspaceItem, WorkspaceRecord
from backend.app.services.workspace_store import WorkspaceStore


def test_audio_task_summary_is_persisted_as_default_v0(
    tmp_path: Path, monkeypatch,
) -> None:
    import backend.app.routes.workspaces as ws_module

    store = WorkspaceStore(root=tmp_path / "store")
    item = WorkspaceItem(
        item_id="item-1",
        type="audio",
        source="local",
        source_value="/tmp/interview.m4a",
        related_task_ids=["audio-1"],
    )
    workspace = WorkspaceRecord(workspace_id="ws-1", name="测试")
    workspace.items.append(item)
    store.create(workspace)
    monkeypatch.setattr(ws_module, "_store", store)
    monkeypatch.setattr(ws_module, "note_dir", lambda *_args: tmp_path / "note")
    monkeypatch.setattr(ws_module, "assemble_item_note", MagicMock())

    task = TaskRecord(
        task_id="audio-1",
        project_id="default_project",
        task_type="audio",
        status=TaskStatus.SUCCESS.value,
        payload={
            "summary_template": "detailed",
            "summary_mode": "speaker_aware",
        },
        result={
            "summary": "# 默认总结\n\n按说话人整理的内容",
            "summary_mode": "speaker_aware",
            "transcript_segments": [
                {"start": 0, "end": 2, "text": "你好", "speaker": "SPEAKER_00"},
            ],
        },
    )

    ws_module._assemble_note_for_task(task, MagicMock())

    saved = store.get_item("ws-1", "item-1")
    assert len(saved.summaries) == 1
    assert saved.summaries[0].version == 0
    assert saved.summaries[0].template == "detailed"
    assert saved.summaries[0].summary_mode == "speaker_aware"
    assert saved.summaries[0].content_md.startswith("# 默认总结")


def test_partial_audio_persists_transcript_without_fake_v0(
    tmp_path: Path, monkeypatch,
) -> None:
    import backend.app.routes.workspaces as ws_module

    store_root = tmp_path / "store"
    store = WorkspaceStore(root=store_root)
    item = WorkspaceItem(
        item_id="item-partial",
        type="audio",
        source="local",
        source_value="/tmp/interview.m4a",
        related_task_ids=["audio-partial"],
    )
    workspace = WorkspaceRecord(workspace_id="ws-partial", name="测试")
    workspace.items.append(item)
    store.create(workspace)
    monkeypatch.setattr(ws_module, "_store", store)
    monkeypatch.setattr(ws_module, "note_dir", lambda *_args: tmp_path / "note-partial")
    monkeypatch.setattr(ws_module, "assemble_item_note", MagicMock())

    task = TaskRecord(
        task_id="audio-partial",
        project_id="default_project",
        task_type="audio",
        status=TaskStatus.PARTIAL.value,
        payload={"summary_template": "detailed", "summary_mode": "speaker_aware"},
        result={
            "summary": "",
            "summary_mode": "speaker_aware",
            "transcript_segments": [{"start": 0, "end": 2, "text": "你好"}],
            "partial_failure": {
                "stage": "diarization",
                "code": "inference_failed",
                "message": "模型加载失败",
            },
        },
    )

    ws_module._assemble_note_for_task(task, MagicMock())

    reloaded = WorkspaceStore(root=store_root)
    saved = reloaded.get_item("ws-partial", "item-partial")
    assert saved.status == "partial"
    assert saved.results["transcript_segments"][0]["text"] == "你好"
    assert saved.results["partial_failure"]["stage"] == "diarization"
    assert saved.summaries == []
