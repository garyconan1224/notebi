"""
统一配置：硅基流动 API、共享路径、RAG 阈值与默认模型名称。
整合自 AI 导演编剧工作台/config.py 与 video-analyzer-new/analyze_videos.py 配置区。
"""

from __future__ import annotations

import os
import json
import warnings
from pathlib import Path

from shared.dotenv_loader import load_dotenv_if_present

load_dotenv_if_present()

# ── 路径常量 ──────────────────────────────────────────────────

# Nibi 项目根目录
ROOT_DIR: Path = Path(__file__).resolve().parent.parent

# 共享数据目录
DATA_DIR: Path = ROOT_DIR / "data"
VIDEOS_DIR: Path = DATA_DIR / "videos"        # 下载器输出 / 视频分析输入
JSON_DATA_DIR: Path = DATA_DIR / "json_data"  # 视频分析 JSON 输出 / 导演台知识库
PROJECTS_DIR: Path = ROOT_DIR / "projects"    # 导演台项目存档

# N1b 新布局：每个 workspace 的产物目录与 workspace_store 的 JSON 同住 data/workspaces/
# 形态：data/workspaces/<id>.json + data/workspaces/<id>/{videos,json_data,text,runtime}/
WORKSPACES_DATA_DIR: Path = DATA_DIR / "workspaces"

# 旧名 alias：保留向后兼容，仍指向旧路径 data/projects/，N1b.3 迁移脚本搬完后由 N1b.4 切换调用方
# 切完后此常量保留指向 WORKSPACES_DATA_DIR，便于第三方脚本继续工作
PROJECT_WORKSPACES_DIR: Path = DATA_DIR / "projects"

# 视频分析归档目录（相对 VIDEOS_DIR 的父目录，即 data/）
COLLECT_DIR_NAME: str = "所有内容汇总"
ARCHIVE_DIR_NAME: str = "已完成"


def ensure_data_dirs() -> None:
    """确保所有共享数据目录存在。"""
    for d in (VIDEOS_DIR, JSON_DATA_DIR, PROJECTS_DIR, WORKSPACES_DATA_DIR):
        d.mkdir(parents=True, exist_ok=True)


def _sanitize_workspace_id(workspace_id: str) -> str:
    safe = (workspace_id or "").strip().replace("/", "_").replace("\\", "_")
    return safe or "default_workspace"


# ── 新 API（N1b）：以 workspace 为命名，落盘到 data/workspaces/<id>/ ──

def get_workspace_root(workspace_id: str) -> Path:
    return WORKSPACES_DATA_DIR / _sanitize_workspace_id(workspace_id)


def get_workspace_videos_dir(workspace_id: str) -> Path:
    return get_workspace_root(workspace_id) / "videos"


def get_workspace_json_dir(workspace_id: str) -> Path:
    return get_workspace_root(workspace_id) / "json_data"


def get_workspace_runtime_dir(workspace_id: str) -> Path:
    return get_workspace_root(workspace_id) / "runtime"


def get_workspace_text_dir(workspace_id: str) -> Path:
    """文本任务产物目录：每个 text 任务一份 .md + .json。"""
    return get_workspace_root(workspace_id) / "text"


def ensure_workspace_dirs(workspace_id: str) -> None:
    for d in (
        get_workspace_videos_dir(workspace_id),
        get_workspace_json_dir(workspace_id),
        get_workspace_runtime_dir(workspace_id),
        get_workspace_text_dir(workspace_id),
    ):
        d.mkdir(parents=True, exist_ok=True)


# ── 旧 API alias（N1b）：保留向后兼容，调用时打 DeprecationWarning ──
# N1b.3 迁移脚本搬完老数据后，N1b.4 会把调用方批量切到新函数；这些 alias 保留一个 release 后删除。

def _sanitize_project_id(project_id: str) -> str:
    return _sanitize_workspace_id(project_id)


def _warn_deprecated_project_api(old: str, new: str) -> None:
    warnings.warn(
        f"shared.config.{old}() is deprecated, use {new}() instead "
        f"(N1b 磁盘布局迁移，旧名将在下个 release 删除)",
        DeprecationWarning,
        stacklevel=3,
    )


def get_project_root(project_id: str) -> Path:
    _warn_deprecated_project_api("get_project_root", "get_workspace_root")
    return PROJECT_WORKSPACES_DIR / _sanitize_workspace_id(project_id)


def get_project_videos_dir(project_id: str) -> Path:
    _warn_deprecated_project_api("get_project_videos_dir", "get_workspace_videos_dir")
    return PROJECT_WORKSPACES_DIR / _sanitize_workspace_id(project_id) / "videos"


def get_project_json_dir(project_id: str) -> Path:
    _warn_deprecated_project_api("get_project_json_dir", "get_workspace_json_dir")
    return PROJECT_WORKSPACES_DIR / _sanitize_workspace_id(project_id) / "json_data"


def get_project_runtime_dir(project_id: str) -> Path:
    _warn_deprecated_project_api("get_project_runtime_dir", "get_workspace_runtime_dir")
    return PROJECT_WORKSPACES_DIR / _sanitize_workspace_id(project_id) / "runtime"


def get_project_text_dir(project_id: str) -> Path:
    _warn_deprecated_project_api("get_project_text_dir", "get_workspace_text_dir")
    return PROJECT_WORKSPACES_DIR / _sanitize_workspace_id(project_id) / "text"


def ensure_project_dirs(project_id: str) -> None:
    _warn_deprecated_project_api("ensure_project_dirs", "ensure_workspace_dirs")
    for d in (
        PROJECT_WORKSPACES_DIR / _sanitize_workspace_id(project_id) / "videos",
        PROJECT_WORKSPACES_DIR / _sanitize_workspace_id(project_id) / "json_data",
        PROJECT_WORKSPACES_DIR / _sanitize_workspace_id(project_id) / "runtime",
        PROJECT_WORKSPACES_DIR / _sanitize_workspace_id(project_id) / "text",
    ):
        d.mkdir(parents=True, exist_ok=True)


# ── OpenAI 兼容 API（硅基流动 / DeepSeek / OpenRouter / Together 等）──────
# 默认基址；运行时可被环境变量 LLM_BASE_URL 或 OPENAI_COMPAT_BASE_URL 覆盖。

DEFAULT_OPENAI_COMPAT_BASE_URL: str = "https://api.siliconflow.cn/v1"

# 兼容旧常量名（等价于未设置 env 时的默认基址）
SILICONFLOW_BASE_URL: str = DEFAULT_OPENAI_COMPAT_BASE_URL


def get_openai_compat_base_url() -> str:
    """
    返回 OpenAI 兼容服务的根 URL（不含尾部路径）。
    优先级：LLM_BASE_URL > OPENAI_COMPAT_BASE_URL > 默认硅基地址。
    """
    raw = (
        (os.environ.get("LLM_BASE_URL") or "").strip()
        or (os.environ.get("OPENAI_COMPAT_BASE_URL") or "").strip()
        or _read_local_settings_value("openai_base_url")
        or DEFAULT_OPENAI_COMPAT_BASE_URL
    )
    return raw.rstrip("/")


# ── Anthropic Messages API ────────────────────────────────────

DEFAULT_ANTHROPIC_API_BASE_URL: str = "https://api.anthropic.com"
ANTHROPIC_MESSAGES_VERSION: str = "2023-06-01"


def get_anthropic_api_base_url() -> str:
    return (
        (os.environ.get("ANTHROPIC_API_BASE_URL") or "").strip()
        or _read_local_settings_value("anthropic_base_url")
        or DEFAULT_ANTHROPIC_API_BASE_URL
    ).rstrip("/")


def _read_local_settings_value(field: str) -> str:
    settings_path = ROOT_DIR / ".local" / "settings.json"
    if not settings_path.is_file():
        return ""
    try:
        data = json.loads(settings_path.read_text(encoding="utf-8"))
    except Exception:
        return ""
    if not isinstance(data, dict):
        return ""
    return str(data.get(field) or "").strip()


# 文本生成后端（创作工作台）
TEXT_BACKEND_OPENAI_COMPAT: str = "openai_compatible"
TEXT_BACKEND_ANTHROPIC: str = "anthropic"

ANTHROPIC_TEXT_MODEL_CHOICES: tuple[str, ...] = (
    "claude-sonnet-4-20250514",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
    "claude-3-opus-20240229",
)

# ── 视频分析配置（原 video-analyzer-new 配置区） ──────────────

VIDEO_EXTENSIONS: frozenset[str] = frozenset(
    {".mp4", ".mov", ".avi", ".mkv", ".flv", ".wmv", ".webm"}
)

# 抽帧间隔：0 = 自适应（短视频1s，长视频2s），>0 则为固定秒数
FRAME_INTERVAL_SEC: int = 0
# 自适应阈值：≤ 此秒数用1s间隔，> 此秒数用2s间隔
SHORT_VIDEO_THRESHOLD: int = 60

API_CONCURRENCY: int = 3      # 并发 API 请求数（建议 2-5，避免触发速率限制）
VLM_FRAMES_PER_CALL: int = 4  # 多帧合并进一次 VLM 请求的帧数（保质量/防限流）
JPEG_QUALITY: int = 85
MAX_IMAGE_SIDE: int = 1280

# 视频分析默认模型
VISION_MODEL_ANALYZER: str = "Qwen/Qwen2.5-VL-72B-Instruct"
TEXT_MODEL_ANALYZER: str = "deepseek-ai/DeepSeek-V3"

# ── RAG 阈值（原 AI 导演编剧工作台/config.py） ────────────────

# 总字符数低于该阈值时走「短文本直灌」模式，不建向量索引
SHORT_MODE_MAX_CHARS: int = 20_000

# 向量检索阶段保留的候选条数
RAG_TOP_K: int = 10

# 重排序后送入大模型的参考视频骨架数量
RAG_FINAL_TOP_N: int = 3

# ── 嵌入模型 ─────────────────────────────────────────────────

EMBEDDING_MODEL: str = "BAAI/bge-m3"
EMBEDDING_MODEL_CHOICES: tuple[str, ...] = (
    "BAAI/bge-m3",
    "Pro/BAAI/bge-m3",
)
EMBEDDING_BATCH_SIZE: int = 32
EMBEDDING_INPUT_MAX_CHARS: int = 5500
EMBEDDING_INPUT_MAX_CHARS_512: int = 480


def embedding_char_limit_for_model(model: str) -> int:
    """按模型设置单条 embedding 输入的最大字符数。"""
    m = (model or "").lower()
    if "bge-m3" in m:
        return EMBEDDING_INPUT_MAX_CHARS
    if "qwen3-embedding" in m:
        return 10000
    if any(
        p in m
        for p in (
            "bge-large",
            "bge-small",
            "bge-base",
            "bce-embedding",
            "e5-mistral",
            "multilingual-e5",
        )
    ):
        return EMBEDDING_INPUT_MAX_CHARS_512
    return EMBEDDING_INPUT_MAX_CHARS_512


# ── 重排序模型 ────────────────────────────────────────────────

RERANKER_MODEL: str = "BAAI/bge-reranker-v2-m3"

# ── 视觉模型（导演台） ────────────────────────────────────────

VISION_MODEL_DEFAULT: str = "Qwen/Qwen2.5-VL-72B-Instruct"
VISION_MODEL_CHOICES: tuple[str, ...] = (
    "Qwen/Qwen2.5-VL-72B-Instruct",
    "Qwen/Qwen2-VL-72B-Instruct",
    "Pro/Qwen/Qwen2.5-VL-72B-Instruct",
    "deepseek-ai/deepseek-vl2",
)

# ── 文本生成模型（导演台） ────────────────────────────────────

TEXT_MODEL_CHOICES: tuple[str, ...] = (
    "deepseek-ai/DeepSeek-V3-0324",
    "deepseek-ai/DeepSeek-V3",
    "Qwen/Qwen2.5-72B-Instruct",
)

# ── FastAPI 后端（任务中心 / SSE）──────────────────────────────

def get_backend_base_url() -> str:
    """Streamlit 与本地脚本请求后端时的根 URL（无尾部斜杠）。

    优先级：VIDMIRROR_BACKEND_URL > BACKEND_URL > 默认 http://127.0.0.1:8000
    """
    # 优先新变量名
    raw = (os.environ.get("VIDMIRROR_BACKEND_URL") or "").strip()
    if raw:
        return raw.rstrip("/")

    # 最后尝试通用变量
    raw = (os.environ.get("BACKEND_URL") or "http://127.0.0.1:8000").strip()
    return raw.rstrip("/")


# ── 分镜脚本分隔符 ────────────────────────────────────────────

PLAN_MARKERS: tuple[str, str, str] = ("<<<PLAN_A>>>", "<<<PLAN_B>>>", "<<<PLAN_C>>>")

# ── 标签库 7 维度（Phase 3C）─────────────────────────────────

TAG_DIMENSIONS: dict[str, dict] = {
    "content_type": {
        "label": "内容类型",
        "choices": ["教程", "访谈", "解说", "纪实", "Vlog", "新闻", "评测", "其它"],
    },
    "subject_domain": {
        "label": "主题领域",
        "choices": ["科技", "人文", "财经", "教育", "娱乐", "生活", "体育", "其它"],
    },
    "difficulty": {
        "label": "难度等级",
        "choices": ["入门", "进阶", "专家"],
    },
    "duration_band": {
        "label": "时长档位",
        "choices": ["短", "中", "长"],  # 短<5min / 中5-30min / 长>30min
    },
    "information_density": {
        "label": "信息密度",
        "choices": ["高", "中", "低"],
    },
    "emotion_tone": {
        "label": "情绪基调",
        "choices": ["中性", "激励", "批判", "幽默", "严肃", "悲情"],
    },
    "custom_tags": {
        "label": "自定义标签",
        "choices": None,  # 自由文本数组
    },
}
