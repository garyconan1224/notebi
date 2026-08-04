from __future__ import annotations

from backend.app.models.workspace import WorkspaceItem
from backend.app.services import note_exporter


def _item() -> WorkspaceItem:
    return WorkspaceItem(
        item_id="item-1",
        type="text",
        source="local",
        source_value="/tmp/source.txt",
        name="测试笔记",
    )


def test_html_export_uses_summary_font_setting(monkeypatch) -> None:
    monkeypatch.setattr(
        note_exporter.appearance_store,
        "load_settings",
        lambda: {
            "fonts": {"ui": None, "cap": None, "sum": "Noto Serif SC"},
            "uploaded_fonts": [],
        },
    )

    html = note_exporter._render_note_html(
        title="测试笔记",
        item=_item(),
        body="# 测试笔记\n\n正文",
    )

    assert 'font-family: "Noto Serif SC", -apple-system' in html


def test_html_export_embeds_selected_uploaded_summary_font(monkeypatch) -> None:
    monkeypatch.setattr(
        note_exporter.appearance_store,
        "load_settings",
        lambda: {
            "fonts": {"ui": None, "cap": None, "sum": "user-abc123"},
            "uploaded_fonts": [
                {
                    "id": "abc123",
                    "family": "user-abc123",
                    "url": "/static/fonts/abc123/abc123.woff2",
                }
            ],
        },
    )
    monkeypatch.setattr(
        note_exporter,
        "_asset_to_data_uri",
        lambda _src: "data:font/woff2;base64,Zm9udA==",
    )

    html = note_exporter._render_note_html(
        title="测试笔记",
        item=_item(),
        body="# 测试笔记\n\n正文",
    )

    assert '@font-face { font-family: "user-abc123";' in html
    assert "data:font/woff2;base64,Zm9udA==" in html
