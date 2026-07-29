from __future__ import annotations

from pathlib import Path

import pytest

from backend.app.models.workspace import ItemSummary, WorkspaceItem, WorkspaceRecord
from backend.app.services.workspace_store import WorkspaceStore


@pytest.fixture()
def retrieval_store(tmp_path: Path) -> WorkspaceStore:
    """Create a representative multi-workspace retrieval data set."""

    store = WorkspaceStore(root=tmp_path / "workspaces")
    shared_id = "legacy-shared-item"
    first = WorkspaceRecord(workspace_id="ws_alpha", name="产品研究")
    first.items = [
        WorkspaceItem(
            item_id=shared_id,
            type="video",
            source="url",
            source_value="https://example.com/product-video",
            name="产品发布会",
            results={
                "transcript_segments": [
                    {
                        "start": 10.0,
                        "end": 18.5,
                        "text": "新产品支持离线搜索和知识整理。",
                    }
                ],
                "summary": "发布会总结",
            },
            tags={"topic": ["产品"], "status": ["待复查"]},
            summaries=[
                ItemSummary(
                    summary_id="summary-alpha-v1",
                    template="concise",
                    version=1,
                    content_md="第一版产品总结",
                ),
                ItemSummary(
                    summary_id="summary-alpha-v2",
                    template="concise",
                    version=2,
                    content_md="第二版产品总结",
                ),
            ],
        ),
        WorkspaceItem(
            item_id="text-note",
            type="text",
            source="local",
            source_value="manual",
            name="手工笔记",
            results={"content_md": "这是一段可独立编辑的用户笔记正文。"},
        ),
    ]
    first.favorites = [shared_id]

    second = WorkspaceRecord(workspace_id="ws_beta", name="市场观察")
    second.items = [
        WorkspaceItem(
            item_id=shared_id,
            type="audio",
            source="url",
            source_value="https://example.com/product-audio",
            name="同源访谈副本",
            results={
                "transcript_segments": [
                    {
                        "start": 30.0,
                        "end": 42.0,
                        "text": "市场反馈关注产品的搜索准确率。",
                    }
                ]
            },
        ),
        WorkspaceItem(
            item_id="empty-image",
            type="image",
            source="local",
            source_value="/tmp/empty.png",
            name="暂无分析结果",
        ),
    ]

    store.create(first)
    store.create(second)
    return store
