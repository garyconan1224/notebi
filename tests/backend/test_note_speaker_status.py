"""Q2 / D1：笔记 payload 的 speaker_status 判定。

判定不得只看 speakerIds 与 speaker_retry_task_id：必须区分
「未请求」与「请求后无结果」，旧任务按原 task payload 的 diarization
参数兼容推断，不批量迁移数据。
"""

from __future__ import annotations

from types import SimpleNamespace

from backend.app.routes.workspaces import _note_speaker_status


def _task(status="SUCCESS", task_type="note", payload=None, result=None):
    return SimpleNamespace(
        status=status,
        task_type=task_type,
        payload=payload or {},
        result=result or {},
    )


VIDEO_PRODUCER_KW = {"video_file": "/data/workspaces/ws/videos/a.mp4"}
LINES_NO_SPEAKER = [{"t_sec": 0, "speaker": "", "text": "你好"}]
LINES_WITH_SPEAKER = [{"t_sec": 0, "speaker": "SPEAKER_00", "text": "你好"}]


def test_has_speaker_labels_returns_data():
    lookup = {"note-1": _task(payload={"diarize": True}, result=VIDEO_PRODUCER_KW)}
    assert (
        _note_speaker_status("video", LINES_WITH_SPEAKER, ["note-1"], lookup.get)
        == "data"
    )


def test_not_requested_returns_none():
    """producer 从未请求 diarization（含旧任务 payload 无该字段）→ none。"""
    lookup = {"note-1": _task(payload={}, result=VIDEO_PRODUCER_KW)}
    assert (
        _note_speaker_status("video", LINES_NO_SPEAKER, ["note-1"], lookup.get)
        == "none"
    )
    # 旧任务 payload 完全没有 diarize 键 → 同样 none（兼容推断，不迁移）
    legacy = {"note-old": _task(payload={"url": "https://x"}, result=VIDEO_PRODUCER_KW)}
    assert (
        _note_speaker_status("video", LINES_NO_SPEAKER, ["note-old"], legacy.get)
        == "none"
    )


def test_requested_but_no_labels_returns_failed():
    lookup = {
        "note-1": _task(
            payload={"diarize": True},
            result=VIDEO_PRODUCER_KW,
        )
    }
    assert (
        _note_speaker_status("video", LINES_NO_SPEAKER, ["note-1"], lookup.get)
        == "failed"
    )


def test_audio_speaker_aware_summary_mode_counts_as_requested():
    lookup = {
        "audio-1": _task(
            task_type="audio",
            payload={"summary_mode": "speaker_aware"},
        )
    }
    assert (
        _note_speaker_status("audio", LINES_NO_SPEAKER, ["audio-1"], lookup.get)
        == "failed"
    )


def test_running_diarization_retry_returns_running():
    lookup = {
        "note-1": _task(payload={"diarize": True}, result=VIDEO_PRODUCER_KW),
        "note-2": _task(
            status="ASR",  # 非终态 = 仍在运行
            payload={"_retry_stage": "diarization"},
        ),
    }
    assert (
        _note_speaker_status(
            "video", LINES_NO_SPEAKER, ["note-1", "note-2"], lookup.get
        )
        == "running"
    )


def test_no_transcript_returns_none():
    lookup = {"note-1": _task(payload={"diarize": True}, result=VIDEO_PRODUCER_KW)}
    assert _note_speaker_status("video", [], ["note-1"], lookup.get) == "none"


def test_text_item_always_none():
    assert _note_speaker_status("text", LINES_WITH_SPEAKER, [], lambda _t: None) == "none"
