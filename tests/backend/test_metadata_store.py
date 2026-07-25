from __future__ import annotations

from pathlib import Path

import pytest

from backend.app.models.workspace import WorkspaceItem, WorkspaceRecord
from backend.app.services.metadata_store import MetadataStore


def test_reopening_store_does_not_rewrite_database(tmp_path: Path) -> None:
    path = tmp_path / "metadata.sqlite3"
    MetadataStore(path)
    initial_bytes = path.read_bytes()

    MetadataStore(path)

    assert path.read_bytes() == initial_bytes


def _record() -> WorkspaceRecord:
    item = WorkspaceItem(
        item_id="item-a",
        type="text",
        source="local",
        source_value="manual",
        tags={"subject_domain": "AI", "custom_tags": ["重点"]},
    )
    return WorkspaceRecord(
        workspace_id="workspace-a",
        name="A",
        items=[item],
        favorites=[item.item_id],
    )


def test_tags_are_normalized_and_auto_does_not_delete_manual(tmp_path: Path) -> None:
    store = MetadataStore(tmp_path / "metadata.sqlite3")
    content_id = _record().items[0].content_id
    store.replace_tags(content_id, {"custom_tags": [" 重点 ", "重点"]}, "MANUAL")
    store.replace_tags(content_id, {"subject_domain": "技术"}, "AUTO")
    store.replace_tags(content_id, {"subject_domain": "产品"}, "AUTO")

    assert store.tags_for_content(content_id, "MANUAL") == {"custom_tags": ["重点"]}
    assert store.tags_for_content(content_id, "AUTO") == {"subject_domain": "产品"}


def test_favorite_migration_and_groups_are_idempotent(tmp_path: Path) -> None:
    store = MetadataStore(tmp_path / "metadata.sqlite3")
    record = _record()

    assert store.migrate_legacy([record]) == 1
    assert store.migrate_legacy([record]) == 0
    group = store.create_favorite_group(" 稍后阅读 ")
    store.set_favorite(record.workspace_id, record.items[0].content_id, group["group_id"])

    groups = store.list_favorite_groups()
    assert {entry["name"] for entry in groups} == {"默认收藏", "稍后阅读"}
    assert record.items[0].content_id in store.favorite_content_ids(record.workspace_id)


def test_folders_are_workspace_scoped_and_deletion_keeps_content(
    tmp_path: Path,
) -> None:
    store = MetadataStore(tmp_path / "metadata.sqlite3")
    folder = store.create_folder("workspace-a", "资料")
    store.move_content("workspace-a", "content-a", folder["folder_id"])

    with pytest.raises(ValueError, match="another workspace"):
        store.move_content("workspace-b", "content-b", folder["folder_id"])

    store.delete_folder("workspace-a", folder["folder_id"])
    assert store.list_folders("workspace-a") == []


def test_favorite_export_import_is_idempotent_and_skips_missing_content(
    tmp_path: Path,
) -> None:
    source = MetadataStore(tmp_path / "source.sqlite3")
    record = _record()
    source.migrate_legacy([record])
    payload = source.export_favorites()
    payload["items"].append({
        "group_name": "默认收藏",
        "workspace_id": "missing",
        "content_id": "missing",
    })
    target = MetadataStore(tmp_path / "target.sqlite3")

    first = target.import_favorites(payload, {record.items[0].content_id})
    second = target.import_favorites(payload, {record.items[0].content_id})

    assert first == {"imported": 1, "skipped": 1}
    assert second == {"imported": 0, "skipped": 1}
