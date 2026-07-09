"""N7b 路径 3 — Gemini 视频直接分析测试。

覆盖：
  GeminiVideoClient 缺 GEMINI_API_KEY 时构造 raise RuntimeError
  _run_video_model_path 正确调用 client 并映射返回结构
  _gemini_segments_to_transcript 正确映射 segments → VideoResultTranscriptLine[]
  _get_video_model_prompt 按 intent 返回不同 prompt
  PROCESSING→ACTIVE 轮询逻辑
  _parse_json_safely JSON fence 容错
"""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from shared.gemini_client import (
    DEFAULT_VIDEO_MODEL,
    GeminiVideoClient,
    GeminiVideoResponse,
    _parse_json_safely,
)


# ── GeminiVideoClient 构造测试 ─────────────────────────────────────────


class TestGeminiVideoClientInit:
    """缺 key 时构造即 raise。"""

    def test_raises_when_env_key_missing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        with pytest.raises(RuntimeError, match="GEMINI_API_KEY"):
            GeminiVideoClient()

    def test_raises_when_empty_string_key(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("GEMINI_API_KEY", "   ")
        with pytest.raises(RuntimeError, match="GEMINI_API_KEY"):
            GeminiVideoClient()

    def test_accepts_explicit_key(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        client = GeminiVideoClient(api_key="test-key-123")
        assert client.api_key == "test-key-123"
        assert client.model == DEFAULT_VIDEO_MODEL

    def test_accepts_env_key(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("GEMINI_API_KEY", "env-key-456")
        client = GeminiVideoClient()
        assert client.api_key == "env-key-456"

    def test_custom_model(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("GEMINI_API_KEY", "key")
        client = GeminiVideoClient(model="gemini-2.5-pro")
        assert client.model == "gemini-2.5-pro"


# ── _gemini_segments_to_transcript 测试 ────────────────────────────────


class TestGeminiSegmentsToTranscript:
    """segments → VideoResultTranscriptLine[] 映射。"""

    def test_maps_segments_to_transcript_lines(self) -> None:
        from backend.app.services.pipeline_tasks import _gemini_segments_to_transcript

        segments = [
            {"start": 0.0, "end": 10.5, "text": "Hello world"},
            {"start": 10.5, "end": 25.0, "text": "Second segment"},
        ]
        result = _gemini_segments_to_transcript(segments)
        assert len(result) == 2
        assert result[0]["t_sec"] == 0.0
        assert result[0]["t_str"] == "00:00"
        assert result[0]["text"] == "Hello world"
        assert result[1]["t_sec"] == 10.5
        assert result[1]["t_str"] == "00:10"
        assert result[1]["text"] == "Second segment"

    def test_skips_empty_text(self) -> None:
        from backend.app.services.pipeline_tasks import _gemini_segments_to_transcript

        segments = [
            {"start": 0.0, "end": 5.0, "text": "valid"},
            {"start": 5.0, "end": 10.0, "text": ""},
            {"start": 10.0, "end": 15.0, "text": None},
        ]
        result = _gemini_segments_to_transcript(segments)
        assert len(result) == 1
        assert result[0]["text"] == "valid"

    def test_empty_segments(self) -> None:
        from backend.app.services.pipeline_tasks import _gemini_segments_to_transcript

        assert _gemini_segments_to_transcript([]) == []


# ── _get_video_model_prompt 测试 ───────────────────────────────────────


class TestGetVideoModelPrompt:
    """按 intent 返回不同 prompt。"""

    def test_learning_prompt(self) -> None:
        from backend.app.services.pipeline_tasks import _get_video_model_prompt

        prompt = _get_video_model_prompt("learning")
        assert "课堂" in prompt or "讲座" in prompt
        assert "知识点" in prompt
        assert "JSON" in prompt

    def test_replica_prompt(self) -> None:
        from backend.app.services.pipeline_tasks import _get_video_model_prompt

        prompt = _get_video_model_prompt("replica")
        assert "拆片" in prompt or "翻拍" in prompt
        assert "镜头" in prompt

    def test_default_prompt(self) -> None:
        from backend.app.services.pipeline_tasks import _get_video_model_prompt

        prompt = _get_video_model_prompt("unknown")
        assert "JSON" in prompt
        assert "summary" in prompt
        assert "segments" in prompt


# ── _run_video_model_path 集成测试 ─────────────────────────────────────


class TestRunVideoModelPath:
    """mock client 验证完整流程。"""

    @pytest.fixture()
    def mock_runner(self) -> MagicMock:
        runner = MagicMock()
        runner.append_log = MagicMock()
        runner.set_progress = MagicMock()
        return runner

    @pytest.fixture()
    def sample_video(self, tmp_path: Path) -> Path:
        v = tmp_path / "test_video.mp4"
        v.write_bytes(b"fake video data")
        return v

    def test_calls_client_and_returns_mapped_result(
        self,
        mock_runner: MagicMock,
        sample_video: Path,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")

        fake_response = GeminiVideoResponse(
            summary="这是一个测试视频摘要",
            segments=[
                {"start": 0.0, "end": 15.0, "text": "第一段内容"},
                {"start": 15.0, "end": 30.0, "text": "第二段内容"},
            ],
            raw_response={"summary": "raw", "segments": []},
        )

        with patch.object(GeminiVideoClient, "analyze_video", return_value=fake_response) as mock_analyze:
            from backend.app.services.pipeline_tasks import _run_video_model_path

            result = _run_video_model_path(
                videos=[sample_video],
                payload={"video_intent": "learning"},
                task_id="test-task-001",
                project_json_dir=tmp_path / "json",
                runner=mock_runner,
            )

            mock_analyze.assert_called_once()
            call_kwargs = mock_analyze.call_args
            assert call_kwargs.kwargs["video_path"] == sample_video
            assert call_kwargs.kwargs["intent"] == "learning"

        assert result["summary_path"] == "video_model"
        assert result["summary"] == "这是一个测试视频摘要"
        assert result["intent"] == "learning"
        assert len(result["transcript"]) == 2
        assert result["transcript"][0]["t_sec"] == 0.0
        assert result["transcript"][0]["text"] == "第一段内容"
        assert result["transcript"][1]["t_sec"] == 15.0
        assert "第一段内容" in result["transcript_text"]
        assert "第二段内容" in result["transcript_text"]
        assert len(result["transcript_segments"]) == 2

    def test_raises_when_no_key(
        self,
        mock_runner: MagicMock,
        sample_video: Path,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)

        from backend.app.services.pipeline_tasks import _run_video_model_path

        with pytest.raises(ValueError, match="GEMINI_API_KEY"):
            _run_video_model_path(
                videos=[sample_video],
                payload={},
                task_id="test-task-002",
                project_json_dir=tmp_path / "json",
                runner=mock_runner,
            )

    def test_uses_model_override(
        self,
        mock_runner: MagicMock,
        sample_video: Path,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")

        fake_response = GeminiVideoResponse(summary="ok", segments=[], raw_response={})

        with patch.object(GeminiVideoClient, "analyze_video", return_value=fake_response):
            from backend.app.services.pipeline_tasks import _run_video_model_path

            result = _run_video_model_path(
                videos=[sample_video],
                payload={"video_model": "gemini-2.5-pro"},
                task_id="test-task-003",
                project_json_dir=tmp_path / "json",
                runner=mock_runner,
            )

        assert result["summary_path"] == "video_model"
        # 验证日志中包含 override model 名称
        log_calls = [str(c) for c in mock_runner.append_log.call_args_list]
        assert any("gemini-2.5-pro" in c for c in log_calls)


# ── PROCESSING→ACTIVE 轮询测试 ─────────────────────────────────────────


class _FakeState:
    """模拟 google-genai File.state 对象。"""

    def __init__(self, name: str) -> None:
        self.name = name


class _FakeFile:
    """模拟 google-genai File 对象。"""

    def __init__(self, name: str = "files/abc123", state_name: str = "ACTIVE") -> None:
        self.name = name
        self.state = _FakeState(state_name)


class TestGeminiPolling:
    """File API PROCESSING→ACTIVE 轮询逻辑。

    analyze_video 内部用延迟 import（from google import genai），
    所以必须通过 sys.modules 拦截，不能 patch 模块级属性。
    """

    def _make_genai_mock(
        self,
        upload_file: _FakeFile,
        get_returns: list[_FakeFile] | None = None,
        generate_text: str = '{"summary":"ok","segments":[]}',
    ) -> tuple[MagicMock, MagicMock]:
        """构造 mock genai module + mock types module。"""
        mock_genai = MagicMock()
        mock_genai.Client.return_value.files.upload.return_value = upload_file
        if get_returns is not None:
            mock_genai.Client.return_value.files.get.side_effect = get_returns
        mock_genai.Client.return_value.models.generate_content.return_value.text = generate_text
        mock_types = MagicMock()
        return mock_genai, mock_types

    def test_polls_until_active(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """模拟 PROCESSING → PROCESSING → ACTIVE 三次轮询。"""
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")

        processing_file = _FakeFile(state_name="PROCESSING")
        active_file = _FakeFile(state_name="ACTIVE")

        mock_genai, mock_types = self._make_genai_mock(
            upload_file=processing_file,
            get_returns=[processing_file, active_file],
        )

        fake_google = MagicMock()
        fake_google.genai = mock_genai
        import time as real_time

        with patch.dict("sys.modules", {"google": fake_google, "google.genai": mock_types}):
            with patch("shared.gemini_client.time") as mock_time:
                # 保留 sleep 的 side_effect 让 time.sleep(3) 不阻塞
                mock_time.sleep = MagicMock()
                client = GeminiVideoClient()
                result = client.analyze_video(
                    video_path=Path("/tmp/test.mp4"),
                    intent="learning",
                    prompt_template="test prompt",
                )

        assert result.summary == "ok"
        assert mock_genai.Client.return_value.files.get.call_count == 2
        mock_time.sleep.assert_called_with(3)

    def test_skips_polling_when_immediately_active(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """上传后直接 ACTIVE，无需轮询。"""
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")

        active_file = _FakeFile(state_name="ACTIVE")
        mock_genai, mock_types = self._make_genai_mock(upload_file=active_file)

        fake_google = MagicMock()
        fake_google.genai = mock_genai

        with patch.dict("sys.modules", {"google": fake_google, "google.genai": mock_types}):
            with patch("shared.gemini_client.time") as mock_time:
                client = GeminiVideoClient()
                result = client.analyze_video(
                    video_path=Path("/tmp/test.mp4"),
                    intent="learning",
                    prompt_template="test",
                )

        assert result.summary == "ok"
        mock_genai.Client.return_value.files.get.assert_not_called()
        mock_time.sleep.assert_not_called()

    def test_raises_on_failed_state(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """文件处理失败时 raise RuntimeError。"""
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")

        failed_file = _FakeFile(state_name="FAILED")
        mock_genai, mock_types = self._make_genai_mock(upload_file=failed_file)

        fake_google = MagicMock()
        fake_google.genai = mock_genai

        with patch.dict("sys.modules", {"google": fake_google, "google.genai": mock_types}):
            with patch("shared.gemini_client.time"):
                client = GeminiVideoClient()
                with pytest.raises(RuntimeError, match="处理失败"):
                    client.analyze_video(
                        video_path=Path("/tmp/test.mp4"),
                        intent="learning",
                        prompt_template="test",
                    )

    def test_raises_on_timeout(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """轮询超时（>180s）时 raise RuntimeError。"""
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")

        processing_file = _FakeFile(state_name="PROCESSING")
        mock_genai, mock_types = self._make_genai_mock(
            upload_file=processing_file,
            get_returns=[processing_file] * 100,  # 永远 PROCESSING
        )

        fake_google = MagicMock()
        fake_google.genai = mock_genai

        with patch.dict("sys.modules", {"google": fake_google, "google.genai": mock_types}):
            with patch("shared.gemini_client.time") as mock_time:
                client = GeminiVideoClient()
                with pytest.raises(RuntimeError, match="超时"):
                    client.analyze_video(
                        video_path=Path("/tmp/test.mp4"),
                        intent="learning",
                        prompt_template="test",
                    )
                # 180s / 3s = 60 次 sleep
                assert mock_time.sleep.call_count == 60


# ── _parse_json_safely 测试 ────────────────────────────────────────────


class TestParseJsonSafely:
    """JSON fence 容错解析。"""

    def test_plain_json(self) -> None:
        data = _parse_json_safely('{"summary": "ok", "segments": []}')
        assert data["summary"] == "ok"

    def test_json_with_code_fence(self) -> None:
        text = '```json\n{"summary": "fenced", "segments": []}\n```'
        data = _parse_json_safely(text)
        assert data["summary"] == "fenced"

    def test_json_with_code_fence_no_lang(self) -> None:
        text = '```\n{"summary": "no-lang", "segments": []}\n```'
        data = _parse_json_safely(text)
        assert data["summary"] == "no-lang"

    def test_invalid_json_raises(self) -> None:
        with pytest.raises(json.JSONDecodeError):
            _parse_json_safely("not json at all")
