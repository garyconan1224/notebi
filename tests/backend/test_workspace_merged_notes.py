from __future__ import annotations

from pathlib import Path

from backend.app.models.workspace import MergedNote, WorkspaceItem, WorkspaceRecord
from backend.app.routes import workspaces as workspace_routes
from backend.app.services.workspace_knowledge import collect_workspace_json_paths
from backend.app.services.workspace_store import WorkspaceStore


def _store(tmp_path: Path, monkeypatch) -> WorkspaceStore:
    store = WorkspaceStore(tmp_path / "workspaces")
    store.create(
        WorkspaceRecord(
            workspace_id="ws",
            name="合集",
            items=[
                WorkspaceItem(
                    item_id="item-1",
                    type="text",
                    source="local",
                    source_value="manual",
                    name="素材一",
                    results={"summary": "摘要"},
                )
            ],
        )
    )
    monkeypatch.setattr(workspace_routes, "_store", store)
    monkeypatch.setattr(
        workspace_routes,
        "invalidate_workspace_index",
        lambda _workspace_id: None,
    )
    return store


def test_legacy_merged_note_becomes_version_one() -> None:
    note = MergedNote.from_dict(
        {
            "merged_id": "legacy",
            "title": "旧融合笔记",
            "item_ids": ["item-1"],
            "content_md": "旧正文",
            "created_at": "2026-01-01T00:00:00+00:00",
        }
    )
    assert note.current_version_id
    assert len(note.versions) == 1
    assert note.versions[0].content_md == "旧正文"
    assert note.to_dict()["content_md"] == "旧正文"


def test_merged_note_create_edit_restore_and_soft_delete(
    tmp_path: Path,
    monkeypatch,
) -> None:
    _store(tmp_path, monkeypatch)
    created = workspace_routes.create_merged_note(
        "ws",
        workspace_routes.MergedNoteCreateRequest(
            title="主题",
            content_md="第一版",
            item_ids=["item-1"],
        ),
    )
    first_id = created["current_version_id"]
    assert created["versions"][0]["created_by"] == "user"
    assert created["versions"][0]["source_snapshot"][0]["content_id"]

    edited = workspace_routes.update_merged_note(
        "ws",
        created["merged_id"],
        workspace_routes.MergedNoteUpdateRequest(content_md="第二版"),
    )
    assert len(edited["versions"]) == 2
    assert edited["content_md"] == "第二版"

    restored = workspace_routes.restore_merged_note_version(
        "ws",
        created["merged_id"],
        first_id,
    )
    assert len(restored["versions"]) == 3
    assert restored["content_md"] == "第一版"
    assert restored["versions"][-1]["created_by"] == "restore"

    deleted = workspace_routes.delete_merged_note("ws", created["merged_id"])
    assert deleted["deleted"] is True
    assert workspace_routes.list_merged_notes("ws") == []
    assert len(_store_record := workspace_routes._store.get("ws").merged_notes) == 1
    assert _store_record[0].deleted_at


def test_only_current_merged_note_version_enters_workspace_index(
    tmp_path: Path,
    monkeypatch,
) -> None:
    store = _store(tmp_path, monkeypatch)
    created = workspace_routes.create_merged_note(
        "ws",
        workspace_routes.MergedNoteCreateRequest(
            title="主题",
            content_md="第一版",
            item_ids=["item-1"],
        ),
    )
    workspace_routes.update_merged_note(
        "ws",
        created["merged_id"],
        workspace_routes.MergedNoteUpdateRequest(content_md="第二版"),
    )

    paths, source_map, _record = collect_workspace_json_paths(
        "ws",
        tmp_path / "index",
        store=store,
    )
    merged_paths = [path for path in paths if "merged-" in path.name]
    assert len(merged_paths) == 1
    payload = merged_paths[0].read_text(encoding="utf-8")
    assert "第二版" in payload
    assert "第一版" not in payload
    assert source_map[str(merged_paths[0])]["source_type"] == "merged_note"
