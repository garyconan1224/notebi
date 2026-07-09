"""VN5.1：normalize_transcript 透传 speaker（diarization 跑过时），无 speaker 时不带该键。

NoteShell 视频笔记「说话人模式」依赖前端 transcript 行携带 speaker；
该字段在规范化时此前被丢弃，VN5.1 改为条件式透传。
"""

from backend.app.services.note_assembler import normalize_transcript


def test_carries_speaker_when_present():
    raw = [
        {"start": 0.0, "text": "你好", "speaker": "SPEAKER_00"},
        {"start": 3.2, "text": "在的", "speaker": "SPEAKER_01"},
    ]
    lines = normalize_transcript(raw)
    assert [l["text"] for l in lines] == ["你好", "在的"]
    assert lines[0]["speaker"] == "SPEAKER_00"
    assert lines[1]["speaker"] == "SPEAKER_01"


def test_omits_speaker_key_when_absent():
    raw = [{"start": 0.0, "text": "没有说话人信息"}]
    lines = normalize_transcript(raw)
    assert lines[0]["text"] == "没有说话人信息"
    # 无 diarization → 不带 speaker 键（前端据此条件式隐藏说话人模式）
    assert "speaker" not in lines[0]


def test_already_normalized_form_carries_speaker():
    # 落盘 transcript.json 的 [{t_sec, t_str, text, speaker}] 形态原样保留 speaker
    raw = [{"t_sec": 5.0, "t_str": "00:05", "text": "段落", "speaker": "主持人"}]
    lines = normalize_transcript(raw)
    assert lines[0]["t_str"] == "00:05"
    assert lines[0]["speaker"] == "主持人"
