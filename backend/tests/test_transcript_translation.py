import sys
import types
from types import SimpleNamespace

import pytest

from backend.app.routes import workspaces


def test_iter_translation_chunks_splits_by_line_limit(monkeypatch):
    monkeypatch.setattr(workspaces, "_TRANSLATE_CHUNK_MAX_LINES", 2)
    monkeypatch.setattr(workspaces, "_TRANSLATE_CHUNK_MAX_CHARS", 1000)

    chunks = workspaces._iter_translation_chunks(["a", "b", "", "c"])

    assert chunks == [[(0, "a"), (1, "b")], [(3, "c")]]


def test_translation_complete_rejects_partial_cache():
    segments = [
        {"idx": 0, "text": "你好"},
        {"idx": 1, "text": ""},
        {"idx": 2, "text": "世界"},
    ]

    assert workspaces._translation_filled_count(segments, ["hi", "there", "world"]) == 2
    assert workspaces._translation_complete(segments, ["hi", "there", "world"]) is False


def test_select_translation_model_prefers_numbered_output_stable_model():
    available = {
        "tencent/Hunyuan-MT-7B",
        "Qwen/Qwen3-8B",
        "Pro/deepseek-ai/DeepSeek-V3.2",
    }

    assert workspaces._select_translation_model("Qwen/Qwen3-8B", available) == "Pro/deepseek-ai/DeepSeek-V3.2"
    assert workspaces._select_translation_model("Qwen/Qwen3-8B", {"tencent/Hunyuan-MT-7B"}) == "Qwen/Qwen3-8B"


def test_parse_single_translation_accepts_plain_text_and_numbered_text():
    assert workspaces._parse_single_translation("代理的", 395) == "代理的"
    assert workspaces._parse_single_translation("[395] 代理的", 395) == "代理的"
    assert workspaces._parse_single_translation("/no_think\n395: 代理的", 395) == "代理的"


def test_translate_segments_batch_merges_chunks(monkeypatch):
    monkeypatch.setattr(workspaces, "_TRANSLATE_CHUNK_MAX_LINES", 2)
    monkeypatch.setattr(workspaces, "_TRANSLATE_CHUNK_MAX_CHARS", 1000)

    class FakeChatRequest:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    class FakeProvider:
        def chat(self, request):
            user_text = request.messages[-1]["content"]
            lines = []
            for line in user_text.splitlines():
                if not line.startswith("["):
                    continue
                idx = line.split("]", 1)[0].strip("[")
                text = line.split("]", 1)[1].strip()
                lines.append(f"[{idx}] 译文:{text}")
            return "\n".join(lines)

    class FakeRegistry:
        def resolve_default_profile(self, settings, kind):
            return SimpleNamespace(default_models={"chat": "fake-model"})

        def build(self, profile):
            return FakeProvider()

    providers_mod = types.ModuleType("providers")
    providers_mod.ChatRequest = FakeChatRequest
    registry_mod = types.ModuleType("registry")
    registry_mod.create_default_registry = lambda: FakeRegistry()
    settings_mod = types.ModuleType("settings_store")
    settings_mod.load_settings = lambda: {}

    monkeypatch.setitem(sys.modules, "src.vidmirror.core.providers", providers_mod)
    monkeypatch.setitem(sys.modules, "src.vidmirror.core.providers.registry", registry_mod)
    monkeypatch.setitem(sys.modules, "shared.settings_store", settings_mod)

    result = workspaces._translate_segments_batch(["one", "two", "three"], "zh")

    assert result == [
        {"idx": 0, "text": "译文:one"},
        {"idx": 1, "text": "译文:two"},
        {"idx": 2, "text": "译文:three"},
    ]


def test_translate_segments_batch_raises_when_chunk_missing(monkeypatch):
    monkeypatch.setattr(workspaces, "_TRANSLATE_CHUNK_MAX_LINES", 3)
    monkeypatch.setattr(workspaces, "_TRANSLATE_CHUNK_MAX_CHARS", 1000)

    class FakeChatRequest:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    class FakeProvider:
        def chat(self, request):
            return "[0] only first"

    class FakeRegistry:
        def resolve_default_profile(self, settings, kind):
            return SimpleNamespace(default_models={"chat": "fake-model"})

        def build(self, profile):
            return FakeProvider()

    providers_mod = types.ModuleType("providers")
    providers_mod.ChatRequest = FakeChatRequest
    registry_mod = types.ModuleType("registry")
    registry_mod.create_default_registry = lambda: FakeRegistry()
    settings_mod = types.ModuleType("settings_store")
    settings_mod.load_settings = lambda: {}

    monkeypatch.setitem(sys.modules, "src.vidmirror.core.providers", providers_mod)
    monkeypatch.setitem(sys.modules, "src.vidmirror.core.providers.registry", registry_mod)
    monkeypatch.setitem(sys.modules, "shared.settings_store", settings_mod)

    with pytest.raises(RuntimeError, match="字幕翻译结果缺少编号"):
        workspaces._translate_segments_batch(["one", "two"], "zh")
