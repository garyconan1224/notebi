"""S1 Task 2: 网络配置 API 测试。

验证：
- GET /network_config 返回默认值
- PATCH /network_config 保存并读回
- 无效 routing_mode / 代理地址返回 422
- 连通性测试返回可解释结果且不泄露代理密码
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


def test_invalid_routing_mode_is_rejected(client: TestClient) -> None:
    """无效 routing_mode 返回 422，不静默改变用户输入。"""
    response = client.patch("/network_config", json={"routing_mode": "invalid"})
    assert response.status_code == 422


@pytest.mark.parametrize(
    "proxy",
    ["ftp://127.0.0.1:21", "127.0.0.1:7890", "javascript:alert(1)"],
)
def test_invalid_proxy_is_rejected(client: TestClient, proxy: str) -> None:
    response = client.patch("/network_config", json={"global_proxy": proxy})
    assert response.status_code == 422


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


def test_connection_probe_reports_route_without_proxy_password(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client.patch(
        "/network_config",
        json={
            "routing_mode": "proxy",
            "global_proxy": "http://user:secret@127.0.0.1:7890",
        },
    )
    monkeypatch.setattr(
        "backend.app.routes.network_config._probe_url",
        lambda target, proxy: (True, "连接成功"),
    )

    response = client.post(
        "/network_config/test",
        json={"target": "https://www.youtube.com/"},
    )
    assert response.status_code == 200
    data = response.json()
    assert set(data) == {
        "target",
        "route",
        "proxy_used",
        "elapsed_ms",
        "ok",
        "message",
    }
    assert data["ok"] is True
    assert data["proxy_used"] is True
    assert "secret" not in response.text
