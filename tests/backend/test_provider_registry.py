from shared.settings_store import AppSettings, ProviderProfile
from backend.app.routes import providers as provider_routes
from src.vidmirror.core.providers.registry import create_default_registry


def test_registry_resolves_default_chat_provider() -> None:
    settings = AppSettings(
        providers=(
            ProviderProfile(
                id="openai-main",
                name="OpenAI Main",
                kind="openai_compatible",
                enabled=True,
                api_key="k-openai",
                capabilities=("chat", "embedding"),
            ),
            ProviderProfile(
                id="anthropic-main",
                name="Anthropic Main",
                kind="anthropic",
                enabled=True,
                api_key="k-anthropic",
                capabilities=("chat",),
            ),
        ),
        default_provider_for_chat="anthropic-main",
    )
    registry = create_default_registry()
    p = registry.resolve_default_profile(settings, "chat")
    assert p.id == "anthropic-main"
    provider = registry.build(p)
    assert provider.provider_id == "anthropic-main"


def test_update_provider_persists_embedding_and_rerank_defaults(monkeypatch) -> None:
    settings = AppSettings(
        providers=(
            ProviderProfile(
                id="siliconflow-main",
                name="SiliconFlow Main",
                kind="openai_compatible",
                enabled=True,
                api_key="k-sf",
                capabilities=("chat", "embedding", "rerank"),
                default_models={"chat": "qwen-chat"},
            ),
        ),
    )
    saved: list[AppSettings] = []

    monkeypatch.setattr(provider_routes, "load_settings", lambda: settings)
    monkeypatch.setattr(provider_routes, "save_settings", saved.append)

    res = provider_routes.update_provider(
        "siliconflow-main",
        provider_routes.ProviderUpdateRequest(
            default_models={
                "embedding": "BAAI/bge-m3",
                "rerank": "BAAI/bge-reranker-v2-m3",
            }
        ),
    )

    assert res["default_models"]["chat"] == "qwen-chat"
    assert res["default_models"]["embedding"] == "BAAI/bge-m3"
    assert res["default_models"]["rerank"] == "BAAI/bge-reranker-v2-m3"
    assert saved[0].embedding_model == "BAAI/bge-m3"
    assert saved[0].rerank_model == "BAAI/bge-reranker-v2-m3"
    assert saved[0].default_provider_for_embedding == "siliconflow-main"
    assert saved[0].default_provider_for_rerank == "siliconflow-main"
    assert saved[0].text_model == ""
    assert saved[0].default_provider_for_chat == ""
