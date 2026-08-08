from __future__ import annotations

"""转录编辑同步测试：原文编辑后译文增量跟随 + 译文编辑端点。

覆盖字幕编辑批次的两条产品规则：
  1. 原文保存后，对每个已缓存语言增量重译该段（mock LLM）；LLM 失败时清空该段译文；
  2. PATCH .../segments/{idx}/translation 可改单段译文；无缓存/越界返回 400。
"""

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.routes import workspaces as ws_module
from backend.app.services.workspace_store import WorkspaceStore


@pytest.fixture()
def client(tmp_path: Path):
    isolated_store = WorkspaceStore(root=tmp_path / "workspaces")
    app = FastAPI()
    with (
        patch.object(ws_module, "_store", isolated_store),
        patch(
            "backend.app.services.note_assembler.get_workspace_root",
            lambda wid: tmp_path / "wsroot" / wid,
        ),
    ):
        app.include_router(ws_module.router)
        with TestClient(app) as c:
            yield c


def _seed(client: TestClient, with_translation: bool = True):
    workspace_id = client.post("/workspaces", json={"name": "转录编辑"}).json()["workspace_id"]
    item_id = client.post(
        f"/workspaces/{workspace_id}/items",
        json={"type": "video", "source": "url", "source_value": "https://example.com/v.mp4"},
    ).json()["items"][0]["item_id"]
    results = {
        "transcript_segments": [
            {"start": 0, "text": "hello world"},
            {"start": 5, "text": "second line"},
        ],
    }
    if with_translation:
        results["translations"] = {
            "zh": [{"idx": 0, "text": "你好世界"}, {"idx": 1, "text": "第二行"}],
        }
    ws_module._store.update_item(workspace_id, item_id, results=results)
    return workspace_id, item_id


def _zh_segments(workspace_id: str, item_id: str):
    item = ws_module._find_item(ws_module._store.get(workspace_id), item_id)
    return item.results["translations"]["zh"]


def test_edit_source_retranslates_cached_languages(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    workspace_id, item_id = _seed(client)
    calls: list[tuple[list[str], str]] = []

    def fake_batch(texts: list[str], target_lang: str):
        calls.append((list(texts), target_lang))
        return [{"idx": 0, "text": "你好，改过的世界"}]

    monkeypatch.setattr(ws_module, "_translate_segments_batch", fake_batch)

    resp = client.patch(
        f"/workspaces/{workspace_id}/items/{item_id}/transcript/segments/0",
        json={"edited_text": "hello again"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["edited_text"] == "hello again"
    assert body["updated_translations"] == {"zh": "你好，改过的世界"}
    assert calls == [(["hello again"], "zh")]

    zh = _zh_segments(workspace_id, item_id)
    assert zh[0]["text"] == "你好，改过的世界"
    assert zh[1]["text"] == "第二行"


def test_edit_source_retranslate_failure_clears_segment(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    workspace_id, item_id = _seed(client)

    def boom(texts: list[str], target_lang: str):
        raise RuntimeError("llm unavailable")

    monkeypatch.setattr(ws_module, "_translate_segments_batch", boom)

    resp = client.patch(
        f"/workspaces/{workspace_id}/items/{item_id}/transcript/segments/0",
        json={"edited_text": "hello again"},
    )

    assert resp.status_code == 200
    assert resp.json()["updated_translations"] == {"zh": ""}
    zh = _zh_segments(workspace_id, item_id)
    assert zh[0]["text"] == ""
    assert zh[1]["text"] == "第二行"


def test_edit_source_without_translation_cache_skips_retranslate(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    workspace_id, item_id = _seed(client, with_translation=False)
    calls: list[str] = []

    def fake_batch(texts: list[str], target_lang: str):
        calls.append(target_lang)
        return [{"idx": 0, "text": "不应被调用"}]

    monkeypatch.setattr(ws_module, "_translate_segments_batch", fake_batch)

    resp = client.patch(
        f"/workspaces/{workspace_id}/items/{item_id}/transcript/segments/0",
        json={"edited_text": "hello again"},
    )

    assert resp.status_code == 200
    assert resp.json()["updated_translations"] == {}
    assert calls == []


def test_edit_translation_updates_cache(client: TestClient) -> None:
    workspace_id, item_id = _seed(client)

    resp = client.patch(
        f"/workspaces/{workspace_id}/items/{item_id}/transcript/segments/1/translation",
        json={"target_lang": "zh", "edited_text": "行二号"},
    )

    assert resp.status_code == 200
    assert resp.json()["edited_text"] == "行二号"
    zh = _zh_segments(workspace_id, item_id)
    assert zh[0]["text"] == "你好世界"
    assert zh[1]["text"] == "行二号"

    # 空字符串 = 清空该段译文
    resp = client.patch(
        f"/workspaces/{workspace_id}/items/{item_id}/transcript/segments/1/translation",
        json={"target_lang": "zh", "edited_text": ""},
    )
    assert resp.status_code == 200
    zh = _zh_segments(workspace_id, item_id)
    assert zh[1]["text"] == ""


def test_edit_translation_without_cache_or_bad_idx_returns_400(client: TestClient) -> None:
    no_cache_ws, no_cache_item = _seed(client, with_translation=False)
    resp = client.patch(
        f"/workspaces/{no_cache_ws}/items/{no_cache_item}/transcript/segments/0/translation",
        json={"target_lang": "zh", "edited_text": "x"},
    )
    assert resp.status_code == 400

    ws, item = _seed(client)
    resp = client.patch(
        f"/workspaces/{ws}/items/{item}/transcript/segments/9/translation",
        json={"target_lang": "zh", "edited_text": "x"},
    )
    assert resp.status_code == 400
