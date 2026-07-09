"""align_frames_to_transcript 单测。"""

from backend.app.services.av_synthesis.align import (
    AlignedFrame,
    Frame,
    TranscriptSegment,
    align_frames_to_transcript,
)


def test_empty_frames_returns_empty():
    """空帧列表返回空结果。"""
    result = align_frames_to_transcript([], [TranscriptSegment(0, 5, "hello")])
    assert result == []


def test_frame_aligns_to_nearby_segment():
    """帧在 ±5s 窗口内能匹配到字幕。"""
    frames = [Frame(timestamp=10.0, image_path="f/001.jpg")]
    segments = [
        TranscriptSegment(8.0, 12.0, "你好世界"),
        TranscriptSegment(20.0, 25.0, "另一段"),
    ]
    result = align_frames_to_transcript(frames, segments)
    assert len(result) == 1
    assert result[0].frame is frames[0]
    assert result[0].transcript_snippets == ["你好世界"]


def test_frame_outside_window_gets_nothing():
    """帧离所有字幕都超过 window_seconds 时返回空片段。"""
    frames = [Frame(timestamp=100.0, image_path="f/002.jpg")]
    segments = [TranscriptSegment(0, 5, "早")]
    result = align_frames_to_transcript(frames, segments)
    assert result[0].transcript_snippets == []


def test_multiple_segments_in_window_are_sorted():
    """窗口内多段字幕按时间顺序排列且去重。"""
    frames = [Frame(timestamp=10.0, image_path="f/003.jpg")]
    segments = [
        TranscriptSegment(12.0, 14.0, "后"),
        TranscriptSegment(6.0, 8.0, "前"),
        TranscriptSegment(7.0, 9.0, "前"),  # 重复
    ]
    result = align_frames_to_transcript(frames, segments)
    snippets = result[0].transcript_snippets
    assert snippets == ["前", "后"]


def test_custom_window():
    """自定义 window_seconds 参数生效。"""
    frames = [Frame(timestamp=10.0, image_path="f/004.jpg")]
    segments = [TranscriptSegment(0.0, 2.0, "远处")]
    # 默认 5s 窗口：10 - 5 = 5，段落在 0~2，end(2) < lo(5)，不匹配
    assert align_frames_to_transcript(frames, segments)[0].transcript_snippets == []
    # 15s 窗口：10 - 15 = -5，段落在 0~2，end(2) >= lo(-5)，匹配
    result = align_frames_to_transcript(frames, segments, window_seconds=15.0)
    assert result[0].transcript_snippets == ["远处"]


def test_preserves_frame_order():
    """输出帧顺序与输入一致。"""
    f1 = Frame(timestamp=5.0, image_path="a.jpg")
    f2 = Frame(timestamp=15.0, image_path="b.jpg")
    seg = TranscriptSegment(0, 20, "全程")
    result = align_frames_to_transcript([f1, f2], [seg])
    assert result[0].frame is f1
    assert result[1].frame is f2
