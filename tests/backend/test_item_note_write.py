"""R1.1 — PUT /{ws}/items/{item}/note 写入端点测试。

覆盖：
  PUT→GET body 一致
  frontmatter 的 tags/media 等机器字段保留
  version 递增
  user_edited=true
  note.md 不存在时可创建
"""

from __future__ import annotations

import zipfile
import yaml
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.routes import workspaces as ws_module
from backend.app.services.note_assembler import assemble_item_note, note_dir
from backend.app.services.workspace_store import WorkspaceStore


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """每个测试用独立 data 目录。"""
    fake_data = tmp_path / "workspaces"
    store = WorkspaceStore(root=fake_data)
    monkeypatch.setattr(ws_module, "_store", store)
    # note_dir 依赖 get_workspace_root，需要同步 patch
    monkeypatch.setattr(
        "backend.app.services.note_assembler.get_workspace_root",
        lambda ws_id: fake_data / ws_id,
    )
    app = FastAPI()
    app.include_router(ws_module.router)
    with TestClient(app) as c:
        yield c


def _create_ws_and_item(client: TestClient) -> tuple[str, str]:
    """创建工作空间和 text 类型素材，返回 (ws_id, item_id)。"""
    ws = client.post("/workspaces", json={"name": "note-write-test"}).json()
    ws_id = ws["workspace_id"]
    resp = client.post(
        f"/workspaces/{ws_id}/items",
        json={
            "source": "local",
            "source_value": "/tmp/test.txt",
            "type": "text",
            "name": "测试笔记",
        },
    )
    # add_item 返回完整 WorkspaceRecord，需要从 items 列表取最新 item_id
    items = resp.json()["items"]
    item_id = items[-1]["item_id"]
    return ws_id, item_id


def _create_ws_and_image_item(client: TestClient) -> tuple[str, str]:
    """创建工作空间和 image 类型素材，返回 (ws_id, item_id)。"""
    ws = client.post("/workspaces", json={"name": "note-image-test"}).json()
    ws_id = ws["workspace_id"]
    resp = client.post(
        f"/workspaces/{ws_id}/items",
        json={
            "source": "url",
            "source_value": "https://www.xiaohongshu.com/explore/test-image-note",
            "type": "image",
            "name": "图文测试",
        },
    )
    items = resp.json()["items"]
    item_id = items[-1]["item_id"]
    return ws_id, item_id


def _seed_note_md(ws_id: str, item_id: str, content: str) -> None:
    """手动写入 note.md 到磁盘。"""
    nd = note_dir(ws_id, item_id)
    nd.mkdir(parents=True, exist_ok=True)
    (nd / "note.md").write_text(content, encoding="utf-8")


def test_put_then_get_body_matches(client: TestClient):
    """PUT 写入 → GET 读回，正文一致。"""
    ws_id, item_id = _create_ws_and_item(client)

    # 先用 assemble 写出初始 note.md
    item = ws_module._find_item(ws_module._store.get(ws_id), item_id)
    item.results = {"content": "原始正文"}
    assemble_item_note(ws_id, item_id, _item=item)

    # PUT 写入新正文
    new_body = "# 新标题\n\n新的正文内容。"
    resp = client.put(
        f"/workspaces/{ws_id}/items/{item_id}/note",
        json={"body": new_body},
    )
    assert resp.status_code == 200
    put_data = resp.json()

    # GET 读回
    get_data = client.get(f"/workspaces/{ws_id}/items/{item_id}/note").json()

    # 正文一致
    put_body = put_data["note_md"].split("---\n", 2)[2].strip()
    get_body = get_data["note_md"].split("---\n", 2)[2].strip()
    assert put_body == new_body
    assert get_body == new_body


def test_frontmatter_tags_preserved(client: TestClient):
    """PUT 后 frontmatter 的 tags 等机器字段保留。"""
    ws_id, item_id = _create_ws_and_item(client)

    # 手动构造带 tags/media 的 note.md
    fm_yaml = yaml.dump(
        {
            "schema_version": 1,
            "type": "text",
            "tags": {"topic": "科技", "mood": "严肃"},
            "media": {"images": ["img.jpg"]},
            "layers": {"source": "source.md", "note": "note.md"},
            "version": 1,
        },
        allow_unicode=True,
        default_flow_style=False,
        sort_keys=False,
    )
    _seed_note_md(ws_id=ws_id, item_id=item_id,
                  content=f"---\n{fm_yaml}---\n\n旧正文")

    # PUT
    resp = client.put(
        f"/workspaces/{ws_id}/items/{item_id}/note",
        json={"body": "新正文"},
    )
    assert resp.status_code == 200
    fm = resp.json()["frontmatter"]

    # tags 保留
    assert fm["tags"]["topic"] == "科技"
    assert fm["tags"]["mood"] == "严肃"
    # media 保留
    assert fm["media"]["images"] == ["img.jpg"]
    # layers 保留
    assert fm["layers"]["source"] == "source.md"


def test_version_increments(client: TestClient):
    """每次 PUT 后 version 递增。"""
    ws_id, item_id = _create_ws_and_item(client)

    # 初始化 version=3
    fm_yaml = yaml.dump(
        {"schema_version": 1, "type": "text", "version": 3},
        allow_unicode=True, default_flow_style=False, sort_keys=False,
    )
    _seed_note_md(ws_id=ws_id, item_id=item_id,
                  content=f"---\n{fm_yaml}---\n\n正文")

    resp1 = client.put(f"/workspaces/{ws_id}/items/{item_id}/note", json={"body": "v2"})
    assert resp1.json()["frontmatter"]["version"] == 4

    resp2 = client.put(f"/workspaces/{ws_id}/items/{item_id}/note", json={"body": "v3"})
    assert resp2.json()["frontmatter"]["version"] == 5


def test_user_edited_set_true(client: TestClient):
    """PUT 后 frontmatter 包含 user_edited=true。"""
    ws_id, item_id = _create_ws_and_item(client)

    # 初始化（没有 user_edited 字段）
    fm_yaml = yaml.dump(
        {"schema_version": 1, "type": "text", "version": 1},
        allow_unicode=True, default_flow_style=False, sort_keys=False,
    )
    _seed_note_md(ws_id=ws_id, item_id=item_id,
                  content=f"---\n{fm_yaml}---\n\n旧正文")

    resp = client.put(f"/workspaces/{ws_id}/items/{item_id}/note", json={"body": "编辑后"})
    assert resp.json()["frontmatter"]["user_edited"] is True


def test_creates_note_md_when_missing(client: TestClient):
    """note.md 不存在时 PUT 可创建（先惰性组装）。"""
    ws_id, item_id = _create_ws_and_item(client)

    # 注入 results 以便 assemble 能生成 frontmatter
    item = ws_module._find_item(ws_module._store.get(ws_id), item_id)
    item.results = {"content": "自动组装正文"}

    # 确认 note.md 不存在
    nd = note_dir(ws_id, item_id)
    assert not (nd / "note.md").exists()

    # PUT → 应触发惰性组装再写入
    new_body = "用户编辑的新正文"
    resp = client.put(f"/workspaces/{ws_id}/items/{item_id}/note", json={"body": new_body})
    assert resp.status_code == 200

    fm = resp.json()["frontmatter"]
    assert fm["user_edited"] is True
    assert fm["version"] == 2  # assemble 写 v1 → PUT +1

    # 磁盘验证
    raw = (nd / "note.md").read_text(encoding="utf-8")
    assert new_body in raw

    # GET 也能读到
    get_data = client.get(f"/workspaces/{ws_id}/items/{item_id}/note").json()
    assert new_body in get_data["note_md"]


def test_get_refreshes_stale_auto_image_text_note(client: TestClient):
    """GET /note 应刷新未手改的旧图文自动稿，展示学习笔记 + 图文语境。"""
    ws_id, item_id = _create_ws_and_image_item(client)
    item = ws_module._find_item(ws_module._store.get(ws_id), item_id)
    item.results = {
        "note_kind": "image_text",
        "source_md_raw": "原始正文",
        "note_body": "# 学习笔记\n\n## 核心观点\n\n这是结合原文提炼的笔记。",
        "markdown": "![配图](/static/workspaces/ws/image/01.jpg)\n\n图片补充了使用场景。",
    }
    fm_yaml = yaml.dump(
        {
            "schema_version": 1,
            "type": "image",
            "title": "图文测试",
            "version": 1,
        },
        allow_unicode=True,
        default_flow_style=False,
        sort_keys=False,
    )
    _seed_note_md(ws_id, item_id, f"---\n{fm_yaml}---\n\n原始正文")

    resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/note")

    assert resp.status_code == 200
    note_md = resp.json()["note_md"]
    assert "学习笔记" in note_md
    assert "图文语境" in note_md
    assert "![配图](/static/workspaces/ws/image/01.jpg)" in note_md
    assert "图片补充了使用场景" in note_md


def test_get_keeps_user_edited_image_text_note(client: TestClient):
    """GET /note 不应覆盖 user_edited=true 的手改图文笔记。"""
    ws_id, item_id = _create_ws_and_image_item(client)
    item = ws_module._find_item(ws_module._store.get(ws_id), item_id)
    item.results = {
        "note_kind": "image_text",
        "note_body": "# 自动学习笔记",
        "markdown": "![自动配图](/static/auto.jpg)",
    }
    fm_yaml = yaml.dump(
        {
            "schema_version": 1,
            "type": "image",
            "title": "图文测试",
            "version": 2,
            "user_edited": True,
        },
        allow_unicode=True,
        default_flow_style=False,
        sort_keys=False,
    )
    _seed_note_md(ws_id, item_id, f"---\n{fm_yaml}---\n\n# 我的手改笔记")

    resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/note")

    assert resp.status_code == 200
    note_md = resp.json()["note_md"]
    assert "我的手改笔记" in note_md
    assert "自动配图" not in note_md


def test_export_item_note_obsidian_zip(client: TestClient):
    """GET note/export?format=obsidian 返回只包含当前 item note 的 zip。"""
    ws_id, item_id = _create_ws_and_item(client)
    _seed_note_md(
        ws_id=ws_id,
        item_id=item_id,
        content="---\nschema_version: 1\ntype: text\n---\n\n# 导出标题\n\n## 摘要\n\n正文",
    )

    resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/note/export?format=obsidian")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"

    zip_path = note_dir(ws_id, item_id) / "out.zip"
    zip_path.write_bytes(resp.content)
    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
        assert names == ["导出标题.md"]
        content = zf.read(names[0]).decode("utf-8")

    assert "title: 导出标题" in content
    assert "item_id:" in content
    assert "## 摘要" in content


def test_export_item_note_rejects_unsupported_format(client: TestClient):
    """note/export 支持 md/html/pdf/docx/long_image/pptx/obsidian；其余格式应 400。"""
    ws_id, item_id = _create_ws_and_item(client)
    resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/note/export?format=xyz")
    assert resp.status_code == 400


def test_put_note_preserves_image_results_images(client: TestClient):
    """PUT 后 media.images 仍优先使用 results["images"]（下载图集），不回退到 source_value。"""
    # 创建 image 类型素材
    ws = client.post("/workspaces", json={"name": "img-test"}).json()
    ws_id = ws["workspace_id"]
    resp = client.post(
        f"/workspaces/{ws_id}/items",
        json={
            "source": "url",
            "source_value": "https://example.com/page",
            "type": "image",
            "name": "图集笔记",
        },
    )
    items = resp.json()["items"]
    item_id = items[-1]["item_id"]

    # 模拟 note task 产出的 results（下载了 3 张图）
    item = ws_module._find_item(ws_module._store.get(ws_id), item_id)
    fake_data = ws_module._store.root
    ws_dir = fake_data / ws_id / "items" / item_id
    ws_dir.mkdir(parents=True, exist_ok=True)
    for i in range(1, 4):
        (ws_dir / f"img_{i}.jpg").write_bytes(b"\xff\xd8\x00")
    item.results = {
        "images": [
            str(ws_dir / "img_1.jpg"),
            str(ws_dir / "img_2.jpg"),
            str(ws_dir / "img_3.jpg"),
        ],
        "image_infos": [
            {"idx": 1, "description": "猫", "ocr_text": "", "static_url": "", "description_parts": {"subject": "猫"}},
            {"idx": 2, "description": "狗", "ocr_text": "", "static_url": "", "description_parts": {"subject": "狗"}},
            {"idx": 3, "description": "鸟", "ocr_text": "", "static_url": "", "description_parts": {"subject": "鸟"}},
        ],
        "content": "图文正文",
    }
    assemble_item_note(ws_id, item_id, _item=item)

    # PUT 保存（模拟用户编辑）
    resp = client.put(
        f"/workspaces/{ws_id}/items/{item_id}/note",
        json={"body": "# 编辑后\n\n修改了正文"},
    )
    assert resp.status_code == 200
    put_data = resp.json()

    # 关键断言：PUT 响应的 media.images 应为 3 张（来自 results），不是 1 个 source_value
    assert len(put_data["media"]["images"]) == 3
    assert put_data["media"]["image_infos"] is not None
    assert len(put_data["media"]["image_infos"]) == 3
    assert put_data["media"]["image_infos"][0]["description_parts"]["subject"] == "猫"
