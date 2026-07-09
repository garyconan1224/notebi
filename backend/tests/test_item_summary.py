"""ItemSummary dataclass + WorkspaceItem 迁移逻辑测试。"""

from __future__ import annotations

import pytest

from backend.app.models.workspace import ItemSummary, WorkspaceItem


# ── ItemSummary 基本 roundtrip ──────────────────────────────────


class TestItemSummaryRoundtrip:
    """ItemSummary ↔ dict 序列化 / 反序列化。"""

    def test_to_dict_and_from_dict(self) -> None:
        s = ItemSummary(
            summary_id="abc-123",
            template="concise",
            version=1,
            background_for_summary="这是背景",
            content_md="# 摘要\n\n内容",
            model_used="openai/gpt-4o",
            created_at="2026-05-28T12:00:00+00:00",
        )
        d = s.to_dict()
        assert d["summary_id"] == "abc-123"
        assert d["template"] == "concise"
        assert d["version"] == 1
        assert d["background_for_summary"] == "这是背景"
        assert d["content_md"] == "# 摘要\n\n内容"
        assert d["model_used"] == "openai/gpt-4o"

        s2 = ItemSummary.from_dict(d)
        assert s2.summary_id == s.summary_id
        assert s2.template == s.template
        assert s2.version == s.version
        assert s2.content_md == s.content_md
        assert s2.model_used == s.model_used

    def test_from_dict_defaults(self) -> None:
        """缺失字段用默认值填充。"""
        s = ItemSummary.from_dict({"summary_id": "x", "template": "detailed", "version": 2})
        assert s.background_for_summary == ""
        assert s.content_md == ""
        assert s.model_used == ""
        assert s.created_at  # 非空，自动生成


# ── WorkspaceItem.summaries 字段 ────────────────────────────────


class TestWorkspaceItemSummaries:
    """WorkspaceItem 新增 summaries 字段的序列化和迁移。"""

    def _make_item_dict(self, **overrides: object) -> dict:
        base: dict = {
            "item_id": "item-1",
            "type": "video",
            "source": "local",
            "source_value": "/tmp/test.mp4",
            "name": "测试视频",
            "status": "done",
            "results": {},
        }
        base.update(overrides)
        return base

    def test_new_item_empty_summaries(self) -> None:
        """新数据（无 summaries、无 results.summary）→ summaries 为空列表。"""
        item = WorkspaceItem.from_dict(self._make_item_dict())
        assert item.summaries == []

    def test_migration_legacy_summary(self) -> None:
        """老数据有 results["summary"] 但无 summaries → 自动迁移为 legacy v1。"""
        item = WorkspaceItem.from_dict(self._make_item_dict(
            results={"summary": "这是老的总结内容", "transcript": "转写文本"},
        ))
        assert len(item.summaries) == 1
        legacy = item.summaries[0]
        assert legacy.summary_id == "legacy"
        assert legacy.template == "legacy"
        assert legacy.version == 1
        assert legacy.content_md == "这是老的总结内容"

    def test_migration_no_trigger_when_summaries_present(self) -> None:
        """已有 summaries 字段 → 不触发迁移（即使 results.summary 也存在）。"""
        item = WorkspaceItem.from_dict(self._make_item_dict(
            results={"summary": "老内容"},
            summaries=[{"summary_id": "s1", "template": "concise", "version": 1, "content_md": "新内容"}],
        ))
        assert len(item.summaries) == 1
        assert item.summaries[0].summary_id == "s1"
        assert item.summaries[0].content_md == "新内容"

    def test_migration_no_trigger_when_summary_empty(self) -> None:
        """results["summary"] 为空字符串 → 不触发迁移。"""
        item = WorkspaceItem.from_dict(self._make_item_dict(
            results={"summary": ""},
        ))
        assert item.summaries == []

    def test_migration_no_trigger_when_no_results(self) -> None:
        """results 为空 → 不触发迁移。"""
        item = WorkspaceItem.from_dict(self._make_item_dict())
        assert item.summaries == []

    def test_summaries_roundtrip(self) -> None:
        """含 summaries 的 item → to_dict → from_dict → 内容一致。"""
        original = WorkspaceItem.from_dict(self._make_item_dict(
            summaries=[
                {"summary_id": "s1", "template": "concise", "version": 1, "content_md": "v1 内容"},
                {"summary_id": "s2", "template": "concise", "version": 2, "content_md": "v2 内容"},
                {"summary_id": "s3", "template": "detailed", "version": 1, "content_md": "详细内容"},
            ],
        ))
        d = original.to_dict()
        restored = WorkspaceItem.from_dict(d)
        assert len(restored.summaries) == 3
        assert restored.summaries[0].content_md == "v1 内容"
        assert restored.summaries[1].version == 2
        assert restored.summaries[2].template == "detailed"

    def test_legacy_migration_roundtrip(self) -> None:
        """迁移后的 legacy → to_dict → from_dict → 仍保留。"""
        item = WorkspaceItem.from_dict(self._make_item_dict(
            results={"summary": "老总结"},
        ))
        d = item.to_dict()
        # to_dict 后 summaries 应在 dict 里
        assert "summaries" in d
        assert len(d["summaries"]) == 1

        restored = WorkspaceItem.from_dict(d)
        assert len(restored.summaries) == 1
        assert restored.summaries[0].template == "legacy"
        assert restored.summaries[0].content_md == "老总结"
