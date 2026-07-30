from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.app.models.workspace import WorkspaceItem, WorkspaceRecord
from backend.app.routes import workspaces as workspace_routes
from backend.app.services.content_identity_migration import (
    inspect_content_identities,
    migrate_content_identities,
    rollback_content_identities,
)
from backend.app.services.workspace_store import WorkspaceStore


def _legacy_workspace(workspace_id: str, item_id: str = "shared") -> dict:
    return {
        "workspace_id": workspace_id,
        "name": workspace_id,
        "items": [{
            "item_id": item_id,
            "type": "text",
            "source": "local",
            "source_value": "manual",
            "name": "同源笔记",
            "results": {"content_md": "原始正文"},
        }],
    }


def test_legacy_items_receive_unique_content_and_shared_lineage(tmp_path: Path) -> None:
    root = tmp_path / "workspaces"
    root.mkdir()
    for workspace_id in ("alpha", "beta"):
        (root / f"{workspace_id}.json").write_text(
            json.dumps(_legacy_workspace(workspace_id)),
            encoding="utf-8",
        )

    first = WorkspaceStore(root=root)
    second = WorkspaceStore(root=root)
    alpha = first.get_item("alpha", "shared")
    beta = first.get_item("beta", "shared")

    assert alpha.content_id != beta.content_id
    assert alpha.lineage_id == beta.lineage_id
    assert second.get_item("alpha", "shared").content_id == alpha.content_id


def test_membership_shares_one_canonical_item_and_is_discoverable(
    tmp_path: Path,
    monkeypatch,
) -> None:
    store = WorkspaceStore(root=tmp_path / "workspaces")
    source_item = WorkspaceItem(
        item_id="source-item",
        type="text",
        source="local",
        source_value="manual",
        results={"content_md": "版本 A"},
    )
    store.create(WorkspaceRecord(workspace_id="source", name="来源", items=[source_item]))
    store.create(WorkspaceRecord(workspace_id="target", name="目标"))
    monkeypatch.setattr(workspace_routes, "_store", store)

    result = workspace_routes.batch_add_items_to_workspace(
        workspace_routes.BatchAddToWorkspaceRequest(
            target_workspace_id="target",
            items=[{"workspace_id": "source", "item_id": "source-item"}],
        )
    )
    shared = store.get_item("target", result["added_ids"][0])
    assert shared.item_id == source_item.item_id
    assert shared.content_id == source_item.content_id
    assert shared.lineage_id == source_item.lineage_id
    store.update_item("target", shared.item_id, results={"content_md": "版本 B"})
    assert store.get_item("source", "source-item").results["content_md"] == "版本 B"
    lineage = workspace_routes.list_item_lineage("source", "source-item")
    assert lineage["memberships"][0]["workspace_id"] == "target"
    store.remove_item("source", "source-item")
    with pytest.raises(KeyError):
        store.get_item("target", "source-item")


def test_identity_migration_is_idempotent_and_rollback_restores_backup(
    tmp_path: Path,
) -> None:
    root = tmp_path / "workspaces"
    root.mkdir()
    original = _legacy_workspace("alpha")
    path = root / "alpha.json"
    path.write_text(json.dumps(original), encoding="utf-8")

    dry_run = inspect_content_identities(root)
    applied = migrate_content_identities(root, tmp_path / "backups")
    repeated = inspect_content_identities(root)

    assert dry_run["changed_item_count"] == 1
    assert applied["verified"] is True
    assert repeated["changed_item_count"] == 0
    rollback_content_identities(root, Path(applied["backup_dir"]))
    assert json.loads(path.read_text(encoding="utf-8")) == original
