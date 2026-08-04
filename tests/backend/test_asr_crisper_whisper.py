"""Q8（D8）：CrisperWhisper 2.0 适配器——阶段 A 假模型测试。

覆盖：
- 无依赖时返回「未安装」能力状态（不静默、不加载）；
- 逐词时间戳聚合为 NoteBi segment 契约，保留 word-level start/end；
- verbatim/intended 模式与语言/引擎元数据保留；
- 中文无空格拼接、英文空格拼接、句读切分；
- 未安装时转写抛出带指引的错误，不降级。
"""

from __future__ import annotations

from backend.app.services import asr_crisper_whisper as cw


def test_capability_not_installed(monkeypatch) -> None:
    monkeypatch.setattr(cw, "_module_available", lambda name: False)
    cap = cw.get_crisper_whisper_capability()
    assert cap["engine"] == "crisper-whisper"
    assert cap["installed"] is False
    assert cap["status"] == "not_installed"
    assert cap["diarization"] is False
    assert "pip install" in cap["install_hint"]
    assert "non-commercial" in cap["license"]


def test_capability_available_when_deps_present(monkeypatch) -> None:
    monkeypatch.setattr(cw, "_module_available", lambda name: True)
    cap = cw.get_crisper_whisper_capability()
    assert cap["installed"] is True
    assert cap["status"] == "available"
    assert cap["word_timestamps"] is True
    assert cap["modes"] == ["verbatim", "intended"]


def test_capability_not_usable_without_transformers_backend(monkeypatch) -> None:
    # 装了 crisperwhisper 但没有 transformers 后端（macOS 不信任 ct2）
    monkeypatch.setattr(
        cw, "_module_available", lambda name: name == "crisperwhisper"
    )
    cap = cw.get_crisper_whisper_capability()
    assert cap["installed"] is True
    assert cap["status"] == "not_installed"


def test_group_words_preserves_word_timestamps_and_metadata() -> None:
    words = [
        {"word": "今天", "start": 0.0, "end": 0.4},
        {"word": "天气", "start": 0.4, "end": 0.8},
        {"word": "很好。", "start": 0.8, "end": 1.2},
        {"word": "我们", "start": 1.5, "end": 1.9},
        {"word": "去公园。", "start": 1.9, "end": 2.5},
    ]
    segments = cw._group_words_to_segments(words, language="zh", mode="verbatim")

    assert len(segments) == 2
    seg1, seg2 = segments
    # 中文无空格拼接 + 句读切分
    assert seg1["text"] == "今天天气很好。"
    assert seg1["start"] == 0.0 and seg1["end"] == 1.2
    assert seg2["text"] == "我们去公园。"
    assert seg2["start"] == 1.5 and seg2["end"] == 2.5

    # 逐词 start/end 保留
    assert seg1["words"][0] == {"word": "今天", "start": 0.0, "end": 0.4}
    assert seg1["words"][-1]["end"] == 1.2
    # 元数据保留
    assert seg1["mode"] == "verbatim"
    assert seg1["language"] == "zh"
    assert seg1["engine"] == "crisper-whisper"


def test_group_words_english_joins_with_spaces() -> None:
    words = [
        {"word": "Hello", "start": 0.0, "end": 0.3},
        {"word": "world.", "start": 0.3, "end": 0.7},
    ]
    segments = cw._group_words_to_segments(words, language="en", mode="intended")
    assert len(segments) == 1
    assert segments[0]["text"] == "Hello world."
    assert segments[0]["mode"] == "intended"


def test_group_words_accepts_object_words_and_skips_empty() -> None:
    class W:
        def __init__(self, word, start, end):
            self.word = word
            self.start = start
            self.end = end

    words = [W("你好", 0.0, 0.5), W("  ", 0.5, 0.6), W("世界", 0.6, 1.0)]
    segments = cw._group_words_to_segments(words, language="zh", mode="verbatim")
    assert len(segments) == 1
    assert segments[0]["text"] == "你好世界"
    # 空词被跳过，只保留 2 个词
    assert len(segments[0]["words"]) == 2


def test_transcribe_raises_when_not_installed(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(cw, "_module_available", lambda name: False)
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"RIFF-fake")
    try:
        cw.transcribe_file_with_crisper_whisper(audio)
        assert False, "未安装时应抛出错误"
    except RuntimeError as err:
        assert "未安装" in str(err)


def test_transcribe_with_fake_model_maps_to_contract(monkeypatch, tmp_path) -> None:
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"RIFF-fake")

    class FakeResult:
        text = "今天天气很好。"
        language = "zh"
        mode = "verbatim"
        duration = 1.2
        processing_time = 0.1
        words = [
            {"word": "今天", "start": 0.0, "end": 0.4},
            {"word": "天气", "start": 0.4, "end": 0.8},
            {"word": "很好。", "start": 0.8, "end": 1.2},
        ]

    class FakeModel:
        def transcribe(self, path, language=None, mode="verbatim", word_timestamps=True):
            assert word_timestamps is True
            return FakeResult()

    text, segments, duration = cw.transcribe_file_with_crisper_whisper(
        audio, language="zh", mode="verbatim", _model=FakeModel()
    )
    assert text == "今天天气很好。"
    assert duration == 1.2
    assert segments[0]["start"] == 0.0
    assert segments[0]["end"] == 1.2
    assert segments[0]["engine"] == "crisper-whisper"
    assert segments[0]["mode"] == "verbatim"
    assert len(segments[0]["words"]) == 3


def test_transcribe_rejects_unknown_mode(tmp_path) -> None:
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"RIFF-fake")
    try:
        cw.transcribe_file_with_crisper_whisper(audio, mode="bogus")
        assert False, "未知模式应报错"
    except ValueError:
        pass
