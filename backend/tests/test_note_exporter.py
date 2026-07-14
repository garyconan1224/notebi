"""NoteShell 导出内容的可见标题与类型测试。"""

from __future__ import annotations

import asyncio
import io
import zipfile

from backend.app.models.workspace import WorkspaceItem
from backend.app.services.note_exporter import build_note_export_response


async def _read_stream(response) -> bytes:
    return b"".join([chunk async for chunk in response.body_iterator])


def test_raw_markdown_export_has_visible_title_and_type() -> None:
    item = WorkspaceItem.from_dict({
        "item_id": "item-1",
        "type": "audio",
        "source": "local",
        "source_value": "/tmp/interview.m4a",
        "name": "客户访谈录音",
        "status": "done",
        "results": {},
    })

    response = build_note_export_response(
        workspace_id="ws-1",
        item_id="item-1",
        item=item,
        note_md="---\ntype: audio\n---\n\n## 正文\n\n内容。",
        format="markdown",
    )

    markdown = asyncio.run(_read_stream(response)).decode("utf-8")
    assert markdown.startswith("# 客户访谈录音\n\n> 类型：音频\n")
    assert "## 正文" in markdown


def test_obsidian_export_has_title_and_type_in_frontmatter_and_body() -> None:
    item = WorkspaceItem.from_dict({
        "item_id": "item-1",
        "type": "audio",
        "source": "local",
        "source_value": "/tmp/interview.m4a",
        "name": "客户访谈录音",
        "status": "done",
        "results": {},
    })

    response = build_note_export_response(
        workspace_id="ws-1",
        item_id="item-1",
        item=item,
        note_md="## 正文\n\n内容。",
        format="obsidian",
    )

    archive = asyncio.run(_read_stream(response))
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        markdown = bundle.read("客户访谈录音.md").decode("utf-8")

    assert "title: 客户访谈录音" in markdown
    assert "type: audio" in markdown
    assert "# 客户访谈录音\n\n> 类型：音频" in markdown
