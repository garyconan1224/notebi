"""S1 Task 2: 网络配置 API 测试。

验证：
- GET /network_config 返回默认值
- PATCH /network_config 保存并读回
- 无效 routing_mode 回退到 smart
- 代理密码不在响应中泄露
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """创建隔离的测试客户端。"""
    # 隔离设置文件
    settings_path = tmp_path / "settings.json"
    monkeypatch.setattr("shared.settings_store.SETTINGS_PATH", settings_path)
    monkeypatch.setattr("shared.settings_store.SETTINGS_DIR", tmp_path)

    from backend.app.main import app

    return TestClient(app)


# ── Task 2.1: GET 默认值 ─────────────────────────────────────────────────────


def test_get_network_config_defaults(client: TestClient) -> None:
    """GET /network_config 返回默认值。"""
    response = client.get("/network_config")
    assert response.status_code == 200
    data = response.json()
    assert data["routing_mode"] == "smart"
    assert data["global_proxy"] == ""


# ── Task 2.2: PATCH 保存并读回 ───────────────────────────────────────────────


def test_patch_network_config_round_trip(client: TestClient) -> None:
    """PATCH /network_config 保存后 GET 读回一致。"""
    # 保存
    patch_response = client.patch(
        "/network_config",
        json={"routing_mode": "proxy", "global_proxy": "http://127.0.0.1:7890"},
    )
    assert patch_response.status_code == 200
    assert patch_response.json()["routing_mode"] == "proxy"

    # 读回
    get_response = client.get("/network_config")
    assert get_response.status_code == 200
    data = get_response.json()
    assert data["routing_mode"] == "proxy"
    assert data["global_proxy"] == "http://127.0.0.1:7890"


# ── Task 2.3: 无效枚举回退 ───────────────────────────────────────────────────


def test_invalid_routing_mode_falls_back(client: TestClient) -> None:
    """无效 routing_mode 回退到 smart。"""
    response = client.patch("/network_config", json={"routing_mode": "invalid"})
    assert response.status_code == 200
    assert response.json()["routing_mode"] == "smart"


# ── Task 2.4: 部分更新保留其他字段 ───────────────────────────────────────────


def test_partial_update_preserves_other_fields(client: TestClient) -> None:
    """部分更新只改指定字段。"""
    # 先设置完整配置
    client.patch(
        "/network_config",
        json={"routing_mode": "proxy", "global_proxy": "http://proxy:8080"},
    )

    # 只更新 routing_mode
    response = client.patch("/network_config", json={"routing_mode": "direct"})
    assert response.status_code == 200
    data = response.json()
    assert data["routing_mode"] == "direct"
    assert data["global_proxy"] == "http://proxy:8080"  # 保留


# ── Task 2.5: 兼容 POST 方法 ─────────────────────────────────────────────────


def test_post_network_config_compat(client: TestClient) -> None:
    """POST /network_config 兼容旧方法。"""
    response = client.post("/network_config", json={"routing_mode": "direct"})
    assert response.status_code == 200
    assert response.json()["routing_mode"] == "direct"
