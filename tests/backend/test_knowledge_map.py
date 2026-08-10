"""信息地图聚合接口测试。"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.models.workspace import WorkspaceItem, WorkspaceRecord
from backend.app.routes import workspaces as ws_module
from backend.app.services.workspace_store import WorkspaceStore


def _client(tmp_path: Path) -> tuple[TestClient, WorkspaceStore, FastAPI]:
    store = WorkspaceStore(root=tmp_path / "workspaces")
    app = FastAPI()
    app.include_router(ws_module.router)
    patcher = patch.object(ws_module, "_store", store)
    runner_patcher = patch.object(ws_module, "_pipeline_runner", MagicMock())
    patcher.start()
    runner_patcher.start()
    client = TestClient(app)
    client._knowledge_map_patchers = (patcher, runner_patcher)  # type: ignore[attr-defined]
    return client, store, app


def _close_client(client: TestClient) -> None:
    for patcher in getattr(client, "_knowledge_map_patchers", ()):
        patcher.stop()
    client.close()


def test_knowledge_map_aggregates_active_items_and_tag_cooccurrence(tmp_path: Path) -> None:
    client, store, _ = _client(tmp_path)
    try:
        store.create(
            WorkspaceRecord(
                workspace_id="ws_map_active",
                name="主动学习",
                items=[
                    WorkspaceItem(
                        item_id="item-a",
                        type="video",
                        source="url",
                        source_value="https://example.com/a",
                        name="AI 入门",
                        tags={"subject_domain": "科技", "custom_tags": ["AI", "教程"]},
                    ),
                    WorkspaceItem(
                        item_id="item-b",
                        type="text",
                        source="local",
                        source_value="manual",
                        name="知识库笔记",
                        tags={"subject_domain": "科技", "custom_tags": ["知识库"]},
                    ),
                ],
            )
        )
        store.create(
            WorkspaceRecord(
                workspace_id="__inbox__",
                name="收件箱",
                source="inbox",
                items=[
                    WorkspaceItem(
                        item_id="inbox-item",
                        type="video",
                        source="url",
                        source_value="https://example.com/inbox",
                        name="不进入地图",
                        tags={"custom_tags": ["隐藏"]},
                    )
                ],
            )
        )
        store.create(
            WorkspaceRecord(
                workspace_id="ws_map_trashed",
                name="已删除",
                trashed=True,
                items=[
                    WorkspaceItem(
                        item_id="trashed-item",
                        type="audio",
                        source="local",
                        source_value="/tmp/trashed.mp3",
                        name="不进入地图",
                        tags={"custom_tags": ["隐藏"]},
                    )
                ],
            )
        )

        response = client.get("/workspaces/knowledge-map")

        assert response.status_code == 200
        data = response.json()
        assert data["stats"]["items"] == 2
        assert data["stats"]["tagged_items"] == 2
        assert data["stats"]["tags"] == 4
        assert data["stats"]["hidden_tags"] == 0
        assert {item["item_id"] for item in data["items"]} == {"item-a", "item-b"}
        assert {node["id"] for node in data["nodes"]} == {
            "tag:AI",
            "tag:教程",
            "tag:知识库",
            "tag:科技",
        }
        assert {
            (edge["source"], edge["target"], edge["weight"])
            for edge in data["edges"]
        } == {
            ("tag:AI", "tag:教程", 1),
            ("tag:AI", "tag:科技", 1),
            ("tag:知识库", "tag:科技", 1),
            ("tag:教程", "tag:科技", 1),
        }
    finally:
        _close_client(client)


def test_knowledge_map_filters_by_collection_as_workspace(tmp_path: Path) -> None:
    """合集筛选等价于素材归属的 workspace 筛选。"""
    client, store, _ = _client(tmp_path)
    try:
        store.create(
            WorkspaceRecord(
                workspace_id="ws_alpha",
                name="合集甲",
                items=[
                    WorkspaceItem(
                        item_id="item-1",
                        type="video",
                        source="url",
                        source_value="https://example.com/1",
                        name="甲素材",
                        tags={"custom_tags": ["共享"]},
                    )
                ],
            )
        )
        store.create(
            WorkspaceRecord(
                workspace_id="ws_beta",
                name="合集乙",
                items=[
                    WorkspaceItem(
                        item_id="item-2",
                        type="text",
                        source="local",
                        source_value="manual",
                        name="乙素材",
                        tags={"custom_tags": ["共享"]},
                    )
                ],
            )
        )

        facets = client.get("/workspaces/knowledge-map").json()["facets"]
        assert facets["collections"] == [
            ["ws_alpha", "合集甲"],
            ["ws_beta", "合集乙"],
        ]

        filtered = client.get(
            "/workspaces/knowledge-map", params={"collection_id": "ws_alpha"}
        ).json()
        assert filtered["stats"]["items"] == 1
        assert {item["item_id"] for item in filtered["items"]} == {"item-1"}
    finally:
        _close_client(client)


def test_knowledge_map_rejects_non_positive_limit(tmp_path: Path) -> None:
    client, _, _ = _client(tmp_path)
    try:
        response = client.get("/workspaces/knowledge-map?limit=0")
        assert response.status_code == 422
    finally:
        _close_client(client)
