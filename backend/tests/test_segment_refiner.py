"""shared/segment_refiner.py 的单元测试。

切分规则：≤16 字保留、>16 字按标点/字数切、时间零漂移。
"""
import pytest
from shared.segment_refiner import refine_segments, _char_len, _split_text, _allocate_time


# ── _char_len ─────────────────────────────────────────────────

class TestCharLen:
    def test_chinese_chars(self):
        assert _char_len("你好世界") == 4

    def test_english_word_counts_as_one(self):
        assert _char_len("hello") == 1
        assert _char_len("hello world") == 2

    def test_mixed(self):
        # "你好 hello 世界" → 你好(2) + hello(1) + 世界(2) = 5
        assert _char_len("你好 hello 世界") == 5

    def test_empty(self):
        assert _char_len("") == 0

    def test_numbers_as_word(self):
        assert _char_len("12345") == 1  # 连续数字 = 1 个 token

    def test_punctuation_attached(self):
        # "你好，" → 你(1) 好(1) ，(1) = 3（标点算 1 字）
        assert _char_len("你好，") == 3


# ── _split_text ───────────────────────────────────────────────

class TestSplitText:
    def test_short_text_no_split(self):
        assert _split_text("短文本", 16, 4) == ["短文本"]

    def test_sentence_end_priority(self):
        # 20 字 > 16，应在句号处切
        result = _split_text("今天天气非常非常好。我们一起出去玩吧朋友。", 16, 4)
        assert len(result) >= 2
        assert "今天天气非常非常好。" in result[0]

    def test_comma_split(self):
        text = "这是一段比较长的文字，中间有逗号分隔，需要在逗号处断开"
        result = _split_text(text, 16, 4)
        for piece in result:
            assert _char_len(piece) <= 16

    def test_hard_split_no_punctuation(self):
        text = "这是一段完全没有标点符号的很长文字需要按字数硬切分成多段"
        result = _split_text(text, 16, 4)
        assert len(result) >= 2
        for piece in result:
            assert _char_len(piece) <= 16

    def test_fragment_merge(self):
        # 切完后产生 1 字碎片 → 合并进前段
        text = "一二三四五六七八九十一二三。你"
        result = _split_text(text, 16, 4)
        for piece in result:
            assert _char_len(piece) >= 4 or len(result) == 1

    def test_english_split(self):
        text = "this is a very long english sentence with many words that should be split"
        result = _split_text(text, 8, 2)
        for piece in result:
            assert _char_len(piece) <= 8

    def test_empty_text(self):
        assert _split_text("", 16, 4) == []


# ── _allocate_time ────────────────────────────────────────────

class TestAllocateTime:
    def test_single_piece(self):
        result = _allocate_time(["你好"], 0.0, 3.0)
        assert len(result) == 1
        assert result[0]["start"] == 0.0
        assert result[0]["end"] == 3.0

    def test_zero_drift(self):
        """核心：首段 start == 原 start，末段 end == 原 end，相邻无缝。"""
        pieces = ["abc", "defghijk", "你好世界测试"]
        start, end = 10.0, 20.0
        result = _allocate_time(pieces, start, end)
        assert result[0]["start"] == pytest.approx(start, abs=1e-6)
        assert result[-1]["end"] == pytest.approx(end, abs=1e-6)
        for i in range(len(result) - 1):
            assert result[i]["end"] == pytest.approx(result[i + 1]["start"], abs=1e-6)

    def test_sum_equals_original_duration(self):
        pieces = ["短", "中等文本", "这是一段比较长的文字内容"]
        start, end = 0.0, 33.0
        result = _allocate_time(pieces, start, end)
        total = sum(r["end"] - r["start"] for r in result)
        assert total == pytest.approx(end - start, abs=1e-6)

    def test_min_dur_merge(self):
        """极短子段（< min_dur）应与前段合并。"""
        pieces = ["很长的一段文字内容测试", "短", "另一段正常长度的文字"]
        result = _allocate_time(pieces, 0.0, 10.0, min_dur=0.8)
        # "短" 只有 1 字，时长会 < 0.8s，应被合并
        for seg in result:
            assert (seg["end"] - seg["start"]) >= 0.8 - 1e-6 or len(result) == 1


# ── refine_segments（集成） ───────────────────────────────────

class TestRefineSegments:
    def test_empty_input(self):
        assert refine_segments([]) == []

    def test_short_segment_unchanged(self):
        segs = [{"start": 0.0, "end": 3.0, "text": "你好世界"}]
        out = refine_segments(segs)
        assert len(out) == 1
        assert out[0]["text"] == "你好世界"
        assert out[0]["start"] == 0.0
        assert out[0]["end"] == 3.0

    def test_long_segment_split(self):
        text = "今天在GitHub上看到一个非常有意思的开源项目，它是一个股票市场分析工具，已经获得了八万多个Star。"
        segs = [{"start": 0.0, "end": 20.0, "text": text}]
        out = refine_segments(segs)
        assert len(out) >= 3
        for seg in out:
            assert _char_len(seg["text"]) <= 16

    def test_zero_drift_integration(self):
        """切分后总时间 == 原时间，首尾对齐。"""
        text = "这是一段很长的字幕文本。中间有句号分隔，也有逗号，需要在合适的位置切开。最后一句收尾。"
        segs = [{"start": 5.0, "end": 25.0, "text": text}]
        out = refine_segments(segs)
        assert out[0]["start"] == pytest.approx(5.0, abs=1e-6)
        assert out[-1]["end"] == pytest.approx(25.0, abs=1e-6)
        total = sum(s["end"] - s["start"] for s in out)
        assert total == pytest.approx(20.0, abs=1e-6)

    def test_punctuation_priority(self):
        text = "今天天气非常非常好。我们一起出去玩吧朋友。"
        segs = [{"start": 0.0, "end": 10.0, "text": text}]
        out = refine_segments(segs)
        # 应在 "。" 处切
        assert any("今天天气非常非常好。" in s["text"] for s in out)

    def test_no_punctuation_hard_split(self):
        text = "这是一段完全没有标点符号的很长文字需要按字数硬切分成多段处理"
        segs = [{"start": 0.0, "end": 20.0, "text": text}]
        out = refine_segments(segs)
        assert len(out) >= 2
        for seg in out:
            assert _char_len(seg["text"]) <= 16

    def test_empty_text_segment_skipped(self):
        segs = [
            {"start": 0.0, "end": 3.0, "text": "正常文本"},
            {"start": 3.0, "end": 5.0, "text": ""},
            {"start": 5.0, "end": 8.0, "text": "另一段"},
        ]
        out = refine_segments(segs)
        assert len(out) == 2
        assert out[0]["text"] == "正常文本"
        assert out[1]["text"] == "另一段"

    def test_zero_duration_segment(self):
        segs = [{"start": 5.0, "end": 5.0, "text": "零时长"}]
        out = refine_segments(segs)
        assert len(out) == 1
        assert out[0]["text"] == "零时长"

    def test_multiple_segments_mixed(self):
        """多段混合：短段保留、长段切分。"""
        segs = [
            {"start": 0.0, "end": 3.0, "text": "短段"},
            {"start": 3.0, "end": 23.0, "text": "这是一段非常长的字幕，包含很多内容，需要被切成多段来改善阅读体验。"},
            {"start": 23.0, "end": 26.0, "text": "结尾"},
        ]
        out = refine_segments(segs)
        assert out[0]["text"] == "短段"
        assert out[-1]["text"] == "结尾"
        # 中间被切了
        assert len(out) >= 4

    def test_preserves_start_end_fields(self):
        """输出段必须有 start/end/text 三个字段。"""
        segs = [{"start": 0.0, "end": 15.0, "text": "一段较长的文字，需要切分处理。"}]
        out = refine_segments(segs)
        for seg in out:
            assert "start" in seg
            assert "end" in seg
            assert "text" in seg
