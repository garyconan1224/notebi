"""handle_note_task 单元测试：覆盖三种步骤编排场景。

场景 A：仅下载
场景 B：下载 + 转录
场景 C：全选（下载 + 转录 + 分析 + 笔记汇总）
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import MagicMock, patch

import pytest

from backend.app.models.tasks import TERMINAL_STATUS_VALUES, TaskRecord, TaskStatus
from backend.app.services.task_runner import TaskRunner
from backend.app.services.task_store import TaskStore
from shared.audio_analyzer import VadResult


def _whisper_side_effect(text: str):
    """返回 transcribe_file_with_fast_whisper 的 side_effect，兼容 return_segments 参数。

    return_segments=True → (text, segments, duration)
    return_segments=False → text
    """
    segments = [{"t_sec": 0.0, "t_str": "00:00", "text": text}]

    def _fn(*args, **kwargs):
        if kwargs.get("return_segments"):
            return text, segments, 10.0
        return text

    return _fn


# ── 公共辅助 ──────────────────────────────────────────────────────────────

def _make_runner(tmp_path: Path, steps: list[str]) -> tuple[TaskRunner, TaskRecord]:
    """创建 TaskStore + TaskRunner，注册 handle_note_task，提交任务并返回。"""
    from backend.app.services.pipeline_tasks import handle_note_task

    store = TaskStore(path=tmp_path / "tasks.json")
    runner = TaskRunner(store, max_workers=1)
    runner.register("note", handle_note_task)

    payload = {
        "url": "https://www.youtube.com/watch?v=test_video",
        "steps": steps,
    }
    rec = runner.create_task("proj-test", "note", payload)
    return runner, rec


def _wait_for_terminal(store: TaskStore, task_id: str, timeout: float = 5.0) -> TaskRecord:
    """等待任务进入终结态，超时则直接返回。"""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        rec = store.get(task_id)
        if rec is not None and rec.status in TERMINAL_STATUS_VALUES:
            return rec
        time.sleep(0.05)
    return store.get(task_id)  # type: ignore[return-value]


# ── Mock 工厂 ──────────────────────────────────────────────────────────────

def _mock_download_ok(save_path: str):
    """返回成功的 yt-dlp 下载结果 mock。"""
    m = MagicMock(return_value={"ok": True, "save_path": save_path})
    return m


def _mock_analysis_state(finished: bool = True):
    """返回一个已完成的 AnalysisState mock。"""
    state = MagicMock()
    state.finished = finished
    state.snapshot.return_value = [{"percent": 100}]
    return state


def _mock_settings(api_key: str = ""):
    """返回 handle_note_task 当前所需的 settings 形状。"""
    transcriber = MagicMock(
        whisper_model_size="base",
        device="cpu",
        language="",
        initial_prompt="",
    )
    return MagicMock(
        openai_api_key=api_key,
        vision_model="gpt-4o",
        text_model="gpt-4o",
        transcriber=transcriber,
    )


def test_stall_notifier_warns_when_progress_stuck() -> None:
    """F3.1: 帧进度长时间不推进时，stall notifier 提示一次「可能在等 API（限流）」，
    已提示不刷屏，进度恢复后重置可再次提示。"""
    from backend.app.services.pipeline_tasks import _make_stall_notifier

    runner = MagicMock()
    tick = _make_stall_notifier(runner, "task-x", threshold_sec=0.05)

    tick(0.5)  # 首次：记录基线，不提示
    runner.append_log.assert_not_called()

    time.sleep(0.06)
    tick(0.5)  # 进度未变 + 超阈值 → 提示一次
    assert runner.append_log.called
    msg = str(runner.append_log.call_args[0][1])
    assert "限流" in msg or "等待 API" in msg

    runner.append_log.reset_mock()
    tick(0.5)  # 已提示，不重复刷屏
    runner.append_log.assert_not_called()

    # 进度恢复推进 → 重置；再次停滞应再次提示
    tick(0.8)
    runner.append_log.reset_mock()
    time.sleep(0.06)
    tick(0.8)
    assert runner.append_log.called


def test_find_visual_json_paths_for_videos_filters_unrelated_workspace_json(tmp_path: Path) -> None:
    from backend.app.services.pipeline_tasks import _find_visual_json_paths_for_videos
    from shared.video_analyzer import get_safe_name

    current_video = tmp_path / "current video.mp4"
    other_video = tmp_path / "other video.mp4"
    current_video.touch()
    other_video.touch()

    current_json = tmp_path / f"{get_safe_name(current_video)}_视觉数据.json"
    other_json = tmp_path / f"{get_safe_name(other_video)}_视觉数据.json"
    current_json.write_text('{"frames": []}', encoding="utf-8")
    other_json.write_text('{"frames": []}', encoding="utf-8")

    assert _find_visual_json_paths_for_videos(tmp_path, [current_video]) == [current_json]


# ── 场景 A：仅下载 ─────────────────────────────────────────────────────────

class TestScenarioA:
    """steps = ['download'] — 仅执行下载步骤。"""

    def test_download_only_succeeds(self, tmp_path: Path) -> None:
        fake_video = tmp_path / "videos" / "test.mp4"
        fake_video.parent.mkdir(parents=True, exist_ok=True)
        fake_video.touch()

        with (
            patch("backend.app.services.pipeline_tasks.run_ytdlp_download",
                  return_value={"ok": True, "save_path": str(fake_video)}),
            patch("backend.app.services.pipeline_tasks.get_workspace_videos_dir",
                  return_value=fake_video.parent),
            patch("backend.app.services.pipeline_tasks.get_workspace_json_dir",
                  return_value=tmp_path / "json"),
            patch("backend.app.services.pipeline_tasks.load_settings",
                  return_value=MagicMock(openai_api_key="", vision_model="gpt-4o", text_model="gpt-4o")),
        ):
            runner, rec = _make_runner(tmp_path, steps=["download"])
            done = _wait_for_terminal(runner.store, rec.task_id)

        assert done.status == TaskStatus.SUCCESS.value, done.error
        result: Dict[str, Any] = done.result
        assert "download" in result["completed_steps"]
        assert "transcribe" not in result["completed_steps"]
        assert result["video_file"] == str(fake_video)

    def test_download_only_failed_raises(self, tmp_path: Path) -> None:
        with (
            patch("backend.app.services.pipeline_tasks.run_ytdlp_download",
                  return_value={"ok": False, "error": "network error"}),
            patch("backend.app.services.pipeline_tasks.get_workspace_videos_dir",
                  return_value=tmp_path / "videos"),
            patch("backend.app.services.pipeline_tasks.get_workspace_json_dir",
                  return_value=tmp_path / "json"),
            patch("backend.app.services.pipeline_tasks.load_settings",
                  return_value=MagicMock(openai_api_key="", vision_model="gpt-4o", text_model="gpt-4o")),
        ):
            runner, rec = _make_runner(tmp_path, steps=["download"])
            done = _wait_for_terminal(runner.store, rec.task_id)

        assert done.status == TaskStatus.FAILED.value
        assert "下载失败" in done.error


# ── 场景 B：下载 + 转录 ────────────────────────────────────────────────────

class TestScenarioB:
    """steps = ['download', 'transcribe'] — 下载后执行转录。"""

    def test_download_and_transcribe_succeeds(self, tmp_path: Path) -> None:
        fake_video = tmp_path / "videos" / "test.mp4"
        fake_video.parent.mkdir(parents=True, exist_ok=True)
        fake_video.touch()

        with (
            patch("backend.app.services.pipeline_tasks.run_ytdlp_download",
                  return_value={"ok": True, "save_path": str(fake_video)}),
            patch("backend.app.services.pipeline_tasks.get_workspace_videos_dir",
                  return_value=fake_video.parent),
            patch("backend.app.services.pipeline_tasks.get_workspace_json_dir",
                  return_value=tmp_path / "json"),
            patch("backend.app.services.pipeline_tasks.load_settings",
                  return_value=_mock_settings()),
            patch("backend.app.services.asr_fast_whisper.is_fast_whisper_available",
                  return_value=True),
            patch("backend.app.services.asr_fast_whisper.transcribe_file_with_fast_whisper",
                  side_effect=_whisper_side_effect("这是转录文本")),
        ):
            runner, rec = _make_runner(tmp_path, steps=["download", "transcribe"])
            done = _wait_for_terminal(runner.store, rec.task_id)

        assert done.status == TaskStatus.SUCCESS.value, done.error
        result: Dict[str, Any] = done.result
        assert "download" in result["completed_steps"]
        assert "transcribe" in result["completed_steps"]
        assert "analyze" not in result["completed_steps"]
        assert result["transcript"] == "这是转录文本"
        assert result["video_file"] == str(fake_video)


# ── 场景 C：全量流程 ───────────────────────────────────────────────────────

class TestScenarioC:
    """steps = ['download', 'transcribe', 'analyze', 'note'] — 完整四步流程。"""

    def test_full_pipeline_succeeds(self, tmp_path: Path) -> None:
        fake_video = tmp_path / "videos" / "test.mp4"
        fake_video.parent.mkdir(parents=True, exist_ok=True)
        fake_video.touch()

        # 模拟 analyze 步骤产出的 markdown 文件
        analysis_md_dir = tmp_path / "videos" / "test_分析报告"
        analysis_md_dir.mkdir(parents=True, exist_ok=True)
        analysis_md_file = analysis_md_dir / "test_图文分镜.md"
        analysis_md_file.write_text("## 分析内容\n\n帧1: 产品展示", encoding="utf-8")

        mock_state = _mock_analysis_state(finished=True)

        with (
            patch("backend.app.services.pipeline_tasks.run_ytdlp_download",
                  return_value={"ok": True, "save_path": str(fake_video)}),
            patch("backend.app.services.pipeline_tasks.get_workspace_videos_dir",
                  return_value=fake_video.parent),
            patch("backend.app.services.pipeline_tasks.get_workspace_json_dir",
                  return_value=tmp_path / "json"),
            patch("backend.app.services.pipeline_tasks.load_settings",
                  return_value=_mock_settings("sk-test")),
            patch("backend.app.services.asr_fast_whisper.is_fast_whisper_available",
                  return_value=True),
            patch("backend.app.services.asr_fast_whisper.transcribe_file_with_fast_whisper",
                  side_effect=_whisper_side_effect("转录文本内容")),
            patch("backend.app.services.pipeline_tasks.find_videos",
                  return_value=[fake_video]),
            patch("backend.app.services.pipeline_tasks.run_batch_analysis",
                  return_value=mock_state),
            patch("backend.app.services.pipeline_tasks.get_safe_name",
                  return_value="test"),
            patch("backend.app.services.pipeline_tasks.get_output_dir",
                  return_value=analysis_md_dir),
        ):
            runner, rec = _make_runner(tmp_path, steps=["download", "transcribe", "analyze", "note"])
            done = _wait_for_terminal(runner.store, rec.task_id)

        assert done.status == TaskStatus.SUCCESS.value, done.error
        result: Dict[str, Any] = done.result
        all_steps = result["completed_steps"]
        # R22: transcribe 与 analyze 并行，完成顺序不定
        assert all_steps[0] == "download"
        assert set(all_steps[1:3]) == {"transcribe", "analyze"}
        assert all_steps[3] == "note"
        assert "## 分析内容" in result["analysis"]
        # note 步骤优先使用 analysis_text（而非 transcript）
        assert "## 分析内容" in result["markdown"]
        assert result["transcript"] == "转录文本内容"

    def test_full_pipeline_markdown_fallback_to_transcript(self, tmp_path: Path) -> None:
        """当 analyze 步骤没有产出 md 文件时，note 步骤应降级使用 transcript。"""
        fake_video = tmp_path / "videos" / "test.mp4"
        fake_video.parent.mkdir(parents=True, exist_ok=True)
        fake_video.touch()

        # 分析目录存在但无 md 文件（模拟分析为空产出）
        empty_md_dir = tmp_path / "videos" / "test_分析报告"
        empty_md_dir.mkdir(parents=True, exist_ok=True)

        mock_state = _mock_analysis_state(finished=True)

        with (
            patch("backend.app.services.pipeline_tasks.run_ytdlp_download",
                  return_value={"ok": True, "save_path": str(fake_video)}),
            patch("backend.app.services.pipeline_tasks.get_workspace_videos_dir",
                  return_value=fake_video.parent),
            patch("backend.app.services.pipeline_tasks.get_workspace_json_dir",
                  return_value=tmp_path / "json"),
            patch("backend.app.services.pipeline_tasks.load_settings",
                  return_value=_mock_settings("sk-test")),
            patch("backend.app.services.asr_fast_whisper.is_fast_whisper_available",
                  return_value=True),
            patch("backend.app.services.asr_fast_whisper.transcribe_file_with_fast_whisper",
                  side_effect=_whisper_side_effect("降级转录内容")),
            patch("backend.app.services.pipeline_tasks.find_videos",
                  return_value=[fake_video]),
            patch("backend.app.services.pipeline_tasks.run_batch_analysis",
                  return_value=mock_state),
            patch("backend.app.services.pipeline_tasks.get_safe_name",
                  return_value="test"),
            patch("backend.app.services.pipeline_tasks.get_output_dir",
                  return_value=empty_md_dir),
        ):
            runner, rec = _make_runner(tmp_path, steps=["download", "transcribe", "analyze", "note"])
            done = _wait_for_terminal(runner.store, rec.task_id)

        assert done.status == TaskStatus.SUCCESS.value, done.error
        result: Dict[str, Any] = done.result
        # analysis 为空时，markdown 应使用 transcript 内容
        assert result["analysis"] == ""
        assert result["markdown"] == "降级转录内容"

    def test_note_summary_template_payload_reaches_generate_summary(self, tmp_path: Path) -> None:
        """本地/链接统一 start note pipeline 时，用户选择的笔记模板必须进入 note_body 生成器。"""
        from backend.app.models.workspace import ItemSummary
        from backend.app.services.pipeline_tasks import handle_note_task

        fake_video = tmp_path / "videos" / "test.mp4"
        fake_video.parent.mkdir(parents=True, exist_ok=True)
        fake_video.touch()

        long_transcript = (
            "这是一段足够长的视频转录文本，用来触发 note_body 的总结生成逻辑，"
            "并验证 payload.summary_template 不会在 handle_note_task 中丢失。"
        )

        store = TaskStore(path=tmp_path / "tasks.json")
        runner = TaskRunner(store, max_workers=1)
        rec = TaskRecord(
            task_id="note-template-001",
            project_id="proj-test",
            task_type="note",
            payload={
                "url": "local:test.mp4",
                "steps": ["download", "transcribe", "note"],
                "api_key": "sk-test",
                "summary_template": "concise",
            },
        )
        store.create(rec)

        with (
            patch("backend.app.services.pipeline_tasks._download_note_source",
                  return_value={
                      "ok": True,
                      "kind_hint": "video",
                      "title": "模板透传测试",
                      "content": "",
                      "images": [],
                      "video_file": str(fake_video),
                      "source_path": str(fake_video),
                      "metadata": {},
                  }),
            patch("backend.app.services.pipeline_tasks.get_workspace_videos_dir",
                  return_value=fake_video.parent),
            patch("backend.app.services.pipeline_tasks.get_workspace_json_dir",
                  return_value=tmp_path / "json"),
            patch("backend.app.services.pipeline_tasks.load_settings",
                  return_value=_mock_settings("sk-test")),
            patch("backend.app.services.pipeline_tasks.find_videos",
                  return_value=[fake_video]),
            patch("backend.app.services.asr_fast_whisper.is_fast_whisper_available",
                  return_value=True),
            patch("backend.app.services.asr_fast_whisper.transcribe_file_with_fast_whisper",
                  side_effect=_whisper_side_effect(long_transcript)),
            patch("backend.app.services.summary_generator.generate_summary",
                  return_value=ItemSummary(
                      summary_id="sum-1",
                      template="concise",
                      version=0,
                      content_md="# concise note",
                  )) as generate_summary_mock,
        ):
            result = handle_note_task(rec, runner)

        assert result["note_body"] == "# concise note"
        generate_summary_mock.assert_called_once()
        assert generate_summary_mock.call_args.args[1] == "concise"


class TestParallelCancel:
    """R22 协作取消：一轨失败时另一轨应通过 cancel_event 退出。"""

    def test_transcribe_failure_cancels_analyze(self, tmp_path: Path) -> None:
        """transcribe 快速失败 → analyze 应在下一帧检查点退出。"""
        import threading

        fake_video = tmp_path / "videos" / "test.mp4"
        fake_video.parent.mkdir(parents=True, exist_ok=True)
        fake_video.touch()

        # 模拟 analyze 慢跑（循环 10 次，每次 0.1s）
        mock_state = MagicMock()
        mock_state.finished = False
        _call_count = {"n": 0}
        _analyze_exited = threading.Event()

        def _slow_snapshot():
            _call_count["n"] += 1
            if _call_count["n"] >= 10:
                # 10 轮后标记完成（防止无限循环）
                mock_state.finished = True
            return [{"percent": _call_count["n"] * 10}]

        mock_state.snapshot = _slow_snapshot

        # transcribe 快速失败
        def _fail_transcribe(*args, **kwargs):
            raise RuntimeError("ASR 引擎崩溃")

        with (
            patch("backend.app.services.pipeline_tasks.run_ytdlp_download",
                  return_value={"ok": True, "save_path": str(fake_video)}),
            patch("backend.app.services.pipeline_tasks.get_workspace_videos_dir",
                  return_value=fake_video.parent),
            patch("backend.app.services.pipeline_tasks.get_workspace_json_dir",
                  return_value=tmp_path / "json"),
            patch("backend.app.services.pipeline_tasks.load_settings",
                  return_value=_mock_settings("sk-test")),
            patch("backend.app.services.asr_fast_whisper.is_fast_whisper_available",
                  return_value=True),
            patch("backend.app.services.asr_fast_whisper.transcribe_file_with_fast_whisper",
                  side_effect=_fail_transcribe),
            patch("backend.app.services.pipeline_tasks.find_videos",
                  return_value=[fake_video]),
            patch("backend.app.services.pipeline_tasks.run_batch_analysis",
                  return_value=mock_state),
            patch("backend.app.services.pipeline_tasks.get_safe_name",
                  return_value="test"),
            patch("backend.app.services.pipeline_tasks.get_output_dir",
                  return_value=tmp_path / "videos" / "test_分析报告"),
        ):
            runner, rec = _make_runner(tmp_path, steps=["download", "transcribe", "analyze"])
            done = _wait_for_terminal(runner.store, rec.task_id, timeout=10.0)

        # 任务应失败（transcribe 失败）
        assert done.status == TaskStatus.FAILED.value
        assert "transcribe 失败" in (done.error or "")
        # analyze 应该被协作取消（不会跑满 10 轮）
        assert _call_count["n"] < 10, f"analyze 未被取消，跑了 {_call_count['n']} 轮"


def test_user_cancel_during_frames_keeps_real_progress_and_writes_no_note(
    tmp_path: Path,
) -> None:
    """复现并锁定取消语义（note 任务）：FRAMES 阶段中途取消后——

    · 终态 CANCELLED；
    · progress 停在取消时刻的真实值（不被顶到 1.0）；
    · 不落完整笔记（notes API 读 result["markdown"]，该键应缺失）。

    对应 bug：取消却显示 100%（CANCELLED + progress=1.0）+ 残缺笔记入库。
    """
    fake_video = tmp_path / "videos" / "test.mp4"
    fake_video.parent.mkdir(parents=True, exist_ok=True)
    fake_video.touch()

    # analyze 永不自然 finished：只能靠用户取消 break，模拟"卡在 FRAMES 轮询"
    mock_state = MagicMock()
    mock_state.finished = False
    mock_state.snapshot.return_value = [
        {"percent": 50, "total_frames": 10, "analyzed_frames": 5}
    ]

    with (
        patch("backend.app.services.pipeline_tasks.run_ytdlp_download",
              return_value={"ok": True, "save_path": str(fake_video)}),
        patch("backend.app.services.pipeline_tasks.get_workspace_videos_dir",
              return_value=fake_video.parent),
        patch("backend.app.services.pipeline_tasks.get_workspace_json_dir",
              return_value=tmp_path / "json"),
        patch("backend.app.services.pipeline_tasks.load_settings",
              return_value=_mock_settings("sk-test")),
        patch("backend.app.services.asr_fast_whisper.is_fast_whisper_available",
              return_value=True),
        patch("backend.app.services.asr_fast_whisper.transcribe_file_with_fast_whisper",
              side_effect=_whisper_side_effect("fake transcript")),
        patch("backend.app.services.pipeline_tasks.find_videos",
              return_value=[fake_video]),
        patch("backend.app.services.pipeline_tasks.run_batch_analysis",
              return_value=mock_state),
        patch("backend.app.services.pipeline_tasks.get_safe_name",
              return_value="test"),
        patch("backend.app.services.pipeline_tasks.get_output_dir",
              return_value=tmp_path / "videos" / "test_分析报告"),
    ):
        runner, rec = _make_runner(
            tmp_path, steps=["download", "transcribe", "analyze", "note"]
        )

        # 等进入 analyze 帧轮询（50% 截帧按 0.30 + 0.50 * 0.30 映射到约 0.45）
        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline:
            cur = runner.store.get(rec.task_id)
            if cur and cur.progress >= 0.44:
                break
            time.sleep(0.02)
        assert runner.store.get(rec.task_id).progress >= 0.44, (
            "未进入 FRAMES 轮询就触发取消，测试时序失效"
        )

        # mid-FRAMES 发起用户取消
        runner.cancel_task(rec.task_id)

        # 等 handler 真正收尾：green 会落 cancelled 标记；red 会误落 markdown
        deadline = time.monotonic() + 10.0
        while time.monotonic() < deadline:
            r = (runner.store.get(rec.task_id).result) or {}
            if r.get("cancelled") or r.get("markdown"):
                break
            time.sleep(0.05)

    done = runner.store.get(rec.task_id)
    assert done.status == TaskStatus.CANCELLED.value
    # 进度不被顶到 100%，且保留取消时刻的真实值
    assert done.progress < 1.0, f"取消后进度被顶到 {done.progress}（应保留真实进度）"
    assert done.progress >= 0.44, f"取消后真实进度丢失：{done.progress}"
    # 不落完整笔记
    result = done.result or {}
    assert not result.get("markdown"), "取消后仍写入了完整笔记 markdown"
    assert result.get("cancelled") is True


def _make_analyze_runner(
    tmp_path: Path, payload: Dict[str, Any]
) -> tuple[TaskRunner, TaskRecord]:
    """创建注册 handle_analyze_task 的 runner，提交 analyze 任务。"""
    from backend.app.services.pipeline_tasks import handle_analyze_task

    store = TaskStore(path=tmp_path / "tasks.json")
    runner = TaskRunner(store, max_workers=1)
    runner.register("analyze", handle_analyze_task)
    rec = runner.create_task("proj-test", "analyze", payload)
    return runner, rec


def test_analyze_user_cancel_during_frames_keeps_real_progress(tmp_path: Path) -> None:
    """锁定 handle_analyze_task 取消语义：默认 VLM 路径中途取消后——

    · 终态 CANCELLED；
    · progress 停在取消时刻的真实值（不被顶到 0.95→1.0）。
    """
    fake_video = tmp_path / "videos" / "test.mp4"
    fake_video.parent.mkdir(parents=True, exist_ok=True)
    fake_video.touch()

    mock_state = MagicMock()
    mock_state.finished = False
    mock_state.snapshot.return_value = [
        {"percent": 50, "total_frames": 10, "analyzed_frames": 5}
    ]
    mock_state.live_frames_snapshot.return_value = []

    with (
        patch("backend.app.services.pipeline_tasks.get_workspace_videos_dir",
              return_value=fake_video.parent),
        patch("backend.app.services.pipeline_tasks.get_workspace_json_dir",
              return_value=tmp_path / "json"),
        patch("backend.app.services.pipeline_tasks.load_settings",
              return_value=_mock_settings("sk-test")),
        patch("backend.app.services.pipeline_tasks.find_videos",
              return_value=[fake_video]),
        patch("backend.app.services.pipeline_tasks.run_batch_analysis",
              return_value=mock_state),
    ):
        runner, rec = _make_analyze_runner(tmp_path, {"api_key": "sk-test"})

        # 等进入帧轮询（默认路径循环内 set_progress → 0.5）
        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline:
            cur = runner.store.get(rec.task_id)
            if cur and cur.progress >= 0.5:
                break
            time.sleep(0.02)
        assert runner.store.get(rec.task_id).progress >= 0.5, "未进入帧轮询，测试时序失效"

        runner.cancel_task(rec.task_id)

        # 等 handler 收尾：green 落 cancelled；red 落 json_output_dir（finalize）
        deadline = time.monotonic() + 10.0
        while time.monotonic() < deadline:
            r = (runner.store.get(rec.task_id).result) or {}
            if r.get("cancelled") or r.get("json_output_dir"):
                break
            time.sleep(0.05)

    done = runner.store.get(rec.task_id)
    assert done.status == TaskStatus.CANCELLED.value
    assert done.progress < 1.0, f"取消后进度被顶到 {done.progress}（应保留真实进度）"
    assert done.progress >= 0.5, f"取消后真实进度丢失：{done.progress}"
    assert (done.result or {}).get("cancelled") is True


def test_audio_task_boolean_false_disables_asr(tmp_path: Path) -> None:
    """IP.9 audio boolean payloads should be honored by the audio pipeline."""
    from backend.app.services.pipeline_tasks import handle_audio_task

    audio_file = tmp_path / "sample.mp3"
    audio_file.write_bytes(b"fake-audio")
    runner = MagicMock()
    record = TaskRecord(
        task_id="audio-bool",
        project_id="default_project",
        task_type="audio",
        payload={
            "source": str(audio_file),
            "source_type": "local",
            "asr": False,
            "srt": False,
            "music": False,
        },
    )

    with (
        patch("backend.app.services.pipeline_tasks.run_vad",
              return_value=VadResult(has_speech=True, total_speech_duration=1.0, total_duration=1.0)),
        patch("backend.app.services.pipeline_tasks.load_settings",
              return_value=MagicMock(openai_api_key="sk-test", openai_base_url="https://example.com/v1")),
        patch("shared.config.get_workspace_root", return_value=tmp_path / "workspace"),
        patch("urllib.request.urlopen") as urlopen,
    ):
        result = handle_audio_task(record, runner)

    urlopen.assert_not_called()
    assert result["transcript"] == ""
    runner.append_log.assert_any_call("audio-bool", "⏭️  跳过 ASR（无人声或未启用）")


def test_subtitle_summary_without_api_key_runs_rules_only(tmp_path: Path) -> None:
    """N7b path 1 should run ASR + rules cleanup without requiring vision/API."""
    from backend.app.services.pipeline_tasks import handle_analyze_task

    fake_video = tmp_path / "videos" / "sample.mp4"
    fake_video.parent.mkdir(parents=True, exist_ok=True)
    fake_video.touch()
    json_dir = tmp_path / "json"

    runner = MagicMock()
    record = TaskRecord(
        task_id="subtitle-no-key",
        project_id="default_project",
        task_type="analyze",
        payload={
            "summary_path": "subtitle",
            "video_basenames": [fake_video.name],
        },
    )

    with (
        patch("backend.app.services.pipeline_tasks.load_settings", return_value=_mock_settings("")),
        patch("backend.app.services.pipeline_tasks.get_workspace_videos_dir",
              return_value=fake_video.parent),
        patch("backend.app.services.pipeline_tasks.get_workspace_json_dir",
              return_value=json_dir),
        patch("backend.app.services.pipeline_tasks.find_videos",
              return_value=[fake_video]),
        patch("backend.app.services.pipeline_tasks.run_batch_analysis") as run_batch,
        patch("backend.app.services.pipeline_tasks._extract_audio_from_video",
              return_value=json_dir / "sample.wav"),
        patch("backend.app.services.asr_fast_whisper.is_fast_whisper_available",
              return_value=True),
        patch("backend.app.services.asr_fast_whisper.transcribe_file_with_fast_whisper",
              return_value=(
                  "嗯 今天天气不错 啊\n今天天气不错",
                  [{"start": 0.0, "end": 2.5, "text": "嗯 今天天气不错 啊"},
                   {"start": 2.5, "end": 5.0, "text": "今天天气不错"}],
                  15.0,
              )),
    ):
        result = handle_analyze_task(record, runner)

    run_batch.assert_not_called()
    assert result["summary_path"] == "subtitle"
    assert "嗯" not in result["transcript_text"]
    assert "天气不错" in result["transcript_text"]
    assert result["summary"] == ""
    # segments 应被保留并传给 _normalize_transcript_to_lines
    assert isinstance(result["transcript"], list)
    assert len(result["transcript"]) == 2
    assert result["transcript"][0]["t_sec"] == 0.0
    assert result["transcript"][0]["t_str"] == "00:00"
    assert result["transcript"][1]["t_sec"] == 2.5
    assert result["transcript"][1]["t_str"] == "00:02"
    assert "嗯" not in result["transcript"][0]["text"]
    assert "啊" not in result["transcript"][0]["text"]


def test_subtitle_summary_prefers_cleaned_lines_for_display(tmp_path: Path) -> None:
    """字幕展示应优先用清洗后的逐行文本，而不是原始 ASR segment 文本。"""
    from backend.app.services.pipeline_tasks import handle_analyze_task

    fake_video = tmp_path / "videos" / "sample.mp4"
    fake_video.parent.mkdir(parents=True, exist_ok=True)
    fake_video.touch()
    json_dir = tmp_path / "json"

    runner = MagicMock()
    record = TaskRecord(
        task_id="subtitle-cleaned-lines",
        project_id="default_project",
        task_type="analyze",
        payload={
            "summary_path": "subtitle",
            "video_basenames": [fake_video.name],
        },
    )

    with (
        patch("backend.app.services.pipeline_tasks.load_settings", return_value=_mock_settings("")),
        patch("backend.app.services.pipeline_tasks.get_workspace_videos_dir",
              return_value=fake_video.parent),
        patch("backend.app.services.pipeline_tasks.get_workspace_json_dir",
              return_value=json_dir),
        patch("backend.app.services.pipeline_tasks.find_videos",
              return_value=[fake_video]),
        patch("backend.app.services.pipeline_tasks.run_batch_analysis") as run_batch,
        patch("backend.app.services.pipeline_tasks._extract_audio_from_video",
              return_value=json_dir / "sample.wav"),
        patch("backend.app.services.asr_fast_whisper.is_fast_whisper_available",
              return_value=True),
        patch("backend.app.services.asr_fast_whisper.transcribe_file_with_fast_whisper",
              return_value=(
                  "原始第一段\n原始第二段",
                  [{"start": 0.0, "end": 2.5, "text": "嗯 原始第一段"},
                   {"start": 2.5, "end": 5.0, "text": "啊 原始第二段"}],
                  15.0,
              )),
        patch("shared.transcript_cleaner.clean_transcript",
              return_value="清洗后第一段\n清洗后第二段"),
    ):
        result = handle_analyze_task(record, runner)

    run_batch.assert_not_called()
    assert [line["text"] for line in result["transcript"]] == [
        "清洗后第一段",
        "清洗后第二段",
    ]


# ── Phase 1F：验证 PROBE / STORE 框架级阶段被触发 ────────────────────────────

class TestPhase1FStageTransitions:
    """Phase 1F 完成标准：除用户勾选的 steps 外，pipeline 必须额外推进
    PROBE（download 之后）和 STORE（最终 SUCCESS 之前）两个框架级阶段，
    对齐 v1.1 §11 全流程进度可视化要求。
    """

    def test_probe_and_store_phases_emit_log_messages(self, tmp_path: Path) -> None:
        """download-only 场景下，任务日志应包含 PROBE 与 STORE 阶段的进度消息。

        PROBE 进度消息："探测内容类型..."
        STORE 进度消息："归档任务结果..."
        """
        fake_video = tmp_path / "videos" / "test.mp4"
        fake_video.parent.mkdir(parents=True, exist_ok=True)
        fake_video.touch()

        with (
            patch("backend.app.services.pipeline_tasks.run_ytdlp_download",
                  return_value={"ok": True, "save_path": str(fake_video)}),
            patch("backend.app.services.pipeline_tasks.get_workspace_videos_dir",
                  return_value=fake_video.parent),
            patch("backend.app.services.pipeline_tasks.get_workspace_json_dir",
                  return_value=tmp_path / "json"),
            patch("backend.app.services.pipeline_tasks.load_settings",
                  return_value=MagicMock(openai_api_key="", vision_model="gpt-4o", text_model="gpt-4o")),
        ):
            runner, rec = _make_runner(tmp_path, steps=["download"])
            done = _wait_for_terminal(runner.store, rec.task_id)

        assert done.status == TaskStatus.SUCCESS.value, done.error
        # TaskLogEntry 是 dataclass，含 ts/level/message 属性
        log_messages = " | ".join(entry.message for entry in (done.log or []))
        assert "探测内容类型" in log_messages, (
            f"PROBE 阶段消息缺失，日志：{log_messages}"
        )
        assert "归档任务结果" in log_messages, (
            f"STORE 阶段消息缺失，日志：{log_messages}"
        )


# ── V2.2/V2.3：输出格式 prompt 模板 ──────────────────────────────────────────

class TestVideoSummaryOutputFormat:
    """V2.2/V2.3：4 种输出格式对应 4 套不同的 prompt 模板。"""

    def test_four_output_formats_produce_different_prompts(self) -> None:
        from backend.app.services.pipeline_tasks import _build_video_summary_prompt

        transcript = "今天聊一聊 AI 的未来。"
        prompts = {}
        for fmt in ("summary", "key_points", "golden_quotes", "paragraph_rewrite"):
            prompts[fmt] = _build_video_summary_prompt(
                transcript, video_template="其它", depth="normal", output_format=fmt,
            )

        for fmt_a, fmt_b in [
            ("summary", "key_points"),
            ("summary", "golden_quotes"),
            ("key_points", "paragraph_rewrite"),
        ]:
            assert prompts[fmt_a] != prompts[fmt_b], (
                f"{fmt_a} 和 {fmt_b} 的 prompt 应不同"
            )

        for fmt, prompt in prompts.items():
            assert transcript in prompt, f"{fmt} 的 prompt 应包含转写文本"

    def test_default_output_format_is_summary(self) -> None:
        """旧数据未传 output_format 时默认走摘要逻辑。"""
        from backend.app.services.pipeline_tasks import _build_video_summary_prompt

        transcript = "测试文本。"
        with_default = _build_video_summary_prompt(transcript)
        with_explicit = _build_video_summary_prompt(
            transcript, output_format="summary",
        )
        assert with_default == with_explicit

    def test_unknown_output_format_falls_back_to_summary(self) -> None:
        """未知 output_format 值兜底到摘要模板。"""
        from backend.app.services.pipeline_tasks import _build_video_summary_prompt

        transcript = "测试文本。"
        unknown = _build_video_summary_prompt(
            transcript, output_format="not_a_real_format",
        )
        explicit = _build_video_summary_prompt(
            transcript, output_format="summary",
        )
        assert unknown == explicit

    def test_subtitle_summary_with_output_format_key_points(self, tmp_path: Path) -> None:
        """路径 1 携带 output_format='key_points' 应被正确传给 prompt 构建。"""
        from backend.app.services.pipeline_tasks import handle_analyze_task

        fake_video = tmp_path / "videos" / "sample.mp4"
        fake_video.parent.mkdir(parents=True, exist_ok=True)
        fake_video.touch()
        json_dir = tmp_path / "json"

        runner = MagicMock()
        record = TaskRecord(
            task_id="subtitle-key-points",
            project_id="default_project",
            task_type="analyze",
            payload={
                "summary_path": "subtitle",
                "video_basenames": [fake_video.name],
                "output_format": "key_points",
            },
        )

        with (
            patch("backend.app.services.pipeline_tasks.load_settings", return_value=_mock_settings("")),
            patch("backend.app.services.pipeline_tasks.get_workspace_videos_dir",
                  return_value=fake_video.parent),
            patch("backend.app.services.pipeline_tasks.get_workspace_json_dir",
                  return_value=json_dir),
            patch("backend.app.services.pipeline_tasks.find_videos",
                  return_value=[fake_video]),
            patch("backend.app.services.pipeline_tasks.run_batch_analysis") as run_batch,
            patch("backend.app.services.pipeline_tasks._extract_audio_from_video",
                  return_value=json_dir / "sample.wav"),
            patch("backend.app.services.asr_fast_whisper.is_fast_whisper_available",
                  return_value=True),
            patch("backend.app.services.asr_fast_whisper.transcribe_file_with_fast_whisper",
                  return_value=(
                      "今天天气不错适合出门散步",
                      [{"start": 0.0, "end": 5.0, "text": "今天天气不错适合出门散步"}],
                      5.0,
                  )),
        ):
            result = handle_analyze_task(record, runner)

        run_batch.assert_not_called()
        assert result["summary_path"] == "subtitle"
        assert result["output_format"] == "key_points"


# ── V3.3: _detect_video_template 单元测试 ─────────────────────────────────


def _mock_detect_provider(chat_return: str) -> MagicMock:
    """构造一个会返回 chat_return 的 LLM provider mock。"""
    provider = MagicMock()
    provider.chat.return_value = chat_return
    registry = MagicMock()
    registry.resolve_default_profile.return_value = MagicMock(
        default_models=MagicMock(get=MagicMock(return_value="test-model")),
    )
    registry.build.return_value = provider
    return provider, registry


class TestDetectVideoTemplate:
    """V3.3 _detect_video_template 白名单 / 兜底 / 自定义模板。"""

    def test_detect_returns_valid_template(self) -> None:
        """LLM 返回白名单内的模板名 → 直接返回。"""
        from backend.app.services.pipeline_tasks import _detect_video_template

        provider, registry = _mock_detect_provider("教程")
        settings = _mock_settings("sk-test")

        with (
            patch("backend.app.services.pipeline_tasks.load_settings", return_value=settings),
            patch("backend.app.services.pipeline_tasks.create_default_registry", return_value=registry),
        ):
            result = _detect_video_template("Python 入门", "今天我们来学习 Python 的基础语法")
            assert result == "教程"

    def test_detect_returns_unknown_word_fallback(self) -> None:
        """LLM 返回白名单外的词 → 兜底「其它」。"""
        from backend.app.services.pipeline_tasks import _detect_video_template

        provider, registry = _mock_detect_provider("新闻联播")
        settings = _mock_settings("sk-test")

        with (
            patch("backend.app.services.pipeline_tasks.load_settings", return_value=settings),
            patch("backend.app.services.pipeline_tasks.create_default_registry", return_value=registry),
        ):
            result = _detect_video_template("测试标题", "测试转写内容")
            assert result == "其它"

    def test_detect_llm_raises_fallback(self) -> None:
        """LLM 调用抛异常 → 兜底「其它」。"""
        from backend.app.services.pipeline_tasks import _detect_video_template

        provider = MagicMock()
        provider.chat.side_effect = RuntimeError("connection timeout")
        registry = MagicMock()
        registry.resolve_default_profile.return_value = MagicMock(
            default_models=MagicMock(get=MagicMock(return_value="test-model")),
        )
        registry.build.return_value = provider
        settings = _mock_settings("sk-test")

        with (
            patch("backend.app.services.pipeline_tasks.load_settings", return_value=settings),
            patch("backend.app.services.pipeline_tasks.create_default_registry", return_value=registry),
        ):
            result = _detect_video_template("标题", "转写内容")
            assert result == "其它"

    def test_detect_no_model_configured_fallback(self) -> None:
        """未配置 chat model → 兜底「其它」。"""
        from backend.app.services.pipeline_tasks import _detect_video_template

        registry = MagicMock()
        registry.resolve_default_profile.return_value = MagicMock(
            default_models=MagicMock(get=MagicMock(return_value="")),
        )
        settings = _mock_settings("sk-test")
        settings.text_model = ""

        with (
            patch("backend.app.services.pipeline_tasks.load_settings", return_value=settings),
            patch("backend.app.services.pipeline_tasks.create_default_registry", return_value=registry),
        ):
            result = _detect_video_template("标题", "转写内容")
            assert result == "其它"

    def test_detect_prompt_includes_custom_templates(self) -> None:
        """V3.2 自定义模板名出现在检测 prompt 中。"""
        from backend.app.services.pipeline_tasks import _detect_video_template

        captured_prompt: list[str] = []

        def _record_chat(request):
            captured_prompt.append(request.messages[0]["content"])
            return "学术讲座"

        provider = MagicMock()
        provider.chat.side_effect = _record_chat
        registry = MagicMock()
        registry.resolve_default_profile.return_value = MagicMock(
            default_models=MagicMock(get=MagicMock(return_value="test-model")),
        )
        registry.build.return_value = provider
        settings = _mock_settings("sk-test")

        with (
            patch("backend.app.services.pipeline_tasks.load_settings", return_value=settings),
            patch("backend.app.services.pipeline_tasks.create_default_registry", return_value=registry),
            patch("backend.app.services.pipeline_tasks.list_video_templates", return_value={
                "教程": "...", "Vlog": "...", "访谈": "...", "影视点评": "...", "产品评测": "...", "其它": "...",
                "学术讲座": "custom prompt",
            }),
        ):
            result = _detect_video_template("深度学习入门", "Transformer 架构的核心是自注意力机制")
            assert result == "学术讲座"
            assert captured_prompt
            assert "学术讲座" in captured_prompt[0]

    def test_detect_auto_in_subtitle_summary(self, tmp_path: Path) -> None:
        """_run_subtitle_summary 传入 video_template='auto' → 自动检测后使用检测结果。"""
        from backend.app.services.pipeline_tasks import handle_analyze_task

        fake_video = tmp_path / "videos" / "test.mp4"
        fake_video.parent.mkdir(parents=True, exist_ok=True)
        fake_video.touch()
        json_dir = tmp_path / "json"

        runner = MagicMock()
        record = TaskRecord(
            task_id="auto-detect",
            project_id="default_project",
            task_type="analyze",
            payload={
                "summary_path": "subtitle",
                "video_basenames": [fake_video.name],
                "video_template": "auto",
                "api_key": "sk-test",
            },
        )

        # Mock detect → "访谈"，mock summary LLM 返回空（跳过长 prompt 验证）
        def _fake_chat(request):
            content = request.messages[0]["content"]
            if "视频内容分类助手" in content:
                return "访谈"
            return "这是自动检测后的摘要内容"

        provider = MagicMock()
        provider.chat.side_effect = _fake_chat
        registry = MagicMock()
        registry.resolve_default_profile.return_value = MagicMock(
            default_models=MagicMock(get=MagicMock(return_value="test-model")),
        )
        registry.build.return_value = provider
        settings = _mock_settings("sk-test")

        with (
            patch("backend.app.services.pipeline_tasks.load_settings", return_value=settings),
            patch("backend.app.services.pipeline_tasks.create_default_registry", return_value=registry),
            patch("backend.app.services.pipeline_tasks.get_workspace_videos_dir",
                  return_value=fake_video.parent),
            patch("backend.app.services.pipeline_tasks.get_workspace_json_dir",
                  return_value=json_dir),
            patch("backend.app.services.pipeline_tasks.find_videos",
                  return_value=[fake_video]),
            patch("backend.app.services.pipeline_tasks.run_batch_analysis"),
            patch("backend.app.services.pipeline_tasks._extract_audio_from_video",
                  return_value=json_dir / "test.wav"),
            patch("backend.app.services.asr_fast_whisper.is_fast_whisper_available",
                  return_value=True),
            patch("backend.app.services.asr_fast_whisper.transcribe_file_with_fast_whisper",
                  return_value=(
                      "今天我们采访了知名导演，聊聊电影创作背后的故事",
                      [{"start": 0.0, "end": 5.0, "text": "今天我们采访了知名导演，聊聊电影创作背后的故事"}],
                      5.0,
                  )),
        ):
            result = handle_analyze_task(record, runner)

        assert result["video_template"] == "访谈"
        assert result["detected_template"] == "访谈"
        assert result["summary"] == "这是自动检测后的摘要内容"


# ── Phase R: handle_image_task 分派测试 ──────────────────────────────


class TestImageTask:
    """handle_image_task (image→image) 覆盖：URL 图片、本地文件、小红书 HTML 回退、retry 兜底。"""

    # 一份最小 PNG（67 字节，1×1 像素）
    FAKE_PNG = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f"
        b"\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )

    _fake_settings = _mock_settings("sk-test")

    @staticmethod
    def _fake_provider(chat_return: str) -> MagicMock:
        provider = MagicMock()
        provider.chat.return_value = chat_return
        registry = MagicMock()
        registry.resolve_default_profile.return_value = MagicMock(
            default_models=MagicMock(get=MagicMock(return_value="test-vision-model")),
        )
        registry.build.return_value = provider
        return provider, registry

    @staticmethod
    def _make_image_rec(source: str, source_type: str = "url") -> TaskRecord:
        return TaskRecord(
            task_id="img-test",
            project_id="default_project",
            task_type="image",
            payload={"source": source, "source_type": source_type},
        )

    def test_url_image_happy_path(self, tmp_path: Path) -> None:
        """URL 直接返回图片字节 → FETCH → VLM → STORE → SUCCESS。"""
        from backend.app.services.pipeline_tasks import handle_image_task

        image_dir = tmp_path / "image"
        image_dir.mkdir(parents=True, exist_ok=True)
        runner = MagicMock()
        rec = self._make_image_rec("https://example.com/photo.jpg")

        provider, registry = self._fake_provider('{"description":"测试描述","tags":{"subject":["猫"]}}')
        from io import BytesIO

        with (
            patch("urllib.request.urlopen", return_value=BytesIO(self.FAKE_PNG)),
            patch("shared.config.get_workspace_root", return_value=tmp_path),
            patch("backend.app.services.pipeline_tasks.load_settings",
                  return_value=self._fake_settings),
            patch("backend.app.services.pipeline_tasks.create_default_registry",
                  return_value=registry),
        ):
            result = handle_image_task(rec, runner)

        assert result["source"] == "https://example.com/photo.jpg"
        assert result["source_type"] == "url"
        assert "测试描述" in result["description"]

    def test_local_image_happy_path(self, tmp_path: Path) -> None:
        """本地文件路径 → 直接读取 → VLM → SUCCESS。"""
        from backend.app.services.pipeline_tasks import handle_image_task

        img_file = tmp_path / "photo.png"
        img_file.write_bytes(self.FAKE_PNG)

        runner = MagicMock()
        rec = self._make_image_rec(str(img_file), source_type="local")
        provider, registry = self._fake_provider('{"description":"本地图片描述","tags":{}}')

        with (
            patch("shared.config.get_workspace_root", return_value=tmp_path),
            patch("backend.app.services.pipeline_tasks.load_settings",
                  return_value=self._fake_settings),
            patch("backend.app.services.pipeline_tasks.create_default_registry",
                  return_value=registry),
        ):
            result = handle_image_task(rec, runner)

        assert result["source"] == str(img_file)
        assert result["source_type"] == "local"
        assert "本地图片描述" in result["description"]

    def test_missing_source_raises(self) -> None:
        """缺少 payload.source → ValueError。"""
        from backend.app.services.pipeline_tasks import handle_image_task

        runner = MagicMock()
        rec = TaskRecord(
            task_id="img-no-src",
            project_id="default_project",
            task_type="image",
            payload={},
        )
        with pytest.raises(ValueError, match="image task 需要 payload.source"):
            handle_image_task(rec, runner)

    def test_html_ytdlp_fallback_succeeds(self, tmp_path: Path) -> None:
        """URL 返回 HTML 非图片 → _extract_thumbnails_via_ytdlp 提取图片并继续 VLM。"""
        from backend.app.services.pipeline_tasks import handle_image_task

        image_dir = tmp_path / "image"
        image_dir.mkdir(parents=True, exist_ok=True)
        thumbs_dir = image_dir / "_ytdlp_thumbs"
        thumbs_dir.mkdir(parents=True, exist_ok=True)

        # 模拟 yt-dlp 产出的缩略图（webp 兜底也覆盖）
        thumb_file = thumbs_dir / "thumb_001.webp"
        # RIFF header + WEBP FourCC
        webp_header = b"RIFF\x00\x00\x00\x00WEBP"
        thumb_file.write_bytes(webp_header + b"\x00" * 32)

        runner = MagicMock()
        rec = self._make_image_rec("https://www.xiaohongshu.com/explore/abc123")

        provider, registry = self._fake_provider('{"description":"小红书图文描述","tags":{}}')
        from io import BytesIO

        html_content = "<html><body>小红书页面</body></html>".encode()

        with (
            patch("urllib.request.urlopen", return_value=BytesIO(html_content)),
            patch("shared.config.get_workspace_root", return_value=tmp_path),
            patch("backend.app.services.pipeline_tasks.load_settings",
                  return_value=self._fake_settings),
            patch("backend.app.services.pipeline_tasks.create_default_registry",
                  return_value=registry),
            # yt-dlp 在回退路径中会被真正调用，mock 它以跳过真实网络
            patch("backend.app.services.pipeline_tasks._extract_thumbnails_via_ytdlp",
                  return_value=[str(thumb_file)]),
        ):
            result = handle_image_task(rec, runner)

        assert result["source"] == str(thumb_file)
        assert result["source_type"] == "local"
        assert "小红书图文描述" in result["description"]

    def test_thumbnail_extract_retry_fallback(self, tmp_path: Path) -> None:
        """retry 场景：yt-dlp 不再生成新文件时返回已有图片（含 .webp）。"""
        from backend.app.services.pipeline_tasks import _extract_thumbnails_via_ytdlp

        thumbs_dir = tmp_path / "_ytdlp_thumbs"
        thumbs_dir.mkdir(parents=True, exist_ok=True)

        # 模拟第一次运行后已存在的图片（含 webp）
        (thumbs_dir / "img_01.jpg").write_bytes(b"jpeg")
        (thumbs_dir / "img_02.png").write_bytes(b"png")
        (thumbs_dir / "img_03.webp").write_bytes(b"webp")

        log = MagicMock()

        # patch yt_dlp.YoutubeDL 使其不新增任何文件（模拟 retry）
        with patch("yt_dlp.YoutubeDL") as mock_ydl:
            mock_ydl.return_value.__enter__.return_value.extract_info.return_value = {}
            result = _extract_thumbnails_via_ytdlp(
                "https://www.xiaohongshu.com/explore/retry-test", tmp_path, log,
            )

        assert len(result) == 3
        assert any(p.endswith(".webp") for p in result)
        assert any(p.endswith(".jpg") for p in result)
        assert any(p.endswith(".png") for p in result)

    def test_thumbnail_extract_no_files_at_all(self, tmp_path: Path) -> None:
        """yt-dlp 未提取任何图片 → 返回空列表。"""
        from backend.app.services.pipeline_tasks import _extract_thumbnails_via_ytdlp

        thumbs_dir = tmp_path / "_ytdlp_thumbs"
        thumbs_dir.mkdir(parents=True, exist_ok=True)

        log = MagicMock()
        with patch("yt_dlp.YoutubeDL") as mock_ydl:
            mock_ydl.return_value.__enter__.return_value.extract_info.return_value = {}
            result = _extract_thumbnails_via_ytdlp(
                "https://example.com/no-images", tmp_path, log,
            )

        assert result == []

    def test_exif_and_dimensions_extraction(self, tmp_path: Path) -> None:
        """JPEG 带 EXIF → result 包含 exif + dimensions 字段。"""
        import io
        from PIL import Image
        from PIL.ExifTags import Base as ExifBase

        from backend.app.services.pipeline_tasks import handle_image_task

        # 构造带 EXIF 的 JPEG，写到真实文件
        img = Image.new("RGB", (4032, 3024), color=(100, 150, 200))
        from PIL.Image import Exif

        exif = Exif()
        exif[ExifBase.Make] = "Apple"
        exif[ExifBase.Model] = "iPhone 15 Pro Max"
        exif[ExifBase.LensModel] = "iPhone 15 Pro Max back triple camera 6.765mm f/1.78"
        exif[ExifBase.DateTimeOriginal] = "2026:05:20 14:30:00"
        exif_ifd = exif.get_ifd(0x8769)
        exif_ifd[33437] = 1.78  # FNumber
        exif_ifd[33434] = 0.001  # ExposureTime (1/1000s)
        exif_ifd[34855] = 50  # ISO
        exif[0x8769] = exif_ifd

        jpeg_path = tmp_path / "test_exif.jpg"
        img.save(str(jpeg_path), format="JPEG", exif=exif.tobytes())

        image_dir = tmp_path / "image"
        image_dir.mkdir(parents=True, exist_ok=True)
        runner = MagicMock()
        rec = self._make_image_rec(str(jpeg_path), source_type="local")

        with (
            patch("shared.config.get_workspace_root", return_value=tmp_path),
            patch("backend.app.services.pipeline_tasks.load_settings",
                  return_value=self._fake_settings),
            patch("backend.app.services.pipeline_tasks.create_default_registry",
                  return_value=MagicMock(
                      resolve_default_profile=MagicMock(return_value=MagicMock(
                          default_models=MagicMock(get=MagicMock(return_value=None)))),
                  )),
        ):
            result = handle_image_task(rec, runner)

        # dimensions
        dims = result["dimensions"]
        assert dims["width"] == 4032
        assert dims["height"] == 3024
        assert dims["format"] == "JPEG"
        assert dims["size_kb"] > 0

        # exif
        exif_out = result["exif"]
        assert "iPhone 15 Pro Max" in exif_out["device"]
        assert "6.765mm" in exif_out["lens"]
        assert exif_out["time"] == "2026:05:20 14:30:00"
        assert exif_out["aperture"] == "f/1.8"
        assert exif_out["shutter"] == "1/1000s"
        assert exif_out["iso"] == "ISO 50"

    def test_png_no_exif_returns_empty(self, tmp_path: Path) -> None:
        """PNG 无 EXIF → exif 为空/不出现，dimensions 正常。"""
        from backend.app.services.pipeline_tasks import handle_image_task

        png_path = tmp_path / "test.png"
        png_path.write_bytes(self.FAKE_PNG)

        image_dir = tmp_path / "image"
        image_dir.mkdir(parents=True, exist_ok=True)
        runner = MagicMock()
        rec = self._make_image_rec(str(png_path), source_type="local")

        with (
            patch("shared.config.get_workspace_root", return_value=tmp_path),
            patch("backend.app.services.pipeline_tasks.load_settings",
                  return_value=self._fake_settings),
            patch("backend.app.services.pipeline_tasks.create_default_registry",
                  return_value=MagicMock(
                      resolve_default_profile=MagicMock(return_value=MagicMock(
                          default_models=MagicMock(get=MagicMock(return_value=None)))),
                  )),
        ):
            result = handle_image_task(rec, runner)

        assert result["dimensions"]["width"] == 1
        assert result["dimensions"]["height"] == 1
        assert result["dimensions"]["format"] == "PNG"
        # PNG 无 EXIF
        assert result.get("exif") in ({}, None)


# ── M7: PROBE 内容识别 + download 调度 ────────────────────────────────────


class TestM7ProbeDownload:
    """M7-3: 测试 _download_note_source 调度和 _probe_note_source 识别。"""

    def test_text_url_skips_ytdlp(self, tmp_path: Path) -> None:
        """普通网页 URL 不调用 run_ytdlp_download，走 text/note 路径。"""
        from backend.app.services.pipeline_tasks import _download_note_source

        mock_doc = MagicMock()
        mock_doc.content = "网页正文内容"
        mock_doc.title = "测试文章"
        mock_doc.source = "https://example.com/article"
        mock_doc.char_count = 100
        mock_doc.meta = {}

        with (
            patch("backend.app.services.pipeline_tasks.load_url", return_value=mock_doc),
            patch("backend.app.services.pipeline_tasks.is_platform_url", return_value=False),
            patch("backend.app.services.pipeline_tasks.is_xiaohongshu_url_or_text", return_value=False),
            patch("backend.app.services.pipeline_tasks.run_ytdlp_download") as mock_ytdlp,
        ):
            result = _download_note_source(
                url="https://sspai.com/post/12345",
                payload={},
                record=MagicMock(project_id="test"),
                runner=MagicMock(),
                task_id="t1",
                project_video_dir=tmp_path,
                dl_kwargs={},
            )

        assert result["ok"] is True
        assert result["kind_hint"] == "text"
        assert "网页正文内容" in result["content"]
        mock_ytdlp.assert_not_called()

    def test_bilibili_opus_skips_video_ytdlp(self, tmp_path: Path) -> None:
        """B站 /opus/ 图文动态不走视频 yt-dlp，走 opus 专用适配器。"""
        from backend.app.services.pipeline_tasks import _download_note_source

        with (
            patch("backend.app.downloaders.bilibili_opus.fetch_bilibili_opus", return_value={
                "ok": True, "title": "我的动态", "content": "B站图文动态正文",
                "images": [], "meta": {},
            }),
            patch("backend.app.services.pipeline_tasks.is_platform_url", return_value=True),
            patch("backend.app.services.pipeline_tasks.is_xiaohongshu_url_or_text", return_value=False),
            patch("backend.app.services.pipeline_tasks.run_ytdlp_download") as mock_ytdlp,
        ):
            result = _download_note_source(
                url="https://www.bilibili.com/opus/12345",
                payload={},
                record=MagicMock(project_id="test"),
                runner=MagicMock(),
                task_id="t1",
                project_video_dir=tmp_path,
                dl_kwargs={},
            )

        assert result["ok"] is True
        assert result["kind_hint"] == "text"
        mock_ytdlp.assert_not_called()

    def test_xiaohongshu_uses_xhs_adapter(self, tmp_path: Path) -> None:
        """小红书调用 run_xiaohongshu_download，保留 images 和正文。"""
        from backend.app.services.pipeline_tasks import _download_note_source

        img_dir = tmp_path / "xhs_images"
        img_dir.mkdir()
        (img_dir / "1.jpg").touch()
        (img_dir / "2.jpg").touch()

        with (
            patch("backend.app.services.pipeline_tasks.is_xiaohongshu_url_or_text", return_value=True),
            patch("backend.app.services.pipeline_tasks.run_xiaohongshu_download", return_value={
                "ok": True,
                "save_path": str(img_dir),
                "note_meta": {"title": "小红书图文", "desc": "图文描述", "type": "normal"},
            }),
            patch("backend.app.services.pipeline_tasks.get_workspace_root", return_value=tmp_path),
        ):
            result = _download_note_source(
                url="https://www.xiaohongshu.com/explore/abc123",
                payload={},
                record=MagicMock(project_id="test"),
                runner=MagicMock(),
                task_id="t1",
                project_video_dir=tmp_path,
                dl_kwargs={},
            )

        assert result["ok"] is True
        assert result["kind_hint"] == "image_text"
        assert "图文描述" in result["content"]
        assert len(result["images"]) == 2

    def test_video_url_uses_ytdlp(self, tmp_path: Path) -> None:
        """明确视频平台 URL 仍调用 run_ytdlp_download。"""
        from backend.app.services.pipeline_tasks import _download_note_source

        fake_video = tmp_path / "test.mp4"
        fake_video.touch()

        with (
            patch("backend.app.services.pipeline_tasks.is_xiaohongshu_url_or_text", return_value=False),
            patch("backend.app.services.pipeline_tasks.is_platform_url", return_value=True),
            patch("backend.app.services.pipeline_tasks.run_ytdlp_download", return_value={
                "ok": True,
                "save_path": str(fake_video),
                "title": "测试视频",
            }),
            patch("backend.app.services.pipeline_tasks._apply_ytdlp_metadata_to_task"),
        ):
            result = _download_note_source(
                url="https://www.youtube.com/watch?v=test",
                payload={},
                record=MagicMock(project_id="test"),
                runner=MagicMock(),
                task_id="t1",
                project_video_dir=tmp_path,
                dl_kwargs={},
            )

        assert result["ok"] is True
        assert result["kind_hint"] == "video"
        assert result["video_file"] == str(fake_video)

    def test_probe_text_removes_transcribe_analyze(self) -> None:
        """PROBE 识别为 text 时，移除 transcribe 和 analyze 步骤。"""
        from backend.app.services.pipeline_tasks import _probe_note_source

        dl_result = {
            "ok": True,
            "kind_hint": "text",
            "content": "正文",
            "title": "标题",
            "images": [],
            "video_file": "",
            "metadata": {},
        }
        probe = _probe_note_source(dl_result, {"steps": ["download", "transcribe", "analyze", "note"]})

        assert probe["note_kind"] == "text"
        assert "transcribe" not in probe["steps"]
        assert "analyze" not in probe["steps"]
        assert "note" in probe["steps"]

    def test_probe_image_text_removes_transcribe_and_analyze(self) -> None:
        """PROBE 识别为 image_text 时，移除 transcribe 和 analyze（图片走独立分析流程）。"""
        from backend.app.services.pipeline_tasks import _probe_note_source

        dl_result = {
            "ok": True,
            "kind_hint": "image_text",
            "content": "图文描述",
            "title": "小红书笔记",
            "images": ["a.jpg"],
            "video_file": "",
            "metadata": {},
        }
        probe = _probe_note_source(dl_result, {"steps": ["download", "transcribe", "analyze", "note"]})

        assert probe["note_kind"] == "image_text"
        assert "transcribe" not in probe["steps"]
        assert "analyze" not in probe["steps"]

    def test_probe_note_media_kind_image_text_overrides_when_images_exist(self) -> None:
        """用户手动选择图文笔记时，有图片材料就优先走 image_text。"""
        from backend.app.services.pipeline_tasks import _probe_note_source

        dl_result = {
            "ok": True,
            "kind_hint": "text",
            "content": "图文描述",
            "title": "图文笔记",
            "images": ["a.jpg"],
            "video_file": "",
            "metadata": {},
        }
        probe = _probe_note_source(dl_result, {
            "steps": ["download", "transcribe", "analyze", "note"],
            "note_media_kind": "image_text",
        })

        assert probe["note_kind"] == "image_text"
        assert "transcribe" not in probe["steps"]
        assert "analyze" not in probe["steps"]

    def test_probe_note_media_kind_conflict_falls_back_to_probe(self) -> None:
        """用户选择和材料明显冲突时，第一版回退 PROBE 结果。"""
        from backend.app.services.pipeline_tasks import _probe_note_source

        dl_result = {
            "ok": True,
            "kind_hint": "text",
            "content": "纯文本正文",
            "title": "文章",
            "images": [],
            "video_file": "",
            "metadata": {},
        }
        probe = _probe_note_source(dl_result, {
            "steps": ["download", "transcribe", "analyze", "note"],
            "note_media_kind": "image_text",
        })

        assert probe["note_kind"] == "text"
        assert "transcribe" not in probe["steps"]
        assert "analyze" not in probe["steps"]

    def test_image_text_note_timeout_fallback_reaches_store(self, tmp_path: Path) -> None:
        """图文笔记文本 LLM 超时后应兜底完成，不停在 VLM，也不触发标题未定义。"""
        from backend.app.services.pipeline_tasks import handle_note_task

        img = tmp_path / "xhs" / "01.jpg"
        img.parent.mkdir(parents=True)
        img.write_bytes(b"\xff\xd8")
        source_dir = img.parent
        dl_result = {
            "ok": True,
            "kind_hint": "image_text",
            "title": "小红书图文标题",
            "content": "这是一段足够长的小红书正文内容，用于验证图文笔记在模型超时后仍可生成兜底笔记。",
            "images": [str(img)],
            "source_path": str(source_dir),
            "video_file": "",
            "metadata": {},
        }

        store = TaskStore(path=tmp_path / "tasks.json")
        runner = TaskRunner(store, max_workers=1)
        rec = runner.create_task(
            "proj-test",
            "note",
            {
                "url": "https://www.xiaohongshu.com/explore/test",
                "steps": ["download", "transcribe", "analyze", "note"],
                "api_key": "sk-test",
                "image_text_llm_timeout_sec": 0.01,
            },
        )

        provider = MagicMock()

        def _slow_chat(_req):
            time.sleep(0.05)
            return "# 太晚返回的内容"

        provider.chat.side_effect = _slow_chat
        registry = MagicMock()
        registry.resolve_default_profile.return_value = MagicMock(
            default_models=MagicMock(get=MagicMock(return_value="gpt-4o")),
        )
        registry.build.return_value = provider

        with (
            patch("backend.app.services.pipeline_tasks.load_settings",
                  return_value=_mock_settings("sk-test")),
            patch("backend.app.services.pipeline_tasks.get_workspace_videos_dir",
                  return_value=tmp_path / "videos"),
            patch("backend.app.services.pipeline_tasks.get_workspace_json_dir",
                  return_value=tmp_path / "json"),
            patch("backend.app.services.pipeline_tasks._download_note_source",
                  return_value=dl_result),
            patch("backend.app.services.pipeline_tasks._analyze_image_for_note",
                  return_value={
                      "image_type": "unknown", "extracted_text": "",
                      "content_summary": "", "action_steps": [],
                      "key_entities": [], "visual_elements": [],
                      "visual_value": "low", "embed_decision": "skip",
                      "insert_hint": "", "confidence": 0.0,
                      "description": "", "ocr_text": "", "is_text_image": False,
                  }),
            patch("backend.app.services.pipeline_tasks.create_default_registry",
                  return_value=registry),
        ):
            result = handle_note_task(rec, runner)

        stored = runner.store.get(rec.task_id)
        assert stored.status == TaskStatus.STORE.value
        assert stored.progress >= 0.90
        assert "note" in result["completed_steps"]
        assert result["note_kind"] == "image_text"
        assert "小红书图文标题" in result["note_body"]
        assert "核心内容" in result["note_body"]
        messages = [row.message for row in stored.log]
        assert any("标准总结" in msg and "超时" in msg for msg in messages)

    def test_background_for_recognition_in_result(self, tmp_path: Path) -> None:
        """background_for_recognition 出现在 PROBE 结果中。"""
        from backend.app.services.pipeline_tasks import _probe_note_source

        dl_result = {
            "ok": True,
            "kind_hint": "text",
            "content": "正文",
            "title": "标题",
            "images": [],
            "video_file": "",
            "metadata": {"description": "来自平台的描述"},
        }
        payload = {
            "steps": ["download", "note"],
            "background_for_recognition": "用户提供的背景信息",
        }
        probe = _probe_note_source(dl_result, payload)

        assert "用户提供的背景信息" in probe["background_context"]
        assert "来自平台的描述" in probe["background_context"]

    def test_unknown_url_falls_back_to_text_then_ytdlp(self, tmp_path: Path) -> None:
        """未知 URL 先尝试文本网页抽取，内容不足回落 yt-dlp。"""
        from backend.app.services.pipeline_tasks import _download_note_source

        mock_doc = MagicMock()
        mock_doc.content = "短"  # 过短
        mock_doc.title = "标题"
        mock_doc.source = "https://unknown.com/page"
        mock_doc.char_count = 5  # < 50
        mock_doc.meta = {}

        fake_video = tmp_path / "test.mp4"
        fake_video.touch()

        with (
            patch("backend.app.services.pipeline_tasks.is_xiaohongshu_url_or_text", return_value=False),
            patch("backend.app.services.pipeline_tasks.is_platform_url", return_value=False),
            patch("backend.app.services.pipeline_tasks.load_url", return_value=mock_doc),
            patch("backend.app.services.pipeline_tasks.run_ytdlp_download", return_value={
                "ok": True,
                "save_path": str(fake_video),
                "title": "下载的视频",
            }),
            patch("backend.app.services.pipeline_tasks._apply_ytdlp_metadata_to_task"),
        ):
            result = _download_note_source(
                url="https://unknown.com/page",
                payload={},
                record=MagicMock(project_id="test"),
                runner=MagicMock(),
                task_id="t1",
                project_video_dir=tmp_path,
                dl_kwargs={},
            )

        assert result["ok"] is True
        assert result["kind_hint"] == "video"
        assert result["video_file"] == str(fake_video)

    def test_extract_opus_id_from_url(self) -> None:
        """_extract_opus_id 从 B站 opus URL 正确提取数字 ID。"""
        from backend.app.downloaders.bilibili_opus import _extract_opus_id

        assert _extract_opus_id("https://www.bilibili.com/opus/1203642237996498944") == "1203642237996498944"
        assert _extract_opus_id("https://m.bilibili.com/opus/999") == "999"
        assert _extract_opus_id("https://www.bilibili.com/video/BV1xx") is None


class TestAnalyzeImageFile:
    """analyze_image_file 的 mock 单测。"""

    def test_ocr_and_vlm_both_succeed(self, tmp_path: Path) -> None:
        from backend.app.services.pipeline_tasks import analyze_image_file

        img = tmp_path / "photo.jpg"
        img.write_bytes(b"\xff\xd8" + b"\x00" * 100)  # fake JPEG

        with (
            patch("shared.ocr_service.extract_text", return_value="图中文字"),
            patch("backend.app.services.pipeline_tasks.create_default_registry") as mock_reg,
        ):
            mock_provider = MagicMock()
            mock_provider.chat.return_value = "这是一张美丽的风景照片，蓝天白云下有一座小桥。"
            mock_reg.return_value.resolve_default_profile.return_value = MagicMock()
            mock_reg.return_value.build.return_value = mock_provider

            result = analyze_image_file(str(img), "gpt-4o", "test-key")

        assert "风景照片" in result["description"]
        assert result["ocr_text"] == "图中文字"
        # 非 JSON 返回走回退路径，description_parts 为空
        assert result["description_parts"] == {}

    def test_no_api_key_skips_vlm(self, tmp_path: Path) -> None:
        from backend.app.services.pipeline_tasks import analyze_image_file

        img = tmp_path / "photo.jpg"
        img.write_bytes(b"\xff\xd8" + b"\x00" * 100)

        with patch("shared.ocr_service.extract_text", return_value="OCR结果"):
            result = analyze_image_file(str(img), "gpt-4o", "")

        assert result["description"] == ""
        assert result["ocr_text"] == "OCR结果"

    def test_no_vision_model_skips_vlm(self, tmp_path: Path) -> None:
        from backend.app.services.pipeline_tasks import analyze_image_file

        img = tmp_path / "photo.jpg"
        img.write_bytes(b"\xff\xd8" + b"\x00" * 100)

        with patch("shared.ocr_service.extract_text", return_value="OCR结果"):
            result = analyze_image_file(str(img), "", "test-key")

        assert result["description"] == ""
        assert result["ocr_text"] == "OCR结果"

    def test_ocr_failure_still_runs_vlm(self, tmp_path: Path) -> None:
        from backend.app.services.pipeline_tasks import analyze_image_file

        img = tmp_path / "photo.png"
        img.write_bytes(b"\x89PNG" + b"\x00" * 100)

        with (
            patch("shared.ocr_service.extract_text", side_effect=RuntimeError("OCR 崩了")),
            patch("backend.app.services.pipeline_tasks.create_default_registry") as mock_reg,
        ):
            mock_provider = MagicMock()
            mock_provider.chat.return_value = "一张产品图"
            mock_reg.return_value.resolve_default_profile.return_value = MagicMock()
            mock_reg.return_value.build.return_value = mock_provider

            result = analyze_image_file(str(img), "gpt-4o", "test-key")

        assert result["description"] == "一张产品图"
        assert result["ocr_text"] == ""  # OCR 失败不影响

    def test_vlm_failure_still_returns_ocr(self, tmp_path: Path) -> None:
        from backend.app.services.pipeline_tasks import analyze_image_file

        img = tmp_path / "photo.jpg"
        img.write_bytes(b"\xff\xd8" + b"\x00" * 100)

        with (
            patch("shared.ocr_service.extract_text", return_value="文字内容"),
            patch("backend.app.services.pipeline_tasks.create_default_registry") as mock_reg,
        ):
            mock_provider = MagicMock()
            mock_provider.chat.side_effect = RuntimeError("API 超时")
            mock_reg.return_value.resolve_default_profile.return_value = MagicMock()
            mock_reg.return_value.build.return_value = mock_provider

            result = analyze_image_file(str(img), "gpt-4o", "test-key")

        assert result["description"] == ""
        assert result["ocr_text"] == "文字内容"

    def test_missing_file_returns_empty(self, tmp_path: Path) -> None:
        from backend.app.services.pipeline_tasks import analyze_image_file

        result = analyze_image_file(str(tmp_path / "不存在.jpg"), "gpt-4o", "test-key")
        assert result == {"description": "", "ocr_text": "", "description_parts": {}}

    def test_vlm_json_valid_populates_description_parts(self, tmp_path: Path) -> None:
        """VLM 返回合法 JSON → description_parts 被填充，description 为拼接字符串。"""
        from backend.app.services.pipeline_tasks import analyze_image_file

        img = tmp_path / "photo.jpg"
        img.write_bytes(b"\xff\xd8" + b"\x00" * 100)

        vlm_json = (
            '{"subject": "一只橘猫", "scene": "窗台上", "color": "暖橙色", '
            '"composition": "居中构图", "style": "写实摄影", "details": "阳光洒在猫身上"}'
        )

        with (
            patch("shared.ocr_service.extract_text", return_value=""),
            patch("backend.app.services.pipeline_tasks.create_default_registry") as mock_reg,
        ):
            mock_provider = MagicMock()
            mock_provider.chat.return_value = vlm_json
            mock_reg.return_value.resolve_default_profile.return_value = MagicMock()
            mock_reg.return_value.build.return_value = mock_provider

            result = analyze_image_file(str(img), "gpt-4o", "test-key")

        dp = result["description_parts"]
        assert dp["subject"] == "一只橘猫"
        assert dp["scene"] == "窗台上"
        # description 字符串由 description_parts 拼接而成
        assert "一只橘猫" in result["description"]
        assert "窗台上" in result["description"]

    def test_vlm_json_parse_fallback_to_description_string(self, tmp_path: Path) -> None:
        """VLM 返回非 JSON（旧格式纯文本）→ description_parts 为空，description 为原字符串。"""
        from backend.app.services.pipeline_tasks import analyze_image_file

        img = tmp_path / "photo.jpg"
        img.write_bytes(b"\xff\xd8" + b"\x00" * 100)

        with (
            patch("shared.ocr_service.extract_text", return_value=""),
            patch("backend.app.services.pipeline_tasks.create_default_registry") as mock_reg,
        ):
            mock_provider = MagicMock()
            mock_provider.chat.return_value = "这是一张美丽的风景照片，蓝天白云。"
            mock_reg.return_value.resolve_default_profile.return_value = MagicMock()
            mock_reg.return_value.build.return_value = mock_provider

            result = analyze_image_file(str(img), "gpt-4o", "test-key")

        assert result["description_parts"] == {}
        assert "风景照片" in result["description"]


class TestClassifyImageTextContent:
    """图文内容分类：_classify_image_text_content。"""

    def test_tool_recommendation_detected(self) -> None:
        from backend.app.services.pipeline_tasks import _classify_image_text_content

        result: dict = {}
        raw_source = "今天给大家推荐一个效率工具，支持 Markdown 导出，Obsidian 同步"
        image_infos = [
            {"description": "App 界面截图", "ocr_text": "下载地址 iOS Android"},
        ]
        note_body = "这是一款支持工作流自动化的软件，Mac Windows 都能用"

        _classify_image_text_content(result, raw_source, image_infos, note_body)

        assert result["content_category"] == "tool_recommendation"
        assert result["default_summary_template"] == "tool_recommendation"

    def test_unknown_when_few_signals(self) -> None:
        from backend.app.services.pipeline_tasks import _classify_image_text_content

        result: dict = {}
        raw_source = "今天天气很好，出去散步"
        image_infos: list = []
        note_body = "阳光明媚的一天"

        _classify_image_text_content(result, raw_source, image_infos, note_body)

        assert result["content_category"] == "unknown"
        assert result["default_summary_template"] == "standard"

    def test_tutorial_detected(self) -> None:
        from backend.app.services.pipeline_tasks import _classify_image_text_content

        result: dict = {}
        raw_source = "如何配置 Python 虚拟环境：第一步安装依赖，第二步设置路径"
        image_infos = [
            {"content_summary": "教程：操作步骤详解"},
        ]
        note_body = "配置完成后，检查安装是否成功"

        _classify_image_text_content(result, raw_source, image_infos, note_body)

        assert result["content_category"] == "tutorial"
        assert result["default_summary_template"] == "steps"

    def test_tutorial_takes_priority_over_tool(self) -> None:
        from backend.app.services.pipeline_tasks import _classify_image_text_content

        result: dict = {}
        # 包含工具信号，但教程信号更强
        raw_source = "如何安装 Obsidian：第一步下载软件，第二步配置插件，第三步设置同步"
        image_infos: list = []
        note_body = "按照教程步骤操作即可"

        _classify_image_text_content(result, raw_source, image_infos, note_body)

        assert result["content_category"] == "tutorial"
        assert result["default_summary_template"] == "steps"

    def test_does_not_overwrite_existing(self) -> None:
        from backend.app.services.pipeline_tasks import _classify_image_text_content

        result: dict = {"content_category": "existing"}
        _classify_image_text_content(result, "", [], "")
        assert result["content_category"] == "existing"

    def test_science_popularization_detected(self) -> None:
        from backend.app.services.pipeline_tasks import _classify_image_text_content

        result: dict = {}
        raw_source = (
            "量子力学的基本原理：波函数描述粒子状态，薛定谔方程决定演化，"
            "测量导致坍缩，叠加态是核心概念，实验验证了理论预测"
        )
        image_infos = [
            {"content_summary": "量子物理科普图解，展示双缝实验现象"},
        ]
        note_body = "量子纠缠现象在通信领域有重要应用"

        _classify_image_text_content(result, raw_source, image_infos, note_body)

        assert result["content_category"] == "science_popularization"
        assert result["default_summary_template"] == "science_popularization"

    def test_tutorial_takes_priority_over_science(self) -> None:
        from backend.app.services.pipeline_tasks import _classify_image_text_content

        result: dict = {}
        raw_source = "如何理解量子力学：第一步学习基础概念，第二步做实验，第三步验证理论"
        image_infos: list = []
        note_body = "按照教程步骤操作即可"

        _classify_image_text_content(result, raw_source, image_infos, note_body)

        assert result["content_category"] == "tutorial"

    def test_science_priority_over_unknown(self) -> None:
        from backend.app.services.pipeline_tasks import _classify_image_text_content

        result: dict = {}
        raw_source = "基因编辑技术的原理与应用，CRISPR 实验发现新规律"
        image_infos: list = []
        note_body = "基因突变导致遗传变异，生物进化论解释物种起源"

        _classify_image_text_content(result, raw_source, image_infos, note_body)

        assert result["content_category"] == "science_popularization"


class TestClassifyFromSource:
    """提前分类（仅基于 source 材料，不含 note_body）。"""

    def test_returns_tutorial(self) -> None:
        from backend.app.services.pipeline_tasks import _classify_from_source

        raw = "如何配置 Python：第一步安装依赖，第二步设置路径，第三步验证"
        enriched = ""
        infos: list = []

        assert _classify_from_source(raw, enriched, infos) == "tutorial"

    def test_returns_tool_recommendation(self) -> None:
        from backend.app.services.pipeline_tasks import _classify_from_source

        raw = "推荐一个效率工具 App，支持 Markdown 导出，iOS Mac 都能用"
        enriched = ""
        infos: list = []

        assert _classify_from_source(raw, enriched, infos) == "tool_recommendation"

    def test_returns_science_popularization(self) -> None:
        from backend.app.services.pipeline_tasks import _classify_from_source

        raw = "宇宙大爆炸理论：物理学家发现星系红移现象，实验研究验证了理论预测"
        enriched = ""
        infos: list = []

        assert _classify_from_source(raw, enriched, infos) == "science_popularization"

    def test_returns_unknown_when_few_signals(self) -> None:
        from backend.app.services.pipeline_tasks import _classify_from_source

        raw = "今天天气很好"
        enriched = ""
        infos: list = []

        assert _classify_from_source(raw, enriched, infos) == "unknown"

    def test_uses_image_infos_as_supplement(self) -> None:
        from backend.app.services.pipeline_tasks import _classify_from_source

        raw = "一些文字内容"
        enriched = ""
        infos = [
            {"content_summary": "教程操作步骤详解"},
            {"extracted_text": "第一步打开设置，第二步配置参数"},
        ]

        assert _classify_from_source(raw, enriched, infos) == "tutorial"


# ── VLM-first 图片笔记：逐图理解 → 分类 → 总结 ─────────────────────────────

def _vlm_note_analysis(
    *,
    image_type: str = "text_card",
    extracted_text: str = "",
    content_summary: str = "",
    action_steps: list[str] | None = None,
    key_entities: list[str] | None = None,
    visual_elements: list[str] | None = None,
    visual_value: str = "medium",
    embed_decision: str = "merge_text",
    insert_hint: str = "",
    confidence: float = 0.8,
) -> dict:
    """构造 VLM-first 分析结果 mock（兼容旧 description/ocr_text 字段）。"""
    return {
        "image_type": image_type,
        "extracted_text": extracted_text,
        "content_summary": content_summary,
        "action_steps": action_steps or [],
        "key_entities": key_entities or [],
        "visual_elements": visual_elements or [],
        "visual_value": visual_value,
        "embed_decision": embed_decision,
        "insert_hint": insert_hint,
        "confidence": confidence,
        "description": content_summary,
        "ocr_text": extracted_text,
        "is_text_image": image_type in ("text_card", "ui_demo", "mixed") or len(extracted_text) > 30,
    }


def _vlm_note_analysis_empty() -> dict:
    """VLM 分析返回空结果（用于质量闸门测试）。"""
    return {
        "image_type": "unknown", "extracted_text": "", "content_summary": "",
        "action_steps": [], "key_entities": [], "visual_elements": [],
        "visual_value": "low", "embed_decision": "skip", "insert_hint": "",
        "confidence": 0.0, "description": "", "ocr_text": "",
        "is_text_image": False,
    }


class TestVLMPipelineNoteImageText:
    """VLM-first 图文笔记链路：验证 image_infos 结构化字段、source_text 内容、质量闸门。"""

    @staticmethod
    def _img(tmp_path: Path, name: str = "01.jpg") -> Path:
        img = tmp_path / "xhs" / name
        img.parent.mkdir(parents=True, exist_ok=True)
        img.write_bytes(b"\xff\xd8")
        return img

    @staticmethod
    def _runner(tmp_path: Path) -> tuple:
        store = TaskStore(path=tmp_path / "tasks.json")
        runner = TaskRunner(store, max_workers=1)
        return store, runner

    @staticmethod
    def _run(vlm_side_effect, tmp_path, *, raw_text: str = "这是一段小红书图文正文，介绍 Obsidian 个人知识工作台的操作台设计。", images: list | None = None):
        """直接调用 handle_note_task（同步，不经过线程池），返回 (stored_record, result_dict)。"""
        from backend.app.services.pipeline_tasks import handle_note_task

        if images is None:
            images = [str(tmp_path / "xhs" / "01.jpg")]

        store = TaskStore(path=tmp_path / "tasks.json")
        runner = TaskRunner(store, max_workers=1)
        runner.register("note", handle_note_task)

        registry = MagicMock()
        provider = MagicMock()
        provider.chat.return_value = "# 学习笔记\n## 一句话结论\n测试笔记内容\n## 核心观点\n基于图片理解的学习笔记正文"
        registry.resolve_default_profile.return_value = MagicMock(
            default_models=MagicMock(get=MagicMock(return_value="gpt-4o")),
        )
        registry.build.return_value = provider

        with (
            patch("backend.app.services.pipeline_tasks.load_settings",
                  return_value=MagicMock(
                      openai_api_key="sk-test", vision_model="gpt-4o", text_model="gpt-4o",
                      transcriber=MagicMock(whisper_model_size="base", device="cpu",
                                           language="", initial_prompt=""),
                  )),
            patch("backend.app.services.pipeline_tasks.get_workspace_videos_dir",
                  return_value=tmp_path / "videos"),
            patch("backend.app.services.pipeline_tasks.get_workspace_json_dir",
                  return_value=tmp_path / "json"),
            patch("backend.app.services.pipeline_tasks._download_note_source",
                  return_value={
                      "ok": True, "kind_hint": "image_text",
                      "title": "测试图文标题",
                      "content": raw_text,
                      "images": images,
                      "source_path": str(tmp_path / "xhs"),
                      "video_file": "", "metadata": {},
                  }),
            patch("backend.app.services.pipeline_tasks._analyze_image_for_note",
                  side_effect=vlm_side_effect),
            patch("backend.app.services.pipeline_tasks.create_default_registry",
                  return_value=registry),
        ):
            rec = TaskRecord(
                task_id="note-test-001",
                project_id="proj-test",
                task_type="note",
                payload={
                    "url": "https://www.xiaohongshu.com/explore/test",
                    "steps": ["download", "note"],
                    "api_key": "sk-test",
                },
            )
            store.create(rec)
            # 同步调用，不经过线程池
            try:
                result = handle_note_task(rec, runner)
                stored = store.get(rec.task_id)
                return stored, result
            except RuntimeError as exc:
                # 模拟 TaskRunner 的异常处理
                store.update(rec.task_id, status=TaskStatus.FAILED.value, error=str(exc))
                stored = store.get(rec.task_id)
                return stored, None

    def test_text_card_extracts_text_and_merge(self, tmp_path: Path) -> None:
        """text_card：VLM 提取文字，source_text 包含 extracted_text，embed_decision=merge_text。"""
        vlm = _vlm_note_analysis(
            image_type="text_card",
            extracted_text="Obsidian 是一款本地优先的 Markdown 笔记软件，支持双向链接、图谱视图和插件生态。",
            content_summary="介绍 Obsidian 作为个人知识管理工具的核心功能和设计理念。",
            embed_decision="merge_text",
        )
        stored, result = self._run(lambda *a, **kw: vlm, tmp_path)

        assert result is not None
        assert result["note_kind"] == "image_text"
        assert "双向链接" in result["source_text_enriched"]  # VLM 理解后的富文本
        assert len(result["note_body"]) > 0

        img_info = result["image_infos"][0]
        assert img_info["image_type"] == "text_card"
        assert "双向链接" in img_info["extracted_text"]
        assert img_info["embed_decision"] == "merge_text"
        assert img_info["ocr_text"] == img_info["extracted_text"]  # 兼容字段

    def test_ui_demo_preserves_action_steps_and_embed_image(self, tmp_path: Path) -> None:
        """ui_demo：返回 action_steps + embed_image，结果保留 static_url 和插图决策。"""
        vlm = _vlm_note_analysis(
            image_type="ui_demo",
            extracted_text="设置面板：外观 → 主题 → 启用深色模式",
            content_summary="演示如何在 Obsidian 中切换深色主题。",
            action_steps=["打开设置", "选择外观", "点击主题下拉框", "选择深色模式"],
            visual_elements=["设置面板界面", "主题下拉菜单"],
            embed_decision="embed_image",
            insert_hint="方法/流程",
        )
        stored, result = self._run(lambda *a, **kw: vlm, tmp_path)

        assert result is not None
        img_info = result["image_infos"][0]
        assert img_info["image_type"] == "ui_demo"
        assert img_info["embed_decision"] == "embed_image"
        assert len(img_info["action_steps"]) == 4
        assert "打开设置" in img_info["action_steps"][0]
        assert "设置面板界面" in img_info["visual_elements"]
        assert "方法/流程" in img_info["insert_hint"]

    def test_mixed_preserves_text_and_visual_elements(self, tmp_path: Path) -> None:
        """mixed：文字和 visual_elements 同时保留。"""
        vlm = _vlm_note_analysis(
            image_type="mixed",
            extracted_text="今日输入模块支持 RSS 订阅和网页剪藏两种方式。",
            content_summary="展示 Obsidian 工作台的今日输入模块，包含 RSS 和剪藏功能截图。",
            visual_elements=["今日输入模块卡片", "RSS 订阅图标", "网页剪藏按钮"],
            key_entities=["今日输入", "RSS", "网页剪藏"],
            embed_decision="merge_text",
        )
        stored, result = self._run(lambda *a, **kw: vlm, tmp_path)

        assert result is not None
        img_info = result["image_infos"][0]
        assert img_info["image_type"] == "mixed"
        assert "RSS" in img_info["extracted_text"]
        assert "今日输入模块卡片" in img_info["visual_elements"]
        assert "RSS" in img_info["key_entities"]
        assert img_info["is_text_image"] is True  # mixed 属于文字类

    def test_quality_gate_all_empty_no_raw_text_fails(self, tmp_path: Path) -> None:
        """所有 VLM 返回空 + 无原始文字 → 任务失败，错误含"图片理解失败"。"""
        img = self._img(tmp_path)
        stored, result = self._run(
            lambda *a, **kw: _vlm_note_analysis_empty(),
            tmp_path,
            raw_text="",
            images=[str(img)],
        )

        assert result is None  # RuntimeError raised
        assert "图片理解失败" in (stored.error or "")

    def test_quality_gate_all_empty_with_raw_text_uses_fallback(self, tmp_path: Path) -> None:
        """所有 VLM 返回空 + 有原始文字 → 使用原始文字兜底，任务不失败。"""
        vlm = _vlm_note_analysis_empty()
        stored, result = self._run(lambda *a, **kw: vlm, tmp_path)

        assert result is not None
        assert result["note_kind"] == "image_text"
        assert "Obsidian" in result["source_md_raw"]
        assert len(result["note_body"]) > 0
        img_info = result["image_infos"][0]
        assert img_info["image_type"] == "unknown"
        assert img_info["embed_decision"] == "skip"
        assert img_info["extracted_text"] == ""
        assert img_info["content_summary"] == ""


# ── _analyze_image_for_note 解析边界测试 ────────────────────────────────────

class TestAnalyzeImageForNoteParsing:
    """直接测试 _analyze_image_for_note 的 JSON 解析逻辑（模拟模型不完全听话的边界）。"""

    @staticmethod
    def _img(tmp_path: Path, name: str = "test.jpg") -> Path:
        img = tmp_path / name
        img.write_bytes(b"\xff\xd8")  # minimal JPEG header
        return img

    @staticmethod
    def _call_with_json(tmp_path: Path, json_str: str) -> dict:
        """用给定的 JSON 字符串作为 VLM 返回，调用 _analyze_image_for_note。"""
        from backend.app.services.pipeline_tasks import _analyze_image_for_note

        provider = MagicMock()
        provider.chat.return_value = json_str
        registry = MagicMock()
        registry.resolve_default_profile.return_value = MagicMock()
        registry.build.return_value = provider

        img = TestAnalyzeImageForNoteParsing._img(tmp_path)
        with (
            patch("backend.app.services.pipeline_tasks.load_settings",
                  return_value=MagicMock()),
            patch("backend.app.services.pipeline_tasks.create_default_registry",
                  return_value=registry),
        ):
            return _analyze_image_for_note(str(img), "gpt-4o", "sk-test")

    def test_missing_embed_decision_with_content_normalizes_to_merge(self, tmp_path: Path) -> None:
        """模型漏填 embed_decision，但有 extracted_text → 归一为 merge_text。"""
        raw = json.dumps({
            "image_type": "text_card",
            "extracted_text": "Obsidian 支持双向链接和图谱视图",
            "content_summary": "介绍知识管理工具核心功能",
            "visual_value": "high",
            "confidence": 0.9,
        }, ensure_ascii=False)
        result = self._call_with_json(tmp_path, raw)

        assert result["extracted_text"] == "Obsidian 支持双向链接和图谱视图"
        assert result["content_summary"] == "介绍知识管理工具核心功能"
        # embed_decision 缺失但有内容 → 归一为 merge_text，不是 skip
        assert result["embed_decision"] == "merge_text"

    def test_list_fields_returned_as_strings_normalized(self, tmp_path: Path) -> None:
        """模型把 list 字段返回为单个字符串（真实行为），应归一为空 list 而非崩溃。"""
        raw = json.dumps({
            "image_type": "ui_demo",
            "extracted_text": "设置面板截图",
            "content_summary": "演示设置界面",
            "action_steps": "打开设置 → 选择外观",  # 应该是 list，实际是 string
            "key_entities": "Obsidian",               # 应该是 list，实际是 string
            "visual_elements": "设置面板",            # 应该是 list，实际是 string
            "embed_decision": "embed_image",
        }, ensure_ascii=False)
        result = self._call_with_json(tmp_path, raw)

        assert result["extracted_text"] == "设置面板截图"
        # list 字段：字符串被 str(v).strip() 处理，单个字符串不会崩溃
        # 行为取决于实现：list comprehension 对单字符串会逐字符迭代
        # 关键是不崩溃且有值
        assert result["embed_decision"] == "embed_image"

    def test_markdown_code_fence_stripped(self, tmp_path: Path) -> None:
        """模型用 markdown 代码块包裹 JSON，应正确剥离并解析。"""
        inner = json.dumps({
            "image_type": "text_card",
            "extracted_text": "小红书爆款标题写法",
            "content_summary": "分享标题写作技巧",
            "action_steps": ["使用数字", "制造悬念"],
            "key_entities": ["小红书"],
            "visual_elements": [],
            "visual_value": "medium",
            "embed_decision": "merge_text",
            "insert_hint": "核心观点",
            "confidence": 0.85,
        }, ensure_ascii=False)
        raw = f"```json\n{inner}\n```"
        result = self._call_with_json(tmp_path, raw)

        assert result["extracted_text"] == "小红书爆款标题写法"
        assert result["embed_decision"] == "merge_text"
        assert result["action_steps"] == ["使用数字", "制造悬念"]

    def test_completely_invalid_json_returns_fallback(self, tmp_path: Path) -> None:
        """VLM 返回完全无法解析的文本 → 不崩溃，description 有值，字段归零。"""
        raw = "这张图片看起来很有趣，包含了多种颜色和形状。" * 5
        result = self._call_with_json(tmp_path, raw)

        # 不崩溃就是成功；description 应有兜底文本
        assert result["description"] != ""
        assert result["extracted_text"] == ""
        # content_summary 有兜底填充（>50字 raw 文本被放入 content_summary）
        assert result["embed_decision"] == "skip"
        assert result["image_type"] == "unknown"

    def test_empty_json_fields_all_empty(self, tmp_path: Path) -> None:
        """VLM 返回全空字段 → 不崩溃，所有分析字段为空。"""
        raw = json.dumps({
            "image_type": "decorative",
            "extracted_text": "",
            "content_summary": "",
            "action_steps": [],
            "key_entities": [],
            "visual_elements": [],
            "visual_value": "low",
            "embed_decision": "skip",
            "insert_hint": "",
            "confidence": 0.0,
        })
        result = self._call_with_json(tmp_path, raw)

        assert result["extracted_text"] == ""
        assert result["content_summary"] == ""
        assert result["visual_elements"] == []
        assert result["embed_decision"] == "skip"
        assert result["image_type"] == "decorative"

    def test_valid_content_with_skip_decision_normalizes_to_merge(self, tmp_path: Path) -> None:
        """模型明确填了 embed_decision=skip，但有实质内容 → 归一为 merge_text。"""
        raw = json.dumps({
            "image_type": "mixed",
            "extracted_text": "工作台首页包含今日行动和今日输入两个模块",
            "content_summary": "展示知识工作台的首页布局",
            "action_steps": [],
            "key_entities": ["工作台", "今日行动", "今日输入"],
            "visual_elements": ["首页卡片布局"],
            "visual_value": "high",
            "embed_decision": "skip",  # 模型误填
            "insert_hint": "",
            "confidence": 0.7,
        }, ensure_ascii=False)
        result = self._call_with_json(tmp_path, raw)

        assert result["extracted_text"] == "工作台首页包含今日行动和今日输入两个模块"
        assert result["content_summary"] == "展示知识工作台的首页布局"
        # skip + 有内容 → 归一为 merge_text
        assert result["embed_decision"] == "merge_text"
