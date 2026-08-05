"""tests for GET/PATCH /settings（外观 + 导出与同步非敏感默认值）"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
import shared.appearance_store as store

client = TestClient(app)


@pytest.fixture()
def isolated_store(tmp_path, monkeypatch):
    """把设置存储隔离到临时目录，避免污染真实 .local/appearance_settings.json。"""
    monkeypatch.setattr(store, "STORE_DIR", tmp_path)
    monkeypatch.setattr(store, "SETTINGS_PATH", tmp_path / "appearance_settings.json")
    return tmp_path


def test_defaults_include_export_sync_defaults(isolated_store):
    body = client.get("/settings").json()
    assert body["export_sync"]["notion_parent_page_id"] == ""
    assert body["export_sync"]["feishu_folder_token"] == ""


def test_patch_export_sync_roundtrip(isolated_store):
    resp = client.patch(
        "/settings",
        json={
            "export_sync": {
                "notion_parent_page_id": "abc123",
                "feishu_folder_token": "fldXyz",
            }
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["export_sync"]["notion_parent_page_id"] == "abc123"
    assert body["export_sync"]["feishu_folder_token"] == "fldXyz"


def test_patch_export_sync_keeps_obsidian_intact(isolated_store):
    client.patch("/settings", json={"obsidian": {"vault_path": "/tmp/vault"}})
    resp = client.patch(
        "/settings",
        json={"export_sync": {"notion_parent_page_id": "pg-1"}},
    )
    body = resp.json()
    assert body["obsidian"]["vault_path"] == "/tmp/vault"
    assert body["export_sync"]["notion_parent_page_id"] == "pg-1"


def test_patch_rejects_unknown_export_sync_fields(isolated_store):
    resp = client.patch(
        "/settings",
        json={"export_sync": {"access_token": "should-not-persist"}},
    )
    assert resp.status_code == 422
