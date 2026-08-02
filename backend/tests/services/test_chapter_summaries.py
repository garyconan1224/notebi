"""Model chapter summaries keep timestamps tied to real transcript evidence."""

from __future__ import annotations

from backend.app.services import chapter_summaries


def test_model_chapters_are_sorted_and_timestamped_to_real_segments(monkeypatch) -> None:
    monkeypatch.setattr(
        chapter_summaries,
        "_call_llm",
        lambda *_args, **_kwargs: (
            '[{"start": 13, "end": 52, "title": "安装要点", '
            '"summary": "讲解安装步骤及常见错误。", "keywords": ["安装", "错误"]}]',
            "provider/model",
        ),
    )

    chapters, model_used = chapter_summaries.generate_chapter_summaries([
        {"t_sec": 10, "t_str": "00:10", "text": "先准备安装所需的环境。"},
        {"t_sec": 30, "t_str": "00:30", "text": "然后执行安装并检查错误。"},
        {"t_sec": 60, "t_str": "01:00", "text": "最后验证运行结果。"},
    ])

    assert model_used == "provider/model"
    assert chapters == [{
        "start": 10.0,
        "end": 60.0,
        "title": "安装要点",
        "summary": "讲解安装步骤及常见错误。",
        "keywords": ["安装", "错误"],
        "source": "llm",
    }]
