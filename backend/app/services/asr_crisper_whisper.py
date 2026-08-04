"""Q8（D8）：CrisperWhisper 2.0 ASR 适配器（POC 阶段 A）。

设计约束（docs/plans/2026-08-02-product-revision.md Q8）：
- 只做可选适配器，不替换 auto/MLX/Faster-Whisper 默认路由；
- 采用 CrisperWhisper 2.0（不适配已弃用 v1）；
- macOS 仅考虑 Transformers/PyTorch 后端，不假设 CT2 fork 可用；
- 模型权重为非商业研究许可证：只在用户按需下载并明确接受后使用，
  绝不随应用分发；
- 映射到 NoteBi 既有 segment 契约（{start, end, text}），并保留
  逐词 start/end、verbatim/intended 模式、语言与引擎元数据；
- 说话人分离仍由 WeSpeaker/现有路径按时间重叠完成——本适配器
  不做、也不宣称 CrisperWhisper 区分说话人。

阶段 A 只交付适配器与假模型测试：未安装依赖时返回「未安装」能力
状态，转写调用抛出带安装指引的错误，不加载任何模型。
"""

from __future__ import annotations

import importlib.util
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

# CrisperWhisper 2.0 模型（HuggingFace: nyralabs/CrisperWhisper2.0_*）
# 许可证：非商业研究用途。此处仅记录，不随应用分发任何权重。
CRISPER_WHISPER_LICENSE = (
    "non-commercial research (nyralabs/CrisperWhisper2.0)"
)
# CrisperWhisper 2.0 支持的大小；large-v3 别名映射为 large（上游没有独立 large-v3 权重）。
CRISPER_WHISPER_MODELS = ("turbo", "large", "medium", "small")
# 上游命名别名 → canonical 大小。无对应关系的（如 base）明确报错，不静默映射。
CRISPER_WHISPER_MODEL_ALIASES = {
    "large-v3": "large",
    "large-v3-turbo": "turbo",
}
CRISPER_WHISPER_MODES = ("verbatim", "intended")

_MAX_SEGMENT_CHARS = 42
_MAX_SEGMENT_WORDS = 14
_SENTENCE_END_CHARS = set("。！？!?；;…")


def _module_available(module_name: str) -> bool:
    try:
        return importlib.util.find_spec(module_name) is not None
    except (ImportError, ValueError):
        return False


def normalize_crisper_model_name(model_name: str) -> str:
    """把用户给的模型名归一化为 CrisperWhisper 支持的 canonical 大小。

    - 支持：turbo / large / medium / small；
    - large-v3 映射为 large，large-v3-turbo 映射为 turbo；
    - base 等无对应关系的大小明确报错，不静默透传。
    """
    key = (model_name or "").strip().lower()
    if key in CRISPER_WHISPER_MODEL_ALIASES:
        return CRISPER_WHISPER_MODEL_ALIASES[key]
    if key in CRISPER_WHISPER_MODELS:
        return key
    supported = "/".join(CRISPER_WHISPER_MODELS)
    raise ValueError(
        f"不支持的 CrisperWhisper 模型: {model_name}（可选 {supported}；"
        "large-v3 等别名映射为 large）"
    )


def is_crisper_whisper_available() -> bool:
    """CrisperWhisper 2.0 是否可用（包已安装）。

    惰性探测，只查包是否存在，不 import 重依赖、不加载模型。
    """
    return _module_available("crisperwhisper")


def _backend_availability() -> Dict[str, bool]:
    """探测本机可用推理后端（仅报告，不加载）。"""
    return {
        "transformers": _module_available("transformers"),
        "ct2": _module_available("ctranslate2"),
    }


def get_crisper_whisper_capability() -> Dict[str, Any]:
    """返回 CrisperWhisper 能力状态；无依赖时为「未安装」。

    供路由层上报给前端，不触发任何下载或模型加载。
    """
    installed = is_crisper_whisper_available()
    backends = _backend_availability()
    # macOS 只信任 transformers 后端；ct2 fork 不假设可用
    usable = installed and backends["transformers"]
    return {
        "engine": "crisper-whisper",
        "installed": installed,
        "status": "available" if usable else "not_installed",
        "backends": backends,
        "models": list(CRISPER_WHISPER_MODELS),
        "modes": list(CRISPER_WHISPER_MODES),
        "word_timestamps": True,
        "diarization": False,  # 说话人仍走现有 WeSpeaker 路径
        "license": CRISPER_WHISPER_LICENSE,
        "install_hint": (
            "pip install crisperwhisper[transformers]"
            if not installed
            else ""
        ),
    }


def _word_field(word: Any, name: str, default: Any = None) -> Any:
    """兼容 dict 与对象两种 WordTimestamp 形态。"""
    if isinstance(word, dict):
        return word.get(name, default)
    return getattr(word, name, default)


def _join_words(words: List[Dict[str, Any]], language: str) -> str:
    """按语言拼接词文本：中日韩无空格，其余用空格。"""
    texts = [str(w.get("word") or "") for w in words]
    lang = (language or "").lower()
    if lang.startswith(("zh", "ja", "ko")):
        return "".join(t.strip() for t in texts).strip()
    return " ".join(t.strip() for t in texts if t.strip()).strip()


def _group_words_to_segments(
    words: List[Any],
    *,
    language: str = "",
    mode: str = "verbatim",
) -> List[Dict[str, Any]]:
    """把逐词时间戳聚合为 NoteBi segment 契约。

    每个 segment 形如：
        {start, end, text, words: [{word, start, end}], mode, language, engine}
    保留逐词 start/end；按句读/长度切分；不丢词、不改时间。
    """
    normalized: List[Dict[str, Any]] = []
    for word in words:
        text = str(_word_field(word, "word", "") or "")
        if not text.strip():
            continue
        normalized.append(
            {
                "word": text,
                "start": float(_word_field(word, "start", 0.0) or 0.0),
                "end": float(_word_field(word, "end", 0.0) or 0.0),
            }
        )

    segments: List[Dict[str, Any]] = []
    current: List[Dict[str, Any]] = []

    def flush() -> None:
        if not current:
            return
        seg_words = list(current)
        current.clear()
        text = _join_words(seg_words, language)
        if not text:
            return
        segments.append(
            {
                "start": seg_words[0]["start"],
                "end": seg_words[-1]["end"],
                "text": text,
                "words": seg_words,
                "mode": mode,
                "language": language,
                "engine": "crisper-whisper",
            }
        )

    for word in normalized:
        current.append(word)
        ends_sentence = bool(word["word"]) and word["word"].strip()[-1] in _SENTENCE_END_CHARS
        joined_len = len(_join_words(current, language))
        if ends_sentence or len(current) >= _MAX_SEGMENT_WORDS or joined_len >= _MAX_SEGMENT_CHARS:
            flush()
    flush()
    return segments


def _load_crisper_model(model_name: str, backend: str = "auto") -> Any:
    """加载 CrisperWhisper 模型（阶段 B 才会真实触发）。"""
    from crisperwhisper import CrisperWhisperModel  # noqa: PLC0415

    return CrisperWhisperModel(model_name, backend=backend)


def transcribe_file_with_crisper_whisper(
    file_path: str | Path,
    *,
    model_name: str = "turbo",
    language: str = "",
    mode: str = "verbatim",
    backend: str = "auto",
    log_callback: Optional[Callable[[str], None]] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
    return_segments: bool = True,
    _model: Any = None,
) -> Tuple[str, List[Dict[str, Any]], float]:
    """用 CrisperWhisper 2.0 转写，返回 (text, segments, duration)。

    阶段 A：`_model` 可注入假模型用于测试；未注入且依赖缺失时抛出
    带安装指引的错误，绝不静默降级。不改变调用方默认 ASR 路由。
    """
    path = Path(file_path)
    if not path.is_file():
        raise FileNotFoundError(f"CrisperWhisper 文件不存在: {path}")

    # 先校验/归一化模型名，再校验模式——base 等无对应关系时明确报错。
    model_name = normalize_crisper_model_name(model_name)

    def _emit(msg: str) -> None:
        if log_callback:
            try:
                log_callback(msg)
            except Exception:  # noqa: BLE001
                pass

    def _emit_progress(ratio: float, msg: str) -> None:
        if progress_callback:
            try:
                progress_callback(max(0.0, min(1.0, ratio)), msg)
            except Exception:  # noqa: BLE001
                pass

    if mode not in CRISPER_WHISPER_MODES:
        raise ValueError(f"不支持的 CrisperWhisper 模式: {mode}（可选 {'/'.join(CRISPER_WHISPER_MODES)}）")

    capability = get_crisper_whisper_capability()
    if _model is None:
        if capability["status"] != "available":
            raise RuntimeError(
                "CrisperWhisper 未安装。请先安装（pip install crisperwhisper[transformers]）"
                "并在确认后下载非商业研究许可的模型权重。"
            )
        _emit(f"🔍 加载 CrisperWhisper 模型：{model_name}（backend={backend}）")
        _emit_progress(0.05, "加载 CrisperWhisper 模型…")
        _model = _load_crisper_model(model_name, backend)

    _emit(f"🎙️ CrisperWhisper 转写 | mode={mode} language={language or 'auto'}")
    _emit_progress(0.1, "CrisperWhisper 转写中…")

    started = time.perf_counter()
    result = _model.transcribe(str(path), language=language or None, mode=mode, word_timestamps=True)
    elapsed = time.perf_counter() - started

    result_text = str(getattr(result, "text", "") or "").strip()
    detected_lang = str(getattr(result, "language", "") or language or "")
    duration = float(getattr(result, "duration", 0.0) or 0.0)
    words = list(getattr(result, "words", []) or [])

    _emit_progress(0.9, "整理逐词时间戳…")
    segments = _group_words_to_segments(words, language=detected_lang, mode=mode)

    # duration 兜底：模型未给出时用最后一个词的 end
    if duration <= 0 and segments:
        duration = float(segments[-1]["end"])

    text_out = result_text or "\n".join(seg["text"] for seg in segments).strip()
    _emit(
        f"✅ CrisperWhisper 完成 | mode={mode} language={detected_lang or 'auto'} "
        f"{len(segments)} 段 / {sum(len(s['words']) for s in segments)} 词 | {elapsed:.1f}s"
    )
    _emit_progress(1.0, "CrisperWhisper 转写完成")

    if return_segments:
        return text_out, segments, duration
    return text_out, [], duration
