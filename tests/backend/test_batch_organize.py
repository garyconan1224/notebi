from __future__ import annotations

from pathlib import Path

from backend.app.models.workspace import WorkspaceItem, WorkspaceRecord
from backend.app.routes import workspaces as workspace_routes
from backend.app.services.metadata_store import MetadataStore
from backend.app.services.workspace_store import WorkspaceStore


def test_batch_organize_updates_manual_tags_and_workspace_folder(
    tmp_path: Path,
    monkeypatch,
) -> None:
    store = WorkspaceStore(tmp_path / "workspaces")
    item = WorkspaceItem(
        item_id="item", type="text", source="local", source_value="manual",
        tags={"subject_domain": "技术"},
    )
    store.create(WorkspaceRecord(workspace_id="workspace", name="合集", items=[item]))
    metadata = MetadataStore(tmp_path / "metadata.sqlite3")
    metadata.replace_tags(item.content_id, item.tags, "AUTO")
    folder = metadata.create_folder("workspace", "待整理")
    monkeypatch.setattr(workspace_routes, "_store", store)
    monkeypatch.setattr(workspace_routes, "_metadata", metadata)

    result = workspace_routes.batch_organize_items(
        workspace_routes.BatchOrganizeRequest(
            items=[{"workspace_id": "workspace", "item_id": "item"}],
            tags={"custom_tags": ["重点"]},
            folder_id=folder["folder_id"],
        )
    )

    assert result == {"changed": 1, "failed": 0, "failures": []}
    assert store.get_item("workspace", "item").tags == {
        "subject_domain": "技术",
        "custom_tags": ["重点"],
    }
