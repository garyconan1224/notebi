"""音频无人声兼容与旧音乐接口退役 — 单元测试。

覆盖：
- VAD 无人声 → 正常完成音频笔记并跳过 ASR
- VAD 有人声 → 正常 ASR
- 旧 music / music_mode_confirmed 参数不再触发音乐分析
- confirm-music 旧端点对已有任务统一返回 410
- segment_audio 分段逻辑
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from backend.app.models.tasks import TaskRecord, TaskStatus
from shared.audio_analyzer import (
    DiarizationError,
    DiarizationResult,
    SpeakerSegment,
    VadResult,
)


# ── VAD 无人声兼容 ───────────────────────────────────────────

def test_audio_no_speech_completes_without_awaiting_confirm(tmp_path: Path) -> None:
    """VAD 返回 0% 语音时正常完成音频笔记，只跳过 ASR。"""
    from backend.app.services.pipeline_tasks import handle_audio_task

    audio_file = tmp_path / "music.mp3"
    audio_file.write_bytes(b"fake-music-data")

    runner = MagicMock()
    record = TaskRecord(
        task_id="audio-no-speech",
        project_id="default_project",
        task_type="audio",
        payload={"source": str(audio_file), "source_type": "local"},
    )

    with (
        patch("backend.app.services.pipeline_tasks.run_vad",
              return_value=VadResult(has_speech=False, total_speech_duration=0.0, total_duration=180.0)),
        patch("shared.config.get_workspace_root", return_value=tmp_path / "workspace"),
    ):
        result = handle_audio_task(record, runner)

    assert result.get("awaiting_confirm") is None
    assert result.get("transcript") == ""
    assert result.get("summary") == ""
    assert result["vad"]["has_speech"] is False
    assert result["vad"]["total_speech_duration"] == 0.0
    assert result["vad"]["total_duration"] == 180.0
    runner.append_log.assert_any_call(
        "audio-no-speech", "⏭️  跳过 ASR（无人声或未启用）"
    )


def test_audio_no_speech_but_music_enabled_no_awaiting(tmp_path: Path) -> None:
    """旧 music 参数不再触发音乐分析或音乐模式。"""
    from backend.app.services.pipeline_tasks import handle_audio_task

    audio_file = tmp_path / "music.mp3"
    audio_file.write_bytes(b"fake-music-data")

    runner = MagicMock()
    record = TaskRecord(
        task_id="audio-music-on",
        project_id="default_project",
        task_type="audio",
        payload={
            "source": str(audio_file),
            "source_type": "local",
            "music": {"enabled": True},
        },
    )

    with (
        patch("backend.app.services.pipeline_tasks.run_vad",
              return_value=VadResult(has_speech=False, total_speech_duration=0.0, total_duration=180.0)),
        patch("shared.config.get_workspace_root", return_value=tmp_path / "workspace"),
        patch("urllib.request.urlopen") as urlopen,
    ):
        result = handle_audio_task(record, runner)

    assert result.get("awaiting_confirm") is None
    assert result.get("music_mode") is None
    assert result.get("music") is None
    urlopen.assert_not_called()


def test_audio_with_speech_no_awaiting(tmp_path: Path) -> None:
    """VAD 有人声 → 正常走 ASR，不触发 AWAITING_CONFIRM。"""
    from backend.app.services.pipeline_tasks import handle_audio_task

    audio_file = tmp_path / "speech.mp3"
    audio_file.write_bytes(b"fake-speech-data")

    runner = MagicMock()
    record = TaskRecord(
        task_id="audio-speech",
        project_id="default_project",
        task_type="audio",
        payload={"source": str(audio_file), "source_type": "local"},
    )

    mock_settings = MagicMock(
        openai_api_key="",
        openai_base_url="https://example.com/v1",
        transcriber=MagicMock(whisper_model_size="base", device="cpu", language="", initial_prompt=""),
    )

    with (
        patch("backend.app.services.pipeline_tasks.run_vad",
              return_value=VadResult(has_speech=True, total_speech_duration=150.0, total_duration=180.0)),
        patch("backend.app.services.pipeline_tasks.load_settings", return_value=mock_settings),
        patch("shared.config.get_workspace_root", return_value=tmp_path / "workspace"),
        patch("backend.app.services.asr_router.run_local_asr_with_fallback",
              return_value=("hello world", [{"text": "hello world", "start": 0.0, "end": 1.0}], 1.0, "remote")),
    ):
        result = handle_audio_task(record, runner)

    assert result.get("awaiting_confirm") is None


def test_audio_diarization_failure_keeps_transcript_as_partial(tmp_path: Path) -> None:
    from backend.app.services.pipeline_tasks import handle_audio_task

    audio_file = tmp_path / "interview.mp3"
    audio_file.write_bytes(b"fake-speech-data")
    runner = MagicMock()
    record = TaskRecord(
        task_id="audio-partial",
        project_id="default_project",
        task_type="audio",
        payload={
            "source": str(audio_file),
            "source_type": "local",
            "voiceprint": {"enabled": True},
            "summary_mode": "speaker_aware",
            "summary_template": "detailed",
        },
    )
    settings = SimpleNamespace(
        openai_api_key="",
        openai_base_url="https://example.com/v1",
        text_model="",
        transcriber=SimpleNamespace(
            whisper_model_size="base",
            initial_prompt="",
        ),
    )
    profile = SimpleNamespace(default_models=SimpleNamespace(chat=""))
    registry = MagicMock()
    registry.resolve_default_profile.return_value = profile

    with (
        patch(
            "backend.app.services.pipeline_tasks.run_vad",
            return_value=VadResult(
                has_speech=True,
                total_speech_duration=150.0,
                total_duration=180.0,
            ),
        ),
        patch("backend.app.services.pipeline_tasks.load_settings", return_value=settings),
        patch("backend.app.services.pipeline_tasks.create_default_registry", return_value=registry),
        patch("backend.app.services.pipeline_tasks._extract_waveform_peaks", return_value=[0.2, 0.4]),
        patch("shared.config.get_workspace_root", return_value=tmp_path / "workspace"),
        patch(
            "backend.app.services.asr_router.run_local_asr_with_fallback",
            return_value=(
                "主持人你好。嘉宾你好。",
                [
                    {"text": "主持人你好。", "start": 0.0, "end": 1.0},
                    {"text": "嘉宾你好。", "start": 1.0, "end": 2.0},
                ],
                2.0,
                "mlx-whisper",
            ),
        ),
        patch(
            "backend.app.services.pipeline_tasks.run_diarization",
            side_effect=DiarizationError(
                "inference_failed",
                "模型加载失败",
                engine="wespeaker",
                model="WeSpeaker ResNet34-LM",
            ),
        ),
    ):
        result = handle_audio_task(record, runner)

    assert result["transcript"] == "主持人你好。嘉宾你好。"
    assert len(result["transcript_segments"]) == 2
    assert result["summary"] == ""
    assert result["partial_failure"] == {
        "stage": "diarization",
        "code": "inference_failed",
        "message": "模型加载失败",
        "engine": "wespeaker",
        "model": "WeSpeaker ResNet34-LM",
    }
    assert any(
        call.kwargs.get("status") == TaskStatus.PARTIAL.value
        and call.kwargs.get("result", {}).get("transcript") == result["transcript"]
        and call.kwargs.get("result", {}).get("partial_failure") == result["partial_failure"]
        for call in runner.store.update.call_args_list
    )


def test_audio_diarization_retry_reuses_transcript_without_asr(tmp_path: Path) -> None:
    """阶段重试只补说话人和总结，不重新执行 VAD/ASR。"""
    from backend.app.services.pipeline_tasks import handle_audio_task

    audio_file = tmp_path / "interview.mp3"
    audio_file.write_bytes(b"fake-speech-data")
    parent = TaskRecord(
        task_id="audio-partial-parent",
        project_id="default_project",
        task_type="audio",
        status=TaskStatus.PARTIAL.value,
        payload={
            "source": str(audio_file),
            "source_type": "local",
            "voiceprint": {"enabled": True},
            "summary_mode": "speaker_aware",
            "summary_template": "detailed",
        },
        result={
            "source": str(audio_file),
            "source_type": "local",
            "transcript": "主持人你好。嘉宾你好。",
            "transcript_segments": [
                {"text": "主持人你好。", "start": 0.0, "end": 1.0},
                {"text": "嘉宾你好。", "start": 1.0, "end": 2.0},
            ],
            "summary": "",
            "summary_mode": "speaker_aware",
            "audio": {
                "title": "访谈",
                "filename": "interview.mp3",
                "duration_sec": 2.0,
                "mime": "audio/mpeg",
                "size_bytes": len(b"fake-speech-data"),
                "local_path": str(audio_file),
            },
            "vad": {
                "has_speech": True,
                "segments": [],
                "total_speech_duration": 2.0,
                "total_duration": 2.0,
            },
            "waveform_peaks": [0.2, 0.4],
            "partial_failure": {"stage": "diarization", "message": "模型失败"},
        },
    )
    retry = TaskRecord(
        task_id="audio-diarization-retry",
        project_id="default_project",
        task_type="audio",
        retry_of=parent.task_id,
        payload={
            **parent.payload,
            "_retry_stage": "diarization",
            "_retry_source_task_id": parent.task_id,
        },
    )
    runner = MagicMock()
    runner.store.get.return_value = parent
    profile = SimpleNamespace(default_models=SimpleNamespace(chat="chat-model"))
    provider = MagicMock()
    provider.chat.return_value = "# 按说话人总结\n\n双方完成问候。"
    registry = MagicMock()
    registry.resolve_default_profile.return_value = profile
    registry.build.return_value = provider

    with (
        patch("backend.app.services.pipeline_tasks.run_vad") as run_vad_mock,
        patch("backend.app.services.asr_router.run_local_asr_with_fallback") as asr_mock,
        patch(
            "backend.app.services.pipeline_tasks.run_diarization",
            return_value=DiarizationResult(
                num_speakers=2,
                engine="wespeaker",
                model="WeSpeaker ResNet34-LM",
                segments=[
                    SpeakerSegment(0.0, 1.0, "SPEAKER_00"),
                    SpeakerSegment(1.0, 2.0, "SPEAKER_01"),
                ],
            ),
        ),
        patch("backend.app.services.pipeline_tasks.create_default_registry", return_value=registry),
        patch("backend.app.services.pipeline_tasks.load_settings", return_value=SimpleNamespace(text_model="")),
        patch("shared.config.get_workspace_root", return_value=tmp_path / "workspace"),
    ):
        result = handle_audio_task(retry, runner)

    run_vad_mock.assert_not_called()
    asr_mock.assert_not_called()
    assert [s["speaker"] for s in result["transcript_segments"]] == ["SPEAKER_00", "SPEAKER_01"]
    assert result["summary"].startswith("# 按说话人总结")
    assert result["summary_coverage"]["source_chars"] > 0
    assert result["summary_coverage"]["chunk_ids"] == ["C001"]
    assert result["summary_coverage"]["status"] == "complete"
    assert result["partial_failure"] is None
    assert result["retry_stage"] == "diarization"


def test_video_diarization_retry_reuses_transcript_without_transcribing(tmp_path: Path) -> None:
    """视频补做说话人识别只提取音轨，不重新下载或转录。"""
    from backend.app.services.pipeline_tasks import handle_note_task

    video_file = tmp_path / "interview.mp4"
    video_file.write_bytes(b"fake-video-data")
    parent = TaskRecord(
        task_id="video-success-parent",
        project_id="default_project",
        task_type="note",
        status=TaskStatus.SUCCESS.value,
        payload={"url": "https://example.test/video"},
        result={
            "video_file": str(video_file),
            "transcript_text": "主持人你好。嘉宾你好。",
            "transcript_segments": [
                {"text": "主持人你好。", "start": 0.0, "end": 1.0},
                {"text": "嘉宾你好。", "start": 1.0, "end": 2.0},
            ],
        },
    )
    retry = TaskRecord(
        task_id="video-diarization-retry",
        project_id="default_project",
        task_type="note",
        retry_of=parent.task_id,
        payload={"_retry_stage": "diarization", "_retry_source_task_id": parent.task_id},
    )
    runner = MagicMock()
    runner.store.get.return_value = parent

    def fake_extract(_video: Path, output: Path, **_kwargs: object) -> Path:
        output.write_bytes(b"fake-wav")
        return output

    with (
        patch("backend.app.services.pipeline_tasks._extract_audio_from_video", side_effect=fake_extract),
        patch(
            "backend.app.services.pipeline_tasks.run_diarization",
            return_value=DiarizationResult(
                num_speakers=2,
                engine="wespeaker",
                model="WeSpeaker ResNet34-LM",
                segments=[
                    SpeakerSegment(0.0, 1.0, "SPEAKER_00"),
                    SpeakerSegment(1.0, 2.0, "SPEAKER_01"),
                ],
            ),
        ),
        patch("backend.app.services.pipeline_tasks.get_workspace_json_dir", return_value=tmp_path / "json"),
    ):
        result = handle_note_task(retry, runner)

    assert [segment["speaker"] for segment in result["transcript_segments"]] == ["SPEAKER_00", "SPEAKER_01"]
    assert result["retry_stage"] == "diarization"
    assert result["retry_source_task_id"] == parent.task_id
    assert result["video_file"] == str(video_file)
    assert not (tmp_path / "json" / "video-diarization-retry_diarization.wav").exists()
    runner.set_progress.assert_any_call(
        retry.task_id,
        0.66,
        "从视频音轨区分说话人…",
        public_stage="DIARIZATION",
    )


def test_long_audio_summary_covers_tail_instead_of_truncating() -> None:
    from backend.app.services.pipeline_tasks import _generate_audio_summary

    profile = SimpleNamespace(default_models=SimpleNamespace(chat="chat-model"))
    provider = MagicMock()
    provider.chat.side_effect = lambda *_args, **_kwargs: f"分段摘要-{provider.chat.call_count}"
    registry = MagicMock()
    registry.resolve_default_profile.return_value = profile
    registry.build.return_value = provider
    transcript = "\n".join(
        [f"第{i:04d}段 " + ("内容" * 30) for i in range(500)]
        + ["音频最后的唯一标记 TAIL-MUST-BE-SUMMARIZED"]
    )

    with (
        patch("backend.app.services.pipeline_tasks.create_default_registry", return_value=registry),
        patch("backend.app.services.pipeline_tasks.load_settings", return_value=SimpleNamespace(text_model="")),
    ):
        summary = _generate_audio_summary(
            payload={"summary_template": "detailed"},
            transcript_text=transcript,
            transcript_segments=[],
            summary_mode="general",
            log=lambda _message: None,
        )

    assert provider.chat.call_count > 2
    user_prompts = [
        message["content"]
        for call in provider.chat.call_args_list
        for message in call.args[0].messages
        if message["role"] == "user"
    ]
    assert any("TAIL-MUST-BE-SUMMARIZED" in prompt for prompt in user_prompts)
    assert summary.startswith("分段摘要-")


def test_audio_summary_source_preserves_all_segments_with_time_evidence() -> None:
    from backend.app.services.pipeline_tasks import _audio_summary_source

    segments = [
        {
            "start": 0,
            "end": 2,
            "text": "原始开场",
            "edited_text": "修订后的开场",
            "speaker": "SPEAKER_00",
        },
        {
            "start": 3661,
            "end": 3664,
            "text": "后半程不能丢",
        },
    ]

    general = _audio_summary_source("备用全文", segments, "general")
    speaker_aware = _audio_summary_source("备用全文", segments, "speaker_aware")

    assert general.splitlines() == [
        "[00:00] 修订后的开场",
        "[01:01:01] 后半程不能丢",
    ]
    assert speaker_aware.splitlines() == [
        "[00:00] SPEAKER_00：修订后的开场",
        "[01:01:01] 未识别说话人：后半程不能丢",
    ]


def test_long_audio_summary_repairs_missing_chunk_after_coverage_audit() -> None:
    from backend.app.services.pipeline_tasks import _generate_audio_summary

    profile = SimpleNamespace(default_models=SimpleNamespace(chat="chat-model"))
    provider = MagicMock()
    audit_calls = 0

    def fake_chat(request):
        nonlocal audit_calls
        prompt = request.messages[-1]["content"]
        if "覆盖审计" in prompt:
            audit_calls += 1
            if audit_calls == 1:
                return json.dumps({
                    "covered_chunk_ids": ["C001"],
                    "missing_chunk_ids": ["C002"],
                    "missing_facts": {"C002": ["TAIL-FACT"]},
                }, ensure_ascii=False)
            return json.dumps({
                "covered_chunk_ids": ["C001", "C002"],
                "missing_chunk_ids": [],
                "missing_facts": {},
            }, ensure_ascii=False)
        if "修复当前总结" in prompt:
            assert "C002" in prompt
            assert "TAIL-FACT" in prompt
            return "# 修复后的完整总结\n\n开场与后半程均已纳入。"
        if "覆盖整段音频" in prompt:
            assert "C001" in prompt
            assert "C002" in prompt
            return "# 初稿\n\n只有开场。"
        if "分段 ID：C001" in prompt:
            return "开场事实"
        if "分段 ID：C002" in prompt:
            return "后半程事实 TAIL-FACT"
        raise AssertionError(f"unexpected prompt: {prompt[:120]}")

    provider.chat.side_effect = fake_chat
    registry = MagicMock()
    registry.resolve_default_profile.return_value = profile
    registry.build.return_value = provider
    coverage: dict = {}
    transcript = ("开场内容" * 1400) + "\n" + ("后半程内容" * 1400) + " TAIL-FACT"

    with (
        patch("backend.app.services.pipeline_tasks.create_default_registry", return_value=registry),
        patch("backend.app.services.pipeline_tasks.load_settings", return_value=SimpleNamespace(text_model="")),
    ):
        summary = _generate_audio_summary(
            payload={"summary_template": "detailed"},
            transcript_text=transcript,
            transcript_segments=[],
            summary_mode="general",
            log=lambda _message: None,
            coverage=coverage,
        )

    assert summary.startswith("# 修复后的完整总结")
    assert coverage["source_chars"] == len(transcript)
    assert coverage["chunk_ids"] == ["C001", "C002"]
    assert coverage["audit_passes"] == 2
    assert coverage["status"] == "complete"
    assert coverage["missing_chunk_ids"] == []


def test_speaker_summary_rejects_false_positive_audit_and_supplements_all_chunks() -> None:
    """模型即使谎报全覆盖，缺章节/缺时间区间也不能标记 complete。"""
    from backend.app.services.pipeline_tasks import _generate_audio_summary

    profile = SimpleNamespace(id="provider", default_models=SimpleNamespace(chat="chat-model"))
    provider = MagicMock()

    def fake_chat(request):
        prompt = request.messages[-1]["content"]
        if "覆盖审计" in prompt:
            return json.dumps({
                "covered_chunk_ids": ["C001", "C002"],
                "missing_chunk_ids": [],
                "missing_facts": {},
            }, ensure_ascii=False)
        if "修复当前总结" in prompt:
            return "## 采访概览\n\n[00:00] 只有开头，仍在表格中途"
        if "覆盖整段音频" in prompt:
            return "## 采访概览\n\n[00:00] 只有开头，仍在表格中途"
        if "分段 ID：C001" in prompt:
            return "[00:00] 主持人：开场事实"
        if "分段 ID：C002" in prompt:
            return "[01:00:00] 嘉宾：后半程事实 TAIL-FACT"
        raise AssertionError(f"unexpected prompt: {prompt[:120]}")

    provider.chat.side_effect = fake_chat
    registry = MagicMock()
    registry.resolve_default_profile.return_value = profile
    registry.build.return_value = provider
    coverage: dict = {}
    segments = [
        {"start": index, "speaker": "主持人", "text": "开场内容" * 8}
        for index in range(100)
    ] + [
        {"start": 3600 + index, "speaker": "嘉宾", "text": ("后半程内容" * 8) + " TAIL-FACT"}
        for index in range(100)
    ]

    with (
        patch("backend.app.services.pipeline_tasks.create_default_registry", return_value=registry),
        patch(
            "backend.app.services.pipeline_tasks.load_settings",
            return_value=SimpleNamespace(text_model="", providers=[]),
        ),
        patch(
            "backend.app.services.pipeline_tasks._chunk_audio_summary_source",
            side_effect=lambda source: ["\n".join(source.splitlines()[:100]), "\n".join(source.splitlines()[100:])],
        ),
    ):
        summary = _generate_audio_summary(
            payload={"summary_template": "speaker_interview"},
            transcript_text="",
            transcript_segments=segments,
            summary_mode="speaker_aware",
            log=lambda _message: None,
            coverage=coverage,
        )

    assert "C001" in summary
    assert "C002" in summary
    assert "TAIL-FACT" in summary
    assert coverage["status"] == "supplemented"
    assert coverage["missing_chunk_ids"] == []
    assert coverage["supplemented_chunk_ids"] == ["C001", "C002"]
    assert "Q&A 时间线" in coverage["structural_missing_sections"]
    assert coverage["deterministic_missing_chunk_ids"] == ["C002"]
    assert coverage["partial_boundary_fallback_ids"] == ["C001", "C002"]
    assert coverage["partial_retry_ids"] == ["C001", "C002"]
    assert coverage["raw_fallback_chunk_ids"] == ["C001", "C002"]
    assert "分段边界原文" in summary
    assert "未验证分段的完整原转写" in summary


# ── 旧 music_mode_confirmed 参数兼容 ───────────────────────────

def test_music_confirmed_is_ignored(tmp_path: Path) -> None:
    """旧 music_mode_confirmed 参数不再恢复已移除的音乐模式。"""
    from backend.app.services.pipeline_tasks import handle_audio_task

    audio_file = tmp_path / "music.mp3"
    audio_file.write_bytes(b"fake-music-data")

    runner = MagicMock()
    record = TaskRecord(
        task_id="audio-confirmed",
        project_id="default_project",
        task_type="audio",
        payload={
            "source": str(audio_file),
            "source_type": "local",
            "music_mode_confirmed": True,
        },
    )

    with (
        patch("backend.app.services.pipeline_tasks.run_vad",
              return_value=VadResult(has_speech=False, total_speech_duration=0.0, total_duration=180.0)),
        patch("backend.app.services.pipeline_tasks.load_settings",
              return_value=MagicMock(openai_api_key="", openai_base_url="")),
        patch("shared.config.get_workspace_root", return_value=tmp_path / "workspace"),
        patch("urllib.request.urlopen") as urlopen,
    ):
        result = handle_audio_task(record, runner)

    urlopen.assert_not_called()
    assert result.get("music_mode") is None
    assert result.get("music") is None
    runner.append_log.assert_any_call(
        "audio-confirmed", "⏭️  跳过 ASR（无人声或未启用）"
    )


# ── confirm-music 端点 ──────────────────────────────────────────

def test_confirm_music_endpoint_410_for_awaiting_task() -> None:
    """旧 AWAITING_CONFIRM 任务调用确认接口时明确返回已移除。"""
    from fastapi import HTTPException
    from backend.app.routes.pipeline import _store, confirm_music_mode

    store = _store

    # 造一个 AWAITING_CONFIRM 状态的任务
    store.create(TaskRecord(
        task_id="audio-confirm-200",
        project_id="proj",
        task_type="audio",
        payload={"source": "/tmp/test.mp3", "source_type": "local"},
        status=TaskStatus.AWAITING_CONFIRM.value,
    ))

    with pytest.raises(HTTPException) as exc:
        confirm_music_mode(task_id="audio-confirm-200")
    assert exc.value.status_code == 410
    assert "已移除音乐模式" in str(exc.value.detail)


def test_confirm_music_endpoint_404() -> None:
    """不存在的 task → 404。"""
    from fastapi import HTTPException
    from backend.app.routes.pipeline import confirm_music_mode

    with pytest.raises(HTTPException) as exc:
        confirm_music_mode(task_id="nonexistent")
    assert exc.value.status_code == 404


def test_confirm_music_endpoint_410_for_completed_task() -> None:
    """旧确认接口对已完成任务同样返回 410，不恢复状态分支。"""
    from fastapi import HTTPException
    from backend.app.routes.pipeline import _store, confirm_music_mode

    _store.create(TaskRecord(
        task_id="audio-confirm-409",
        project_id="proj",
        task_type="audio",
        payload={"source": "/tmp/test.mp3", "source_type": "local"},
        status=TaskStatus.SUCCESS.value,
    ))

    with pytest.raises(HTTPException) as exc:
        confirm_music_mode(task_id="audio-confirm-409")
    assert exc.value.status_code == 410
    assert "已移除音乐模式" in str(exc.value.detail)
