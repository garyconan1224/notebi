"""as_r_router 单测：平台分支 + 降级 + 全失败。

全部用 monkeypatch，不真下模型。
"""

from __future__ import annotations

import sys
import types

import pytest

from backend.app.services.asr_router import select_asr_engine, run_local_asr_with_fallback


# ── select_asr_engine ──────────────────────────────────────────


class TestSelectAsrEngine:
    def test_mlx_preferred_on_apple_silicon(self, monkeypatch):
        """macOS arm64 + mlx 可用 → 选 mlx-whisper"""
        monkeypatch.setattr(
            "backend.app.services.asr_mlx_whisper.is_mlx_whisper_available",
            lambda: True,
        )
        assert select_asr_engine() == "mlx-whisper"

    def test_fallback_to_fast_whisper(self, monkeypatch):
        """mlx 不可用 + fast-whisper 可用 → 选 fast-whisper"""
        monkeypatch.setattr(
            "backend.app.services.asr_mlx_whisper.is_mlx_whisper_available",
            lambda: False,
        )
        monkeypatch.setattr(
            "backend.app.services.asr_fast_whisper.is_fast_whisper_available",
            lambda: True,
        )
        assert select_asr_engine() == "fast-whisper"

    def test_fallback_to_remote_with_key(self, monkeypatch):
        """mlx + fast 都不可用 + 有 api_key → 选 remote"""
        monkeypatch.setattr(
            "backend.app.services.asr_mlx_whisper.is_mlx_whisper_available",
            lambda: False,
        )
        monkeypatch.setattr(
            "backend.app.services.asr_fast_whisper.is_fast_whisper_available",
            lambda: False,
        )
        assert select_asr_engine(api_key="sk-test") == "remote"

    def test_none_when_all_unavailable(self, monkeypatch):
        """全部不可用 + 无 api_key → none"""
        monkeypatch.setattr(
            "backend.app.services.asr_mlx_whisper.is_mlx_whisper_available",
            lambda: False,
        )
        monkeypatch.setattr(
            "backend.app.services.asr_fast_whisper.is_fast_whisper_available",
            lambda: False,
        )
        assert select_asr_engine() == "none"


# ── run_local_asr_with_fallback ────────────────────────────────


class TestRunLocalAsrWithFallback:
    def test_uses_mlx_when_available(self, monkeypatch, tmp_path):
        """mlx 可用时直接用 mlx，不走 fast-whisper"""
        audio = tmp_path / "test.mp3"
        audio.write_bytes(b"fake-audio")

        monkeypatch.setattr(
            "backend.app.services.asr_mlx_whisper.is_mlx_whisper_available",
            lambda: True,
        )
        monkeypatch.setattr(
            "backend.app.services.asr_mlx_whisper.transcribe_file_with_mlx_whisper",
            lambda *a, **kw: ("hello world", [{"start": 0.0, "end": 1.0, "text": "hello world"}], 1.0),
        )

        text, segs, dur, engine = run_local_asr_with_fallback(str(audio))
        assert engine == "mlx-whisper"
        assert text == "hello world"
        assert dur == 1.0

    def test_falls_back_to_fast_whisper(self, monkeypatch, tmp_path):
        """mlx 失败 → 降级到 fast-whisper"""
        audio = tmp_path / "test.mp3"
        audio.write_bytes(b"fake-audio")

        monkeypatch.setattr(
            "backend.app.services.asr_mlx_whisper.is_mlx_whisper_available",
            lambda: False,
        )
        monkeypatch.setattr(
            "backend.app.services.asr_fast_whisper.is_fast_whisper_available",
            lambda: True,
        )
        monkeypatch.setattr(
            "backend.app.services.asr_fast_whisper.transcribe_file_with_fast_whisper",
            lambda *a, **kw: ("fallback text", [{"start": 0.0, "end": 2.0, "text": "fallback text"}], 2.0),
        )

        text, segs, dur, engine = run_local_asr_with_fallback(str(audio))
        assert engine == "fast-whisper"
        assert text == "fallback text"

    def test_all_fail_raises(self, monkeypatch, tmp_path):
        """全部失败 → RuntimeError"""
        audio = tmp_path / "test.mp3"
        audio.write_bytes(b"fake-audio")

        monkeypatch.setattr(
            "backend.app.services.asr_mlx_whisper.is_mlx_whisper_available",
            lambda: False,
        )
        monkeypatch.setattr(
            "backend.app.services.asr_fast_whisper.is_fast_whisper_available",
            lambda: False,
        )

        with pytest.raises(RuntimeError, match="ASR 全部失败"):
            run_local_asr_with_fallback(str(audio))

    def test_file_not_found(self):
        """文件不存在 → FileNotFoundError"""
        with pytest.raises(FileNotFoundError, match="ASR 文件不存在"):
            run_local_asr_with_fallback("/nonexistent/file.mp3")


# ── _to_simplified 繁→简 ─────────────────────────────────────


class TestToSimplified:
    def _install_fake_opencc(self, monkeypatch):
        class FakeOpenCC:
            def __init__(self, config: str) -> None:
                assert config == "t2s"

            def convert(self, text: str) -> str:
                table = str.maketrans({
                    "為": "为",
                    "什": "什",
                    "麼": "么",
                    "語": "语",
                    "音": "音",
                    "辨": "辨",
                    "識": "识",
                    "會": "会",
                    "輸": "输",
                    "出": "出",
                    "繁": "繁",
                    "體": "体",
                    "這": "这",
                    "第": "第",
                    "二": "二",
                    "段": "段",
                })
                return text.translate(table)

        monkeypatch.setitem(sys.modules, "opencc", types.SimpleNamespace(OpenCC=FakeOpenCC))
        monkeypatch.setattr("backend.app.services.asr_router._OPENCC_T2S", None)

    def test_converts_traditional_to_simplified(self, monkeypatch):
        """繁体中文 segments → 出口为简体"""
        self._install_fake_opencc(monkeypatch)
        from backend.app.services.asr_router import _to_simplified
        trad = "為什麼語音辨識會輸出繁體中文？"
        result = _to_simplified(trad)
        # 繁体 "為什麼" → 简体 "为什么"
        assert "為" not in result
        assert "为什么" in result

    def test_simplified_unchanged(self, monkeypatch):
        """简体输入不变（t2s 幂等）"""
        self._install_fake_opencc(monkeypatch)
        from backend.app.services.asr_router import _to_simplified
        simp = "语音识别输出简体中文"
        result = _to_simplified(simp)
        assert result == simp

    def test_router_outlet_converts_traditional(self, monkeypatch, tmp_path):
        """通过 router 的繁体 segments 在出口被转成简体"""
        self._install_fake_opencc(monkeypatch)
        audio = tmp_path / "test.mp3"
        audio.write_bytes(b"fake-audio")

        trad_text = "為什麼繁體會出現？"
        trad_segs = [
            {"start": 0.0, "end": 1.0, "text": "為什麼繁體會出現？"},
            {"start": 1.0, "end": 2.0, "text": "這是第二段"},
        ]

        monkeypatch.setattr(
            "backend.app.services.asr_mlx_whisper.is_mlx_whisper_available",
            lambda: True,
        )
        monkeypatch.setattr(
            "backend.app.services.asr_mlx_whisper.transcribe_file_with_mlx_whisper",
            lambda *a, **kw: (trad_text, [dict(s) for s in trad_segs], 2.0),
        )

        text, segs, dur, engine = run_local_asr_with_fallback(str(audio))
        assert engine == "mlx-whisper"
        # 出口文本应已转简体
        assert "為什麼" not in text
        # 各 segment 也应已转简体
        for seg in segs:
            assert "為什麼" not in seg["text"]

    def test_opencc_unavailable_returns_original(self, monkeypatch):
        """opencc 不可用时降级返回原文，不让 ASR 主流程失败。"""
        import builtins
        from backend.app.services.asr_router import _to_simplified

        real_import = builtins.__import__

        def fake_import(name, *args, **kwargs):
            if name == "opencc":
                raise ImportError("opencc unavailable")
            return real_import(name, *args, **kwargs)

        monkeypatch.delitem(sys.modules, "opencc", raising=False)
        monkeypatch.setattr("backend.app.services.asr_router._OPENCC_T2S", None)
        monkeypatch.setattr(builtins, "__import__", fake_import)

        trad = "為什麼語音辨識會輸出繁體中文？"
        assert _to_simplified(trad) == trad
