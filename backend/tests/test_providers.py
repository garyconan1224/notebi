"""Provider settings: selecting a role must make the provider runnable for it."""

from backend.app.routes import providers as providers_route
from shared.settings_store import AppSettings, ProviderProfile


def test_selecting_a_default_model_enables_its_provider_capability(monkeypatch):
    settings = AppSettings(
        providers=(
            ProviderProfile(
                id="siliconflow",
                name="SiliconFlow",
                kind="openai_compatible",
                api_key="test-key",
                capabilities=("chat",),
            ),
        ),
    )
    saved: dict[str, AppSettings] = {}
    monkeypatch.setattr(providers_route, "load_settings", lambda: settings)
    monkeypatch.setattr(providers_route, "save_settings", lambda value: saved.setdefault("value", value))

    response = providers_route.update_provider(
        "siliconflow",
        providers_route.ProviderUpdateRequest(
            default_models={"vision": "Qwen/Qwen2.5-VL-72B-Instruct"},
        ),
    )

    assert response["default_models"]["vision"] == "Qwen/Qwen2.5-VL-72B-Instruct"
    assert "vision" in response["capabilities"]
    assert saved["value"].default_provider_for_vision == "siliconflow"
    assert saved["value"].vision_model == "Qwen/Qwen2.5-VL-72B-Instruct"
    assert "vision" in saved["value"].providers[0].capabilities


def test_openai_compatible_provider_passes_custom_base_url_to_model_discovery(monkeypatch):
    from src.vidmirror.core.providers import openai_compat_provider

    seen: dict[str, str] = {}

    def fake_get_model_ids(api_key: str, sub_type: str, *, base_url: str | None = None) -> list[str]:
        seen["api_key"] = api_key
        seen["sub_type"] = sub_type
        seen["base_url"] = base_url or ""
        return ["Qwen3-Ascend"]

    monkeypatch.setattr(openai_compat_provider, "get_model_ids", fake_get_model_ids)
    provider = openai_compat_provider.OpenAICompatProvider(
        provider_id="ascend",
        display_name="华为昇腾 vLLM",
        api_key="local-key",
        base_url="http://127.0.0.1:8000/v1",
    )

    assert provider.list_models("chat") == ["Qwen3-Ascend"]
    assert seen == {
        "api_key": "local-key",
        "sub_type": "chat",
        "base_url": "http://127.0.0.1:8000/v1",
    }


def test_openai_compatible_model_discovery_uses_standard_models_endpoint(monkeypatch):
    """vLLM-Ascend/MindIE 不应收到 SiliconFlow 专属 sub_type 查询参数。"""
    import shared.sf_client as sf_client

    class Response:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {"data": [{"id": "Qwen3-Ascend"}]}

    seen: dict[str, object] = {}

    def fake_get(url, **kwargs):
        seen["url"] = url
        seen["kwargs"] = kwargs
        return Response()

    monkeypatch.setattr(sf_client.requests, "get", fake_get)
    assert sf_client.get_model_ids(
        "local-key",
        "chat",
        base_url="http://127.0.0.1:8000/v1",
    ) == ["Qwen3-Ascend"]
    assert seen["url"] == "http://127.0.0.1:8000/v1/models"
    assert "params" not in seen["kwargs"]


def test_openai_compatible_reasoning_model_retries_without_temperature(monkeypatch):
    from src.vidmirror.core.providers import openai_compat_provider
    from src.vidmirror.core.providers.types import ChatRequest
    from shared.sf_client import SiliconFlowError

    calls: list[dict[str, object]] = []

    def fake_chat(*args, **kwargs):
        calls.append(dict(kwargs))
        if len(calls) == 1:
            raise SiliconFlowError("temperature is not supported by this model")
        return "最终可见答案"

    monkeypatch.setattr(openai_compat_provider, "chat_completion", fake_chat)
    provider = openai_compat_provider.OpenAICompatProvider(
        provider_id="reasoning", display_name="Reasoning", api_key="test-key",
    )

    result = provider.chat(ChatRequest(model="reasoning-model", messages=[], temperature=0.3))

    assert result == "最终可见答案"
    assert calls[0]["temperature"] == 0.3
    assert "temperature" not in calls[1]


def test_assistant_content_accepts_openai_text_blocks_without_reasoning_leak():
    from shared.sf_client import _assistant_content

    assert _assistant_content([
        {"type": "reasoning_content", "text": "隐藏推理"},
        {"type": "text", "text": "可见"},
    ]) == "可见"
