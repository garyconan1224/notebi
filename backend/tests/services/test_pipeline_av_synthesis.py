"""handle_av_synthesis_task 端到端测试（mock LLM + mock 产物文件）。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict
from unittest.mock import MagicMock, patch

import pytest

from backend.app.models.tasks import TaskRecord, TaskStatus


# ── fixtures ──────────────────────────────────────────────────

@pytest.fixture()
def workspace(tmp_path: Path) -> Path:
    """构造一个含帧数据和转写数据的临时 workspace。"""
    project_id = "test-ws-001"
    ws_root = tmp_path / "data" / "workspaces" / project_id
    ws_root.mkdir(parents=True)

    # json_data / <video_dir> / frames / + *_视觉数据.json
    video_dir = ws_root / "json_data" / "demo_分析报告"
    frames_dir = video_dir / "frames"
    frames_dir.mkdir(parents=True)

    # 创建 3 个假帧图片
    for i in range(3):
        (frames_dir / f"{i:03d}.jpg").write_bytes(b"\xff\xd8\xff\xe0")

    frames_json = {
        "video_title": "Python 入门教程",
        "product_name": "Python 入门",
        "global_visual_summary": "Python 基础语法教学",
        "frames": [
            {"timestamp": "00:05", "description_zh": "开场介绍", "image_prompt_en": ""},
            {"timestamp": "01:30", "description_zh": "变量定义", "image_prompt_en": ""},
            {"timestamp": "03:00", "description_zh": "函数演示", "image_prompt_en": ""},
        ],
    }
    (video_dir / "demo_视觉数据.json").write_text(
        json.dumps(frames_json, ensure_ascii=False), encoding="utf-8"
    )

    # audio / <task_id>.json
    audio_dir = ws_root / "audio"
    audio_dir.mkdir(parents=True)

    audio_json = {
        "video_title": "Python 入门教程",
        "uploader": "UP主",
        "duration_sec": 600,
        "transcript_segments": [
            {"start": 0.0, "end": 5.0, "text": "大家好，欢迎来到 Python 教程"},
            {"start": 5.0, "end": 15.0, "text": "今天我们学习变量和数据类型"},
            {"start": 90.0, "end": 100.0, "text": "变量用等号赋值"},
            {"start": 180.0, "end": 190.0, "text": "接下来讲函数定义"},
        ],
        "summary": "",
    }
    (audio_dir / "audio-task-001.json").write_text(
        json.dumps(audio_json, ensure_ascii=False), encoding="utf-8"
    )

    return ws_root


def _make_task(project_id: str) -> TaskRecord:
    """构造 TaskRecord。"""
    return TaskRecord(
        task_id="av-synth-001",
        project_id=project_id,
        task_type="av_synthesis",
        payload={"api_key": "sk-test-fake-key"},
    )


# ── tests ─────────────────────────────────────────────────────

class TestHandleAVSynthesisTask:
    """handle_av_synthesis_task 端到端测试。"""

    def _run_handler(self, workspace: Path, task: TaskRecord) -> Dict[str, Any]:
        """执行 handler，返回结果 dict。"""
        from backend.app.services.pipeline_tasks import handle_av_synthesis_task

        runner = MagicMock()
        runner.store = MagicMock()
        runner.append_log = MagicMock()
        runner.set_progress = MagicMock()

        # mock LLM 调用
        def fake_chat(*args: Any, **kwargs: Any) -> str:
            prompt = args[0] if args else kwargs.get("prompt", "")
            if "章节" in prompt or "JSON" in prompt:
                return json.dumps([
                    {"title": "引言", "start_ts": 0, "end_ts": 15, "frame_indices": [0], "transcript_indices": [0, 1]},
                    {"title": "变量", "start_ts": 15, "end_ts": 120, "frame_indices": [1], "transcript_indices": [2]},
                    {"title": "函数", "start_ts": 120, "end_ts": 300, "frame_indices": [2], "transcript_indices": [3]},
                ], ensure_ascii=False)
            if "摘要" in prompt:
                return "本视频介绍了 Python 基础语法，包括变量定义和函数使用。"
            if "综合" in prompt:
                return "Python 是入门友好的编程语言，本教程覆盖了核心基础概念。"
            return "mock response"

        with patch(
            "backend.app.services.av_synthesis.llm._call_llm",
            side_effect=fake_chat,
        ), patch(
            "backend.app.services.av_synthesis.llm.load_settings",
        ), patch(
            "backend.app.services.pipeline_tasks.load_settings",
        ):
            return handle_av_synthesis_task(task, runner)

    def test_handler_returns_expected_keys(self, workspace: Path):
        """handler 返回值包含所有预期 key。"""
        with patch("backend.app.services.pipeline_tasks.get_workspace_root", return_value=workspace), \
             patch("backend.app.services.pipeline_tasks.get_workspace_json_dir", return_value=workspace / "json_data"):
            task = _make_task("test-ws-001")
            result = self._run_handler(workspace, task)

        assert "av_synthesis_path" in result
        assert "chapter_count" in result
        assert "frame_count" in result
        assert "segment_count" in result
        assert result["chapter_count"] == 3
        assert result["frame_count"] == 3
        assert result["segment_count"] == 4

    def test_output_file_exists(self, workspace: Path):
        """输出 av_synthesis.md 文件存在且非空。"""
        with patch("backend.app.services.pipeline_tasks.get_workspace_root", return_value=workspace), \
             patch("backend.app.services.pipeline_tasks.get_workspace_json_dir", return_value=workspace / "json_data"):
            task = _make_task("test-ws-001")
            self._run_handler(workspace, task)

        out_path = workspace / "av_synthesis.md"
        assert out_path.exists(), "av_synthesis.md 未生成"
        content = out_path.read_text(encoding="utf-8")
        assert len(content) > 100, "av_synthesis.md 内容过短"

    def test_output_contains_sections(self, workspace: Path):
        """输出 Markdown 包含 5 个核心段落。"""
        with patch("backend.app.services.pipeline_tasks.get_workspace_root", return_value=workspace), \
             patch("backend.app.services.pipeline_tasks.get_workspace_json_dir", return_value=workspace / "json_data"):
            task = _make_task("test-ws-001")
            self._run_handler(workspace, task)

        content = (workspace / "av_synthesis.md").read_text(encoding="utf-8")
        for section in ["全局摘要", "关键帧画廊", "章节正文", "字幕原文", "最终综合"]:
            assert f"## {section}" in content, f"缺少 ## {section}"

    def test_output_contains_title(self, workspace: Path):
        """输出 Markdown 包含视频标题。"""
        with patch("backend.app.services.pipeline_tasks.get_workspace_root", return_value=workspace), \
             patch("backend.app.services.pipeline_tasks.get_workspace_json_dir", return_value=workspace / "json_data"):
            task = _make_task("test-ws-001")
            self._run_handler(workspace, task)

        content = (workspace / "av_synthesis.md").read_text(encoding="utf-8")
        assert "Python 入门教程" in content

    def test_missing_frames_raises(self, workspace: Path):
        """帧数据不存在时抛出 FileNotFoundError。"""
        empty_json_dir = workspace / "json_data_empty"
        empty_json_dir.mkdir()

        with patch("backend.app.services.pipeline_tasks.get_workspace_root", return_value=workspace), \
             patch("backend.app.services.pipeline_tasks.get_workspace_json_dir", return_value=empty_json_dir):
            task = _make_task("test-ws-001")
            runner = MagicMock()
            runner.append_log = MagicMock()
            runner.set_progress = MagicMock()

            with patch("backend.app.services.pipeline_tasks.load_settings"):
                from backend.app.services.pipeline_tasks import handle_av_synthesis_task
                with pytest.raises(FileNotFoundError, match="视频分析产物"):
                    handle_av_synthesis_task(task, runner)

    def test_missing_transcript_raises(self, workspace: Path):
        """转写数据不存在时抛出 FileNotFoundError。"""
        empty_audio_dir = workspace / "audio_empty"
        empty_audio_dir.mkdir()

        with patch("backend.app.services.pipeline_tasks.get_workspace_root", return_value=workspace), \
             patch("backend.app.services.pipeline_tasks.get_workspace_json_dir", return_value=workspace / "json_data"):
            # 移动 audio 目录使其为空
            import shutil
            audio_backup = workspace / "audio_backup"
            shutil.move(str(workspace / "audio"), str(audio_backup))

            task = _make_task("test-ws-001")
            runner = MagicMock()
            runner.append_log = MagicMock()
            runner.set_progress = MagicMock()

            with patch("backend.app.services.pipeline_tasks.load_settings"):
                from backend.app.services.pipeline_tasks import handle_av_synthesis_task
                with pytest.raises(FileNotFoundError, match="转写产物"):
                    handle_av_synthesis_task(task, runner)

            # 恢复
            shutil.move(str(audio_backup), str(workspace / "audio"))

    def test_no_api_key_raises(self, workspace: Path):
        """无 API key 时抛出 ValueError。"""
        with patch("backend.app.services.pipeline_tasks.get_workspace_root", return_value=workspace), \
             patch("backend.app.services.pipeline_tasks.get_workspace_json_dir", return_value=workspace / "json_data"):
            task = _make_task("test-ws-001")
            task.payload = {}  # 无 api_key
            runner = MagicMock()
            runner.append_log = MagicMock()
            runner.set_progress = MagicMock()

            mock_settings = MagicMock()
            mock_settings.openai_api_key = ""

            with patch("backend.app.services.pipeline_tasks.load_settings", return_value=mock_settings):
                from backend.app.services.pipeline_tasks import handle_av_synthesis_task
                with pytest.raises(ValueError, match="API key"):
                    handle_av_synthesis_task(task, runner)

    def test_runner_progress_calls(self, workspace: Path):
        """handler 调用了 set_progress 多次（验证进度更新）。"""
        with patch("backend.app.services.pipeline_tasks.get_workspace_root", return_value=workspace), \
             patch("backend.app.services.pipeline_tasks.get_workspace_json_dir", return_value=workspace / "json_data"):
            task = _make_task("test-ws-001")
            runner = MagicMock()
            runner.store = MagicMock()
            runner.append_log = MagicMock()
            runner.set_progress = MagicMock()

            def fake_chat(*args: Any, **kwargs: Any) -> str:
                prompt = args[0] if args else ""
                if "章节" in prompt or "JSON" in prompt:
                    return json.dumps([{"title": "全", "start_ts": 0, "end_ts": 10, "frame_indices": [0], "transcript_indices": [0]}])
                return "摘要文本"

            with patch("backend.app.services.av_synthesis.llm._call_llm", side_effect=fake_chat), \
                 patch("backend.app.services.pipeline_tasks.load_settings"):
                from backend.app.services.pipeline_tasks import handle_av_synthesis_task
                handle_av_synthesis_task(task, runner)

            # set_progress 应被调用至少 5 次（0.05, 0.15, 0.25, 0.50, 0.70, 0.85, 1.0）
            assert runner.set_progress.call_count >= 5
