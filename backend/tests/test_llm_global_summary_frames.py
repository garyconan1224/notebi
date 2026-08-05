"""llm_global_summary 带帧配图单测：mock LLM 输出占位符 → 替换为 /static/ URL。"""

from __future__ import annotations

from unittest.mock import patch

from backend.app.services.av_synthesis.llm import llm_global_summary
from shared.config import DATA_DIR


def _frame(tmp_path, name: str, sec: float, desc: str) -> dict:
    path = tmp_path / name
    path.write_bytes(b"x")
    return {"sec": sec, "frame_image_path": str(path), "desc": desc}


def test_frames_mode_injects_rule_and_resolves_placeholder(tmp_path):
    frames = [_frame(tmp_path, "f1.jpg", 12.0, "界面截图"), _frame(tmp_path, "f2.jpg", 40.0, "代码示例")]
    captured: dict = {}

    def fake_llm(prompt: str, api_key: str, **kwargs):
        captured["prompt"] = prompt
        return "这里介绍第一个工具。\n![配图](*FRAME-[00:12])\n\n然后是第二个要点。"

    with (
        patch("backend.app.services.av_synthesis.llm._call_llm", side_effect=fake_llm),
        patch("backend.app.services.frame_placeholder._to_static_url", return_value="/static/xx.jpg"),
    ):
        result = llm_global_summary("转写文本", "k", frames=frames)

    assert "*FRAME-" in captured["prompt"]  # 配图规则注入
    assert "关键帧清单" in captured["prompt"]
    assert "/static/" in result  # 占位符已替换为静态 URL
    assert "*FRAME-" not in result


def test_no_frames_keeps_plain_text(tmp_path):
    captured: dict = {}

    def fake_llm(prompt: str, api_key: str, **kwargs):
        captured["prompt"] = prompt
        return "纯文字摘要"

    with patch("backend.app.services.av_synthesis.llm._call_llm", side_effect=fake_llm):
        result = llm_global_summary("转写文本", "k")

    assert "*FRAME-" not in captured["prompt"]
    assert result == "纯文字摘要"
