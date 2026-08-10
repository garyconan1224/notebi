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

from shared.runtime_paths import STATE_DIR

TEXT_BACKEND_OPENAI_COMPAT: str = "openai_compatible"
SETTINGS_DIR = STATE_DIR
SETTINGS_PATH: Path = SETTINGS_DIR / "settings.json"

ProviderKind = Literal["openai_compatible", "anthropic"]
ProviderCapability = Literal["chat", "vision", "embedding", "rerank"]
TranscriberType = Literal["auto", "fast-whisper", "groq", "mlx-whisper"]

_ALLOWED_TRANSCRIBER_TYPES: tuple[TranscriberType, ...] = (
    "auto",
    "fast-whisper",
    "groq",
    "mlx-whisper",
)

# S4: 已退役的转录引擎，读取历史配置时自动迁移到 auto
_RETIRED_TRANSCRIBER_TYPES: frozenset[str] = frozenset({"bcut", "kuaishou"})


def migrate_transcriber_type(raw: Any) -> TranscriberType:
    """转录引擎值的唯一迁移入口。

    - 白名单内的值原样保留；
    - 退役引擎（见 ``_RETIRED_TRANSCRIBER_TYPES``：bcut / kuaishou）与任何未知值
      统一迁移到 ``auto``。只做现有配置兼容迁移，不恢复退役引擎 UI 或云转录路径。
    """
    candidate = str(raw or "auto").strip()
    if candidate in _ALLOWED_TRANSCRIBER_TYPES:
        return candidate  # type: ignore[return-value]
    if candidate in _RETIRED_TRANSCRIBER_TYPES:
        # 退役引擎（bcut / kuaishou）显式迁移到 auto，不恢复其 UI 或云转录路径
        return "auto"
    # 其余未知值统一回退 auto
    return "auto"


@dataclass(frozen=True)
class TranscriberConfig:
    """音频转写引擎偏好（跨端生效，落 AppSettings）。

    字段与前端 configStore.TranscriberConfig 对齐（采用下划线命名，前端侧转驼峰）。
    """

    type: TranscriberType = "auto"
    whisper_model_size: str = "medium"
    language: str = "auto"
    device: str = "auto"
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
        t = migrate_transcriber_type(data.get("type"))
        return cls(
            type=t,
            whisper_model_size=str(data.get("whisper_model_size") or "medium"),
            language=str(data.get("language") or "zh"),
            device=str(data.get("device") or "auto"),
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


# ── TaskDefaultsConfig 任务创建默认值 ─────────────────────────────────────────


@dataclass(frozen=True)
class TaskDefaultsConfig:
    """笔记任务默认值；缺失字段保持 S3 前的代码行为。"""

    summary_template: str = "standard"
    video_frame_analysis: bool = True
    frame_interval_sec: int = 5
    diarize: bool = False
    speaker_count: int | None = None
    # 输出语言独立于 ASR 语言：source=跟随原文，custom 使用 summary_language_custom。
    summary_language: str = "zh-Hans"
    summary_language_custom: str = ""

    @classmethod
    def from_dict(cls, data: Any) -> "TaskDefaultsConfig":
        if not isinstance(data, dict):
            return cls()
        summary_template = str(data.get("summary_template") or "standard").strip()
        # 任意正整数契约：不设硬编码上限；0、负数、非数值回退安全默认。
        frame_interval_sec = _positive_int(data.get("frame_interval_sec"), 5)
        raw_speaker_count = data.get("speaker_count")
        speaker_count = (
            _clamp_int(raw_speaker_count, 2, 2, 5)
            if raw_speaker_count is not None
            else None
        )
        return cls(
            summary_template=summary_template or "standard",
            video_frame_analysis=bool(data.get("video_frame_analysis", True)),
            frame_interval_sec=frame_interval_sec,
            diarize=bool(data.get("diarize", False)),
            speaker_count=speaker_count,
            summary_language=_normalize_summary_language(data.get("summary_language")),
            summary_language_custom=_normalize_bcp47(data.get("summary_language_custom")),
        )


_SUMMARY_LANGUAGES = frozenset({"source", "zh-Hans", "zh-Hant", "en", "ja", "ko", "custom"})


def _normalize_summary_language(value: Any) -> str:
    candidate = str(value or "zh-Hans").strip()
    return candidate if candidate in _SUMMARY_LANGUAGES else "zh-Hans"


def _normalize_bcp47(value: Any) -> str:
    candidate = str(value or "").strip()
    if not candidate:
        return ""
    import re
    return candidate if re.fullmatch(r"[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*", candidate) else ""


# ── NetworkConfig 网络配置 ────────────────────────────────────────────────────

RoutingMode = Literal["smart", "direct", "proxy"]
_ALLOWED_ROUTING_MODES: tuple[str, ...] = ("smart", "direct", "proxy")


@dataclass(frozen=True)
class NetworkConfig:
    """网络配置：智能路由、全局代理。

    routing_mode:
    - smart: 国内直连，海外走代理
    - direct: 全部直连
    - proxy: 全部走代理
    """

    routing_mode: RoutingMode = "smart"
    global_proxy: str = ""

    @classmethod
    def from_dict(cls, data: Any) -> "NetworkConfig":
        if not isinstance(data, dict):
            return cls()
        raw_mode = str(data.get("routing_mode") or "smart").strip()
        mode: RoutingMode = raw_mode if raw_mode in _ALLOWED_ROUTING_MODES else "smart"  # type: ignore[assignment]
        return cls(
            routing_mode=mode,
            global_proxy=str(data.get("global_proxy") or ""),
        )


# ── DownloadConfig 数值字段 clamp 边界（与前端 configStore 约束一致）──────────
_CONCURRENCY_MIN, _CONCURRENCY_MAX = 1, 8
_RETRY_MIN, _RETRY_MAX = 0, 10
_SOCKET_TIMEOUT_MIN, _SOCKET_TIMEOUT_MAX = 5, 300

ProxyMode = Literal["inherit", "direct", "proxy"]
CookieMode = Literal["none", "browser", "file"]
_ALLOWED_PROXY_MODES: tuple[str, ...] = ("inherit", "direct", "proxy")
_ALLOWED_COOKIE_MODES: tuple[str, ...] = ("none", "browser", "file")


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


def _positive_int(value: Any, default: int) -> int:
    """任意正整数契约：正整数原样返回（无上限）；0、负数、非数值回退默认。"""
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    return n if n >= 1 else default


@dataclass(frozen=True)
class DownloadConfig:
    """下载器偏好（跨端生效，落 AppSettings）。

    字段与前端 configStore 下载相关字段对齐：
    - 路径/命名：output_dir / filename_template；
    - 代理策略：proxy_mode（inherit/direct/proxy）；
    - Cookie：cookie_mode（none/browser/file）、cookie_browser、cookie_profile、cookie_file_path；
    - 高级：concurrency_limit / retry_count / socket_timeout（均含 clamp）。

    已废弃字段（兼容读取但不序列化）：po_token、visitor_data、cookie_base_dirs、http_proxy。
    """

    output_dir: str = ""
    filename_template: str = "%(title)s.%(ext)s"
    proxy_mode: ProxyMode = "inherit"
    cookie_mode: CookieMode = "browser"
    cookie_browser: str = "chrome"
    cookie_profile: str = ""
    cookie_file_path: str = ""
    concurrency_limit: int = 2
    retry_count: int = 2
    socket_timeout: int = 30

    @classmethod
    def from_dict(cls, data: Any) -> "DownloadConfig":
        if not isinstance(data, dict):
            return cls()
        raw_proxy_mode = str(data.get("proxy_mode") or "inherit").strip()
        proxy_mode: ProxyMode = raw_proxy_mode if raw_proxy_mode in _ALLOWED_PROXY_MODES else "inherit"  # type: ignore[assignment]
        raw_cookie_mode = str(data.get("cookie_mode") or "browser").strip()
        cookie_mode: CookieMode = raw_cookie_mode if raw_cookie_mode in _ALLOWED_COOKIE_MODES else "browser"  # type: ignore[assignment]
        return cls(
            output_dir=str(data.get("output_dir") or ""),
            filename_template=str(data.get("filename_template") or "%(title)s.%(ext)s"),
            proxy_mode=proxy_mode,
            cookie_mode=cookie_mode,
            cookie_browser=str(data.get("cookie_browser") or "chrome"),
            cookie_profile=str(data.get("cookie_profile") or ""),
            cookie_file_path=str(data.get("cookie_file_path") or ""),
            concurrency_limit=_clamp_int(data.get("concurrency_limit"), 2, _CONCURRENCY_MIN, _CONCURRENCY_MAX),
            retry_count=_clamp_int(data.get("retry_count"), 2, _RETRY_MIN, _RETRY_MAX),
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
    network: NetworkConfig = field(default_factory=NetworkConfig)
    download: DownloadConfig = field(default_factory=DownloadConfig)
    performance: PerformanceConfig = field(default_factory=PerformanceConfig)
    task_defaults: TaskDefaultsConfig = field(default_factory=TaskDefaultsConfig)
    model_storage_dir: str = ""
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
            network=NetworkConfig.from_dict(data.get("network")),
            download=DownloadConfig.from_dict(data.get("download")),
            performance=PerformanceConfig.from_dict(data.get("performance")),
            task_defaults=TaskDefaultsConfig.from_dict(data.get("task_defaults")),
            model_storage_dir=str(data.get("model_storage_dir") or ""),
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


# ── SettingsStore：可隔离测试的设置存储 ──────────────────────────────────────

# 序列化时排除的废弃字段
_DEPRECATED_DOWNLOAD_FIELDS = frozenset({"po_token", "visitor_data", "cookie_base_dirs", "http_proxy"})


class SettingsStore:
    """可指定路径的设置存储，用于测试隔离。

    生产代码继续使用模块级 load_settings / save_settings。
    """

    def __init__(self, path: Path) -> None:
        self._path = path

    def load(self) -> AppSettings:
        if not self._path.is_file():
            return AppSettings()
        try:
            raw = self._path.read_text(encoding="utf-8")
            data = json.loads(raw)
        except Exception:
            return AppSettings()
        if not isinstance(data, dict):
            return AppSettings()
        return AppSettings.from_dict(data)

    def save(self, settings: AppSettings) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        payload = asdict(settings)
        payload["providers"] = [asdict(p) for p in settings.providers]
        # 移除废弃字段，不序列化到 JSON
        if "download" in payload and isinstance(payload["download"], dict):
            for key in _DEPRECATED_DOWNLOAD_FIELDS:
                payload["download"].pop(key, None)
        self._path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
