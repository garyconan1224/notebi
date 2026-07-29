"""S1 Task 2: 下载配置 API 测试。

验证：
- GET /download_config 返回新默认值
- PATCH /download_config 保存并读回
- 废弃字段不再出现
- 无效枚举和文件名模板返回 422
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """创建隔离的测试客户端。"""
    settings_path = tmp_path / "settings.json"
    monkeypatch.setattr("shared.settings_store.SETTINGS_PATH", settings_path)
    monkeypatch.setattr("shared.settings_store.SETTINGS_DIR", tmp_path)

    from backend.app.main import app

    return TestClient(app)


# ── Task 2.1: GET 默认值 ─────────────────────────────────────────────────────


def test_get_download_config_defaults(client: TestClient) -> None:
    """GET /download_config 返回新默认值。"""
    response = client.get("/download_config")
    assert response.status_code == 200
    data = response.json()
    assert data["proxy_mode"] == "inherit"
    assert data["cookie_mode"] == "browser"
    assert data["cookie_browser"] == "chrome"
    assert data["concurrency_limit"] == 2
    assert data["retry_count"] == 2
    assert data["socket_timeout"] == 30


# ── Task 2.2: 废弃字段不出现 ─────────────────────────────────────────────────


def test_deprecated_fields_not_in_response(client: TestClient) -> None:
    """响应中不包含废弃字段。"""
    response = client.get("/download_config")
    data = response.json()
    assert "po_token" not in data
    assert "visitor_data" not in data
    assert "cookie_base_dirs" not in data
    assert "http_proxy" not in data


# ── Task 2.3: PATCH 保存并读回 ───────────────────────────────────────────────


def test_patch_download_config_round_trip(client: TestClient) -> None:
    """PATCH /download_config 保存后 GET 读回一致。"""
    patch_response = client.patch(
        "/download_config",
        json={
            "output_dir": "/custom/videos",
            "proxy_mode": "direct",
            "cookie_mode": "file",
            "cookie_browser": "firefox",
            "concurrency_limit": 4,
        },
    )
    assert patch_response.status_code == 200

    get_response = client.get("/download_config")
    data = get_response.json()
    assert data["output_dir"] == "/custom/videos"
    assert data["proxy_mode"] == "direct"
    assert data["cookie_mode"] == "file"
    assert data["cookie_browser"] == "firefox"
    assert data["concurrency_limit"] == 4


# ── Task 2.4: 无效枚举回退 ───────────────────────────────────────────────────


def test_invalid_proxy_mode_is_rejected(client: TestClient) -> None:
    """无效 proxy_mode 返回 422。"""
    response = client.patch("/download_config", json={"proxy_mode": "invalid"})
    assert response.status_code == 422


def test_invalid_cookie_mode_is_rejected(client: TestClient) -> None:
    """无效 cookie_mode 返回 422。"""
    response = client.patch("/download_config", json={"cookie_mode": "invalid"})
    assert response.status_code == 422


@pytest.mark.parametrize(
    "template",
    ["/tmp/%(title)s.%(ext)s", "../%(title)s.%(ext)s", "%(title)s"],
)
def test_invalid_filename_template_is_rejected(
    client: TestClient,
    template: str,
) -> None:
    response = client.patch(
        "/download_config",
        json={"filename_template": template},
    )
    assert response.status_code == 422


# ── Task 2.5: 数值边界校验 ───────────────────────────────────────────────────


def test_concurrency_limit_bounds(client: TestClient) -> None:
    """concurrency_limit 超界返回 422。"""
    response = client.patch("/download_config", json={"concurrency_limit": 100})
    assert response.status_code == 422


def test_retry_count_bounds(client: TestClient) -> None:
    """retry_count 超界返回 422。"""
    response = client.patch("/download_config", json={"retry_count": -1})
    assert response.status_code == 422


# ── Task 2.6: 兼容 POST 方法 ─────────────────────────────────────────────────


def test_post_download_config_compat(client: TestClient) -> None:
    """POST /download_config 兼容旧方法。"""
    response = client.post("/download_config", json={"proxy_mode": "proxy"})
    assert response.status_code == 200
    assert response.json()["proxy_mode"] == "proxy"
