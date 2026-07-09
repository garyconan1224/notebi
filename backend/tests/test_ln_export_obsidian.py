"""GET /workspaces/{id}/ln/export?format=obsidian — Obsidian zip 导出测试。"""

from __future__ import annotations

import io
import pathlib
import zipfile

import pytest
from fastapi.testclient import TestClient

from backend.app.models.workspace import WorkspaceItem, WorkspaceRecord
from backend.app.services.workspace_store import WorkspaceStore


def _make_test_store(tmp_dir: str) -> WorkspaceStore:
    """创建含一个 workspace + video item 的临时 store。"""
    store = WorkspaceStore(root=pathlib.Path(tmp_dir))
    item = WorkspaceItem.from_dict({
        "item_id": "item-1",
        "type": "video",
        "source": "local",
        "source_value": "/tmp/test.mp4",
        "name": "测试视频标题",
        "status": "done",
        "results": {},
        "related_task_ids": [],
    })
    rec = WorkspaceRecord(workspace_id="ws-1", name="测试工作空间")
    rec.items.append(item)
    store.create(rec)
    return store


@pytest.fixture()
def _setup_with_images(monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path):
    """ln.md 含图片引用 + 实际截图文件。"""
    import backend.app.routes.export as export_module

    store = _make_test_store(str(tmp_path))
    monkeypatch.setattr(export_module, "_store", store)

    ws_root = tmp_path / "ws-1"
    ws_root.mkdir(parents=True, exist_ok=True)

    # 创建 ln.md，含图片引用
    md_content = """# 学习笔记

## 第一章

这是一段笔记内容。

![截图@12](/static/workspaces/ws-1/ln-screenshots/shot-000012-143025.png)

## 第二章

更多内容。

![截图@30](/static/workspaces/ws-1/ln-screenshots/shot-000030-143045.png)
"""
    (ws_root / "ln.md").write_text(md_content, encoding="utf-8")

    # 创建截图目录和文件
    screenshots_dir = ws_root / "ln-screenshots"
    screenshots_dir.mkdir(parents=True, exist_ok=True)
    (screenshots_dir / "shot-000012-143025.png").write_bytes(b"fake png content 1")
    (screenshots_dir / "shot-000030-143045.png").write_bytes(b"fake png content 2")

    monkeypatch.setattr(export_module, "get_workspace_root", lambda _ws_id: ws_root)


@pytest.fixture()
def _setup_no_images(monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path):
    """ln.md 无图片引用。"""
    import backend.app.routes.export as export_module

    store = _make_test_store(str(tmp_path))
    monkeypatch.setattr(export_module, "_store", store)

    ws_root = tmp_path / "ws-1"
    ws_root.mkdir(parents=True, exist_ok=True)

    md_content = """# 学习笔记

纯文本内容，没有图片。
"""
    (ws_root / "ln.md").write_text(md_content, encoding="utf-8")

    monkeypatch.setattr(export_module, "get_workspace_root", lambda _ws_id: ws_root)


@pytest.fixture()
def _setup_fallback_summary(monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path):
    """无 ln.md，降级到 item.results.summary。"""
    import backend.app.routes.export as export_module

    store = _make_test_store(str(tmp_path))
    item = store.get("ws-1").items[0]
    item.results["summary"] = "### 视频总结\n\n![截图](/static/workspaces/ws-1/ln-screenshots/shot-000005-120000.png)"
    monkeypatch.setattr(export_module, "_store", store)

    ws_root = tmp_path / "ws-1"
    ws_root.mkdir(parents=True, exist_ok=True)

    # 创建截图文件
    screenshots_dir = ws_root / "ln-screenshots"
    screenshots_dir.mkdir(parents=True, exist_ok=True)
    (screenshots_dir / "shot-000005-120000.png").write_bytes(b"fallback png")

    monkeypatch.setattr(export_module, "get_workspace_root", lambda _ws_id: ws_root)


from backend.app.main import app  # noqa: E402

client = TestClient(app)


class TestLnExportObsidian:
    def test_export_with_images(self, _setup_with_images):
        """导出含图片的 Obsidian zip：图片语法改写 + frontmatter + attachments。"""
        resp = client.get("/workspaces/ws-1/ln/export?format=obsidian")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/zip"

        # 解析 zip
        buf = io.BytesIO(resp.content)
        with zipfile.ZipFile(buf, "r") as zf:
            names = zf.namelist()

            # 应包含 {标题}.md（H1 标题优先）和 attachments/*.png
            assert "学习笔记.md" in names
            assert "attachments/shot-000012-143025.png" in names
            assert "attachments/shot-000030-143045.png" in names

            # 验证 md 内容
            md_content = zf.read("学习笔记.md").decode("utf-8")

            # 应包含 frontmatter
            assert "---" in md_content
            assert "title: 学习笔记" in md_content
            assert "tags: [学习笔记, nibi]" in md_content

            # 图片语法应已改写
            assert "![[attachments/shot-000012-143025.png]]" in md_content
            assert "![[attachments/shot-000030-143045.png]]" in md_content
            # 原始语法不应存在
            assert "/static/workspaces/" not in md_content

    def test_export_no_images(self, _setup_no_images):
        """导出无图片的 Obsidian zip：只有 md，无 attachments 目录。"""
        resp = client.get("/workspaces/ws-1/ln/export?format=obsidian")
        assert resp.status_code == 200

        buf = io.BytesIO(resp.content)
        with zipfile.ZipFile(buf, "r") as zf:
            names = zf.namelist()

            assert "学习笔记.md" in names
            # 不应有 attachments
            assert not any(n.startswith("attachments/") for n in names)

            md_content = zf.read("学习笔记.md").decode("utf-8")
            assert "title: 学习笔记" in md_content
            assert "纯文本内容" in md_content

    def test_export_fallback_summary(self, _setup_fallback_summary):
        """无 ln.md 时降级到 summary，图片语法同样改写。"""
        resp = client.get("/workspaces/ws-1/ln/export?format=obsidian")
        assert resp.status_code == 200

        buf = io.BytesIO(resp.content)
        with zipfile.ZipFile(buf, "r") as zf:
            names = zf.namelist()

            assert "测试视频标题.md" in names
            assert "attachments/shot-000005-120000.png" in names

            md_content = zf.read("测试视频标题.md").decode("utf-8")
            assert "![[attachments/shot-000005-120000.png]]" in md_content
            assert "视频总结" in md_content

    def test_404_when_no_notes(self, tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch):
        """既无 ln.md 也无 summary 时返回 404。"""
        import backend.app.routes.export as export_module

        store = _make_test_store(str(tmp_path))
        monkeypatch.setattr(export_module, "_store", store)

        ws_root = tmp_path / "ws-1"
        ws_root.mkdir(parents=True, exist_ok=True)
        monkeypatch.setattr(export_module, "get_workspace_root", lambda _ws_id: ws_root)

        resp = client.get("/workspaces/ws-1/ln/export?format=obsidian")
        assert resp.status_code == 404
        assert "学习笔记尚未生成" in resp.json()["detail"]

    def test_404_for_nonexistent_workspace(self, tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch):
        """workspace 不存在时返回 404。"""
        import backend.app.routes.export as export_module

        store = WorkspaceStore(root=tmp_path)
        monkeypatch.setattr(export_module, "_store", store)

        resp = client.get("/workspaces/no-such-ws/ln/export?format=obsidian")
        assert resp.status_code == 404

    def test_400_for_unsupported_format(self, _setup_no_images):
        """不支持的格式返回 400。"""
        resp = client.get("/workspaces/ws-1/ln/export?format=pdf")
        assert resp.status_code == 400
        assert "不支持的格式" in resp.json()["detail"]

    def test_path_traversal_skipped(self, monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path):
        """恶意 ../ 路径穿越的图片引用应被跳过，不写入 zip。"""
        import backend.app.routes.export as export_module

        store = _make_test_store(str(tmp_path))
        monkeypatch.setattr(export_module, "_store", store)

        ws_root = tmp_path / "ws-1"
        ws_root.mkdir(parents=True, exist_ok=True)
        md_content = """# 安全测试

![恶意](/static/workspaces/ws-1/ln-screenshots/../../etc/passwd.png)
![正常](/static/workspaces/ws-1/ln-screenshots/ok.png)
"""
        (ws_root / "ln.md").write_text(md_content, encoding="utf-8")
        screenshots_dir = ws_root / "ln-screenshots"
        screenshots_dir.mkdir(parents=True, exist_ok=True)
        (screenshots_dir / "ok.png").write_bytes(b"ok")
        (screenshots_dir / ".." / ".." / "etc" / "passwd.png").parent.mkdir(parents=True, exist_ok=True)

        monkeypatch.setattr(export_module, "get_workspace_root", lambda _ws_id: ws_root)

        resp = client.get("/workspaces/ws-1/ln/export?format=obsidian")
        assert resp.status_code == 200

        buf = io.BytesIO(resp.content)
        with zipfile.ZipFile(buf, "r") as zf:
            names = zf.namelist()
            # 恶意路径不应出现
            assert not any(".." in n for n in names)
            # 正常图片应存在
            assert "attachments/ok.png" in names
            md_in_zip = zf.read("安全测试.md").decode("utf-8")
            assert "![[attachments/ok.png]]" in md_in_zip
            # 恶意引用：路径穿越被检测后原样保留（未改写为 Obsidian 语法）
            assert "![[attachments/../../etc/passwd.png]]" not in md_in_zip

    def test_frontmatter_source_is_workspace_id(self, monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path):
        """frontmatter source 应为 source_value（URL）而非 video_item.name。"""
        import backend.app.routes.export as export_module

        store = _make_test_store(str(tmp_path))
        # 设置 source_value 为 URL
        item = store.get("ws-1").items[0]
        item.source_value = "https://bilibili.com/video/BV123"
        monkeypatch.setattr(export_module, "_store", store)

        ws_root = tmp_path / "ws-1"
        ws_root.mkdir(parents=True, exist_ok=True)
        (ws_root / "ln.md").write_text("# 测试\n\n内容", encoding="utf-8")
        monkeypatch.setattr(export_module, "get_workspace_root", lambda _ws_id: ws_root)

        resp = client.get("/workspaces/ws-1/ln/export?format=obsidian")
        assert resp.status_code == 200

        buf = io.BytesIO(resp.content)
        with zipfile.ZipFile(buf, "r") as zf:
            md_content = zf.read("测试.md").decode("utf-8")
            assert "source: https://bilibili.com/video/BV123" in md_content
            # 不应是 video_item.name
            assert "source: 测试视频标题" not in md_content

    def test_zip_md_filename_uses_h1_title(self, monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path):
        """zip 内 md 文件名应取自 H1 标题，而非 video_item.name。"""
        import backend.app.routes.export as export_module

        store = _make_test_store(str(tmp_path))
        monkeypatch.setattr(export_module, "_store", store)

        ws_root = tmp_path / "ws-1"
        ws_root.mkdir(parents=True, exist_ok=True)
        (ws_root / "ln.md").write_text("# 我的自定义笔记标题\n\n内容", encoding="utf-8")
        monkeypatch.setattr(export_module, "get_workspace_root", lambda _ws_id: ws_root)

        resp = client.get("/workspaces/ws-1/ln/export?format=obsidian")
        assert resp.status_code == 200

        buf = io.BytesIO(resp.content)
        with zipfile.ZipFile(buf, "r") as zf:
            names = zf.namelist()
            # 文件名应是 H1 标题
            assert "我的自定义笔记标题.md" in names
            # 不应是 video_item.name
            assert "测试视频标题.md" not in names

    def test_title_slash_sanitized(self, monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path):
        """H1 标题含 / 时，zip 内文件名应被清洗。"""
        import backend.app.routes.export as export_module

        store = _make_test_store(str(tmp_path))
        monkeypatch.setattr(export_module, "_store", store)

        ws_root = tmp_path / "ws-1"
        ws_root.mkdir(parents=True, exist_ok=True)
        (ws_root / "ln.md").write_text("# 笔记/2026年\n\n内容", encoding="utf-8")
        monkeypatch.setattr(export_module, "get_workspace_root", lambda _ws_id: ws_root)

        resp = client.get("/workspaces/ws-1/ln/export?format=obsidian")
        assert resp.status_code == 200

        buf = io.BytesIO(resp.content)
        with zipfile.ZipFile(buf, "r") as zf:
            names = zf.namelist()
            # / 应被替换为 _
            assert "笔记_2026年.md" in names
            # 不应有裸 / 在文件名中（zip entry 的目录分隔符除外）
            assert "笔记/2026年.md" not in names
