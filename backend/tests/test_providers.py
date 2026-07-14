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
