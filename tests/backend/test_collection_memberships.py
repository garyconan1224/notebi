from __future__ import annotations

from pathlib import Path

import pytest

from backend.app.models.workspace import ItemSummary, WorkspaceItem, WorkspaceRecord
from backend.app.services.workspace_store import WorkspaceStore


def _store(tmp_path: Path) -> WorkspaceStore:
    store = WorkspaceStore(root=tmp_path / "workspaces")
    store.create(
        WorkspaceRecord(
            workspace_id="source",
            name="来源合集",
            items=[
                WorkspaceItem(
                    item_id="note-1",
                    type="text",
                    source="local",
                    source_value="manual",
                    results={"content_md": "第一版"},
                )
            ],
        )
    )
    store.create(WorkspaceRecord(workspace_id="target", name="目标合集"))
    return store


def test_membership_persists_one_item_and_updates_through_any_collection(tmp_path: Path) -> None:
    store = _store(tmp_path)
    assert store.add_item_membership("target", "source", "note-1") is True

    target = store.get("target")
    assert target is not None
    assert [item.item_id for item in target.items] == ["note-1"]
    assert len((tmp_path / "workspaces" / "target.json").read_text(encoding="utf-8")) > 0
    assert '"items": []' in (tmp_path / "workspaces" / "target.json").read_text(encoding="utf-8")

    store.update_item("target", "note-1", name="统一后的标题")
    store.add_item_summary(
        "target",
        "note-1",
        ItemSummary(summary_id="summary-1", template="concise", version=0, content_md="共享总结"),
    )
    source = store.get_item("source", "note-1")
    assert source.name == "统一后的标题"
    assert source.summaries[0].content_md == "共享总结"

    reloaded = WorkspaceStore(root=tmp_path / "workspaces")
    assert reloaded.get_item("target", "note-1").name == "统一后的标题"
    assert reloaded.membership_count("target") == 1


def test_removing_collection_member_only_unlinks_relationship(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.add_item_membership("target", "source", "note-1")

    store.remove_item("target", "note-1")

    assert store.membership_count("target") == 0
    assert store.get_item("source", "note-1").results["content_md"] == "第一版"
    with pytest.raises(KeyError):
        store.get_item("target", "note-1")


def test_deleting_canonical_item_unlinks_all_collections(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.create(WorkspaceRecord(workspace_id="third", name="第三合集"))
    store.add_item_membership("target", "source", "note-1")
    store.add_item_membership("third", "source", "note-1")

    store.remove_item("source", "note-1")

    assert store.membership_count("target") == 0
    assert store.membership_count("third") == 0


def test_rejects_ambiguous_cross_workspace_item_id_collision(tmp_path: Path) -> None:
    """历史数据若跨空间复用了 item_id，不能静默丢掉第二条成员关系。"""
    store = _store(tmp_path)
    store.create(
        WorkspaceRecord(
            workspace_id="other-source",
            name="另一来源",
            items=[
                WorkspaceItem(
                    item_id="note-1",
                    type="text",
                    source="local",
                    source_value="other",
                )
            ],
        )
    )
    assert store.add_item_membership("target", "source", "note-1") is True

    with pytest.raises(ValueError, match="item_id collision"):
        store.add_item_membership("target", "other-source", "note-1")
