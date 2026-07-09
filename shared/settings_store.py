"""
应用设置持久化（本地文件，不入库）。

用途：
- 统一保存 API 与后端配置；
- 启动后自动加载，避免重复输入；
- 提供清空能力用于发布前安全检查。
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field, replace
from pathlib import Path
from typing import Any, Literal

TEXT_BACKEND_OPENAI_COMPAT: str = "openai_compatible"
ROOT_DIR: Path = Path(__file__).resolve().parent.parent

SETTINGS_DIR: Path = ROOT_DIR / ".local"
SETTINGS_PATH: Path = SETTINGS_DIR / "settings.json"

ProviderKind = Literal["openai_compatible", "anthropic"]
ProviderCapability = Literal["chat", "vision", "embedding", "rerank"]
TranscriberType = Literal["fast-whisper", "bcut", "kuaishou", "groq", "mlx-whisper"]

_ALLOWED_TRANSCRIBER_TYPES: tuple[TranscriberType, ...] = (
    "fast-whisper",
    "bcut",
    "kuaishou",
    "groq",
    "mlx-whisper",
)


@dataclass(frozen=True)
class TranscriberConfig:
    """音频转写引擎偏好（跨端生效，落 AppSettings）。

    字段与前端 configStore.TranscriberConfig 对齐（采用下划线命名，前端侧转驼峰）。
    """

    type: TranscriberType = "fast-whisper"
    whisper_model_size: str = "medium"
    language: str = "auto"
    device: str = "cpu"
    groq_api_key: str = ""
    initial_prompt: str = ""
    # R4.8: ASR 加速参数
    cpu_threads: int = 0       # 0=自动（按 os.cpu_count()，上限 8）
    beam_size: int = 5         # Whisper beam search 宽度（1=贪心，5=默认）
    vad_filter: bool = True    # Silero VAD 预过滤静默段（默认开）

    @classmethod
    def from_dict(cls, data: Any) -> "TranscriberConfig":
        if not isinstance(data, dict):
            return cls()
        raw_type = str(data.get("type") or "fast-whisper").strip()
        t: TranscriberType = raw_type if raw_type in _ALLOWED_TRANSCRIBER_TYPES else "fast-whisper"  # type: ignore[assignment]
        return cls(
            type=t,
            whisper_model_size=str(data.get("whisper_model_size") or "medium"),
            language=str(data.get("language") or "zh"),
            device=str(data.get("device") or "cpu"),
            groq_api_key=str(data.get("groq_api_key") or ""),
            initial_prompt=str(data.get("initial_prompt") or ""),
            cpu_threads=int(data.get("cpu_threads") or 0),
            beam_size=int(data.get("beam_size") or 5),
            vad_filter=bool(data.get("vad_filter", True)),
        )


# ── PerformanceConfig 性能档位 ─────────────────────────────────────────────────

PerformanceTier = Literal["low", "medium", "high"]

_TIERS: dict[str, dict[str, Any]] = {
    "low": {
        "whisper_model_size": "base",
        "interval_sec": 8,
        "max_frames": 30,
        "vlm_concurrency": 3,
    },
    "medium": {
        "whisper_model_size": "medium",
        "interval_sec": 5,
        "max_frames": 60,
        "vlm_concurrency": 6,
    },
    "high": {
        "whisper_model_size": "large-v3",
        "interval_sec": 3,
        "max_frames": 100,
        "vlm_concurrency": 8,
    },
}


@dataclass(frozen=True)
class PerformanceConfig:
    """性能档位：按内存自动推荐，用户可手动覆盖。

    tier 影响 whisper_model_size（转写）和 interval_sec / max_frames（截帧）。
    用户在转写/截帧页手动改的值优先于档位默认值——档位仅在首次选择时"填充"。
    """

    tier: PerformanceTier = "medium"

    @classmethod
    def from_dict(cls, data: Any) -> "PerformanceConfig":
        if not isinstance(data, dict):
            return cls()
        raw = str(data.get("tier") or "medium").strip()
        tier: PerformanceTier = raw if raw in ("low", "medium", "high") else "medium"
        return cls(tier=tier)

    @property
    def whisper_model_size(self) -> str:
        return _TIERS[self.tier]["whisper_model_size"]

    @property
    def interval_sec(self) -> int:
        return _TIERS[self.tier]["interval_sec"]

    @property
    def max_frames(self) -> int:
        return _TIERS[self.tier]["max_frames"]

    @property
    def vlm_concurrency(self) -> int:
        """VLM 多帧并发数：随档位提速（low=3 / medium=6 / high=8），上限 8 防 SiliconFlow 限流。"""
        return _TIERS[self.tier]["vlm_concurrency"]

    @staticmethod
    def recommend_tier(total_ram_gb: float) -> PerformanceTier:
        """根据总内存推荐默认档位。"""
        if total_ram_gb <= 5:
            return "low"
        if total_ram_gb <= 12:
            return "medium"
        return "high"


# ── DownloadConfig 数值字段 clamp 边界（与前端 configStore 约束一致）──────────
_CONCURRENCY_MIN, _CONCURRENCY_MAX = 1, 8
_RETRY_MIN, _RETRY_MAX = 0, 10
_SOCKET_TIMEOUT_MIN, _SOCKET_TIMEOUT_MAX = 5, 300


def _clamp_int(value: Any, default: int, lo: int, hi: int) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    if n < lo:
        return lo
    if n > hi:
        return hi
    return n


def _normalize_cookie_base_dirs(raw: Any) -> tuple[str, ...]:
    if not isinstance(raw, (list, tuple)):
        return ()
    out: list[str] = []
    for item in raw:
        s = str(item or "").strip()
        if s and s not in out:
            out.append(s)
    return tuple(out)


@dataclass(frozen=True)
class DownloadConfig:
    """下载器偏好（跨端生效，落 AppSettings）。

    字段与前端 configStore 下载相关字段对齐：
    - 路径/命名：output_dir / filename_template；
    - 网络与凭据：http_proxy / po_token / visitor_data / cookie_base_dirs；
    - 高级：concurrency_limit / retry_count / socket_timeout（均含 clamp）。
    """

    output_dir: str = ""
    filename_template: str = "%(title)s-%(id)s.%(ext)s"
    http_proxy: str = ""
    po_token: str = ""
    visitor_data: str = ""
    cookie_base_dirs: tuple[str, ...] = ()
    concurrency_limit: int = 2
    retry_count: int = 3
    socket_timeout: int = 30

    @classmethod
    def from_dict(cls, data: Any) -> "DownloadConfig":
        if not isinstance(data, dict):
            return cls()
        return cls(
            output_dir=str(data.get("output_dir") or ""),
            filename_template=str(data.get("filename_template") or "%(title)s-%(id)s.%(ext)s"),
            http_proxy=str(data.get("http_proxy") or ""),
            po_token=str(data.get("po_token") or ""),
            visitor_data=str(data.get("visitor_data") or ""),
            cookie_base_dirs=_normalize_cookie_base_dirs(data.get("cookie_base_dirs")),
            concurrency_limit=_clamp_int(data.get("concurrency_limit"), 2, _CONCURRENCY_MIN, _CONCURRENCY_MAX),
            retry_count=_clamp_int(data.get("retry_count"), 3, _RETRY_MIN, _RETRY_MAX),
            socket_timeout=_clamp_int(data.get("socket_timeout"), 30, _SOCKET_TIMEOUT_MIN, _SOCKET_TIMEOUT_MAX),
        )


@dataclass(frozen=True)
class ProviderProfile:
    id: str
    name: str
    kind: ProviderKind
    enabled: bool = True
    api_key: str = ""
    base_url: str = ""
    capabilities: tuple[ProviderCapability, ...] = ("chat",)
    default_models: dict[str, str] = field(default_factory=dict)
    rate_limit_rpm: int = 60
    timeout_sec: int = 120

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ProviderProfile":
        cap_raw = data.get("capabilities") or ["chat"]
        caps: list[ProviderCapability] = []
        if isinstance(cap_raw, list):
            for c in cap_raw:
                s = str(c or "").strip().lower()
                if s in ("chat", "vision", "embedding", "rerank") and s not in caps:
                    caps.append(s)  # type: ignore[arg-type]
        if not caps:
            caps = ["chat"]

        kind_raw = str(data.get("kind") or "openai_compatible").strip().lower()
        kind: ProviderKind = "anthropic" if kind_raw == "anthropic" else "openai_compatible"
        default_models_raw = data.get("default_models") or {}
        default_models: dict[str, str] = {}
        if isinstance(default_models_raw, dict):
            for k, v in default_models_raw.items():
                key = str(k or "").strip()
                val = str(v or "").strip()
                if key and val:
                    default_models[key] = val

        pid = str(data.get("id") or "").strip() or f"{kind}-profile"
        return cls(
            id=pid,
            name=str(data.get("name") or pid),
            kind=kind,
            enabled=bool(data.get("enabled", True)),
            api_key=str(data.get("api_key") or ""),
            base_url=str(data.get("base_url") or ""),
            capabilities=tuple(caps),
            default_models=default_models,
            rate_limit_rpm=max(1, int(data.get("rate_limit_rpm") or 60)),
            timeout_sec=max(10, int(data.get("timeout_sec") or 120)),
        )


@dataclass(frozen=True)
class PromptFormat:
    """提示词格式模板（图片 / 视频两类，前端显示层用）。

    Phase 1G 增强：用户可在设置页自由编辑模板，结果页按选中的 active_*_ids
    渲染对应平台风格的提示词文本。模板内含 {placeholder}，未识别占位符前端
    原样保留。
    """

    id: str
    name: str
    category: str  # "image" | "video"
    template: str = ""
    description: str = ""
    is_default: bool = False

    @classmethod
    def from_dict(cls, data: Any) -> "PromptFormat":
        if not isinstance(data, dict):
            return cls(id="", name="", category="image")
        cat_raw = str(data.get("category") or "image").strip().lower()
        category = "video" if cat_raw == "video" else "image"
        return cls(
            id=str(data.get("id") or "").strip(),
            name=str(data.get("name") or "").strip(),
            category=category,
            template=str(data.get("template") or ""),
            description=str(data.get("description") or ""),
            is_default=bool(data.get("is_default", False)),
        )


@dataclass(frozen=True)
class PromptFormatsConfig:
    """提示词格式模板配置。

    - formats: 用户实际保存的全部模板。空 tuple 表示从未保存过 → load_settings
      读取时旁路注入种子（不写盘，待用户首次保存才落库）。
    - active_image_ids / active_video_ids: 结果页 tabs 选中的 ID 序列。
      约束：图片类预期 3 个（JSON 由前端永远附加在末尾，不在此处枚举）。
    """

    formats: tuple[PromptFormat, ...] = ()
    active_image_ids: tuple[str, ...] = ()
    active_video_ids: tuple[str, ...] = ()

    @classmethod
    def from_dict(cls, data: Any) -> "PromptFormatsConfig":
        if not isinstance(data, dict):
            return cls()
        raw_formats = data.get("formats") or []
        formats: list[PromptFormat] = []
        seen_ids: set[str] = set()
        if isinstance(raw_formats, list):
            for item in raw_formats:
                fmt = PromptFormat.from_dict(item)
                if not fmt.id or fmt.id in seen_ids:
                    continue
                seen_ids.add(fmt.id)
                formats.append(fmt)
        return cls(
            formats=tuple(formats),
            active_image_ids=_normalize_id_list(data.get("active_image_ids")),
            active_video_ids=_normalize_id_list(data.get("active_video_ids")),
        )


def _normalize_id_list(raw: Any) -> tuple[str, ...]:
    if not isinstance(raw, (list, tuple)):
        return ()
    out: list[str] = []
    for item in raw:
        s = str(item or "").strip()
        if s and s not in out:
            out.append(s)
    return tuple(out)


def _seed_prompt_formats_config() -> PromptFormatsConfig:
    """从 prompt_format_defaults 构造首次启动的种子。

    放在 settings_store 内部，避免外层依赖；用户首次 POST 保存后才落库。
    """
    from shared.prompt_format_defaults import (  # 局部 import 避免顶层循环
        DEFAULT_ACTIVE_IMAGE_IDS,
        DEFAULT_ACTIVE_VIDEO_IDS,
        all_seed_formats,
    )

    formats = tuple(
        PromptFormat(
            id=s["id"],
            name=s["name"],
            category=s["category"],
            template=s["template"],
            description=s["description"],
            is_default=s["is_default"],
        )
        for s in all_seed_formats()
    )
    return PromptFormatsConfig(
        formats=formats,
        active_image_ids=DEFAULT_ACTIVE_IMAGE_IDS,
        active_video_ids=DEFAULT_ACTIVE_VIDEO_IDS,
    )


@dataclass(frozen=True)
class AppSettings:
    openai_api_key: str = ""
    openai_base_url: str = ""
    anthropic_api_key: str = ""
    anthropic_base_url: str = ""
    text_backend: str = TEXT_BACKEND_OPENAI_COMPAT
    text_model: str = ""
    vision_model: str = ""
    embedding_model: str = ""
    rerank_model: str = ""
    anthropic_model: str = ""
    providers: tuple[ProviderProfile, ...] = ()
    default_provider_for_chat: str = ""
    default_provider_for_vision: str = ""
    default_provider_for_embedding: str = ""
    default_provider_for_rerank: str = ""
    transcriber: TranscriberConfig = field(default_factory=TranscriberConfig)
    download: DownloadConfig = field(default_factory=DownloadConfig)
    prompt_formats: PromptFormatsConfig = field(default_factory=PromptFormatsConfig)
    performance: PerformanceConfig = field(default_factory=PerformanceConfig)
    tavily_api_key: str = ""

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AppSettings":
        providers = _parse_providers_with_migration(data)
        defaults = _default_provider_ids_from_profiles(providers)
        return cls(
            openai_api_key=str(data.get("openai_api_key") or ""),
            openai_base_url=str(data.get("openai_base_url") or ""),
            anthropic_api_key=str(data.get("anthropic_api_key") or ""),
            anthropic_base_url=str(data.get("anthropic_base_url") or ""),
            text_backend=str(data.get("text_backend") or TEXT_BACKEND_OPENAI_COMPAT),
            text_model=str(data.get("text_model") or ""),
            vision_model=str(data.get("vision_model") or ""),
            embedding_model=str(data.get("embedding_model") or ""),
            rerank_model=str(data.get("rerank_model") or ""),
            anthropic_model=str(data.get("anthropic_model") or ""),
            providers=providers,
            default_provider_for_chat=str(data.get("default_provider_for_chat") or defaults.get("chat") or ""),
            default_provider_for_vision=str(data.get("default_provider_for_vision") or defaults.get("vision") or ""),
            default_provider_for_embedding=str(data.get("default_provider_for_embedding") or defaults.get("embedding") or ""),
            default_provider_for_rerank=str(data.get("default_provider_for_rerank") or defaults.get("rerank") or ""),
            transcriber=TranscriberConfig.from_dict(data.get("transcriber")),
            download=DownloadConfig.from_dict(data.get("download")),
            prompt_formats=PromptFormatsConfig.from_dict(data.get("prompt_formats")),
            performance=PerformanceConfig.from_dict(data.get("performance")),
            tavily_api_key=str(data.get("tavily_api_key") or ""),
        )


def load_settings() -> AppSettings:
    if not SETTINGS_PATH.is_file():
        return AppSettings()
    try:
        raw = SETTINGS_PATH.read_text(encoding="utf-8")
        data = json.loads(raw)
    except Exception:
        return AppSettings()
    if not isinstance(data, dict):
        return AppSettings()
    return AppSettings.from_dict(data)


def save_settings(settings: AppSettings) -> None:
    SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
    payload = asdict(settings)
    payload["providers"] = [asdict(p) for p in settings.providers]
    SETTINGS_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def clear_settings() -> None:
    if SETTINGS_PATH.exists():
        SETTINGS_PATH.unlink()


def delete_provider(provider_id: str) -> bool:
    """从设置中移除指定 provider。

    - 返回 ``True`` 表示找到并已删除；
    - 返回 ``False`` 表示 provider 不存在（调用方决定是否视为幂等成功或 404）。

    采用"读-改-写"的完整覆盖写：与 ``save_settings`` 保持一致的持久化路径。
    """
    settings = load_settings()
    if not any(p.id == provider_id for p in settings.providers):
        return False
    new_providers = tuple(p for p in settings.providers if p.id != provider_id)
    save_settings(replace(settings, providers=new_providers))
    return True


def load_prompt_formats_with_seed() -> PromptFormatsConfig:
    """读取 prompt_formats；空（首次）则注入种子，但不写盘。

    种子写盘的时机：用户首次 POST /prompt_formats_config 时由 save_prompt_formats 落库。
    """
    cfg = load_settings().prompt_formats
    if not cfg.formats:
        return _seed_prompt_formats_config()
    return cfg


def save_prompt_formats(cfg: PromptFormatsConfig) -> PromptFormatsConfig:
    """整体覆盖写入 prompt_formats，并返回最新值。"""
    settings = load_settings()
    save_settings(replace(settings, prompt_formats=cfg))
    return cfg


def reset_prompt_formats() -> PromptFormatsConfig:
    """恢复种子并写入；返回种子配置。"""
    seed = _seed_prompt_formats_config()
    save_prompt_formats(seed)
    return seed


def _parse_providers_with_migration(data: dict[str, Any]) -> tuple[ProviderProfile, ...]:
    raw = data.get("providers")
    out: list[ProviderProfile] = []
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            out.append(ProviderProfile.from_dict(item))
    if out:
        return tuple(out)

    # backward-compatible migration from legacy single-provider fields
    openai_provider = ProviderProfile(
        id="openai-default",
        name="OpenAI Compatible (Default)",
        kind="openai_compatible",
        enabled=True,
        api_key=str(data.get("openai_api_key") or ""),
        base_url=str(data.get("openai_base_url") or ""),
        capabilities=("chat", "vision", "embedding", "rerank"),
        default_models={
            "chat": str(data.get("text_model") or ""),
            "vision": str(data.get("vision_model") or ""),
            "embedding": str(data.get("embedding_model") or ""),
            "rerank": str(data.get("rerank_model") or ""),
        },
        rate_limit_rpm=60,
        timeout_sec=120,
    )
    anthropic_provider = ProviderProfile(
        id="anthropic-default",
        name="Anthropic (Default)",
        kind="anthropic",
        enabled=True,
        api_key=str(data.get("anthropic_api_key") or ""),
        base_url=str(data.get("anthropic_base_url") or ""),
        capabilities=("chat",),
        default_models={"chat": str(data.get("anthropic_model") or "")},
        rate_limit_rpm=60,
        timeout_sec=120,
    )
    return (openai_provider, anthropic_provider)


def _default_provider_ids_from_profiles(providers: tuple[ProviderProfile, ...]) -> dict[str, str]:
    result = {"chat": "", "vision": "", "embedding": "", "rerank": ""}
    for cap in ("chat", "vision", "embedding", "rerank"):
        for p in providers:
            if p.enabled and cap in p.capabilities:
                result[cap] = p.id
                break
    return result
