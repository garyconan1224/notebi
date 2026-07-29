from __future__ import annotations

from pathlib import Path

from backend.app.models.workspace import WorkspaceItem, WorkspaceRecord
from backend.app.routes import workspaces as workspace_routes
from backend.app.services.note_version_store import NoteVersionStore
from backend.app.services.workspace_store import WorkspaceStore


def test_note_version_store_deduplicates_consecutive_content(tmp_path: Path) -> None:
    versions = NoteVersionStore(tmp_path / "metadata.sqlite3")

    assert versions.checkpoint("content", "第一版", "USER_EDIT")
    assert versions.checkpoint("content", "第一版", "USER_EDIT") is None
    assert versions.checkpoint("content", "第二版", "USER_EDIT")
    assert [entry["version_no"] for entry in versions.list("content")] == [2, 1]


def test_note_route_versions_restore_and_adopt_are_independent(
    tmp_path: Path,
    monkeypatch,
) -> None:
    store = WorkspaceStore(tmp_path / "workspaces")
    source = WorkspaceItem(
        item_id="source-item", type="text", source="local", source_value="manual",
    )
    sibling = WorkspaceItem.from_dict(source.to_dict())
    sibling.item_id = "sibling-item"
    sibling.content_id = "sibling-content"
    store.create(WorkspaceRecord(workspace_id="source", name="来源", items=[source]))
    store.create(WorkspaceRecord(workspace_id="sibling", name="同源", items=[sibling]))
    note_root = tmp_path / "notes"
    monkeypatch.setattr(workspace_routes, "_store", store)
    monkeypatch.setattr(
        workspace_routes,
        "_note_versions",
        NoteVersionStore(tmp_path / "metadata.sqlite3"),
    )
    monkeypatch.setattr(
        workspace_routes,
        "note_dir",
        lambda workspace_id, item_id: note_root / workspace_id / item_id,
    )
    for workspace_id, item_id, body in (
        ("source", "source-item", "第一版"),
        ("sibling", "sibling-item", "同源独立版本"),
    ):
        directory = note_root / workspace_id / item_id
        directory.mkdir(parents=True)
        (directory / "note.md").write_text(
            f"---\nversion: 1\nuser_edited: true\n---\n\n{body}",
            encoding="utf-8",
        )

    workspace_routes.update_item_note(
        "source", "source-item", workspace_routes.NoteUpdateRequest(body="第二版"),
    )
    versions = workspace_routes.list_note_versions("source", "source-item")
    restored = workspace_routes.restore_note_version(
        "source", "source-item", versions[-1]["version_id"],
    )
    assert restored["note_md"].endswith("第一版")

    adopted = workspace_routes.adopt_sibling_note(
        "source",
        "source-item",
        workspace_routes.AdoptSiblingRequest(
            sibling_content_id=sibling.content_id,
        ),
    )
    assert adopted["note_md"].endswith("同源独立版本")
    sibling_body = (note_root / "sibling" / "sibling-item" / "note.md").read_text()
    assert sibling_body.endswith("同源独立版本")
