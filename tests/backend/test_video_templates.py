"""V3.2 视频模板 CRUD 测试。"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pytest import MonkeyPatch

import shared.template_store as template_store_module
from backend.app.routes.templates import router as templates_router
from backend.app.routes.templates import legacy_router as templates_legacy_router


@pytest.fixture
def client(tmp_path: Path, monkeypatch: MonkeyPatch) -> TestClient:
    """每个测试用独立 .local/video_templates.json，避免污染真实数据。"""
    store_dir = tmp_path / ".local"
    store_file = store_dir / "video_templates.json"
    monkeypatch.setattr(template_store_module, "STORE_DIR", store_dir)
    monkeypatch.setattr(template_store_module, "STORE_PATH", store_file)

    app = FastAPI()
    app.include_router(templates_router)
    app.include_router(templates_legacy_router)
    return TestClient(app)


def test_get_all_templates_includes_builtins(client: TestClient) -> None:
    resp = client.get("/video-templates")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 6
    names = {t["name"] for t in data}
    assert names >= {"教程", "Vlog", "访谈", "影视点评", "产品评测", "其它"}
    builtins = [t for t in data if t["is_builtin"]]
    assert len(builtins) == 9


def test_create_and_get_custom_template(client: TestClient) -> None:
    resp = client.post(
        "/video-templates",
        json={"name": "学术讲座", "prompt": "学术讲座 prompt"},
    )
    assert resp.status_code == 201
    created = resp.json()
    assert created["name"] == "学术讲座"
    assert created["is_builtin"] is False
    assert created["template_id"]

    resp2 = client.get("/video-templates")
    all_names = {t["name"] for t in resp2.json()}
    assert "学术讲座" in all_names
    assert "教程" in all_names


def test_create_duplicate_name_rejected(client: TestClient) -> None:
    client.post(
        "/video-templates",
        json={"name": "学术讲座", "prompt": "p1"},
    )
    resp = client.post(
        "/video-templates",
        json={"name": "学术讲座", "prompt": "p2"},
    )
    assert resp.status_code == 409


def test_create_builtin_name_rejected(client: TestClient) -> None:
    resp = client.post(
        "/video-templates",
        json={"name": "教程", "prompt": "xxx"},
    )
    assert resp.status_code == 409


@pytest.mark.parametrize(
    "payload",
    [
        {"name": "   ", "prompt": "valid prompt"},
        {"name": "空白 Prompt", "prompt": "   "},
    ],
)
def test_create_rejects_blank_after_strip(
    client: TestClient,
    payload: dict[str, str],
) -> None:
    resp = client.post("/video-templates", json=payload)
    assert resp.status_code == 422


def test_edit_custom_template(client: TestClient) -> None:
    created = client.post(
        "/video-templates",
        json={"name": "初版", "prompt": "p1"},
    ).json()

    resp = client.put(
        f"/video-templates/{created['template_id']}",
        json={"name": "修订版", "prompt": "p2"},
    )
    assert resp.status_code == 200
    updated = resp.json()
    assert updated["name"] == "修订版"
    assert updated["prompt"] == "p2"


def test_edit_builtin_rejected(client: TestClient) -> None:
    resp = client.put(
        "/video-templates/builtin-教程",
        json={"name": "新教程", "prompt": "xxx"},
    )
    assert resp.status_code == 403


def test_delete_custom_template(client: TestClient) -> None:
    created = client.post(
        "/video-templates",
        json={"name": "待删", "prompt": "p"},
    ).json()

    resp = client.delete(f"/video-templates/{created['template_id']}")
    assert resp.status_code == 204

    all_data = client.get("/video-templates").json()
    names = {t["name"] for t in all_data}
    assert "待删" not in names


def test_delete_builtin_rejected(client: TestClient) -> None:
    resp = client.delete("/video-templates/builtin-教程")
    assert resp.status_code == 403


def test_duplicate_builtin_creates_editable_copy(client: TestClient) -> None:
    resp = client.post(
        "/video-templates/builtin-教程/duplicate",
        json={"source_prompt": "自定义教程 prompt"},
    )
    assert resp.status_code == 201
    copy = resp.json()
    assert copy["is_builtin"] is False
    assert "教程" in copy["name"]
    assert copy["prompt"] == "自定义教程 prompt"


def test_duplicate_custom_template(client: TestClient) -> None:
    created = client.post(
        "/video-templates",
        json={"name": "原始", "prompt": "orig"},
    ).json()

    resp = client.post(
        f"/video-templates/{created['template_id']}/duplicate",
        json={"source_prompt": "orig"},
    )
    assert resp.status_code == 201


def test_list_video_templates_merge(client: TestClient) -> None:
    """验证 pipeline_tasks.list_video_templates() 合并内置 + 自定义。"""
    client.post(
        "/video-templates",
        json={"name": "直播切片", "prompt": "直播切片专用 prompt"},
    )

    from backend.app.services.pipeline_tasks import list_video_templates

    merged = list_video_templates()
    assert "教程" in merged
    assert "直播切片" in merged
    assert merged["教程"] != merged["直播切片"]


def test_edit_to_builtin_name_rejected(client: TestClient) -> None:
    """自定义模板改名成内置名应被 409 拒绝。"""
    created = client.post(
        "/video-templates",
        json={"name": "学术讲座", "prompt": "p"},
    ).json()

    resp = client.put(
        f"/video-templates/{created['template_id']}",
        json={"name": "教程", "prompt": "p"},
    )
    assert resp.status_code == 409


def test_edit_to_other_custom_name_rejected(client: TestClient) -> None:
    """自定义模板改名成另一个自定义模板名应被 409 拒绝。"""
    client.post("/video-templates", json={"name": "A", "prompt": "pa"})
    created_b = client.post("/video-templates", json={"name": "B", "prompt": "pb"}).json()

    resp = client.put(
        f"/video-templates/{created_b['template_id']}",
        json={"name": "A", "prompt": "pb"},
    )
    assert resp.status_code == 409


def test_edit_keep_own_name_succeeds(client: TestClient) -> None:
    """允许保持自己的原名不变。"""
    created = client.post(
        "/video-templates",
        json={"name": "学术讲座", "prompt": "p1"},
    ).json()

    resp = client.put(
        f"/video-templates/{created['template_id']}",
        json={"name": "学术讲座", "prompt": "p2"},
    )
    assert resp.status_code == 200
    assert resp.json()["prompt"] == "p2"


@pytest.mark.parametrize(
    "payload",
    [
        {"name": "   ", "prompt": "p2"},
        {"name": "学术讲座", "prompt": "   "},
    ],
)
def test_edit_rejects_blank_after_strip(
    client: TestClient,
    payload: dict[str, str],
) -> None:
    created = client.post(
        "/video-templates",
        json={"name": "学术讲座", "prompt": "p1"},
    ).json()

    resp = client.put(f"/video-templates/{created['template_id']}", json=payload)
    assert resp.status_code == 422


def test_duplicate_missing_template_returns_404(client: TestClient) -> None:
    """复制不存在的自定义模板 ID 应返回 404。"""
    resp = client.post(
        "/video-templates/missing-id/duplicate",
        json={"source_prompt": "xxx"},
    )
    assert resp.status_code == 404


def test_duplicate_rejects_blank_prompt_after_strip(client: TestClient) -> None:
    resp = client.post(
        "/video-templates/builtin-教程/duplicate",
        json={"source_prompt": "   "},
    )
    assert resp.status_code == 422


def test_text_custom_template_not_in_list_video_templates(
    tmp_path: Path, monkeypatch: MonkeyPatch,
) -> None:
    """list_video_templates() 只返回 video category，text 自定义模板不应混入。"""
    store_dir = tmp_path / ".local"
    store_file = store_dir / "video_templates.json"
    monkeypatch.setattr(template_store_module, "STORE_DIR", store_dir)
    monkeypatch.setattr(template_store_module, "STORE_PATH", store_file)

    app = FastAPI()
    app.include_router(templates_router)
    app.include_router(templates_legacy_router)
    c = TestClient(app)

    # 创建一个 text 自定义模板
    c.post("/templates", json={"name": "文字摘要", "prompt": "summarize", "category": "text"})
    # 创建一个 video 自定义模板
    c.post("/templates", json={"name": "视频讲解", "prompt": "explain", "category": "video"})

    from backend.app.services.pipeline_tasks import list_video_templates

    result = list_video_templates()
    assert "视频讲解" in result, "video custom template should be included"
    assert "文字摘要" not in result, "text custom template must NOT leak into video list"
