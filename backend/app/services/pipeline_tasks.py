from __future__ import annotations

"""Task handlers for pipeline task center."""

import base64
import hashlib
import json
import re
import subprocess
import threading
import time
import traceback as tb
import urllib.request
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from backend.app.models.tasks import TaskRecord, TaskStatus
from backend.app.services.task_runner import TaskRunner
from shared.config import (
    DATA_DIR,
    get_workspace_json_dir,
    get_workspace_root,
    get_workspace_text_dir,
    get_workspace_videos_dir,
)
from shared.settings_store import load_settings
from shared.storyboard_generator import run_storyboard_generation
from shared.text_loader import TextDocument, TextLoaderError, load_auto, load_url
from shared.audio_analyzer import (
    analyze_music,
    assign_speakers_to_segments,
    export_srt,
    export_txt,
    generate_music_prompt,
    run_diarization,
    run_vad,
)
from shared.video_analyzer import (
    CaptureParams,
    extract_first_frame,
    find_videos,
    get_output_dir,
    get_safe_name,
    probe_duration_seconds,
    run_batch_analysis,
)
from shared.video_download_ytdlp import fetch_ytdlp_metadata, is_platform_url, run_ytdlp_download
from shared.segment_refiner import refine_segments
from shared.xiaohongshu_share import is_xiaohongshu_url_or_text, run_xiaohongshu_download
from src.vidmirror.core.providers import ChatRequest
from src.vidmirror.core.providers.registry import create_default_registry


def _tier_capture_params() -> CaptureParams:
    """返回当前性能档位对应的截帧默认参数。"""
    perf = load_settings().performance
    return CaptureParams(mode="interval", interval_sec=perf.interval_sec, max_frames=perf.max_frames, frames_per_shot=3)


def _tier_vlm_concurrency() -> int:
    """返回当前性能档位对应的 VLM 多帧并发数（low=3 / medium=6 / high=8）。"""
    return load_settings().performance.vlm_concurrency


# ── N7b 路径 1：视频字幕直接总结 ──────────────────────────────

_OUTPUT_FORMAT_PROMPTS: Dict[str, str] = {
    "summary": "请将以下视频转写文本总结为一段通顺的摘要，涵盖核心内容和关键信息。",
    "key_points": "请从以下视频转写文本中提取要点，以编号列表形式输出，每条要点一句话。",
    "golden_quotes": "请从以下视频转写文本中摘录最精彩、最有价值的金句，逐条列出，并简要标注每条金句的语境。",
    "paragraph_rewrite": "请将以下视频转写文本重新组织为通顺的叙事段落，保留原意但优化表达，去掉口语填充词和冗余重复。",
}

# V3.2: 公开别名，供 templates.py router 导入
_BUILTIN_TEMPLATE_PROMPTS: Dict[str, str] = {}

_VIDEO_TEMPLATE_PROMPTS: Dict[str, str] = {
    "教程": (
        "这是一段教程/课程类视频的转写文本。请按以下结构输出总结：\n"
        "1. 一句话摘要（30字以内）\n"
        "2. 知识点列表（编号，每点一句话）\n"
        "3. 重点概念解释（如有专有术语）\n"
        "4. 学习建议（1-2 条）\n"
    ),
    "Vlog": (
        "这是一段 Vlog/生活记录类视频的转写文本。请按以下结构输出总结：\n"
        "1. 一句话摘要（30字以内）\n"
        "2. 地点与事件亮点（编号列表）\n"
        "3. 情绪氛围描述（1-2 句）\n"
        "4. 金句摘录（如有精彩表达）\n"
    ),
    "访谈": (
        "这是一段访谈类视频的转写文本。请按以下结构输出总结：\n"
        "1. 一句话摘要（30字以内）\n"
        "2. 受访者核心观点（编号列表）\n"
        "3. 金句摘录（直接引用）\n"
        "4. 话题脉络梳理（简要）\n"
    ),
    "影视点评": (
        "这是一段影视点评类视频的转写文本。请按以下结构输出总结：\n"
        "1. 一句话摘要（30字以内）\n"
        "2. 点评要点（编号列表）\n"
        "3. 优缺点分析\n"
        "4. 推荐指数与理由\n"
    ),
    "产品评测": (
        "这是一段产品评测类视频的转写文本。请按以下结构输出总结：\n"
        "1. 一句话摘要（30字以内）\n"
        "2. 产品核心卖点（编号列表）\n"
        "3. 优缺点分析\n"
        "4. 适合人群与购买建议\n"
    ),
    "学术": (
        "这是一段学术/知识类视频的转写文本。请按以下结构输出总结：\n"
        "1. 核心论点（一句话）\n"
        "2. 研究背景与动机\n"
        "3. 方法论与论证逻辑\n"
        "4. 关键发现与结论\n"
        "5. 局限性与未来方向\n"
    ),
    "会议纪要": (
        "这是一段会议/讨论类视频的转写文本。请按以下结构输出总结：\n"
        "1. 会议主题（一句话）\n"
        "2. 参会人员与角色\n"
        "3. 讨论要点（编号列表）\n"
        "4. 决议与行动项\n"
        "5. 待解决问题\n"
    ),
    "商业报告": (
        "这是一段商业/财经类视频的转写文本。请按以下结构输出总结：\n"
        "1. 核心观点（一句话）\n"
        "2. 市场背景与趋势\n"
        "3. 关键数据与指标\n"
        "4. 策略建议\n"
        "5. 风险提示\n"
    ),
    "其它": (
        "请将以下视频转写文本总结为结构化输出：\n"
        "1. 一句话摘要（30字以内）\n"
        "2. 要点列表（3-5 条，每条一句话）\n"
        "3. 金句摘录（如有精彩表达）\n"
    ),
}


# 将内置字典复制到公开别名
_BUILTIN_TEMPLATE_PROMPTS.update(_VIDEO_TEMPLATE_PROMPTS)


def list_video_templates() -> Dict[str, str]:
    """返回合并后的模板 dict：内置 6 类 + 用户自定义（自定义覆盖同名内置）。"""
    from shared.template_store import load_templates_by_category as _load_by_cat

    merged = dict(_BUILTIN_TEMPLATE_PROMPTS)
    for t in _load_by_cat("video"):
        merged[t.name] = t.prompt
    return merged


def _normalize_transcript_to_lines(
    transcript_text: str,
    transcript_segments: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """将转写文本规范化为 VideoResultTranscriptLine[] 格式。

    优先使用 segments（带时间戳），否则将整段文本包装为单行。
    """
    if transcript_segments:
        return [
            {
                "t_sec": float(seg.get("start", 0)),
                "t_str": _format_sec_short(float(seg.get("start", 0))),
                "text": str(seg.get("text", "")),
            }
            for seg in transcript_segments
            if seg.get("text")
        ]
    if transcript_text and transcript_text.strip():
        return [{"t_sec": 0, "t_str": "00:00", "text": transcript_text.strip()}]
    return []


def _build_display_transcript_lines(
    cleaned_transcript_text: str,
    transcript_segments: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Build display lines that preserve timestamps while preferring cleaned text."""
    if not transcript_segments:
        return _normalize_transcript_to_lines(cleaned_transcript_text, transcript_segments)

    from shared.transcript_cleaner import clean_transcript_rules

    base_lines = [
        {
            "t_sec": float(seg.get("start", 0)),
            "t_str": _format_sec_short(float(seg.get("start", 0))),
            "text": clean_transcript_rules(str(seg.get("text", ""))).strip(),
        }
        for seg in transcript_segments
        if str(seg.get("text", "")).strip()
    ]
    base_lines = [line for line in base_lines if line["text"]]

    cleaned_lines = [
        line.strip()
        for line in cleaned_transcript_text.splitlines()
        if line.strip()
    ]
    if cleaned_lines and len(cleaned_lines) == len(base_lines):
        for line, cleaned in zip(base_lines, cleaned_lines):
            line["text"] = cleaned

    return base_lines


def _format_sec_short(sec: float) -> str:
    """秒数格式化为 MM:SS。"""
    s = max(0, int(sec))
    return f"{s // 60:02d}:{s % 60:02d}"


def _gemini_segments_to_transcript(
    segments: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """将 Gemini 返回的 segments [{start, end, text}] 映射为 VideoResultTranscriptLine[]。"""
    return [
        {
            "t_sec": float(seg.get("start", 0)),
            "t_str": _format_sec_short(float(seg.get("start", 0))),
            "text": str(seg.get("text", "")),
        }
        for seg in segments
        if seg.get("text")
    ]


def _get_video_model_prompt(intent: str) -> str:
    """根据视频意图生成 video_model 路径的 prompt 模板。"""
    base = (
        "请分析这段视频的完整内容，输出严格的 JSON 格式：\n"
        '{"summary": "视频内容的结构化摘要", '
        '"segments": [{"start": 秒数, "end": 秒数, "text": "该时间段的内容文字"}]}\n'
        "要求：\n"
        "1. summary 用中文，200-500 字，覆盖视频核心信息\n"
        "2. segments 按时间顺序，每个 10-60 秒，覆盖视频全程\n"
        "3. text 是该时间段的口播/画面内容转写\n"
    )
    if intent == "learning":
        return (
            "你是一个课堂/讲座视频分析专家。\n"
            + base
            + "4. 重点提取知识点、公式、定义、示例\n"
            + "5. summary 按「主题 → 核心要点 → 关键结论」组织\n"
        )
    if intent == "replica":
        return (
            "你是一个视频拆片/翻拍分析专家。\n"
            + base
            + "4. 标注镜头切换、转场、画面构图变化\n"
            + "5. summary 按「结构 → 每段作用 → 拍摄手法」组织\n"
        )
    return base


def _run_video_model_path(
    videos: List[Path],
    payload: Dict[str, Any],
    task_id: str,
    project_json_dir: Path,
    runner: Any,
) -> Dict[str, Any]:
    """N7b 路径 3：Gemini 视频模型直接分析。"""
    from shared.gemini_client import GeminiVideoClient, GeminiVideoResponse

    runner.append_log(task_id, "🎬 路径 3 视频模型直传 | 初始化 Gemini 客户端…")
    runner.set_progress(task_id, 0.05, "Initializing Gemini client")

    # 构造客户端（缺 key 在此 raise → 任务 FAILED 带明确错误）
    model_override = str(payload.get("video_model") or "").strip()
    try:
        client = GeminiVideoClient(model=model_override or "gemini-2.5-flash")
    except RuntimeError as e:
        raise ValueError(str(e))

    intent = str(payload.get("video_intent") or "learning").strip()
    prompt_template = _get_video_model_prompt(intent)

    runner.append_log(task_id, f"📹 开始分析 {len(videos)} 个视频 | model={client.model} | intent={intent}")

    all_transcript_lines: List[Dict[str, Any]] = []
    all_transcript_segments: List[Dict[str, Any]] = []
    summaries: List[str] = []

    for i, video_path in enumerate(videos):
        runner.append_log(task_id, f"📤 上传视频 [{i+1}/{len(videos)}]: {video_path.name}")
        runner.set_progress(task_id, 0.1 + 0.7 * (i / max(len(videos), 1)), f"Analyzing {video_path.name}")

        try:
            result: GeminiVideoResponse = client.analyze_video(
                video_path=video_path,
                intent=intent,
                prompt_template=prompt_template,
            )
        except Exception as e:
            runner.append_log(task_id, f"❌ 视频 {video_path.name} 分析失败: {e}")
            raise

        segments = result.segments
        all_transcript_segments.extend(segments)
        all_transcript_lines.extend(_gemini_segments_to_transcript(segments))
        if result.summary:
            summaries.append(result.summary)
        runner.append_log(task_id, f"✅ {video_path.name} 分析完成 | {len(segments)} 个片段")

    runner.set_progress(task_id, 0.95, "Building final result")

    transcript_text = "\n".join(line["text"] for line in all_transcript_lines)
    combined_summary = "\n\n".join(summaries) if summaries else ""

    # R2 segment_refiner：切细过长字幕段（在存入 results 前）
    all_transcript_segments = refine_segments(all_transcript_segments)

    final_result: Dict[str, Any] = {
        "json_outputs": [],
        "json_output_basenames": [],
        "json_output_dir": str(project_json_dir.resolve()),
        "summary_path": "video_model",
        "transcript": all_transcript_lines,
        "transcript_text": transcript_text,
        "transcript_segments": all_transcript_segments,
        "summary": combined_summary,
        "intent": intent,
    }

    runner.set_progress(task_id, 1.0, "video_model analysis finished")
    runner.append_log(task_id, f"✅ 路径 3 完成 | summary {len(combined_summary)} 字 | {len(all_transcript_lines)} 个转写片段")
    return final_result


def _extract_audio_from_video(
    video_path: Path,
    output_path: Path,
    log_fn: Optional[Any] = None,
) -> Path:
    """用 ffmpeg 从视频中提取音频轨道为 WAV。"""
    cmd = [
        "ffmpeg", "-y", "-i", str(video_path),
        "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
        str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg 音频提取失败: {result.stderr[:500]}")
    if log_fn:
        log_fn(f"🎵 音频提取完成: {output_path.name} ({output_path.stat().st_size // 1024} KB)")
    return output_path


def _detect_video_template(
    title: str,
    transcript_preview: str,
) -> str:
    """V3.3: 用 LLM 自动检测视频类型模板。失败时返回 "其它"。"""
    all_templates = list_video_templates()
    builtin_names = set(_BUILTIN_TEMPLATE_PROMPTS.keys())
    custom_names = [n for n in all_templates if n not in builtin_names]
    custom_str = "、".join(custom_names) if custom_names else "无"

    prompt = (
        "你是视频内容分类助手。给定视频标题和转写前 500 字，从以下类别中选一个最匹配的：\n"
        "教程 / Vlog / 访谈 / 影视点评 / 产品评测 / 其它\n\n"
        f"如果是用户自定义模板（下面列出），优先匹配它们：\n{custom_str}\n\n"
        f"标题：{title}\n"
        f"转写片段：{transcript_preview}\n\n"
        "仅返回类别名（中文），不解释。"
    )

    try:
        settings = load_settings()
        registry = create_default_registry()
        profile = registry.resolve_default_profile(settings, "chat")
        provider = registry.build(profile)
        model = (
            profile.default_models.get("chat")
            or (settings.text_model or "").strip()
        )
        if not model:
            return "其它"

        response = provider.chat(
            ChatRequest(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=20,
            )
        )
        result = response.strip()

        valid_names = set(all_templates.keys())
        if result in valid_names:
            return result
        # Fuzzy match: check prefix overlap
        for name in valid_names:
            if result.startswith(name) or name.startswith(result):
                return name
        return "其它"
    except Exception:
        return "其它"


def _build_video_summary_prompt(
    transcript: str,
    video_template: str = "其它",
    depth: str = "normal",
    output_format: str = "summary",
) -> str:
    """根据视频类型模板和输出格式构建 LLM 总结 prompt。

    V2.2/V2.3: output_format 决定主要输出形式（摘要/要点/金句/段落改写），
    video_template 会在 format instruction 之后拼接领域上下文提示。
    """
    format_instruction = _OUTPUT_FORMAT_PROMPTS.get(
        output_format, _OUTPUT_FORMAT_PROMPTS["summary"]
    )
    all_templates = list_video_templates()
    template_instruction = all_templates.get(
        video_template, all_templates.get("其它", "")
    )
    depth_hint = {
        "brief": "请简洁输出，总字数控制在 200 字以内。",
        "normal": "请适度展开，总字数 300-500 字。",
        "deep": "请详细分析，总字数 500-800 字。",
    }.get(depth, "请适度展开，总字数 300-500 字。")

    # 超长文本截断（LLM context 保护）
    max_chars = 12000
    truncated = transcript[:max_chars] if len(transcript) > max_chars else transcript
    suffix = "\n\n（注：转写文本过长，已截断前 12000 字符）" if len(transcript) > max_chars else ""

    return (
        f"{format_instruction}\n\n"
        f"{template_instruction}\n"
        f"{depth_hint}\n\n"
        f"请用中文输出。\n\n"
        f"---\n转写文本：\n{truncated}{suffix}"
    )


def _resolve_download_kwargs(payload: Dict[str, Any]) -> Dict[str, Any]:
    """合并 payload 与 AppSettings.download 作为 run_ytdlp_download 的 kwargs。

    规则（M3)：
    - 字符串字段（proxy / po_token / visitor_data) 与 format_selector：payload 非空时用 payload，
      否则回落到 ``AppSettings.download``；
    - cookie_base_dirs：payload 提供非空 list 时用 payload，否则落 settings.cookie_base_dirs；
    - filename_template / retry_count / socket_timeout / concurrent_fragment_downloads：
      payload 不出现 (legacy 链路从不下发) 时直接取 settings；
    - 所有 settings 读取均用 ``isinstance`` 守卫，避免被 MagicMock 覆写时把非预期对象
      透传给 yt-dlp（保持现有 test_pipeline_tasks.py mock 的行为不变）。
    """
    try:
        settings = load_settings()
        dl = getattr(settings, "download", None)
    except Exception:
        dl = None

    def _s(name: str) -> str:
        v = getattr(dl, name, "") if dl is not None else ""
        return v if isinstance(v, str) else ""

    def _i_or_none(name: str) -> Optional[int]:
        v = getattr(dl, name, None) if dl is not None else None
        return v if isinstance(v, int) and not isinstance(v, bool) else None

    def _dirs() -> Optional[List[str]]:
        v = getattr(dl, "cookie_base_dirs", None) if dl is not None else None
        if isinstance(v, (list, tuple)) and v:
            cleaned = [str(x) for x in v if isinstance(x, str) and x.strip()]
            return cleaned or None
        return None

    # 字符串字段：payload 非空优先，否则回落 settings
    proxy = str(payload.get("proxy") or "") or _s("http_proxy")
    po_token = str(payload.get("po_token") or "") or _s("po_token")
    visitor_data = str(payload.get("visitor_data") or "") or _s("visitor_data")
    format_selector = str(payload.get("format_selector") or "") or "best"

    # cookie_base_dirs：payload 的 list 优先
    raw_dirs = payload.get("cookie_base_dirs")
    cookie_dirs: Optional[List[str]] = None
    if isinstance(raw_dirs, list) and raw_dirs:
        cookie_dirs = [str(x) for x in raw_dirs]
    else:
        cookie_dirs = _dirs()

    # filename_template：空串也视为"未提供"（避免前端误传空串）
    filename_template = str(payload.get("filename_template") or "") or _s("filename_template")

    return {
        "browser": str(payload.get("browser") or "chrome"),
        "proxy": proxy,
        "po_token": po_token,
        "visitor_data": visitor_data,
        "format_selector": format_selector,
        "cookie_base_dirs_list": cookie_dirs,
        # 仅在有具体值时传入，避免空串污染 _build_attempts 的默认模板兜底
        **({"filename_template": filename_template} if filename_template else {}),
        "retry_count": _i_or_none("retry_count"),
        "socket_timeout": _i_or_none("socket_timeout"),
        "concurrent_fragment_downloads": _i_or_none("concurrency_limit"),
    }


def handle_download_task(record: TaskRecord, runner: TaskRunner) -> Dict[str, Any]:
    """处理视频下载任务"""
    runner.set_progress(record.task_id, 0.05, "Preparing download")
    url = str(record.payload.get("url") or "").strip()
    if not url:
        raise ValueError("download payload.url is required")
    project_video_dir = get_workspace_videos_dir(record.project_id)
    project_video_dir.mkdir(parents=True, exist_ok=True)

    dl_kwargs = _resolve_download_kwargs(record.payload)
    out = run_ytdlp_download(
        url=url,
        output_dir=str(project_video_dir),
        log=lambda m: runner.append_log(record.task_id, m),
        progress_callback=lambda p, msg: runner.set_progress(record.task_id, p, msg),
        # 将 yt-dlp 捕获的实时速度写入 task.result["download_speed"]，前端订阅展示
        speed_callback=lambda s: runner.set_download_speed(record.task_id, s),
        # R15 yt-dlp 拿到 info_dict 时即时回调，把 title/cover 写进 task.result；
        # ProcessingPage 在下载中就能显示真实标题（不再等下载完成才看到）
        info_callback=lambda meta: _apply_ytdlp_metadata_to_task(record, runner, meta),
        **dl_kwargs,
    )
    if not out.get("ok"):
        err = (out.get("error_full") or out.get("error") or "download failed").strip()
        raise RuntimeError(err)
    runner.set_progress(record.task_id, 1.0, "Download finished")
    result: Dict[str, Any] = {
        "downloaded_files": [out.get("save_path") or ""],
        "file_name": out.get("file_name") or "",
        "save_path": out.get("save_path") or "",
    }
    thumb = out.get("thumbnail_path") or ""
    if thumb:
        result["cover_thumbnail"] = thumb
    # R12.1 抽取 yt-dlp 元数据写入 task.result，ProcessingPage Hero 展示
    if out.get("title"):
        result["video_title"] = out["title"]
    if out.get("duration"):
        result["video_duration"] = out["duration"]  # seconds
    if out.get("uploader"):
        result["video_uploader"] = out["uploader"]
    if out.get("thumbnail_url"):
        result["video_thumbnail_url"] = out["thumbnail_url"]
    if out.get("description"):
        result["video_description"] = out["description"]
    if out.get("upload_date"):
        result["video_upload_date"] = out["upload_date"]
    return result


def _apply_ytdlp_metadata_to_task(
    record: TaskRecord,
    runner: TaskRunner,
    dl_result: Dict[str, Any],
) -> Dict[str, Any]:
    """R13.6.1 把 yt-dlp 返回的 metadata 写进 task.result，并触发工作空间改名。

    返回值：一个 dict，含本次要 merge 进 task.result 的 metadata 字段。
    调用方负责把返回值 merge 到自己最终的 result dict 里。

    副作用：
    - 在 task.result 上即时 update（runner.store.update(..., result=...)）
    - 调用 workspaces._maybe_rename_workspace_from_video_title 触发 workspace 改名（如适用）
    """
    meta: Dict[str, Any] = {}
    for key in ("title", "duration", "uploader", "thumbnail_url", "description", "upload_date"):
        val = dl_result.get(key)
        if not val:
            continue
        meta[f"video_{key}"] = val
    if not meta:
        return meta

    # 即时写入 task.result，前端 SSE 下一帧就能看到
    try:
        current = dict(record.result or {})
        current.update(meta)
        runner.store.update(record.task_id, result=current)
    except Exception:
        pass  # 写失败不阻塞主流程

    # 触发 workspace 改名（懒导入避免循环 import）
    try:
        from backend.app.routes.workspaces import (
            _maybe_rename_workspace_from_video_title,
        )
        _maybe_rename_workspace_from_video_title(record, meta)
    except Exception:
        pass

    return meta


def _try_cc_subtitle(
    payload: Dict[str, Any],
    log: Any,
) -> Optional[Tuple[str, List[Dict[str, Any]], Dict[str, Any]]]:
    """④16 CC-first：尝试直取平台字幕。

    返回 (transcript_text, segments, meta) 或 None。
    调用方根据返回值决定：命中→跳过 Whisper，未命中→回退 Whisper。
    """
    prefer_subtitle = bool(payload.get('prefer_subtitle', True))
    video_url = str(payload.get('url') or '').strip()

    if not (prefer_subtitle and video_url):
        if not prefer_subtitle:
            log("ℹ️  字幕优先已关闭，直接走 Whisper")
        return None

    log("🎯 字幕优先模式：尝试直取平台 CC 字幕...")
    try:
        from backend.app.services.subtitle_fetcher import fetch_best_subtitle

        # 复用 pipeline 的下载上下文（cookie/extras），B站 412 必需
        dl_kwargs = _resolve_download_kwargs(payload)
        result = fetch_best_subtitle(
            video_url,
            proxy=dl_kwargs.get('proxy'),
            po_token=dl_kwargs.get('po_token'),
            visitor_data=dl_kwargs.get('visitor_data'),
            cookie_base_dirs=dl_kwargs.get('cookie_base_dirs_list'),
        )

        if not result:
            log("ℹ️  未获取到平台字幕，回退 Whisper 转写")
            return None

        transcript_text, segments, meta = result
        source = meta.get('source', 'unknown')
        lang = meta.get('lang', '?')
        seg_count = len(segments)

        if source == 'manual':
            # 人工字幕直接用
            log(f"✅ 人工字幕命中 (lang={lang}) | {len(transcript_text)} 字符 / {seg_count} 段，跳过 Whisper")
        else:
            # 自动字幕过规则层清洗
            from shared.transcript_cleaner import clean_transcript
            raw_len = len(transcript_text)
            glossary = payload.get("glossary") or []
            transcript_text = clean_transcript(transcript_text, glossary=glossary)
            log(f"✅ 自动字幕命中 (lang={lang}) + 清洗 | {raw_len} → {len(transcript_text)} 字符 / {seg_count} 段，跳过 Whisper")

        return transcript_text, segments, meta

    except Exception as e:
        log(f"ℹ️  字幕获取异常（{e}），回退 Whisper 转写")
        return None


def _run_subtitle_summary(
    videos: List[Path],
    payload: Dict[str, Any],
    task_id: str,
    text_model: str,
    api_key: str,
    project_video_dir: Path,
    project_json_dir: Path,
    runner: TaskRunner,
) -> Dict[str, Any]:
    """N7b 路径 1：从视频提取音频 → Whisper 转写 → LLM 字幕直接总结。"""
    log = lambda msg: runner.append_log(task_id, msg)  # noqa: E731

    # 0. 字幕优先分支（④16 CC-first）
    cc_result = _try_cc_subtitle(payload, log)
    if cc_result:
        transcript_text, transcript_segments, _meta = cc_result
        runner.set_progress(task_id, 0.97, "字幕已就绪，准备总结...")
        # 跳过音频提取 + Whisper，直接进入字幕清洗（3.5）→ LLM 总结（4）
        _cc_skip_to_summary = True
    else:
        _cc_skip_to_summary = False

    # ---- 以下：如果 _cc_skip_to_summary=False，走原有 Whisper 流程 ----

    if not _cc_skip_to_summary:
        # 1. 选第一个视频文件
        video_path = videos[0]
        log(f"🔊 路径 1 字幕总结 | 视频: {video_path.name}")

        # 2. 提取音频
        audio_hash = hashlib.md5(str(video_path).encode()).hexdigest()[:8]
        audio_path = project_json_dir / f"{video_path.stem}_{audio_hash}.wav"
        try:
            runner.set_progress(task_id, 0.955, "提取音频轨道...")
            _extract_audio_from_video(video_path, audio_path, log_fn=log)
        except Exception as e:
            log(f"⚠️  音频提取失败: {e}")
            return {"summary_path": "subtitle", "summary_error": f"音频提取失败: {e}"}

        # 3. Whisper 转写
        transcript_text = ""
        transcript_segments: List[Dict[str, Any]] = []
        try:
            from backend.app.services.asr_fast_whisper import (
                is_fast_whisper_available,
                transcribe_file_with_fast_whisper,
            )
            if not is_fast_whisper_available():
                log("⚠️  本地 ASR 引擎未就绪，跳过转写")
                return {"summary_path": "subtitle", "transcript": [], "summary_error": "ASR 引擎未就绪"}

            runner.set_progress(task_id, 0.96, "Whisper 转写中...")
            tcfg = load_settings().transcriber
            log(f"📄 Whisper 转写 | model={tcfg.whisper_model_size} device={tcfg.device}")

            def _on_progress(ratio: float, msg: str) -> None:
                mapped = 0.96 + 0.02 * max(0.0, min(1.0, ratio))
                runner.set_progress(task_id, mapped, msg)

            whisper_result = transcribe_file_with_fast_whisper(
                str(audio_path),
                model_name=tcfg.whisper_model_size or "base",
                device=tcfg.device or "cpu",
                language=tcfg.language or "",
                initial_prompt=tcfg.initial_prompt or "",
                log_callback=log,
                progress_callback=_on_progress,
                return_segments=True,
            )
            transcript_text, transcript_segments, whisper_duration = whisper_result
            log(f"✅ 转写完成 | {len(transcript_text)} 字符 / {len(transcript_segments)} 段 / {whisper_duration:.1f}s")
        except Exception as e:
            log(f"⚠️  Whisper 转写失败: {e}\n{tb.format_exc()}")
            return {"summary_path": "subtitle", "transcript": [], "summary_error": f"转写失败: {e}"}

        if not transcript_text.strip():
            log("⚠️  转写结果为空（可能无人声）")
            return {
                "summary_path": "subtitle",
                "transcript": [],
                "summary": "（转写结果为空，可能视频无人声内容）",
            }

    # 3.5 字幕清洗（F1.6）—— 对字幕（人工/自动）和 Whisper 结果都执行
    from shared.transcript_cleaner import clean_transcript

    glossary = payload.get("glossary") or []
    if api_key:
        def _llm_polish(prompt: str) -> str:
            settings = load_settings()
            registry = create_default_registry()
            profile = registry.resolve_default_profile(settings, "chat")
            provider = registry.build(profile)
            chat_model = text_model or str(
                getattr(profile.default_models, "chat", None) or ""
            ).strip()
            if not chat_model:
                return ""
            return provider.chat(ChatRequest(
                model=chat_model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2,
                max_tokens=4000,
            ))

        try:
            runner.set_progress(task_id, 0.975, "字幕清洗中...")
            raw_len = len(transcript_text)
            transcript_text = clean_transcript(
                transcript_text, glossary=glossary, llm_fn=_llm_polish,
            )
            log(f"🧹 字幕清洗完成 | {raw_len} → {len(transcript_text)} 字符")
        except Exception as e:
            log(f"⚠️  字幕清洗失败（保留原始转写）: {e}")
    else:
        # 无 API key 时只做规则层清洗
        transcript_text = clean_transcript(transcript_text)
        log("🧹 字幕清洗完成（仅规则层，无 API key）")

    # 4. LLM 总结
    video_template = str(payload.get("video_template") or "其它").strip()
    summary_depth = str(payload.get("summary_depth") or "normal").strip()
    output_format = str(payload.get("output_format") or "summary").strip()
    summary = ""

    # V3.3: auto-detect video template
    detected_template = ""
    if video_template == "auto" and transcript_text.strip():
        if api_key:
            try:
                video_title = video_path.stem
                detected = _detect_video_template(video_title, transcript_text[:500])
                if detected:
                    detected_template = detected
                    video_template = detected
                    log(f"🤖 自动检测模板 → {detected}")
            except Exception as e:
                log(f"⚠️ 模板自动检测失败，兜底「其它」: {e}")
                video_template = "其它"
        else:
            video_template = "其它"
            log("⚠️ 无 API key，「auto」模式兜底「其它」")

    if api_key:
        try:
            runner.set_progress(task_id, 0.98, "LLM 生成摘要...")
            # R18: 优先使用 summary_template（新模板系统）
            summary_template_id = str(payload.get("summary_template") or "").strip()
            summary_max_tokens = 1200
            if summary_template_id:
                from backend.app.services.summary_templates import get_template
                tpl = get_template(summary_template_id)
                prompt = tpl.user_prompt.replace("{transcript}", transcript_text[:12000])
                summary_max_tokens = 3000
                log(f"📝 LLM 总结 | template={tpl.label} ({summary_template_id})")
            else:
                prompt = _build_video_summary_prompt(
                    transcript_text, video_template, summary_depth, output_format,
                )
                log(f"📝 LLM 总结 | template={video_template} | depth={summary_depth} | format={output_format}")

            settings = load_settings()
            registry = create_default_registry()
            profile = registry.resolve_default_profile(settings, "chat")
            provider = registry.build(profile)
            chat_model = text_model or str(
                getattr(profile.default_models, "chat", None) or ""
            ).strip()
            if chat_model:
                summary = provider.chat(
                    ChatRequest(
                        model=chat_model,
                        messages=[{"role": "user", "content": prompt}],
                        temperature=0.3,
                        max_tokens=summary_max_tokens,
                    )
                )
                log(f"✅ 摘要生成完成 | {len(summary)} 字符")
            else:
                log("⚠️  未配置 text_model，跳过 LLM 总结")
        except Exception as e:
            log(f"⚠️  LLM 总结失败: {e}")
    else:
        log("⚠️  无 API key，跳过 LLM 总结")

    # 清理临时音频文件
    try:
        audio_path.unlink(missing_ok=True)
    except Exception:
        pass

    # segment_refiner：切细过长字幕段（在存入 results 前）
    transcript_segments = refine_segments(transcript_segments)

    # 规范化 transcript 为数组格式（前端 VideoResult.transcript 期望 VideoResultTranscriptLine[]）
    transcript_lines = _build_display_transcript_lines(transcript_text, transcript_segments)

    return {
        "summary_path": "subtitle",
        "transcript": transcript_lines,
        "transcript_text": transcript_text,  # 保留原始文本供备用
        "transcript_segments": transcript_segments,
        "summary": summary,
        "video_template": video_template,
        "detected_template": detected_template,
        "output_format": output_format,
        "duration_sec": whisper_duration,
    }


def _collect_frame_descriptions(json_paths: list) -> str:
    """从 VLM 视觉数据 JSON 文件中收集所有帧描述文本。"""
    import json as _json
    lines: list[str] = []
    for jp in json_paths:
        try:
            with open(jp, "r", encoding="utf-8") as f:
                data = _json.load(f)
        except Exception:
            continue
        for frame in data.get("frames", []):
            desc = frame.get("description_zh") or frame.get("description") or ""
            ts = frame.get("timestamp", "")
            if desc.strip():
                lines.append(f"[{ts}] {desc.strip()}")
    return "\n".join(lines)


def _extract_bvid(filename: str) -> str:
    """从文件名提取 B 站 BV 号（BV + 数字字母），无则返回空串。"""
    m = re.search(r"(BV[0-9A-Za-z]+)", filename)
    return m.group(1) if m else ""


def _find_visual_json_paths_for_videos(project_json_dir: Path, videos: List[Path]) -> List[Path]:
    """只返回当前 videos 对应的 VLM JSON，避免复用同工作区里其它视频的视觉数据。

    匹配策略（R3.7 修复中文标点/连字符导致 safe-name 不一致）：
    1. 优先 BV 号匹配：从视频文件名提 BV 号，在视觉 JSON 文件名里找含同一 BV 号者。
    2. 回退 safe-name：无 BV 号（非 B 站/本地文件）时用 get_safe_name 精确匹配。
    """
    if not videos:
        return []

    all_jsons = list(project_json_dir.glob("*_视觉数据.json"))
    if not all_jsons:
        return []

    matched: set[Path] = set()

    # ── 1. BV 号匹配（优先） ──
    bvid_to_video: dict[str, Path] = {}
    videos_without_bvid: list[Path] = []
    for video in videos:
        bvid = _extract_bvid(video.name)
        if bvid:
            bvid_to_video[bvid] = video
        else:
            videos_without_bvid.append(video)

    if bvid_to_video:
        for json_path in all_jsons:
            for bvid in bvid_to_video:
                if bvid in json_path.name:
                    matched.add(json_path)
                    break

    # ── 2. safe-name 回退（无 BV 号的视频） ──
    if videos_without_bvid:
        fallback_names = {f"{get_safe_name(v)}_视觉数据.json" for v in videos_without_bvid}
        for json_path in all_jsons:
            if json_path not in matched and json_path.name in fallback_names:
                matched.add(json_path)

    return sorted(matched)


def _generate_combined_summary(
    api_key: str,
    text_model: str,
    transcript_text: str,
    frame_descriptions: str,
    payload: Dict[str, Any],
    runner: Any,
    task_id: str,
    tweet_text: str = "",
) -> str:
    """用 transcript + 帧描述 生成音视频合并总结。"""
    if not api_key or not text_model:
        return ""
    if not transcript_text.strip() and not frame_descriptions.strip() and not tweet_text.strip():
        return ""

    template = str(payload.get("video_template") or "").strip()
    depth = str(payload.get("summary_depth") or "详细").strip()
    output_format = str(payload.get("output_format") or "").strip()

    prompt = _build_combined_summary_prompt(
        transcript_text=transcript_text,
        frame_descriptions=frame_descriptions,
        video_template=template,
        summary_depth=depth,
        output_format=output_format,
        tweet_text=tweet_text,
    )

    try:
        registry = create_default_registry()
        settings = load_settings()
        profile = registry.resolve_default_profile(settings, "chat")
        provider = registry.build(profile)

        resp = provider.chat(ChatRequest(
            model=text_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
        ))
        return resp.strip()
    except Exception as e:
        runner.append_log(task_id, f"⚠️ combined summary 生成失败: {e}")
        return ""


def _build_combined_summary_prompt(
    transcript_text: str,
    frame_descriptions: str,
    video_template: str,
    summary_depth: str,
    output_format: str,
    tweet_text: str = "",
) -> str:
    """构建音视频合并总结 prompt。"""
    parts: list[str] = []
    parts.append("你是一个专业的视频内容分析师。请根据以下音频转写文本和画面描述，生成一份综合性的视频总结。")

    if video_template and video_template != "auto":
        parts.append(f"视频类型：{video_template}")
    if summary_depth:
        depth_map = {"简洁": "请生成简洁的要点总结，控制在 300 字以内。",
                      "详细": "请生成详细的总结，包含关键观点、论据和细节。",
                      "带画面引用": "请生成详细总结，并在关键观点处引用对应的画面描述。"}
        parts.append(depth_map.get(summary_depth, depth_map["详细"]))
    if output_format:
        parts.append(f"输出格式要求：{output_format}")

    # 帖子正文（如 X/Twitter）：作为背景上下文放在最前面
    if tweet_text.strip():
        parts.append(f"\n## 原帖正文（背景上下文）\n\n{tweet_text[:4000]}")

    if transcript_text.strip():
        parts.append(f"\n## 音频转写文本\n\n{transcript_text[:8000]}")
    if frame_descriptions.strip():
        parts.append(f"\n## 画面描述\n\n{frame_descriptions[:8000]}")

    parts.append("\n请生成综合总结：")
    return "\n".join(parts)


def _make_stall_notifier(runner: TaskRunner, task_id: str, *, threshold_sec: float = 30.0):
    """VLM 帧分析进度停滞检测（F3.1）：进度连续 threshold_sec 秒不推进时提示一次
    「可能正在等待 API（限流/排队，sf_client 已自动重试）」，缓解任务卡住却无反馈的体验。
    进度恢复后重置，可再次提示。返回 tick(cur_pct: 0~1) 回调，在轮询循环里每轮调用。"""
    st = {"last_pct": -1.0, "last_ts": time.monotonic(), "notified": False}

    def tick(cur_pct: float) -> None:
        now = time.monotonic()
        if cur_pct > st["last_pct"] + 1e-4:
            st["last_pct"] = cur_pct
            st["last_ts"] = now
            st["notified"] = False
        elif not st["notified"] and now - st["last_ts"] >= threshold_sec:
            runner.append_log(
                task_id,
                "⏳ 帧分析进度较慢，可能正在等待 API（限流或排队中，已自动重试），请耐心等待…",
                level="warning",
            )
            st["notified"] = True

    return tick


def handle_analyze_task(record: TaskRecord, runner: TaskRunner) -> Dict[str, Any]:
    payload = record.payload
    task_id = record.task_id
    settings = load_settings()
    api_key = str(payload.get("api_key") or "").strip() or settings.openai_api_key.strip()
    summary_path = str(payload.get("summary_path") or "").strip()
    # subtitle 路径不需要 API key（仅规则清洗即可运行），video_model 用 GEMINI_API_KEY，其他路径用 OpenAI key
    if not api_key and summary_path not in ("subtitle", "video_model"):
        raise ValueError("analyze requires api_key in payload or settings")
    vision_model = str(payload.get("vision_model") or "").strip() or settings.vision_model
    text_model = str(payload.get("text_model") or "").strip() or settings.text_model
    proxy = str(payload.get("proxy") or "").strip()

    # 日志：记录收到的模型和代理配置
    runner.append_log(
        task_id,
        f"📊 analyze_task 配置 | "
        f"text_model={text_model} | "
        f"vision_model={vision_model} | "
        f"proxy={'✓' if proxy else '✗'}"
    )

    project_video_dir = get_workspace_videos_dir(record.project_id)
    project_video_dir.mkdir(parents=True, exist_ok=True)   # 确保目录存在，防止 FileNotFoundError
    project_json_dir = get_workspace_json_dir(record.project_id)
    project_json_dir.mkdir(parents=True, exist_ok=True)
    videos = find_videos(project_video_dir)
    raw_names = payload.get("video_basenames")
    if isinstance(raw_names, list) and raw_names:
        allowed = {str(x) for x in raw_names}
        videos = [v for v in videos if v.name in allowed]
    if not videos:
        raise ValueError(f"no videos found in {project_video_dir}")

    # N7b path 3: video_model (Gemini 直传) — 在 videos 加载后执行
    if summary_path == "video_model":
        return _run_video_model_path(videos, payload, task_id, project_json_dir, runner)

    # N7b path 1 (subtitle): ASR/text-only, no VLM frame analysis needed
    # av_combined: ASR first, then VLM, then combined LLM summary
    if summary_path in ("subtitle", "av_combined"):
        runner.set_progress(record.task_id, 0.1, f"Found {len(videos)} videos")
        subtitle_result = _run_subtitle_summary(
            videos=videos,
            payload=payload,
            task_id=task_id,
            text_model=text_model,
            api_key=api_key,
            project_video_dir=project_video_dir,
            project_json_dir=project_json_dir,
            runner=runner,
        )
        if summary_path == "subtitle":
            result: Dict[str, Any] = {
                "json_outputs": [],
                "json_output_basenames": [],
                "json_output_dir": str(project_json_dir.resolve()),
            }
            result.update(subtitle_result)
            runner.set_progress(record.task_id, 1.0, "Analysis finished")
            return result

        # av_combined: 先拿 transcript，再跑 VLM 帧分析，最后合并总结
        runner.append_log(task_id, "🎬 av_combined: ASR 完成，开始 VLM 帧分析…")
        runner.set_progress(record.task_id, 0.3, "VLM frame analysis starting")
        frame_prompts = payload.get("frame_prompt")
        capture_params = CaptureParams.from_dict(frame_prompts) if frame_prompts is not None else _tier_capture_params()
        _vlm_cancel = threading.Event()
        state = run_batch_analysis(
            api_key=api_key,
            video_paths=videos,
            vision_model=vision_model,
            text_model=text_model,
            auto_sync_json=True,
            target_json_dir=project_json_dir,
            capture_params=capture_params,
            concurrency=_tier_vlm_concurrency(),
            cancel_event=_vlm_cancel,
        )
        last_reported_pct = -100.0
        _stall = _make_stall_notifier(runner, record.task_id)
        while not state.finished:
            if runner.is_cancel_requested(record.task_id):
                _vlm_cancel.set()  # 取消时让后台截帧 worker 停下
                break
            snaps = state.snapshot()
            if snaps:
                avg = sum(float(s["percent"]) for s in snaps) / max(len(snaps), 1) / 100.0
                current_pct = avg * 100
                _stall(avg)
                if current_pct - last_reported_pct >= 5:
                    runner.set_progress(record.task_id, min(0.65, max(0.3, 0.3 + avg * 0.35)), "Analyzing video frames")
                    last_reported_pct = current_pct
                # 每 5% 或每 2 秒打一条日志
                for s in snaps:
                    if s["total_frames"] > 0:
                        runner.append_log(
                            task_id,
                            f"🎬 截帧进度：{s['analyzed_frames']}/{s['total_frames']} 帧 ({s['percent']:.1f}%)"
                        )
            time.sleep(0.2)
        # 用户取消早退：不跑合并总结/收尾，进度停在取消时刻的真实值，终态 CANCELLED
        if runner.is_cancel_requested(record.task_id):
            runner.append_log(task_id, "⛔ 已取消：跳过合并总结与收尾", level="warning")
            rec = runner.store.get(record.task_id)
            partial = dict(rec.result) if rec and rec.result else {}
            partial.update({"summary_path": "av_combined", "cancelled": True})
            return partial
        runner.set_progress(record.task_id, 0.7, "Generating combined summary")

        # 收集帧描述
        json_paths = _find_visual_json_paths_for_videos(project_json_dir, videos)
        frame_descriptions = _collect_frame_descriptions(json_paths)

        # 合并总结：transcript + frame descriptions → LLM
        transcript_text = subtitle_result.get("transcript_text", "")
        # R26: X 帖子正文注入合并总结（从任务产物元数据中取）
        _tweet_text = ""
        _sniff_platform = str(payload.get("source_meta", {}) and (payload.get("source_meta") or {}).get("platform", ""))
        # handle_note_task download 阶段的 dl_result["content"] 存了帖子正文
        # 这里从 payload 取不到，改为从 record.result["tweet_text"] 取
        _prev_rec = runner.store.get(record.task_id)
        _prev_result = (_prev_rec.result or {}) if _prev_rec else {}
        _tweet_text = str(_prev_result.get("tweet_text", "") or "")
        combined_summary = _generate_combined_summary(
            api_key=api_key,
            text_model=text_model,
            transcript_text=transcript_text,
            frame_descriptions=frame_descriptions,
            payload=payload,
            runner=runner,
            task_id=task_id,
            tweet_text=_tweet_text,
        )

        av_result: Dict[str, Any] = {
            "summary_path": "av_combined",
            "json_outputs": [str(p.resolve()) for p in json_paths],
            "json_output_basenames": [p.name for p in json_paths],
            "json_output_dir": str(project_json_dir.resolve()),
            "transcript": subtitle_result.get("transcript", []),
            "transcript_text": transcript_text,
            "summary": combined_summary or subtitle_result.get("summary", ""),
            "duration_sec": subtitle_result.get("duration_sec", 0),
        }
        runner.set_progress(record.task_id, 1.0, "av_combined analysis finished")
        return av_result

    # N7 VLM 路径（含 visual_only 和默认 detailed）
    runner.set_progress(record.task_id, 0.1, f"Found {len(videos)} videos")
    frame_prompts = payload.get("frame_prompt")
    capture_params = CaptureParams.from_dict(frame_prompts) if frame_prompts is not None else _tier_capture_params()
    if capture_params is not None:
        runner.append_log(
            task_id,
            f"🎬 capture_params | mode={capture_params.mode} | "
            f"interval={capture_params.interval_sec}s | "
            f"max_frames={capture_params.max_frames} | "
            f"frames_per_shot={capture_params.frames_per_shot}"
        )

    _vlm_cancel = threading.Event()
    state = run_batch_analysis(
        api_key=api_key,
        video_paths=videos,
        vision_model=vision_model,
        text_model=text_model,
        auto_sync_json=True,
        target_json_dir=project_json_dir,
        capture_params=capture_params,
        concurrency=_tier_vlm_concurrency(),
        cancel_event=_vlm_cancel,
    )
    last_reported_pct = -100.0
    _stall = _make_stall_notifier(runner, record.task_id)
    while not state.finished:
        if runner.is_cancel_requested(record.task_id):
            _vlm_cancel.set()  # 取消时让后台截帧 worker 停下
            break
        snaps = state.snapshot()
        if snaps:
            avg = sum(float(s["percent"]) for s in snaps) / max(len(snaps), 1) / 100.0
            current_pct = avg * 100
            _stall(avg)
            if current_pct - last_reported_pct >= 5:
                runner.set_progress(record.task_id, min(0.95, max(0.1, avg)), "Analyzing video frames")
                last_reported_pct = current_pct
        live = state.live_frames_snapshot()
        tail = live[-12:] if live else []
        rec = runner.store.get(record.task_id)
        merged = dict(rec.result) if rec and rec.result else {}
        merged["live_preview"] = {"snapshots": snaps, "recent_frames": tail}
        runner.store.update(record.task_id, result=merged)
        time.sleep(0.2)
    # 用户取消早退：不跑帧收尾/归档，进度停在取消时刻的真实值，终态 CANCELLED
    if runner.is_cancel_requested(record.task_id):
        runner.append_log(task_id, "⛔ 已取消：跳过帧收尾归档", level="warning")
        rec = runner.store.get(record.task_id)
        partial = dict(rec.result) if rec and rec.result else {}
        partial.update({"cancelled": True})
        return partial
    runner.set_progress(record.task_id, 0.95, "Frame analysis finished")
    json_paths = _find_visual_json_paths_for_videos(project_json_dir, videos)
    basenames = [p.name for p in json_paths]
    root = str(project_json_dir.resolve())

    # 收集每个视频的第一帧，供资料库卡片缩略图使用
    frames: List[Dict[str, str]] = []
    first_frame_path: Optional[str] = None
    for vp in videos:
        output_dir = get_output_dir(vp)
        frames_dir = output_dir / "frames"
        if frames_dir.is_dir():
            jpgs = sorted(frames_dir.glob("*.jpg"))
            if jpgs:
                abs_path = str(jpgs[0].resolve())
                if first_frame_path is None:
                    first_frame_path = abs_path
                frames.append({
                    "frame_image": jpgs[0].name,
                    "frame_image_path": abs_path,
                })

    result: Dict[str, Any] = {
        "json_outputs": [str(p.resolve()) for p in json_paths],
        "json_output_basenames": basenames,
        "json_output_dir": root,
    }
    if frames:
        result["frames"] = frames
    if summary_path == "visual_only":
        result["summary_path"] = "visual_only"

    runner.set_progress(record.task_id, 1.0, "Analysis finished")
    return result


def handle_create_task(record: TaskRecord, runner: TaskRunner) -> Dict[str, Any]:
    """处理创意内容生成任务"""
    payload = record.payload
    query = str(payload.get("prompt") or "").strip()
    if not query:
        raise ValueError("create payload.prompt is required")

    settings = load_settings()
    registry = create_default_registry()
    profile = registry.resolve_default_profile(settings, "chat")
    provider = registry.build(profile)
    model = str(payload.get("model") or profile.default_models.get("chat") or settings.text_model or "").strip()
    if not model:
        raise ValueError("create task model is required")

    runner.set_progress(record.task_id, 0.2, f"Generating via {profile.name}")
    content = provider.chat(
        ChatRequest(
            model=model,
            messages=[
                {"role": "system", "content": "You are a creative storyboard writer."},
                {"role": "user", "content": query},
            ],
            temperature=float(payload.get("temperature") or 0.7),
            max_tokens=int(payload.get("max_tokens") or 2048),
        )
    )
    runner.set_progress(record.task_id, 1.0, "Creative generation finished")

    runtime_dir = get_workspace_json_dir(record.project_id).parent / "runtime"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    out_file = runtime_dir / f"{record.task_id}.md"
    out_file.write_text(content, encoding="utf-8")
    return {"content": content, "artifact_path": str(out_file)}


def handle_storyboard_task(record: TaskRecord, runner: TaskRunner) -> Dict[str, Any]:
    payload = record.payload
    runner.set_progress(record.task_id, 0.02, "Storyboard pipeline starting")
    raw_paths = payload.get("image_paths") or []
    image_paths = [str(x) for x in raw_paths] if isinstance(raw_paths, list) else []
    raw_bn = payload.get("rag_json_basenames")
    rag_basenames = [str(x) for x in raw_bn] if isinstance(raw_bn, list) else None
    rag_kpid = str(payload.get("rag_knowledge_project_id") or "").strip() or None

    result = run_storyboard_generation(
        project_id=record.project_id,
        product_name=str(payload.get("product_name") or ""),
        core_features=str(payload.get("core_features") or ""),
        web_enrichment_md=str(payload.get("web_enrichment_md") or ""),
        api_key=str(payload.get("api_key") or "").strip() or load_settings().openai_api_key,
        anthropic_key=str(payload.get("anthropic_key") or "").strip() or load_settings().anthropic_api_key,
        vision_model=str(payload.get("vision_model") or ""),
        text_model=str(payload.get("text_model") or ""),
        embedding_model=str(payload.get("embedding_model") or ""),
        text_backend=str(payload.get("text_backend") or ""),
        anthropic_model=str(payload.get("anthropic_model") or ""),
        image_paths=image_paths,
        rag_knowledge_project_id=rag_kpid,
        rag_json_basenames=rag_basenames,
        log=lambda m: runner.append_log(record.task_id, m),
    )
    runner.set_progress(record.task_id, 1.0, "Storyboard finished")
    return result


def _persist_intermediate(runner: TaskRunner, task_id: str, result_patch: Dict[str, Any]) -> None:
    """将中间结果合并写入 task.result，保留已有字段。"""
    rec = runner.store.get(task_id)
    merged = dict(rec.result) if rec and rec.result else {}
    merged.update(result_patch)
    runner.store.update(task_id, result=merged)


# ── note task 下载/识别/步骤调度 helpers ────────────────────

def _extra_tweet_text(tweet_text: str) -> dict:
    """构造包含 X 帖子正文的额外字段，仅当正文非空时返回。"""
    if tweet_text.strip():
        return {"tweet_text": tweet_text}
    return {}


def _resolve_b23_url(url: str) -> str:
    """解析 b23.tv 短链 → 真实 URL；非短链或解析失败返回原 URL。"""
    if "b23.tv" not in url.lower():
        return url
    try:
        import urllib.request as _req
        req = _req.Request(url, method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
        resp = _req.urlopen(req, timeout=8)
        resolved = resp.url
        return resolved if resolved else url
    except Exception:
        return url


def _classify_note_url(url: str) -> str:
    """根据 URL 形态给出下载器提示（非最终类型，仅用于选择下载器）。

    返回: "xiaohongshu" | "twitter" | "bili_opus" | "text_page" | "video_audio" | "unknown"
    """
    # b23.tv 短链先解析到真实 URL，再按真实 URL 判断类型
    if "b23.tv" in url.lower():
        url = _resolve_b23_url(url)
    lower = url.lower()
    if is_xiaohongshu_url_or_text(url):
        return "xiaohongshu"
    # X (Twitter)：x.com / twitter.com
    from shared.twitter_share import is_twitter_url_or_text
    if is_twitter_url_or_text(url):
        return "twitter"
    # B站图文动态 /opus/ 路径（移动端 __INITIAL_STATE__ 适配器，不能走 load_url）
    if "bilibili.com" in lower and "/opus/" in lower:
        return "bili_opus"
    # 常见文本网页平台（公众号、少数派、MBA智库等）——这些平台 yt-dlp 无法处理
    if any(d in lower for d in ("mp.weixin.qq.com", "sspai.com", "mbalib.com", "zhihu.com", "juejin.cn")):
        return "text_page"
    # 明确的视频/音频平台
    if is_platform_url(url):
        return "video_audio"
    return "unknown"


def _download_note_source(
    *,
    url: str,
    payload: dict,
    record: TaskRecord,
    runner: TaskRunner,
    task_id: str,
    project_video_dir: Path,
    dl_kwargs: dict,
) -> dict:
    """根据 URL 类型选择下载器，返回统一结构。

    返回:
        {
            "ok": bool,
            "kind_hint": "text" | "image_text" | "video" | "audio",
            "source_path": str,       # 本地文件/目录
            "content": str,           # 文本内容（text 类型）
            "title": str,
            "images": list[str],      # 图片路径列表
            "video_file": str,        # 视频文件路径
            "metadata": dict,
            "error": str,
        }
    """
    log = lambda m: runner.append_log(task_id, m)
    # Bug #2：本地视频/音频 → 已在工作空间，跳过下载（source_type 由 bridge 标记）
    if payload.get("source_type") == "local":
        _names = payload.get("video_basenames")
        _allowed = {str(x) for x in _names} if isinstance(_names, list) and _names else set()
        _workspace_id = str(payload.get("workspace_id") or record.project_id)
        _search_dirs = []
        for _dir in (project_video_dir, get_workspace_videos_dir(_workspace_id), get_workspace_root(_workspace_id)):
            if _dir not in _search_dirs:
                _search_dirs.append(_dir)
        videos = []
        for _dir in _search_dirs:
            if not _dir.exists():
                continue
            _candidates = find_videos(_dir)
            if _allowed:
                _candidates = [v for v in _candidates if v.name in _allowed]
            if _candidates:
                videos = _candidates
                break
        if not videos:
            return {"ok": False, "kind_hint": "video", "error": f"本地视频未找到（{_names}）"}
        _local_path = str(videos[0])
        _ext = Path(_local_path).suffix.lower()
        _kind = "audio" if _ext in {".mp3", ".wav", ".aac", ".flac", ".ogg", ".m4a", ".opus", ".wma"} else "video"
        log(f"📁 本地{_kind} → 跳过下载：{Path(_local_path).name}")

        # #18: 本地视频提取首帧作为封面缩略图 + 探测时长
        _cover_path = ""
        _duration = 0
        if _kind == "video":
            _thumb_path = Path(_local_path).parent / "thumbnail.jpg"
            try:
                if extract_first_frame(_local_path, _thumb_path):
                    _cover_path = str(_thumb_path)
                    log(f"🖼️ 首帧封面已提取：{_thumb_path.name}")
            except Exception:
                pass
            try:
                _duration = probe_duration_seconds(_local_path)
            except Exception:
                _duration = 0

        return {
            "ok": True, "kind_hint": _kind, "source_path": _local_path,
            "content": "", "title": Path(_local_path).stem, "images": [],
            "video_file": _local_path, "metadata": {},
            "cover_thumbnail": _cover_path,
            "video_duration": _duration,
        }
    # b23.tv 短链在入口处统一解析为真实 URL，后续所有适配器用真实 URL 工作
    url = _resolve_b23_url(url)
    url_hint = _classify_note_url(url)

    # ── 小红书 ──
    if url_hint == "xiaohongshu":
        log("📕 小红书笔记 → 走小红书适配器")
        _xhs_out = get_workspace_root(record.project_id) / "image"
        _xhs_out.mkdir(parents=True, exist_ok=True)
        _xhs = run_xiaohongshu_download(
            url_or_text=url, output_dir=str(_xhs_out), log=log,
            progress_callback=lambda p, msg: runner.set_progress(task_id, 0.02 + p * 0.08, msg),
        )
        _nm = _xhs.get("note_meta") or {}
        _note_type = str(_nm.get("type") or "normal")
        _title = str(_nm.get("title") or "小红书笔记")
        _desc = str(_nm.get("desc") or "")
        # 7.2: 实时写入 video_title，让 ProcessingPage 在下载阶段就显示真实标题
        if _title and _title != "小红书笔记":
            try:
                _cur = dict(record.result or {})
                _cur["video_title"] = _title
                runner.store.update(record.task_id, result=_cur)
            except Exception:
                pass
        if not _xhs.get("ok"):
            # 视频失败也标 video，便于上层按"视频失败"提示而非生成空图文笔记
            _fail_kind = "video" if _note_type == "video" else "image_text"
            return {"ok": False, "kind_hint": _fail_kind, "error": _xhs.get("error") or "小红书解析失败"}
        # 视频笔记：save_path = 视频文件路径，走完整视频流程（转录 + 截帧分析 + 播放）
        if _note_type == "video":
            return {
                "ok": True,
                "kind_hint": "video",
                "source_path": "",
                "content": _desc,
                "title": _title,
                "images": [],
                "video_file": _xhs.get("save_path") or "",
                "metadata": _nm,
            }
        # 图文笔记：save_path = 图片目录
        _note_dir = _xhs.get("save_path") or ""
        _imgs = sorted(
            str(_p) for _p in Path(_note_dir).glob("*")
            if _p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")
        ) if _note_dir and Path(_note_dir).is_dir() else []
        return {
            "ok": True,
            "kind_hint": "image_text",
            "source_path": _note_dir,
            "content": _desc,
            "title": _title,
            "images": _imgs,
            "video_file": "",
            "metadata": _nm,
        }

    # ── X (Twitter) ──
    if url_hint == "twitter":
        from shared.twitter_share import fetch_twitter_meta, run_twitter_download
        log("🐦 X 帖子 → 判断视频 vs 图文…")
        try:
            _tw_meta = fetch_twitter_meta(url)
        except Exception as _e:
            log(f"   ⚠️ syndication 查询失败({_e})，回落 yt-dlp")
            _tw_meta = {"ok": False, "error": str(_e)}
        if _tw_meta.get("ok") and _tw_meta.get("has_video"):
            log("   🎬 视频帖 → yt-dlp 下载")
            # 视频帖交给 yt-dlp（fall through 到 video_audio 分支走 yt-dlp）
            out = run_ytdlp_download(
                url=url,
                output_dir=str(project_video_dir),
                log=log,
                progress_callback=lambda p, msg: runner.set_progress(task_id, 0.02 + p * 0.08, msg),
                speed_callback=lambda s: runner.set_download_speed(task_id, s),
                info_callback=lambda meta: _apply_ytdlp_metadata_to_task(record, runner, meta),
                **dl_kwargs,
            )
            if not out.get("ok"):
                return {"ok": False, "kind_hint": "video", "error": (out.get("error_full") or out.get("error") or "download failed")}
            _apply_ytdlp_metadata_to_task(record, runner, out)
            save_path = str(out.get("save_path") or "")
            # 把帖子正文透传下去，供块 4 合并总结使用
            _tw_text = _tw_meta.get("text", "") or out.get("description", "")
            return {
                "ok": True,
                "kind_hint": "video",
                "source_path": save_path,
                "content": _tw_text,
                "title": str(out.get("title") or _tw_meta.get("author", "")),
                "images": [],
                "video_file": save_path,
                "metadata": out,
                "tweet_text": _tw_text,
            }
        # 无视频：图文帖或纯文本帖
        _image_out = get_workspace_root(record.project_id) / "image"
        _image_out.mkdir(parents=True, exist_ok=True)
        _tw_out = run_twitter_download(
            url_or_text=url, output_dir=str(_image_out), log=log,
            progress_callback=lambda p, msg: runner.set_progress(task_id, 0.02 + p * 0.08, msg),
        )
        if not _tw_out.get("ok"):
            return {"ok": False, "kind_hint": "text", "error": _tw_out.get("error") or "X 帖子解析失败"}
        _tw_tm = _tw_out.get("tweet_meta") or {}
        _tw_desc = str(_tw_tm.get("desc") or "")
        _tw_title = str(_tw_tm.get("title") or "")
        if _tw_title and _tw_title != "X 帖子":
            try:
                _cur = dict(record.result or {})
                _cur["video_title"] = _tw_title
                runner.store.update(record.task_id, result=_cur)
            except Exception:
                pass
        _note_type = str(_tw_tm.get("type") or "text")
        if _note_type == "photo":
            _tw_dir = _tw_out.get("save_path") or ""
            _tw_imgs = sorted(
                str(_p) for _p in Path(_tw_dir).glob("*")
                if _p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")
            ) if _tw_dir and Path(_tw_dir).is_dir() else []
            return {
                "ok": True,
                "kind_hint": "image_text",
                "source_path": _tw_dir,
                "content": _tw_desc,
                "title": _tw_title,
                "images": _tw_imgs,
                "video_file": "",
                "metadata": _tw_tm,
            }
        # 纯文本帖
        return {
            "ok": True,
            "kind_hint": "text",
            "source_path": "",
            "content": _tw_desc,
            "title": _tw_title,
            "images": [],
            "video_file": "",
            "metadata": _tw_tm,
        }

    # ── B站 opus 图文动态（移动端 HTML + __INITIAL_STATE__）──
    if url_hint == "bili_opus":
        from backend.app.downloaders.bilibili_opus import fetch_bilibili_opus, download_opus_images
        log(f"📄 B站 opus → 专用适配器 ({url[:60]})")
        _op = fetch_bilibili_opus(url)
        if not _op.get("ok"):
            return {"ok": False, "kind_hint": "text", "error": _op.get("error") or "B站 opus 解析失败"}
        _remote_imgs = _op.get("images", [])
        _local_imgs: list[str] = []
        _content = _op.get("content", "")
        _opus_out = ""
        if _remote_imgs:
            _opus_id = (re.search(r"/opus/(\d+)", url) or [None, "unknown"])[1]
            _opus_out = get_workspace_root(record.project_id) / "image" / f"opus_{_opus_id}"
            _local_imgs = download_opus_images(_remote_imgs, str(_opus_out))
            # 替换 content 中的远程 URL 为本地路径（供 _img_to_static_url 转 /static/）
            for _r, _l in zip(_remote_imgs, _local_imgs):
                _content = _content.replace(_r, _l)
            log(f"📥 opus 图片已下载: {len(_local_imgs)}/{len(_remote_imgs)} 张")
        kind = "image_text" if _local_imgs else "text"
        return {
            "ok": True,
            "kind_hint": kind,
            "source_path": str(_opus_out) if _local_imgs else "",
            "content": _content,
            "title": _op.get("title", ""),
            "images": _local_imgs,
            "video_file": "",
            "metadata": _op.get("meta", {}),
        }

    # ── 文本网页（公众号 / 少数派 / MBA智库等）──
    if url_hint == "text_page":
        log(f"📄 文本网页 → load_url 抽取正文 ({url[:60]})")
        try:
            doc = load_url(url)
        except TextLoaderError as err:
            return {"ok": False, "kind_hint": "text", "error": str(err)}
        return {
            "ok": True,
            "kind_hint": "text",
            "source_path": doc.source,
            "content": doc.content,
            "title": doc.title,
            "images": [],
            "video_file": "",
            "metadata": doc.meta,
        }

    # ── 明确视频/音频平台 ──
    if url_hint == "video_audio":
        log("🎬 视频/音频平台 → yt-dlp 下载")
        out = run_ytdlp_download(
            url=url,
            output_dir=str(project_video_dir),
            log=log,
            progress_callback=lambda p, msg: runner.set_progress(task_id, 0.02 + p * 0.08, msg),
            speed_callback=lambda s: runner.set_download_speed(task_id, s),
            info_callback=lambda meta: _apply_ytdlp_metadata_to_task(record, runner, meta),
            **dl_kwargs,
        )
        if not out.get("ok"):
            return {"ok": False, "kind_hint": "video", "error": (out.get("error_full") or out.get("error") or "download failed")}
        _apply_ytdlp_metadata_to_task(record, runner, out)
        save_path = str(out.get("save_path") or "")
        ext = Path(save_path).suffix.lower()
        kind = "audio" if ext in {".mp3", ".wav", ".aac", ".flac", ".ogg", ".m4a", ".opus", ".wma"} else "video"
        return {
            "ok": True,
            "kind_hint": kind,
            "source_path": save_path,
            "content": "",
            "title": str(out.get("title") or ""),
            "images": [],
            "video_file": save_path,
            "metadata": out,
        }

    # ── unknown: 先尝试文本网页抽取，失败回落 yt-dlp ──
    log(f"❓ URL 类型不确定 → 先尝试文本网页抽取 ({url[:60]})")
    try:
        doc = load_url(url)
        if doc.char_count > 50:  # 有实质内容
            log(f"   ✓ 网页正文 {doc.char_count} 字符，走 text 路径")
            return {
                "ok": True,
                "kind_hint": "text",
                "source_path": doc.source,
                "content": doc.content,
                "title": doc.title,
                "images": [],
                "video_file": "",
                "metadata": doc.meta,
            }
        log("   ⚠️ 网页正文过短，回落 yt-dlp")
    except TextLoaderError as err:
        log(f"   ⚠️ 网页抽取失败({err})，回落 yt-dlp")

    # 回落 yt-dlp
    out = run_ytdlp_download(
        url=url,
        output_dir=str(project_video_dir),
        log=log,
        progress_callback=lambda p, msg: runner.set_progress(task_id, 0.02 + p * 0.28, msg),
        speed_callback=lambda s: runner.set_download_speed(task_id, s),
        info_callback=lambda meta: _apply_ytdlp_metadata_to_task(record, runner, meta),
        **dl_kwargs,
    )
    if not out.get("ok"):
        return {"ok": False, "kind_hint": "video", "error": (out.get("error_full") or out.get("error") or "download failed")}
    _apply_ytdlp_metadata_to_task(record, runner, out)
    save_path = str(out.get("save_path") or "")
    return {
        "ok": True,
        "kind_hint": "video",
        "source_path": save_path,
        "content": "",
        "title": str(out.get("title") or ""),
        "images": [],
        "video_file": save_path,
        "metadata": out,
    }


def _probe_note_source(download_result: dict, payload: dict) -> dict:
    """PROBE 阶段：根据下载结果确定内容类型，重算后续步骤。

    返回:
        {
            "note_kind": "text" | "image_text" | "mixed" | "video" | "audio",
            "source_title": str,
            "source_text": str,
            "images": list[str],
            "video_file": str,
            "background_context": str,
            "steps": list[str],
        }
    """
    kind = download_result.get("kind_hint", "text")
    title = download_result.get("title", "")
    content = download_result.get("content", "")
    images = download_result.get("images", [])
    video_file = download_result.get("video_file", "")
    requested_kind = str(payload.get("note_media_kind") or "auto").strip()
    if requested_kind and requested_kind != "auto":
        if requested_kind == "image_text" and images:
            kind = "image_text"
        elif requested_kind == "mixed" and video_file and images:
            kind = "mixed"
        elif requested_kind == "video" and video_file:
            kind = "video"
        elif requested_kind == "audio" and video_file:
            kind = "audio"
        elif requested_kind == "text" and content:
            kind = "text"

    # 合并 background_for_recognition
    bg_parts = []
    if payload.get("background_for_recognition"):
        bg_parts.append(str(payload["background_for_recognition"]))
    if download_result.get("metadata"):
        meta = download_result["metadata"]
        if isinstance(meta, dict):
            for key in ("description", "desc", "summary"):
                if meta.get(key):
                    bg_parts.append(str(meta[key]))
                    break
    background_context = "\n".join(bg_parts)

    # 根据内容类型裁剪步骤
    requested = payload.get("steps") or ["download", "transcribe", "analyze", "note"]
    steps = _steps_for_note_kind(kind, requested)

    return {
        "note_kind": kind,
        "source_title": title,
        "source_text": content,
        "images": images,
        "video_file": video_file,
        "background_context": background_context,
        "steps": steps,
    }


def analyze_image_file(
    image_path: str,
    vision_model: str,
    api_key: str,
    *,
    log: Callable[[str], None] = lambda _msg: None,
) -> Dict[str, Any]:
    """对单张图片做 OCR + VLM 描述，返回 {"description", "ocr_text", "description_parts"}。

    description_parts: {"subject", "scene", "color", "composition", "style", "details"}
    无 api_key/vision_model 时跳过 VLM，只做 OCR。
    单张失败不抛异常，返回空字符串兜底。
    """
    result: Dict[str, Any] = {"description": "", "ocr_text": "", "description_parts": {}}
    path = Path(image_path)
    if not path.is_file():
        log(f"⚠️  图片文件不存在：{image_path}")
        return result

    image_bytes = path.read_bytes()

    # ── OCR ──
    try:
        from shared.ocr_service import extract_text

        ocr = extract_text(image_bytes)
        if ocr:
            result["ocr_text"] = ocr
            log(f"🔤 OCR 提取 {len(ocr)} 字：{path.name}")
    except Exception as err:
        log(f"⚠️  OCR 失败（{path.name}）：{err}")

    # ── VLM 描述 ──
    if not api_key or not vision_model:
        log("⚠️  未配置 api_key/vision_model，跳过 VLM 描述")
        return result

    try:
        if image_bytes[:4] == b"\x89PNG":
            mime = "image/png"
        elif image_bytes[:2] == b"\xff\xd8":
            mime = "image/jpeg"
        elif image_bytes[:4] == b"RIFF" and image_bytes[8:12] == b"WEBP":
            mime = "image/webp"
        else:
            mime = "image/jpeg"

        img_b64 = base64.b64encode(image_bytes).decode()
        registry = create_default_registry()
        profile = registry.resolve_default_profile(load_settings(), "vision")
        provider = registry.build(profile)

        prompt = (
            "你是一名专业的图像分析助手。请用中文分析这张图片，严格按以下 JSON 格式输出（不要输出其它内容）：\n"
            "{\n"
            '  "subject": "图片主体（人/物/场景，一句话）",\n'
            '  "scene": "场景环境描述（30字以内）",\n'
            '  "color": "主色调与色彩氛围（30字以内）",\n'
            '  "composition": "构图方式与视觉重心（30字以内）",\n'
            '  "style": "视觉风格（写实/插画/摄影等，20字以内）",\n'
            '  "details": "其它值得注意的细节（50字以内）"\n'
            "}\n"
            "只输出 JSON，不要 markdown 代码块。"
        )
        raw = provider.chat(
            ChatRequest(
                model=vision_model,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{img_b64}"}},
                        {"type": "text", "text": prompt},
                    ],
                }],
                temperature=0.3,
                max_tokens=400,
            )
        )
        raw = raw.strip()
        # 尝试解析 JSON；成功则填充 description_parts，同时拼 description 字符串
        _parts: Dict[str, str] = {}
        try:
            _parts = json.loads(raw)
            _parts = {k: str(v).strip() for k, v in _parts.items() if isinstance(v, str) and v.strip()}
        except (json.JSONDecodeError, TypeError):
            # JSON 解析失败 → raw 就是旧格式的纯文本描述，直接用
            pass
        result["description_parts"] = _parts
        if _parts:
            # 结构化字段拼成人类可读描述（保留旧 description 字符串兼容性）
            result["description"] = "；".join(_parts.values())
        else:
            result["description"] = raw
        log(f"🔍 VLM 描述 {len(raw)} 字：{path.name}")
    except Exception as err:
        log(f"⚠️  VLM 描述失败（{path.name}）：{err}")

    return result


def _img_to_static_url(img_path: str, data_dir: Path) -> str:
    """将图片绝对路径转为 /static/... URL（复用 workspaces.to_static_url 逻辑）。"""
    s = str(img_path)
    if s.startswith("/static/"):
        return s
    try:
        p = Path(s).resolve()
        data_resolved = data_dir.resolve()
        if (data_resolved in p.parents or p == data_resolved) and p.exists():
            return "/static/" + p.relative_to(data_resolved).as_posix()
    except (ValueError, OSError):
        pass
    return ""


def _vlm_note_empty_analysis() -> Dict[str, Any]:
    """VLM 分析失败时的空结果字典（降级兜底）。"""
    return {
        "image_type": "unknown",
        "extracted_text": "",
        "content_summary": "",
        "action_steps": [],
        "key_entities": [],
        "visual_elements": [],
        "visual_value": "low",
        "embed_decision": "skip",
        "insert_hint": "",
        "confidence": 0.0,
    }


def _analyze_image_for_note(
    image_path: str,
    vision_model: str,
    api_key: str,
    *,
    log: Callable[[str], None] = lambda _msg: None,
) -> Dict[str, Any]:
    """VLM-first 图片理解：逐图调视觉模型，返回结构化笔记分析。

    与 analyze_image_file（通用 VLM 描述）不同，本函数面向笔记生成场景：
    - 读出图中文字（不依赖 OCR 库）
    - 判断图片类型和理解价值
    - 决定文字合并或图片插入策略

    单张失败不抛异常，返回空/降级结果。
    """
    result = _vlm_note_empty_analysis()
    result["description"] = ""  # 兼容旧字段
    result["ocr_text"] = ""
    path = Path(image_path)
    if not path.is_file():
        log(f"⚠️  图片文件不存在：{image_path}")
        return result
    if not api_key or not vision_model:
        log("⚠️  未配置 api_key/vision_model，跳过 VLM 分析")
        return result

    image_bytes = path.read_bytes()
    if image_bytes[:4] == b"\x89PNG":
        mime = "image/png"
    elif image_bytes[:2] == b"\xff\xd8":
        mime = "image/jpeg"
    elif image_bytes[:4] == b"RIFF" and image_bytes[8:12] == b"WEBP":
        mime = "image/webp"
    else:
        mime = "image/jpeg"

    prompt = (
        "你是一名专业的图文内容分析助手。请分析这张图片，返回严格 JSON（不要 markdown 代码块）。\n\n"
        "要求：\n"
        "1. 读出图中所有可见文字（按阅读顺序）。\n"
        "2. 判断图片类型。\n"
        "3. 决定这张图在学习笔记中该怎么处理。\n\n"
        "extracted_text 格式化规则（重要）：\n"
        "- 文字型图（text_card）：把图中文字按结构转成 Markdown 标题、列表或表格，不要保留原始 OCR 碎片。\n"
        "- 演示/流程图（ui_demo/flow_diagram）：把步骤转成有序列表，箭头/节点顺序即步骤顺序；只保留对理解有帮助的界面状态说明。\n"
        "- 表格/对比图（chart_table）：优先还原为 Markdown 表格；结构不完整时保留关键行列，缺失单元格用「—」填充。\n"
        "- Logo/装饰图（icon_logo/decorative）：只输出有业务含义的文字（产品名、按钮入口、关键状态），纯装饰信息留空。\n"
        "- 混合图（mixed）：文字转 Markdown，图标/界面状态只保留一句话说明。\n\n"
        "输出格式（严格 JSON，字段顺序固定）：\n"
        "{\n"
        '  "image_type": "text_card | ui_demo | flow_diagram | chart_table'
        ' | icon_logo | decorative | photo | mixed | unknown",\n'
        '  "extracted_text": "按上述规则格式化后的 Markdown 文字；没有则空字符串",\n'
        '  "content_summary": "这张图表达的知识点或信息价值，80-200字",\n'
        '  "action_steps": ["如果是演示/教程图，提取操作步骤"],\n'
        '  "key_entities": ["工具名、功能名、对象名、指标名"],\n'
        '  "visual_elements": ["图中对理解有价值的界面、图标、流程、表格、对比区域"],\n'
        '  "visual_value": "high | medium | low",\n'
        '  "embed_decision": "merge_text | embed_image | skip",\n'
        '  "insert_hint": "适合放到哪个主题段落，例如：操作台设计、输入输出模块",\n'
        '  "confidence": 0.0\n'
        "}\n\n"
        "embed_decision 规则：\n"
        "- merge_text：文字型图，文字和总结进入笔记正文，不插图片。\n"
        "- embed_image：演示图/流程图/表格图/混合图有关键视觉证据，保留图片插入。\n"
        "- skip：装饰/重复/无信息图。\n\n"
        "只输出 JSON，不要任何其它文字。"
    )

    try:
        img_b64 = base64.b64encode(image_bytes).decode()
        registry = create_default_registry()
        profile = registry.resolve_default_profile(load_settings(), "vision")
        provider = registry.build(profile)

        raw = provider.chat(
            ChatRequest(
                model=vision_model,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{img_b64}"}},
                        {"type": "text", "text": prompt},
                    ],
                }],
                temperature=0.2,
                max_tokens=800,
            )
        )
        raw = raw.strip()

        # 去掉可能的 markdown 代码块
        m = re.search(r"```(?:json)?\s*\n?(.*?)```", raw, re.DOTALL)
        if m:
            raw = m.group(1).strip()

        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            # 校验必需字段
            _it = str(parsed.get("image_type") or "unknown").strip()
            _et = str(parsed.get("extracted_text") or "").strip()
            _cs = str(parsed.get("content_summary") or "").strip()
            _ve_list = parsed.get("visual_elements") or []
            if isinstance(_ve_list, list):
                _ve_list = [str(v).strip() for v in _ve_list if str(v).strip()]

            # 只有三个关键字段都为空时才算分析失败
            if not _et and not _cs and not _ve_list:
                log(f"⚠️  VLM 分析内容为空（{path.name}），image_type={_it}")
                result["image_type"] = _it
                return result

            result.update({
                "image_type": _it if _it else "unknown",
                "extracted_text": _et,
                "content_summary": _cs,
                "action_steps": [
                    str(s).strip() for s in (parsed.get("action_steps") or []) if str(s).strip()
                ],
                "key_entities": [
                    str(e).strip() for e in (parsed.get("key_entities") or []) if str(e).strip()
                ],
                "visual_elements": _ve_list,
                "visual_value": str(parsed.get("visual_value") or "low").strip() or "low",
                "embed_decision": str(parsed.get("embed_decision") or "").strip() or "skip",
                "insert_hint": str(parsed.get("insert_hint") or "").strip(),
                "confidence": float(parsed.get("confidence") or 0),
            })

            # 归一化：有实质内容但 embed_decision 缺失/误填为 skip → 默认 merge_text
            # （模型漏填 decision 或不完全听话时，不能让已有文字的图被丢掉）
            if result["embed_decision"] in ("skip", "") and (_et or _cs or _ve_list):
                result["embed_decision"] = "merge_text"
                log(f"ℹ️  embed_decision 缺失但有内容，归一为 merge_text（{path.name}）")

            # 兼容旧字段：description/ocr_text 供下游不感知新字段的函数使用
            result["ocr_text"] = _et
            result["description"] = _cs

            # is_text_image：有文字内容的图
            _TEXT_TYPES = {"text_card", "ui_demo", "mixed"}
            result["is_text_image"] = _it in _TEXT_TYPES or len(_et) > 30

            log(
                f"✅ VLM 分析完成（{path.name}）：type={_it} | "
                f"文字={len(_et)}字 | 决策={result['embed_decision']}"
            )
            return result

        # JSON 解析成功但不是 dict
        log(f"⚠️  VLM 返回非 dict（{path.name}），降级处理")
        result["description"] = str(parsed)[:300]
        result["ocr_text"] = ""
        return result

    except (json.JSONDecodeError, TypeError, ValueError) as exc:
        log(f"⚠️  VLM 返回无法解析为 JSON（{path.name}）：{exc}，尝试提取兜底字段")
        # 兜底：从 raw 文本中尽量提取有用信息
        if raw:
            _desc = raw.strip()[:300]
            result["description"] = _desc
            # 如果 raw 里有看起来像中文句子的，放到 content_summary
            if len(_desc) > 50:
                result["content_summary"] = _desc
        return result
    except Exception as exc:
        log(f"⚠️  VLM 分析失败（{path.name}）：{exc}")
        return result


def _image_intermediate_patch(
    note_kind: str,
    images_from_download: List[str],
    data_dir: Path,
) -> Dict[str, Any]:
    """图文/混合笔记 PROBE 后写入中间结果，让处理页能展示首图封面和图片数量。"""
    if note_kind not in {"image_text", "mixed"} or not images_from_download:
        return {}
    cover = _img_to_static_url(images_from_download[0], data_dir)
    return {
        "cover_thumbnail": cover,
        "image_count": len(images_from_download),
    }


_TOOL_SIGNALS: frozenset[str] = frozenset({
    "App", "app", "应用", "软件", "插件", "网站",
    "推荐", "工作流", "Markdown", "markdown",
    "Obsidian", "导出", "转写", "效率",
    "iOS", "Mac", "Windows", "Android", "浏览器",
    "下载", "扩展", "自动化",
    "Notion", "飞书", "WPS", "Office",
    "截图", "OCR", "翻译", "整理", "收集",
    "插件", "一键", "神器", "必装", "强推",
    "下载地址", "官网", "免费版", "付费", "订阅",
})

_TUTORIAL_SIGNALS: frozenset[str] = frozenset({
    "步骤", "教程", "第一步", "第二步", "第三步",
    "如何", "怎么做", "操作", "配置", "安装", "设置",
    "流程", "指南", "手把手", "Step", "step",
})

_SCIENCE_POPULARIZATION_SIGNALS: frozenset[str] = frozenset({
    "原理", "机制", "科普", "是什么", "为什么",
    "科学", "物理", "化学", "生物", "数学",
    "理论", "概念", "定义", "规律", "定律",
    "实验", "研究", "论文", "发现", "现象",
    "宇宙", "进化", "量子", "基因", "神经",
    "大脑", "心理", "认知", "算法", "逻辑",
})


def _classify_image_text_content(
    result: Dict[str, Any],
    raw_source_text: str,
    image_infos: List[Dict[str, Any]],
    note_body: str,
) -> None:
    """轻量图文内容分类：识别 tutorial / tool_recommendation / science_popularization / unknown，写入 result。

    优先使用 source.md / source_text_enriched，其次才看 image_infos。
    tutorial 信号优先级最高（互斥）。
    """
    if result.get("content_category"):
        return  # 已有分类（重试等），不覆盖

    # 收集所有文本信号：优先 source.md（结构化源材料）
    source_md_raw = str(result.get("source_md_raw") or "")
    source_text_enriched = str(result.get("source_text_enriched") or "")
    texts: List[str] = [source_md_raw or raw_source_text, source_text_enriched, note_body]
    # image_infos 作为补充信号
    for info in image_infos:
        if isinstance(info, dict):
            texts.append(str(info.get("content_summary") or ""))
            texts.append(str(info.get("extracted_text") or info.get("description") or ""))
    blob = "\n".join(texts)

    # 教程信号优先（互斥：命中教程就不再判其他类型）
    tutorial_hit = sum(1 for w in _TUTORIAL_SIGNALS if w in blob)
    if tutorial_hit >= 3:
        result["content_category"] = "tutorial"
        result["default_summary_template"] = "steps"
        return

    tool_hit = sum(1 for w in _TOOL_SIGNALS if w in blob)
    if tool_hit >= 4:
        result["content_category"] = "tool_recommendation"
        result["default_summary_template"] = "tool_recommendation"
        return

    science_hit = sum(1 for w in _SCIENCE_POPULARIZATION_SIGNALS if w in blob)
    if science_hit >= 4:
        result["content_category"] = "science_popularization"
        result["default_summary_template"] = "science_popularization"
        return

    result["content_category"] = "unknown"
    result["default_summary_template"] = "standard"


def _classify_from_source(
    raw_source_text: str,
    source_text_enriched: str,
    image_infos: List[Dict[str, Any]],
) -> str:
    """提前分类（仅基于 source 材料，不含 note_body），用于 note 正文生成时选择模板。

    返回 content_category 字符串。
    """
    texts: List[str] = [raw_source_text, source_text_enriched]
    for info in image_infos:
        if isinstance(info, dict):
            texts.append(str(info.get("content_summary") or ""))
            texts.append(str(info.get("extracted_text") or info.get("description") or ""))
    blob = "\n".join(texts)

    tutorial_hit = sum(1 for w in _TUTORIAL_SIGNALS if w in blob)
    if tutorial_hit >= 3:
        return "tutorial"

    tool_hit = sum(1 for w in _TOOL_SIGNALS if w in blob)
    if tool_hit >= 4:
        return "tool_recommendation"

    science_hit = sum(1 for w in _SCIENCE_POPULARIZATION_SIGNALS if w in blob)
    if science_hit >= 4:
        return "science_popularization"

    return "unknown"


def _image_text_llm_timeout_sec(payload: Dict[str, Any]) -> float:
    """Return the bounded wait time for image-text note LLM calls."""
    raw = payload.get("image_text_llm_timeout_sec", 90)
    try:
        timeout = float(raw)
    except (TypeError, ValueError):
        timeout = 90.0
    return max(0.01, min(timeout, 120.0))


def _chat_with_timeout(
    provider: Any,
    request: ChatRequest,
    *,
    timeout_sec: float,
    label: str,
) -> str:
    """Run provider.chat with a task-level timeout so image notes can fallback."""
    result: Dict[str, Any] = {}
    done = threading.Event()

    def _target() -> None:
        try:
            result["value"] = provider.chat(request)
        except BaseException as exc:  # propagate into the caller thread
            result["error"] = exc
        finally:
            done.set()

    thread = threading.Thread(
        target=_target,
        name=f"image-text-llm-{label}",
        daemon=True,
    )
    thread.start()
    if not done.wait(timeout_sec):
        raise TimeoutError(f"{label} 超时（>{timeout_sec:g}s）")
    if "error" in result:
        raise result["error"]
    return str(result.get("value") or "")


def _compose_images_with_llm(
    *,
    source_text: str,
    image_infos: list[dict],
    settings: Any,
    payload: Dict[str, Any],
    log: Callable[[str], None],
) -> str:
    """NI.3: 用 LLM 把图片按语境插入正文，输出完整 markdown。

    image_infos: [{"idx": int, "description": str, "ocr_text": str, "static_url": str}]
    失败返回空串（调用方 fallback 到原逻辑）。
    """
    api_key = (
        str(payload.get("api_key") or "").strip()
        or (settings.openai_api_key or "").strip()
    )
    if not api_key:
        log("⚠️  无 api_key，跳过图文语境合成")
        return ""

    try:
        registry = create_default_registry()
        profile = registry.resolve_default_profile(settings, "chat")
        provider = registry.build(profile)
        model = (
            str(payload.get("text_model") or "").strip()
            or profile.default_models.get("chat")
            or (settings.text_model or "").strip()
        )
        if not model:
            log("⚠️  未配置 text_model，跳过图文语境合成")
            return ""
    except Exception as exc:
        log(f"⚠️  LLM 初始化失败，跳过图文语境合成：{exc}")
        return ""

    # 构造图列表（优先使用 description_parts 结构化字段）
    img_lines: list[str] = []
    for img in image_infos:
        parts = [f"图{img['idx']}"]
        dp = img.get("description_parts") or {}
        if dp:
            # 结构化字段：更精准的语义信息
            if dp.get("subject"):
                parts.append(f"主体: {dp['subject']}")
            if dp.get("scene"):
                parts.append(f"场景: {dp['scene']}")
            if dp.get("color"):
                parts.append(f"色彩: {dp['color']}")
            if dp.get("composition"):
                parts.append(f"构图: {dp['composition']}")
            if dp.get("style"):
                parts.append(f"风格: {dp['style']}")
            if dp.get("details"):
                parts.append(f"细节: {dp['details']}")
        elif img["description"]:
            # 回退：旧 description 字符串（历史数据）
            parts.append(f"描述: {img['description']}")
        if img["ocr_text"]:
            parts.append(f"OCR文字: {img['ocr_text']}")
        if img["static_url"]:
            parts.append(f"URL: {img['static_url']}")
        img_lines.append(" | ".join(parts))
    img_list_text = "\n".join(img_lines)

    sys_prompt = (
        "你是一名专业的图文编辑。任务：把图片按内容语境插入到正文最相关的位置，输出完整 markdown。\n"
        "规则：\n"
        "1. 文字型图片（以 OCR 文字为主）：将 OCR 内容自然融入正文相应段落，不另起图片块。\n"
        "2. 配图/插图（以视觉描述为主）：用 ![简短描述](图片URL) 插到内容最相关的段落附近。\n"
        "3. 信息完整不丢：正文原文、每张图的描述/OCR 都要体现在输出中。\n"
        "4. 保持原文结构和语义，不要编造新内容。\n"
        "5. 直接输出 markdown，不要加任何解释说明。"
    )

    body = source_text[:12000]
    user_prompt = (
        f"# 正文\n{body}\n\n"
        f"# 图片列表（共 {len(image_infos)} 张）\n{img_list_text}\n\n"
        "请将图片按语境插入正文，输出完整 markdown："
    )

    timeout_sec = _image_text_llm_timeout_sec(payload)
    log(f"⏳ 图文语境合成中，最多等待 {timeout_sec:g}s")
    try:
        raw = _chat_with_timeout(
            provider,
            ChatRequest(
                model=model,
                messages=[
                    {"role": "system", "content": sys_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.3,
                max_tokens=4096,
            ),
            timeout_sec=timeout_sec,
            label="图文语境合成",
        )
        composed = raw.strip()
        if composed:
            # NI.3 guard: 有 static_url 的图但输出里没 /static/ 引用 → 视为合成失败
            expected_urls = [img["static_url"] for img in image_infos if img.get("static_url")]
            if expected_urls and "/static/" not in composed:
                log("⚠️  LLM 输出未包含图片引用，回退到原逻辑")
                return ""
            log(f"✅ 图文语境合成完成，{len(composed)} 字")
            return composed
        log("⚠️  LLM 返回空，回退到原逻辑")
        return ""
    except Exception as exc:
        log(f"⚠️  图文语境合成失败，回退到原逻辑：{exc}")
        return ""


def _generate_image_text_learning_note(
    *,
    source_md: str,
    title: str,
    settings: Any,
    payload: Dict[str, Any],
    log: Callable[[str], None],
    content_category: str = "unknown",
) -> str:
    """图文笔记：基于 source.md 生成总结笔记，按 content_category 路由模板。

    source_md 是 VLM 逐图理解后构建的结构化源材料（Markdown），包含原始文字和图片转化内容。
    note.md 只基于 source.md 做总结，不允许直接逐图描述 image_infos。
    """
    api_key = (
        str(payload.get("api_key") or "").strip()
        or (settings.openai_api_key or "").strip()
    )
    if not api_key:
        log("⚠️  无 api_key，跳过学习笔记生成")
        return ""

    try:
        registry = create_default_registry()
        profile = registry.resolve_default_profile(settings, "chat")
        provider = registry.build(profile)
        model = (
            str(payload.get("text_model") or "").strip()
            or profile.default_models.get("chat")
            or (settings.text_model or "").strip()
        )
        if not model:
            log("⚠️  未配置 text_model，跳过学习笔记生成")
            return ""
    except Exception as exc:
        log(f"⚠️  LLM 初始化失败，跳过学习笔记生成：{exc}")
        return ""

    # ── 按 content_category 选择 prompt 模板 ──
    from backend.app.services.summary_generator import build_image_text_note_prompt

    sys_prompt, user_prompt = build_image_text_note_prompt(source_md, title, content_category)
    label = {
        "tutorial": "教程",
        "tool_recommendation": "工具推荐",
        "science_popularization": "知识科普",
    }.get(content_category, "标准")

    timeout_sec = _image_text_llm_timeout_sec(payload)
    log(f"⏳ {label}总结生成中（类型={content_category}），最多等待 {timeout_sec:g}s")
    try:
        raw = _chat_with_timeout(
            provider,
            ChatRequest(
                model=model,
                messages=[
                    {"role": "system", "content": sys_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.3,
                max_tokens=4096,
            ),
            timeout_sec=timeout_sec,
            label=f"{label}总结生成",
        )
        note = raw.strip()
        if note and len(note) > 80:
            log(f"✅ {label}总结生成完成，{len(note)} 字")
            return note
        log("⚠️  LLM 返回过短，回退到纯文本提炼")
    except Exception as exc:
        log(f"⚠️  {label}总结生成失败，回退到纯文本提炼：{exc}")

    return _fallback_learning_note(source_text=source_md, title=title, log=log)


def _fallback_learning_note(
    *,
    source_text: str,
    title: str,
    log: Callable[[str], None],
) -> str:
    """无 LLM 时的纯文本兜底：从原始文本提炼学习笔记结构。

    不使用逐图描述，只保留原始文本的核心内容。
    """
    if not source_text or len(source_text.strip()) < 30:
        log("⚠️  原始文本过短，无法生成学习笔记兜底")
        return ""

    lines = [f"# {title}"] if title else ["# 学习笔记"]
    lines.append("")
    lines.append("## 核心内容")
    lines.append("")
    paragraphs = [p.strip() for p in source_text.split("\n\n") if p.strip()]
    for para in paragraphs[:10]:
        # 跳过纯图片描述段（含「【图片 N】」标记）
        if "【图片" in para and ("描述" in para or "OCR" in para):
            continue
        # 跳过空行或纯标点
        if len(para) < 5:
            continue
        lines.append(para)
        lines.append("")
    log(f"📝 纯文本兜底笔记，{len(paragraphs)} 段原文（跳过图片描述段）")
    return "\n".join(lines).strip()


def _steps_for_note_kind(kind: str, requested_steps: list[str]) -> list[str]:
    """根据内容类型裁剪后续步骤。"""
    steps = list(requested_steps)
    if kind == "text":
        # 纯文本：不需要转写和截帧
        steps = [s for s in steps if s not in ("transcribe", "analyze")]
    elif kind == "image_text":
        # 图文：不需要转写，也不走视频截帧 analyze（图片分析走独立流程）
        steps = [s for s in steps if s not in ("transcribe", "analyze")]
    elif kind == "audio":
        # 音频：需要转写，不需要截帧分析
        steps = [s for s in steps if s != "analyze"]
    # video: 保留全部步骤
    return steps


def handle_note_task(record: TaskRecord, runner: TaskRunner) -> Dict[str, Any]:
    """复合笔记任务：按 payload.steps 动态编排执行步骤。

    支持的步骤：download / transcribe / analyze / note
    未指定 steps 时默认全量执行。

    状态机流转（对齐 v1.1 §11）：
      DOWNLOAD → PROBE → FRAMES → ASR → VLM → SUM → STORE → SUCCESS
    """
    payload = record.payload
    task_id = record.task_id

    # ── 0. 解析步骤列表 ────────────────────────────────────────
    steps: List[str] = payload.get("steps") or ["download", "transcribe", "analyze", "note"]
    # 复刻提示词：只跑下载+截帧，跳过 transcribe 和 note 总结
    if str(payload.get("intent") or "") == "replica" and str(payload.get("replica_kind") or "prompt") == "prompt":
        steps = ["download", "analyze"]
    completed_steps: List[str] = []

    # ── 1. 取 payload 字段 ─────────────────────────────────────
    url = str(payload.get("url") or payload.get("video_url") or "").strip()
    if not url:
        raise ValueError("note task 需要 payload.url 或 payload.video_url")

    settings = load_settings()
    api_key = (
        str(payload.get("api_key") or "").strip()
        or settings.openai_api_key.strip()
    )
    vision_model = str(payload.get("vision_model") or "").strip() or settings.vision_model
    text_model = str(payload.get("text_model") or "").strip() or settings.text_model
    proxy = str(payload.get("proxy") or "").strip()

    # 日志：记录收到的文本/视觉模型和代理配置（音频模型已弃用，改用本地 faster-whisper）
    runner.append_log(
        task_id,
        f"📋 note_task 配置 | "
        f"text_model={text_model} | "
        f"vision_model={vision_model} | "
        f"proxy={'✓' if proxy else '✗'} | "
        f"steps={steps}"
    )

    # ── 2. 准备项目目录 ────────────────────────────────────────
    project_video_dir = get_workspace_videos_dir(record.project_id)
    project_video_dir.mkdir(parents=True, exist_ok=True)
    project_json_dir = get_workspace_json_dir(record.project_id)
    project_json_dir.mkdir(parents=True, exist_ok=True)

    # 中间产出容器
    transcript_text = ""
    transcript_segments: List[Dict[str, Any]] = []  # 7.4: 带时间码的分段
    analysis_text = ""
    markdown = ""
    note_body = ""
    download_save_path = ""
    # PROBE 结果（download 后由内容识别填充）
    note_kind = "text"  # 默认；PROBE 后可能变为 image_text / mixed / video / audio
    source_text_from_download = ""
    images_from_download: List[str] = []
    background_context = ""
    _source_title = ""

    # ── 3. download 步骤（M7: 按 URL 类型选择下载器）──────────
    if "download" in steps:
        runner.store.update(task_id, status=TaskStatus.DOWNLOAD.value)
        runner.set_progress(task_id, 0.02, "开始下载...")

        dl_kwargs = _resolve_download_kwargs(payload)
        dl_result = _download_note_source(
            url=url,
            payload=payload,
            record=record,
            runner=runner,
            task_id=task_id,
            project_video_dir=project_video_dir,
            dl_kwargs=dl_kwargs,
        )
        if not dl_result.get("ok"):
            err = (dl_result.get("error") or "download failed").strip()
            raise RuntimeError(f"下载失败: {err}")

        download_save_path = str(dl_result.get("video_file") or dl_result.get("source_path") or "")
        source_text_from_download = str(dl_result.get("content") or "")
        images_from_download = list(dl_result.get("images") or [])

        completed_steps.append("download")
        # R26: X 帖子正文——download 阶段的 tweet_text 写进 task.result，
        # 供 analyze（av_combined）阶段的合并总结 prompt 使用
        _tweet_text = str(dl_result.get("tweet_text", "") or dl_result.get("content", "") or "")
        _persist_intermediate(runner, task_id, {
            "completed_steps": completed_steps[:],
            "video_file": download_save_path,
            "source_path": str(dl_result.get("source_path") or ""),
            **_extra_tweet_text(_tweet_text),
        })

    # ── 3.5. PROBE 阶段（M7: 内容识别 + 步骤裁剪）─────────────
    runner.store.update(task_id, status=TaskStatus.PROBE.value)
    runner.set_progress(task_id, 0.10, "探测内容类型...")

    if "download" in steps:
        probe = _probe_note_source(dl_result, payload)
        note_kind = probe["note_kind"]
        source_text_from_download = probe["source_text"] or source_text_from_download
        images_from_download = probe["images"] or images_from_download
        background_context = probe["background_context"]
        steps = probe["steps"]
        # 复刻提示词：PROBE 可能覆盖 steps，需重新裁剪
        if str(payload.get("intent") or "") == "replica" and str(payload.get("replica_kind") or "prompt") == "prompt":
            steps = ["download", "analyze"]
        _source_title = str((dl_result or {}).get("title") or "").strip()
        if not _source_title:
            _source_title = str(probe.get("source_title") or "").strip()

        # R4.7: 配图关闭时跳过截帧+VLM（省掉重 API 调用），笔记只用转写文本
        # replica prompt 必须保留 analyze（画面分析是复刻的核心），不受 embed_frames 控制
        _pf = payload.get("preflight") or {}
        _is_replica_prompt = str(payload.get("intent") or "") == "replica" and str(payload.get("replica_kind") or "prompt") == "prompt"
        if not _is_replica_prompt and not _pf.get("embed_frames", True) and "analyze" in steps:
            steps = [s for s in steps if s != "analyze"]
            runner.append_log(task_id, "⏭️ embed_frames=False → 跳过截帧分析")

        runner.append_log(
            task_id,
            f"🔍 PROBE | note_kind={note_kind} | steps={steps} | "
            f"text_len={len(source_text_from_download)} | images={len(images_from_download)}"
        )
        _persist_intermediate(runner, task_id, {
            "note_kind": note_kind,
            "source_title": probe["source_title"],
            "background_for_recognition": background_context,
            "source_description": source_text_from_download[:500] if source_text_from_download else "",
            "background_context": background_context,
            **_image_intermediate_patch(note_kind, images_from_download, DATA_DIR),
        })
        # #18: 本地视频实时写入封面/标题（在线视频由 _apply_ytdlp_metadata_to_task 处理）
        if payload.get("source_type") == "local":
            _local_meta: Dict[str, Any] = {}
            if dl_result.get("cover_thumbnail"):
                # 绝对路径 → /static/ URL（前端 <img src> 需要 HTTP 路径）
                _static_thumb = _img_to_static_url(str(dl_result["cover_thumbnail"]), DATA_DIR)
                if _static_thumb:
                    _local_meta["cover_thumbnail"] = _static_thumb
            if _source_title:
                _local_meta["video_title"] = _source_title
            if dl_result.get("video_duration"):
                _local_meta["video_duration"] = dl_result["video_duration"]
            if _local_meta:
                _persist_intermediate(runner, task_id, _local_meta)

    # ── 3.6. 图集分析（VLM-first：逐图视觉理解 → 文字提取 → 分类决策）──
    # 保存原始文本：source_text_from_download 后面会被 VLM 理解结果补充。
    raw_source_text = source_text_from_download
    image_infos: list[dict] = []  # 外层声明，供后面写入 result 使用
    if note_kind in {"image_text", "mixed"} and images_from_download:
        runner.store.update(task_id, status=TaskStatus.VLM.value)
        runner.set_progress(task_id, 0.15, "图集视觉理解中...")

        def _log_img(msg: str) -> None:
            runner.append_log(task_id, f"[图集] {msg}")

        data_dir = DATA_DIR
        vlm_fail_count = 0
        for idx, img_path in enumerate(images_from_download):
            runner.set_progress(
                task_id,
                0.15 + 0.15 * (idx / len(images_from_download)),
                f"视觉理解图片 {idx + 1}/{len(images_from_download)}...",
            )
            info = _analyze_image_for_note(
                img_path, vision_model, api_key, log=_log_img,
            )
            static_url = _img_to_static_url(img_path, data_dir)

            image_infos.append({
                # 兼容旧字段
                "idx": idx + 1,
                "description": info.get("description") or info.get("content_summary") or "",
                "ocr_text": info.get("ocr_text") or info.get("extracted_text") or "",
                "static_url": static_url,
                "is_text_image": bool(info.get("is_text_image")),
                # VLM-first 丰富字段
                "image_type": info.get("image_type", "unknown"),
                "extracted_text": info.get("extracted_text", ""),
                "content_summary": info.get("content_summary", ""),
                "action_steps": info.get("action_steps") or [],
                "key_entities": info.get("key_entities") or [],
                "visual_elements": info.get("visual_elements") or [],
                "visual_value": info.get("visual_value", "low"),
                "embed_decision": info.get("embed_decision", "skip"),
                "insert_hint": info.get("insert_hint", ""),
                "confidence": info.get("confidence", 0.0),
            })

            # 统计失败数量
            if (not info.get("extracted_text")
                    and not info.get("content_summary")
                    and not info.get("visual_elements")):
                vlm_fail_count += 1

        _log_img(
            f"图集视觉理解完成，{len(images_from_download) - vlm_fail_count}/"
            f"{len(images_from_download)} 张有有效内容"
        )

        # ── 用 VLM 理解结果构造 source_text（原始正文 + 图片理解）──
        # 规则：所有有实质内容（extracted_text/content_summary/visual_elements/action_steps）的图
        # 都进入语料，不论 embed_decision 是什么。embed_decision 只决定是否插图片 URL。
        runner.set_progress(task_id, 0.35, "组织图文内容中...")
        images_with_content = [
            img for img in image_infos
            if (img.get("extracted_text") or img.get("content_summary")
                or img.get("visual_elements") or img.get("action_steps"))
        ]
        if images_with_content:
            # ── 构建 source.md（干净 Markdown，按图片类型分流）──
            _TEXT_TYPES = {"text_card", "ui_demo", "mixed"}
            text_imgs = [
                img for img in images_with_content
                if img.get("image_type") in _TEXT_TYPES
                or (img.get("is_text_image") and img.get("extracted_text"))
            ]
            flow_imgs = [
                img for img in images_with_content
                if img.get("image_type") in ("flow_diagram", "ui_demo")
                and img.get("action_steps")
                and img not in text_imgs
            ]
            table_imgs = [
                img for img in images_with_content
                if img.get("image_type") == "chart_table"
                and img.get("extracted_text")
                and img not in text_imgs
            ]
            other_imgs = [
                img for img in images_with_content
                if img not in text_imgs and img not in flow_imgs and img not in table_imgs
            ]

            img_sections: list[str] = []
            if text_imgs:
                for img in text_imgs:
                    if img.get("extracted_text"):
                        img_sections.append(img["extracted_text"].strip())
                    if img.get("content_summary"):
                        img_sections.append(f"> {img['content_summary']}")
            if flow_imgs:
                for img in flow_imgs:
                    steps_text = "\n".join(
                        f"{i+1}. {s}" for i, s in enumerate(img["action_steps"])
                    )
                    img_sections.append(steps_text)
                    if img.get("content_summary"):
                        img_sections.append(f"> {img['content_summary']}")
            if table_imgs:
                for img in table_imgs:
                    img_sections.append(img["extracted_text"].strip())
            if other_imgs:
                for img in other_imgs:
                    if img.get("embed_decision") == "embed_image" and img.get("static_url"):
                        img_sections.append(f"![图{img['idx']}]({img['static_url']})")
                    if img.get("content_summary"):
                        img_sections.append(f"> {img['content_summary']}")

            images_source_text = "\n\n".join(
                s.replace("\t", " ") for s in img_sections
            )
            _raw_clean = raw_source_text.replace("\t", " ") if raw_source_text else ""
            source_text_from_download = (
                f"{_raw_clean}\n\n---\n\n{images_source_text}"
                if _raw_clean and images_source_text
                else images_source_text or _raw_clean
            )

        # ── 质量闸门：全部 VLM 失败时不能生成假成功 ──
        all_analysis_empty = vlm_fail_count == len(images_from_download)
        if all_analysis_empty:
            if raw_source_text and len(raw_source_text.strip()) > 10:
                _log_img("⚠️  所有图片 VLM 分析均失败，使用原始文字兜底")
                all_analysis_empty = False  # 有文字，不阻断
            else:
                error_msg = "图片理解失败，缺少可总结内容"
                _log_img(f"❌ {error_msg}")
                runner.append_log(task_id, f"[图集] ❌ {error_msg}")
                raise RuntimeError(error_msg)

        # ── 3.7. 图文标准总结生成（基于 source.md）──────────────────
        # note_body 用于 note.md 默认正文（标准总结），source.md 作为唯一依据。
        if "note" in steps and api_key:
            # 提前分类（仅 source 材料，不含 note_body），用于选择 note 正文模板
            early_category = _classify_from_source(
                raw_source_text, source_text_from_download, image_infos,
            )
            runner.set_progress(task_id, 0.45, f"生成图文{early_category}总结中...")
            image_text_note_body = _generate_image_text_learning_note(
                source_md=source_text_from_download,
                title=_source_title,
                settings=load_settings(),
                payload=payload,
                log=_log_img,
                content_category=early_category,
            )
            if image_text_note_body:
                note_body = image_text_note_body
            else:
                note_body = _fallback_learning_note(
                    source_text=source_text_from_download,
                    title=_source_title,
                    log=_log_img,
                )
        # 更新中间结果（VLM-first 字段）
        if image_infos:
            _persist_intermediate(runner, task_id, {"image_infos": image_infos})

    # ── 4+5. transcribe + analyze 并行步骤 ──────────────────────
    # R22: 音频转录(ASR)与视频截帧(VLM)本质独立，可并行执行。
    # 进度区间：transcribe 0.12~0.30, analyze 0.30~0.60，各自独立更新。
    if "transcribe" in steps or "analyze" in steps:
        from concurrent.futures import Future, as_completed

        # 预检查：转录引擎（仅 transcribe 步骤需要）
        if "transcribe" in steps:
            import sys as _sys
            from backend.app.services.asr_fast_whisper import (
                is_fast_whisper_available,
                get_install_hint,
                get_last_probe_error,
                transcribe_file_with_fast_whisper,
            )
            if not is_fast_whisper_available():
                hint = get_install_hint()
                probe = get_last_probe_error()
                header = f"❌ 本地转录引擎未就绪 | python={_sys.executable}"
                if probe is not None:
                    err_type, err_msg, err_tb = probe
                    runner.append_log(task_id, f"{header}\n错误类型: {err_type}\n错误信息: {err_msg}\nTraceback:\n{err_tb}\n{hint}")
                else:
                    runner.append_log(task_id, f"{header}\n{hint}")
                raise RuntimeError(f"本地转录引擎未安装。{hint}")

        # 预检查：视频文件（两轨都需要）
        videos = find_videos(project_video_dir)
        if not videos:
            raise ValueError("本地视频文件不存在，请先执行下载步骤")

        # 确定视频文件路径（转录用单文件，analyze 用列表）
        video_file = ""
        if download_save_path and Path(download_save_path).is_file():
            video_file = download_save_path
            # analyze 轨只处理当前视频，避免共享目录旧视频污染笔记
            videos = [p for p in videos if p.resolve() == Path(video_file).resolve()]
            if not videos:
                videos = [Path(video_file)]
        else:
            if download_save_path:
                runner.append_log(
                    task_id,
                    f"⚠️  download_save_path 失效: {download_save_path!r}，回退到目录扫描",
                )
            videos_sorted = sorted(videos, key=lambda p: p.stat().st_mtime, reverse=True)
            video_file = str(videos_sorted[0])

        if not video_file or not Path(video_file).is_file():
            raise ValueError(
                f"无可用的本地视频文件进行转录 (project_video_dir={project_video_dir})"
            )

        # 预检查：analyze 需要 api_key
        if "analyze" in steps and not api_key:
            raise ValueError("analyze 步骤需要 api_key（payload 或 settings）")

        # 并行执行：submit 两轨到独立线程池（不能复用 runner._executor，否则会死锁）
        from concurrent.futures import ThreadPoolExecutor as _Pool
        _pool = _Pool(max_workers=2, thread_name_prefix="r22-parallel")
        futures: Dict[str, Future] = {}

        # ── 协作取消信号（一轨失败时 set，另一轨在循环检查点退出）──
        _cancel_event = threading.Event()

        # ── 进度单调递增保护（两轨并行写进度，只前进不后退）─────
        _progress_lock = threading.Lock()
        _max_progress = [0.10]  # PROBE 阶段结束时的进度

        def _monotonic_progress(pct: float, msg: str) -> None:
            """只在新进度大于历史最大值时才更新，避免两轨互相覆盖导致倒退。"""
            with _progress_lock:
                if pct > _max_progress[0]:
                    _max_progress[0] = pct
                    runner.set_progress(task_id, pct, msg)

        # ── transcribe 轨 ──────────────────────────────────────
        # whisper 是单次长调用，无法中途断；进度回调中做 best-effort 检查。
        if "transcribe" in steps:
            def _run_transcribe() -> Tuple[str, List[Dict[str, Any]]]:
                runner.store.update(task_id, status=TaskStatus.ASR.value)
                _monotonic_progress(0.12, "开始转录音频...")

                # ④16 CC-first：先尝试直取平台字幕，命中则跳过 Whisper
                log_fn = lambda msg: runner.append_log(task_id, msg)  # noqa: E731
                cc_result = _try_cc_subtitle(payload, log_fn)
                if cc_result:
                    _cc_text, _cc_segments, _cc_meta = cc_result
                    _monotonic_progress(0.30, "字幕已就绪，跳过转录")
                    return _cc_text, _cc_segments

                # 字幕未命中，走 Whisper
                tcfg = load_settings().transcriber
                # 兜底：fast-whisper 不支持 mps
                _device = tcfg.device if tcfg.device != "mps" else "cpu"
                runner.append_log(
                    task_id,
                    f"📄 本地转录 | 文件={Path(video_file).name} "
                    f"model={tcfg.whisper_model_size} device={_device} language={tcfg.language or 'auto'}",
                )

                def _on_progress(ratio: float, msg: str) -> None:
                    if _cancel_event.is_set():
                        raise RuntimeError("已取消：另一轨失败")
                    mapped = 0.12 + 0.18 * max(0.0, min(1.0, ratio))
                    _monotonic_progress(mapped, f"[转录] {msg}")

                def _on_log(msg: str) -> None:
                    runner.append_log(task_id, f"[转录] {msg}")

                # 7.4: return_segments=True 获取带时间码的分段，供实时字幕面板使用
                _text, _segments, _dur = transcribe_file_with_fast_whisper(
                    video_file,
                    model_name=tcfg.whisper_model_size or "base",
                    device=_device,
                    language=tcfg.language or "",
                    initial_prompt=tcfg.initial_prompt or "",
                    log_callback=_on_log,
                    progress_callback=_on_progress,
                    return_segments=True,
                    cpu_threads=tcfg.cpu_threads,
                    beam_size=tcfg.beam_size,
                    vad_filter=tcfg.vad_filter,
                )
                if not _text or not _text.strip():
                    runner.append_log(
                        task_id,
                        "🔇 该视频无音轨（或无有效语音），已跳过语音转写，"
                        "将使用画面分析生成笔记。",
                    )
                return _text, _segments

            futures["transcribe"] = _pool.submit(_run_transcribe)

        # ── analyze 轨 ─────────────────────────────────────────
        # 截帧循环每轮检查 cancel_event，秒级响应。
        if "analyze" in steps:
            def _run_analyze() -> str:
                runner.store.update(task_id, status=TaskStatus.FRAMES.value)
                _monotonic_progress(0.30, "开始视觉帧分析...")

                frame_prompts = payload.get("frame_prompt")
                if preflight := payload.get("preflight"):
                    frame_prompts = frame_prompts or (isinstance(preflight, dict) and preflight.get("frame_prompt"))
                if frame_prompts is not None:
                    capture_params = CaptureParams.from_dict(frame_prompts)
                else:
                    capture_params = _tier_capture_params()
                if capture_params is not None:
                    runner.append_log(
                        task_id,
                        f"🎬 note capture_params | mode={capture_params.mode} | "
                        f"interval={capture_params.interval_sec}s | "
                        f"max_frames={capture_params.max_frames} | "
                        f"frames_per_shot={capture_params.frames_per_shot}"
                    )

                image_mode = "vision"
                if preflight := payload.get("preflight"):
                    image_mode = preflight.get("image_mode") or "vision"

                state = run_batch_analysis(
                    api_key=api_key,
                    video_paths=videos,
                    vision_model=vision_model,
                    text_model=text_model,
                    auto_sync_json=True,
                    target_json_dir=project_json_dir,
                    capture_params=capture_params,
                    concurrency=_tier_vlm_concurrency(),
                    cancel_event=_cancel_event,
                    image_mode=image_mode,
                )

                _last_logged_pct = -1.0
                _stall = _make_stall_notifier(runner, task_id)
                while not state.finished:
                    if _cancel_event.is_set():
                        raise RuntimeError("已取消：另一轨失败")
                    if runner.is_cancel_requested(task_id):
                        _cancel_event.set()  # 让后台截帧 worker 一并停下，不再发起新 VLM 调用
                        break
                    snaps = state.snapshot()
                    if snaps:
                        avg = sum(float(s["percent"]) for s in snaps) / max(len(snaps), 1) / 100.0
                        cur_pct = min(0.60, 0.30 + avg * 0.30)
                        _stall(avg)
                        _monotonic_progress(cur_pct, "[截帧] 视觉帧分析中...")
                        if cur_pct - _last_logged_pct >= 0.05 or _last_logged_pct < 0:
                            _last_logged_pct = cur_pct
                            for s in snaps:
                                if s.get("total_frames", 0) > 0:
                                    runner.append_log(
                                        task_id,
                                        f"🎬 截帧进度：{s['analyzed_frames']}/{s['total_frames']} 帧 ({s['percent']:.1f}%)",
                                    )
                    time.sleep(0.2)

                md_parts: List[str] = []
                for video_path in videos:
                    safe_name = get_safe_name(video_path)
                    output_dir = get_output_dir(video_path)
                    md_file = output_dir / (safe_name + "_图文分镜.md")
                    if md_file.exists():
                        md_parts.append(md_file.read_text(encoding="utf-8"))
                return "\n\n---\n\n".join(md_parts) if md_parts else ""

            futures["analyze"] = _pool.submit(_run_analyze)

        # ── 等待两轨完成，一轨失败协作取消另一轨 ────────────────
        try:
            for future in as_completed(futures.values()):
                try:
                    result = future.result()
                    for key, f in futures.items():
                        if f is future:
                            if key == "transcribe":
                                # 7.4: (text, segments) tuple from return_segments=True
                                if isinstance(result, tuple) and len(result) == 2:
                                    transcript_text, transcript_segments = result
                                else:
                                    transcript_text = result
                                    transcript_segments = []
                            elif key == "analyze":
                                analysis_text = result
                            completed_steps.append(key)
                            _persist_intermediate(runner, task_id, {
                                key: result,
                                "completed_steps": completed_steps[:],
                            })
                            break
                except Exception as e:
                    # 用户主动取消时，另一轨会在检查点抛 "已取消：另一轨失败"，
                    # 这不是真失败——跳出等待循环走下方取消早退，避免误判为 FAILED。
                    # （真失败时 is_cancel_requested 为 False，照常 raise → FAILED。）
                    if runner.is_cancel_requested(task_id):
                        _cancel_event.set()
                        break
                    for key, f in futures.items():
                        if f is future:
                            err_msg = f"{key} 失败: {e}"
                            break
                    runner.append_log(
                        task_id,
                        f"❌ {err_msg}\n{tb.format_exc()}",
                        level="error",
                    )
                    # 协作取消：set event 让另一轨在检查点退出
                    _cancel_event.set()
                    # 兜底：取消尚未开始的 future
                    for f in futures.values():
                        f.cancel()
                    raise RuntimeError(err_msg) from e
        finally:
            _pool.shutdown(wait=False)

    # ── 5.5. 用户取消早退 ──────────────────────────────────────
    # 截帧轮询里检测到取消后只是 break，控制流会走到这里。若确属用户取消：
    #   · 不再构建/落盘 markdown 笔记（notes API 读 result["markdown"]，缺该键即空笔记）
    #   · 不再推进 set_progress(0.65/0.80/0.90)，进度停在取消时刻的真实值
    #   · 终态 CANCELLED 由 task_runner._run 的取消分支统一收口
    if runner.is_cancel_requested(task_id):
        runner.append_log(task_id, "⛔ 已取消：跳过笔记汇总（SUM）与归档（STORE）收尾", level="warning")
        rec = runner.store.get(task_id)
        partial = dict(rec.result) if rec and rec.result else {}
        partial.pop("markdown", None)  # 确保不残留"看似完整"的笔记
        partial.update({
            "completed_steps": completed_steps,
            "video_file": download_save_path,
            "cancelled": True,
        })
        return partial

    # ── 6. note 步骤（汇总 markdown）──────────────────────────
    llm_summary = ""
    if "note" in steps:
        runner.store.update(task_id, status=TaskStatus.SUM.value)
        runner.set_progress(task_id, 0.65, "整理笔记内容...")

        # 数据源优先级：analyze 产出 > transcribe 文本 > 下载阶段抽取的文本 > 空字符串
        source_text = analysis_text or transcript_text or source_text_from_download or ""
        if source_text:
            markdown = source_text
        else:
            markdown = "（未找到可用的分析或转录内容，请检查前置步骤是否已执行）"

        # ── LLM 生成摘要（视频/音频类型有转录文本时）──
        llm_summary = ""
        # R26: 提取 X 帖子正文，供 LLM 摘要作为背景上下文
        _prev_for_llm = runner.store.get(task_id)
        _prev_result_llm = (_prev_for_llm.result or {}) if _prev_for_llm else {}
        _tweet_for_llm = str(_prev_result_llm.get("tweet_text", "") or "")
        if api_key and (_tweet_for_llm or (transcript_text and len(transcript_text) > 50)):
            try:
                from backend.app.services.av_synthesis.llm import llm_global_summary
                runner.append_log(task_id, "📝 生成 LLM 摘要...")
                # 把帖子正文拼在 transcript 前面作为背景上下文
                _summary_input = transcript_text
                if _tweet_for_llm.strip() and transcript_text.strip():
                    _summary_input = (
                        f"【原帖正文（背景上下文）】\n{_tweet_for_llm[:2000]}\n\n"
                        f"【视频转写文本】\n{transcript_text}"
                    )
                elif _tweet_for_llm.strip() and not transcript_text.strip():
                    # 视频无语音但帖子有正文：直接用帖子正文生成摘要
                    _summary_input = f"【原帖正文】\n{_tweet_for_llm[:4000]}"
                llm_summary = llm_global_summary(_summary_input, api_key) if _summary_input.strip() else ""
                if llm_summary:
                    runner.append_log(task_id, f"📝 LLM 摘要生成完成（{len(llm_summary)} 字）")
            except Exception as e:
                runner.append_log(task_id, f"⚠️ LLM 摘要生成失败（不影响主流程）: {e}")

        completed_steps.append("note")
        _persist_intermediate(runner, task_id, {
            "markdown": markdown,
            "llm_summary": llm_summary,
            "completed_steps": completed_steps[:],
        })

    # ── 6.5. STORE 阶段（pipeline 框架级，对齐 v1.1 §11）─────────
    # 入库：标记进入持久化阶段。当前流水线中间产物已通过
    # _persist_intermediate 即时落盘，此处为最终一次性确认 + UI 收尾。
    runner.store.update(task_id, status=TaskStatus.STORE.value)
    runner.set_progress(task_id, 0.80, "归档任务结果...")

    # ── 7. 构建最终返回结果 ────────────────────────────────────
    runner.set_progress(task_id, 0.90, "任务完成")

    # segment_refiner：切细过长字幕段（在存入 results 前）
    transcript_segments = refine_segments(transcript_segments)

    # R3.4 fix: 按当前视频过滤视觉 JSON，避免同项目其他视频的帧串台
    if download_save_path:
        json_paths = _find_visual_json_paths_for_videos(
            project_json_dir, [Path(download_save_path)]
        )
    else:
        json_paths = sorted(project_json_dir.glob("*_视觉数据.json"))

    # ── 6.7 复刻提示词边界检查：analyze 必须产出帧 ───────────
    if str(payload.get("intent") or "") == "replica" and str(payload.get("replica_kind") or "prompt") == "prompt":
        _has_frames = bool(json_paths) or bool(analysis_text)
        if not _has_frames:
            raise RuntimeError("复刻提示词失败：视频截帧未产出任何画面（可能是纯音频或视频损坏）")

    # ── 6.8. R3.5: 自动生成总结，作为 note.md 默认正文 ──────
    # R3.11: 读取嵌图配置
    _preflight = payload.get("preflight") or {}
    _embed_frames = bool(_preflight.get("embed_frames", True))
    # R3.16: max_embed_frames=0 表示「按视频时长自适应封顶」（见 summary_generator
    # ._adaptive_frame_cap），不再是「无限」；generate-note 入口未传 preflight 时即走此默认。
    _max_embed = int(_preflight.get("max_embed_frames", 0) or 0)

    # 先算标题（standard prompt 需要；image_text 分支已提前算过）
    if "download" in steps:
        _source_title = _source_title or str((dl_result or {}).get("title") or "").strip()
    if not _source_title:
        _source_title = str((probe.get("source_title") if "download" in steps else "") or "").strip()

    # note_body: image_text 分支已在 §3.7 设置学习笔记；此处对有 transcript 的类型生成用户选择的总结。
    # note_body 已在中间产出容器初始化为 ""，image_text 设置后不会被覆盖（transcript_text 为空时不进此块）。
    if "note" in steps and api_key and transcript_text and len(transcript_text) > 50:
        try:
            from backend.app.models.workspace import WorkspaceItem
            from backend.app.services.summary_generator import generate_summary

            summary_template_id = str(payload.get("summary_template") or "standard").strip() or "standard"
            runner.append_log(task_id, f"📖 生成笔记总结（{summary_template_id}）...")
            runner.set_progress(task_id, 0.85, "生成标准总结...")

            # 构造临时 WorkspaceItem，填入 generate_summary 所需字段
            # 把转写规范成带时间戳的分段 list（{t_sec,t_str,text}），standard 总结才能
            # 在 ## 章节标题后标注真实 [mm:ss]；无 segments 时兜底回纯文本（与旧行为一致）。
            _tmp_transcript = _build_display_transcript_lines(
                transcript_text, transcript_segments
            ) or transcript_text
            _tmp_item = WorkspaceItem(
                item_id="pipeline_tmp",
                type="video",
                source="url",
                source_value="",
                results={
                    "transcript": _tmp_transcript,
                    "transcript_segments": transcript_segments,
                    "json_outputs": [str(p.resolve()) for p in json_paths],
                    "video_title": _source_title or "",
                },
            )
            # R26: X 帖子正文作为背景上下文注入 standard 总结
            _tweet_for_standard = str(_prev_for_llm.result.get("tweet_text", "") if _prev_for_llm and _prev_for_llm.result else "")
            _std_summary = generate_summary(
                _tmp_item, summary_template_id,
                embed_frames=_embed_frames,
                max_embed_frames=_max_embed,
                background=_tweet_for_standard if _tweet_for_standard.strip() else "",
            )
            if _std_summary and _std_summary.content_md:
                note_body = _std_summary.content_md
                runner.append_log(task_id, f"📖 标准总结生成完成（{len(note_body)} 字）")
            else:
                runner.append_log(task_id, "⚠️ 标准总结返回为空，回退到默认摘要")
        except Exception as e:
            runner.append_log(task_id, f"⚠️ 标准总结生成失败（不影响主流程，回退到默认摘要）: {e}")
            note_body = ""

    result: Dict[str, Any] = {
        "transcript":            transcript_text,
        "transcript_segments":   transcript_segments,  # 7.4: 带时间码分段，供前端实时字幕
        "analysis":              analysis_text,
        "markdown":              markdown,
        "llm_summary":           llm_summary,
        "note_body":             note_body,  # R3.5: standard 总结作为 note.md 默认正文
        "completed_steps":       completed_steps,
        "video_file":            download_save_path,
        "json_outputs":          [str(p.resolve()) for p in json_paths],
        "json_output_basenames": [p.name for p in json_paths],
        "json_output_dir":       str(project_json_dir.resolve()),
    }
    # R3.13 fix: 继承 download 阶段写入 task.result 的展示字段（封面/时长/作者等）。
    # handle_note_task 最终 return 的 result 会整体覆盖 task.result；若不继承，分析
    # 完成瞬间 cover_thumbnail/video_thumbnail_url 丢失 → ProcessingPage 露黑底「● LIVE」
    # （截图2 处理中有封面、截图3 完成后封面消失即此因）。这些字段由下载阶段 yt-dlp
    # 实时回调 _apply_ytdlp_metadata_to_task 写入 task.result。
    _prev_rec = runner.store.get(task_id)
    _prev_result = (_prev_rec.result or {}) if _prev_rec else {}
    for _k in (
        "cover_thumbnail", "video_thumbnail_url", "video_duration",
        "video_uploader", "video_upload_date", "video_description",
    ):
        if _prev_result.get(_k) and not result.get(_k):
            result[_k] = _prev_result[_k]
    # R26: 把 download 阶段写进的 tweet_text 保留到最终 result，供
    # note_assembler.build_note_md 和前端 NoteShell 使用。
    _tweet_result = str(_prev_result.get("tweet_text", "") or "")
    if _tweet_result and not result.get("tweet_text"):
        result["tweet_text"] = _tweet_result
    # 7.2 标题全链路：把下载阶段解析到的真实标题写入 result，
    # 供 success callback 回写 item.name（解决 NoteShell 显示 ID/BV 号的问题）
    if _source_title:
        result["video_title"] = _source_title
    if payload.get("workspace_id"):
        result["workspace_id"] = str(payload.get("workspace_id") or "")
    if payload.get("item_id"):
        result["item_id"] = str(payload.get("item_id") or "")
    # M7: 附加 PROBE 识别结果
    if note_kind != "video":
        result["note_kind"] = note_kind
    if images_from_download:
        result["images"] = images_from_download
        result["image_count"] = len(images_from_download)
    # image_text / mixed 分支：保存结构化图片信息（供前端 NoteMedia.image_infos）
    if note_kind in {"image_text", "mixed"} and image_infos:
        result["image_infos"] = image_infos
    # image_text / mixed 分支：保存原始文本（供 source.md 显示原始依据，不受 _compose 覆盖）
    # tab 会让 source.md 段间出现缩进噪声，统一替换为空格（与 source_text_enriched 清理对齐）
    if note_kind in {"image_text", "mixed"} and raw_source_text:
        result["source_md_raw"] = raw_source_text.replace("\t", " ")
    # image_text / mixed 分支：保存 VLM 理解后的富文本（含图片理解结果，供学习笔记生成和前端参考）
    if note_kind in {"image_text", "mixed"} and source_text_from_download and source_text_from_download != raw_source_text:
        result["source_text_enriched"] = source_text_from_download
    if background_context:
        result["background_for_recognition"] = background_context
    # 图文内容分类：识别 tool_recommendation 等，写入 content_category + default_summary_template
    if note_kind == "image_text":
        _classify_image_text_content(result, raw_source_text, image_infos, note_body)
    return result


def _text_llm_call(
    *,
    content: str,
    title: str,
    sys_prompt: str,
    user_prompt_suffix: str,
    settings,
    payload: Dict[str, Any],
    log: Any,
    max_input_chars: int = 16000,
    max_tokens: int = 1024,
) -> str:
    """通用文本 LLM 调用。失败返回空串。"""
    if not content.strip():
        return ""
    api_key = (
        str(payload.get("api_key") or "").strip()
        or (settings.openai_api_key or "").strip()
    )
    if not api_key:
        log("⚠️  未提供 api_key，跳过 LLM 调用")
        return ""
    try:
        registry = create_default_registry()
        profile = registry.resolve_default_profile(settings, "chat")
        provider = registry.build(profile)
        model = (
            str(payload.get("text_model") or "").strip()
            or profile.default_models.get("chat")
            or (settings.text_model or "").strip()
        )
        if not model:
            log("⚠️  未配置 text_model，跳过 LLM 调用")
            return ""
        body = content[:max_input_chars]
        truncated = len(content) > max_input_chars
        user_prompt = (
            f"# 文档标题\n{title or '(无标题)'}\n\n"
            f"# 正文（{'已截断' if truncated else '完整'}）\n{body}"
            + (f"\n\n{user_prompt_suffix}" if user_prompt_suffix else "")
        )
        return provider.chat(
            ChatRequest(
                model=model,
                messages=[
                    {"role": "system", "content": sys_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=float(payload.get("temperature") or 0.3),
                max_tokens=max_tokens,
            )
        )
    except Exception as err:  # noqa: BLE001
        log(f"⚠️  LLM 调用失败：{err}")
        return ""


def _find_para_index(char_pos: int, paragraphs: list[str]) -> int:
    """按字符偏移定位所属段落序号（0 起始）。"""
    cumulative = 0
    for i, para in enumerate(paragraphs):
        cumulative += len(para)
        if char_pos < cumulative:
            return i
        cumulative += 2  # "\n\n" 分隔符
    return len(paragraphs) - 1 if paragraphs else 0


def _parse_structured_summary(raw: str, content: str, log: Any) -> dict[str, Any]:
    """解析 LLM 返回的 JSON 摘要，并对金句/要点做原文子串校验和位置计算。"""
    # 剥离 ``` 代码块包裹
    text = raw.strip()
    if text.startswith("```"):
        text = text.removeprefix("```")
        if text.lower().startswith("json"):
            text = text[4:]
        text = text.strip().removesuffix("```").strip()

    # 尝试 JSON 解析
    parsed: dict[str, Any] = {}
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        # 尝试截取 { ... } 重试
        lbrace = text.find("{")
        rbrace = text.rfind("}")
        if lbrace != -1 and rbrace != -1 and rbrace > lbrace:
            try:
                parsed = json.loads(text[lbrace : rbrace + 1])
            except json.JSONDecodeError:
                pass

    abstract = str(parsed.get("abstract", raw)) if parsed else raw
    key_points_raw = parsed.get("key_points", []) if parsed else []
    quotes_raw = parsed.get("golden_quotes", []) if parsed else []

    paragraphs = content.split("\n\n")

    # 校验金句：必须是原文精确子串
    golden_quotes: list[dict[str, Any]] = []
    for q in quotes_raw:
        if not isinstance(q, dict):
            continue
        quote_text = str(q.get("quote_text", "")).strip()
        if not quote_text:
            continue
        pos = content.find(quote_text)
        if pos == -1:
            log(f"⚠️  金句子串校验失败，已丢弃: {quote_text[:60]}...")
            continue
        golden_quotes.append(
            {
                "quote_text": quote_text,
                "char_start": pos,
                "char_end": pos + len(quote_text),
                "para_index": _find_para_index(pos, paragraphs),
            }
        )

    # 校验要点 source_excerpt
    key_points: list[dict[str, Any]] = []
    for kp in key_points_raw:
        if not isinstance(kp, dict):
            continue
        text_kp = str(kp.get("text", "")).strip()
        excerpt = str(kp.get("source_excerpt", "")).strip()
        if not text_kp:
            continue
        item: dict[str, Any] = {"text": text_kp}
        if excerpt:
            pos = content.find(excerpt)
            if pos != -1:
                item["source_excerpt"] = excerpt
                item["char_start"] = pos
                item["char_end"] = pos + len(excerpt)
                item["para_index"] = _find_para_index(pos, paragraphs)
            else:
                log(f"⚠️  要点 source_excerpt 未在原文找到，已丢弃: {excerpt[:60]}...")
                continue
        key_points.append(item)

    return {"abstract": abstract, "key_points": key_points, "golden_quotes": golden_quotes}


def _summarize_text(
    *,
    content: str,
    title: str,
    settings,
    payload: Dict[str, Any],
    log: Any,
) -> Dict[str, Any]:
    """对正文做一轮 LLM 摘要，返回结构化 dict（abstract + key_points + golden_quotes）。"""
    summary_params = payload.get("summary") or {}
    length_map = {"short": 50, "medium": 100, "long": 200}
    length = length_map.get(summary_params.get("length", "medium"), 100)

    sys_prompt = (
        f"你是一名严谨的中文文档摘要助手。请基于给定正文，输出一个 JSON 对象，"
        f"结构必须严格如下（不要输出任何其他内容）：\n\n"
        f'{{"abstract": "约{length}字的一段话摘要", '
        f'"key_points": [{{"text": "归纳性要点句", "source_excerpt": "该要点对应的原文精确片段"}}], '
        f'"golden_quotes": [{{"quote_text": "原文中一字不差的精确引文"}}]}}\n\n'
        f"关键规则：\n"
        f"- quote_text 必须是原文中的逐字原文，直接复制粘贴，不得改写、不得增减任何字。\n"
        f"- source_excerpt 也必须是原文中的精确片段，用于锚定要点位置。\n"
        f"- abstract 约 {length} 字。\n"
        f"- key_points 输出 3–6 条。\n"
        f"- 只输出 JSON 对象本身，不要用 ``` 代码块包裹，不要加任何解释性文字。"
        "不要编造文中没有的事实。"
    )
    raw = _text_llm_call(
        content=content,
        title=title,
        sys_prompt=sys_prompt,
        user_prompt_suffix="",
        settings=settings,
        payload=payload,
        log=log,
        max_tokens=int(payload.get("summary_max_tokens") or 2048),
    )
    if not raw:
        return {"abstract": "", "key_points": [], "golden_quotes": []}
    return _parse_structured_summary(raw, content, log)


def _associate_text(
    *,
    content: str,
    title: str,
    directions: list[str],
    settings,
    payload: Dict[str, Any],
    log: Any,
) -> Dict[str, str]:
    """联想归纳（N10）。返回 {方向名: 分析结果}。"""
    if not directions:
        return {}
    dir_str = "、".join(directions)
    sys_prompt = (
        "你是一名深度内容分析师。请基于给定正文，从以下方向进行联想归纳分析：\n"
        f"方向：{dir_str}\n\n"
        "要求：\n"
        "- 每个方向独立输出，用 Markdown 二级标题分隔\n"
        "- 每个方向 100-200 字\n"
        "- 基于原文事实，不要编造\n"
        "- 输出格式：## 方向名\n分析内容\n"
    )
    raw = _text_llm_call(
        content=content,
        title=title,
        sys_prompt=sys_prompt,
        user_prompt_suffix="",
        settings=settings,
        payload=payload,
        log=log,
        max_tokens=1500,
    )
    # 解析各方向结果
    result: Dict[str, str] = {}
    if not raw:
        return result
    current_dir = ""
    current_lines: list[str] = []
    for line in raw.splitlines():
        stripped = line.strip()
        if stripped.startswith("## "):
            if current_dir:
                result[current_dir] = "\n".join(current_lines).strip()
            current_dir = stripped[3:].strip()
            current_lines = []
        else:
            current_lines.append(line)
    if current_dir:
        result[current_dir] = "\n".join(current_lines).strip()
    # 如果解析失败，把整段作为通用结果
    if not result and raw:
        result["联想归纳"] = raw
    return result


def _rewrite_text(
    *,
    content: str,
    title: str,
    style: str,
    settings,
    payload: Dict[str, Any],
    log: Any,
) -> str:
    """改写/润色（N10）。返回改写后的文本。"""
    style_map = {
        "formal": "正式、专业的书面语风格",
        "casual": "轻松、口语化的表达风格",
        "concise": "精简、去冗余的简洁风格",
        "rich": "丰富、生动的文学风格",
    }
    style_desc = style_map.get(style, style)
    sys_prompt = (
        f"你是一名专业的文字改写助手。请将给定正文改写为{style_desc}。\n"
        "要求：\n"
        "- 保持原文核心信息不变\n"
        "- 逐段改写，保留段落结构\n"
        "- 不要添加原文没有的信息\n"
        "- 直接输出改写后的正文，不要加前缀说明"
    )
    return _text_llm_call(
        content=content,
        title=title,
        sys_prompt=sys_prompt,
        user_prompt_suffix="",
        settings=settings,
        payload=payload,
        log=log,
        max_tokens=2048,
    )


def _translate_text(
    *,
    content: str,
    title: str,
    target_lang: str,
    settings,
    payload: Dict[str, Any],
    log: Any,
) -> str:
    """翻译（N10）。返回翻译后的文本。"""
    lang_map = {
        "zh": "中文", "en": "英文", "ja": "日文", "ko": "韩文",
        "es": "西班牙文", "fr": "法文", "de": "德文", "ru": "俄文", "pt": "葡萄牙文",
    }
    lang_name = lang_map.get(target_lang, target_lang)
    sys_prompt = (
        f"你是一名专业的翻译助手。请将给定正文翻译为{lang_name}。\n"
        "要求：\n"
        "- 翻译准确、通顺、自然\n"
        "- 逐段翻译，保留段落结构\n"
        "- 专有名词保留原文并在括号内注明\n"
        "- 直接输出翻译结果，不要加前缀说明"
    )
    return _text_llm_call(
        content=content,
        title=title,
        sys_prompt=sys_prompt,
        user_prompt_suffix="",
        settings=settings,
        payload=payload,
        log=log,
        max_tokens=2048,
    )


def _split_paragraphs(text: str) -> list:
    """按双换行拆分为段落数组，去除首尾空白和空段。"""
    return [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]


def handle_text_task(record: TaskRecord, runner: TaskRunner) -> Dict[str, Any]:
    """文本输入层任务（Phase 2C.1）。

    payload 字段：
      - source_type: "pdf" | "docx" | "url"（可省略，依赖 source 自动推断）
      - source: 必填，URL 或本地文件路径
      - api_key / text_model / temperature / summary_max_tokens / summary_max_input_chars：可选

    状态机：FETCH → PARSE → EXTRACT → SUM → STORE → SUCCESS
    产物：data/workspaces/<pid>/text/<task_id>.md + .json
    """
    payload = record.payload
    task_id = record.task_id

    source = str(payload.get("source") or "").strip()
    if not source:
        raise ValueError("text task 需要 payload.source（URL 或文件路径）")
    source_type = str(payload.get("source_type") or "").strip().lower() or None

    log = lambda msg: runner.append_log(task_id, msg)  # noqa: E731
    log(f"📄 text_task 配置 | source_type={source_type or 'auto'} | source={source[:80]}")

    # ── 1. FETCH ────────────────────────────────────────────
    runner.store.update(task_id, status=TaskStatus.FETCH.value)
    runner.set_progress(task_id, 0.05, "拉取素材...")

    # ── 2. PARSE + EXTRACT（loader 内部一次完成；分两个进度点对外展示）─
    runner.store.update(task_id, status=TaskStatus.PARSE.value)
    runner.set_progress(task_id, 0.30, "解析文档...")
    if is_xiaohongshu_url_or_text(source):
        # 小红书走免 cookie 适配器：分享链接自带 xsec_token → 取图集 + 正文 → text 笔记
        runner.set_progress(task_id, 0.35, "小红书笔记解析中...")
        _xhs_out = get_workspace_root(record.project_id) / "image"
        _xhs_out.mkdir(parents=True, exist_ok=True)
        _xhs = run_xiaohongshu_download(url_or_text=source, output_dir=str(_xhs_out), log=log)
        if not _xhs.get("ok"):
            raise RuntimeError(f"小红书解析失败: {_xhs.get('error') or '未知错误'}")
        _nm = _xhs.get("note_meta") or {}
        _note_dir = _xhs.get("save_path") or ""
        _imgs = sorted(
            str(_p) for _p in Path(_note_dir).glob("*")
            if _p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")
        ) if _note_dir and Path(_note_dir).is_dir() else []
        _desc = str(_nm.get("desc") or "")
        doc = TextDocument(
            title=str(_nm.get("title") or "小红书笔记"),
            content=_desc,
            source_type="url",
            source=source,
            char_count=len(_desc),
            meta={
                "platform": "xiaohongshu",
                "note_type": _nm.get("type", "normal"),
                "images": _imgs,
                "cover_thumbnail": _imgs[0] if _imgs else "",
            },
        )
    else:
        try:
            doc = load_auto(source, source_type)
        except TextLoaderError as err:
            raise RuntimeError(str(err)) from err

    runner.store.update(task_id, status=TaskStatus.EXTRACT.value)
    runner.set_progress(task_id, 0.55, f"正文提取完成（{doc.char_count} 字符）")
    log(f"📄 正文抽取 | title={doc.title!r} chars={doc.char_count} type={doc.source_type}")
    if doc.char_count == 0:
        log("⚠️  抽取到的正文为空，跳过摘要（PDF 可能为扫描件）")

    _persist_intermediate(runner, task_id, {
        "title": doc.title,
        "content": doc.content,
        "char_count": doc.char_count,
        "source_type": doc.source_type,
        "source": doc.source,
        "meta": doc.meta,
    })

    # ── 3. SUM ──────────────────────────────────────────────
    runner.store.update(task_id, status=TaskStatus.SUM.value)
    runner.set_progress(task_id, 0.70, "生成 LLM 摘要...")
    settings = load_settings()
    summary = _summarize_text(
        content=doc.content,
        title=doc.title,
        settings=settings,
        payload=payload,
        log=log,
    )

    # ── 3.5 N10: 联想归纳 ──────────────────────────────────
    associations: Dict[str, str] = {}
    assoc_params = payload.get("association") or {}
    if assoc_params.get("enabled") and assoc_params.get("directions"):
        runner.store.update(task_id, status=TaskStatus.ASSOCIATE.value)
        runner.set_progress(task_id, 0.75, "联想归纳分析中...")
        log(f"📄 联想归纳 | directions={assoc_params['directions']}")
        associations = _associate_text(
            content=doc.content,
            title=doc.title,
            directions=assoc_params["directions"],
            settings=settings,
            payload=payload,
            log=log,
        )

    # ── 3.6 N10: 改写/润色 ─────────────────────────────────
    rewrites: Dict[str, str] = {}
    rewrite_params = payload.get("rewrite") or {}
    if rewrite_params.get("enabled") and rewrite_params.get("style"):
        runner.store.update(task_id, status=TaskStatus.REWRITE.value)
        runner.set_progress(task_id, 0.80, f"改写中（{rewrite_params['style']}）...")
        log(f"📄 改写 | style={rewrite_params['style']}")
        result = _rewrite_text(
            content=doc.content,
            title=doc.title,
            style=rewrite_params["style"],
            settings=settings,
            payload=payload,
            log=log,
        )
        if result:
            rewrites[rewrite_params["style"]] = {
                "full_text": result,
                "paragraphs": _split_paragraphs(result),
            }

    # ── 3.7 N10: 翻译 ──────────────────────────────────────
    translations: Dict[str, str] = {}
    translate_params = payload.get("translate") or {}
    if translate_params.get("enabled") and translate_params.get("target_lang"):
        runner.store.update(task_id, status=TaskStatus.TRANSLATE.value)
        runner.set_progress(task_id, 0.85, f"翻译中（{translate_params['target_lang']}）...")
        log(f"📄 翻译 | target_lang={translate_params['target_lang']}")
        result = _translate_text(
            content=doc.content,
            title=doc.title,
            target_lang=translate_params["target_lang"],
            settings=settings,
            payload=payload,
            log=log,
        )
        if result:
            translations[translate_params["target_lang"]] = {
                "full_text": result,
                "paragraphs": _split_paragraphs(result),
            }

    # ── 4. STORE ────────────────────────────────────────────
    runner.store.update(task_id, status=TaskStatus.STORE.value)
    runner.set_progress(task_id, 0.90, "归档文本产物...")
    text_dir = get_workspace_text_dir(record.project_id)
    text_dir.mkdir(parents=True, exist_ok=True)
    md_path = text_dir / f"{task_id}.md"
    json_path = text_dir / f"{task_id}.json"

    # 构建 md 正文
    md_parts = [
        f"# {doc.title}\n\n",
        f"> 来源：{doc.source} ｜ 类型：{doc.source_type} ｜ 字符数：{doc.char_count}\n\n",
    ]
    # 结构化摘要 → Markdown
    if isinstance(summary, dict):
        abstract = summary.get("abstract", "")
        key_points = summary.get("key_points", [])
        golden_quotes = summary.get("golden_quotes", [])
        if abstract:
            md_parts.append(f"## 摘要\n\n{abstract}\n\n")
        if key_points:
            md_parts.append("## 要点\n\n")
            for i, kp in enumerate(key_points, 1):
                md_parts.append(f"{i}. {kp['text']}\n")
                if kp.get("source_excerpt"):
                    md_parts.append(f"   > 原文：{kp['source_excerpt']}\n")
            md_parts.append("\n")
        if golden_quotes:
            md_parts.append("## 金句\n\n")
            for q in golden_quotes:
                md_parts.append(f"> {q['quote_text']}\n\n")
        if not abstract and not key_points and not golden_quotes:
            md_parts.append("## 摘要\n\n_（未生成摘要）_\n\n")
    elif summary:
        md_parts.append(f"## 摘要\n\n{summary.strip()}\n\n")
    else:
        md_parts.append("## 摘要\n\n_（未生成摘要）_\n\n")
    if associations:
        md_parts.append("## 联想归纳\n\n")
        for direction, analysis in associations.items():
            md_parts.append(f"### {direction}\n\n{analysis}\n\n")
    if rewrites:
        md_parts.append("## 改写/润色\n\n")
        for style, text in rewrites.items():
            md_parts.append(f"### {style}\n\n{text}\n\n")
    if translations:
        md_parts.append("## 翻译\n\n")
        for lang, text in translations.items():
            md_parts.append(f"### {lang}\n\n{text}\n\n")
    md_parts.append(f"---\n\n## 正文\n\n{doc.content}\n")

    md_path.write_text("".join(md_parts), encoding="utf-8")
    json_path.write_text(
        json.dumps(
            {
                "task_id": task_id,
                "project_id": record.project_id,
                **doc.to_dict(),
                "summary": summary,
                "associations": associations,
                "rewrites": rewrites,
                "translations": translations,
                "summary_version": 2,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    runner.set_progress(task_id, 1.0, "文本任务完成")

    return {
        "title": doc.title,
        "content": doc.content,
        "summary": summary,
        "summary_version": 2,
        "associations": associations,
        "rewrites": rewrites,
        "translations": translations,
        "char_count": doc.char_count,
        "source_type": doc.source_type,
        "source": doc.source,
        "meta": doc.meta,
        "cover_thumbnail": (doc.meta or {}).get("cover_thumbnail", ""),
        "images": (doc.meta or {}).get("images", []),
        "markdown_path": str(md_path.resolve()),
        "json_path": str(json_path.resolve()),
    }


def _extract_thumbnails_via_ytdlp(url: str, output_dir: Path, log: Any) -> list[str]:
    """#3: 用 yt-dlp write_all_thumbnails 提取平台页面中的图片（如小红书图文）。

    适用于图文类平台（无 video formats），跳过视频下载，仅提取所有 thumbnail。
    返回已下载的图片路径列表（可能为空）。
    """
    try:
        import yt_dlp
    except ImportError:
        if log:
            log("⚠️ yt-dlp 未安装，跳过缩略图提取")
        return []

    work_dir = output_dir / "_ytdlp_thumbs"
    work_dir.mkdir(parents=True, exist_ok=True)

    # 记录操作前的文件
    before = {p.name for p in work_dir.iterdir()}

    opts: dict[str, Any] = {
        "skip_download": True,
        "writethumbnail": True,
        "write_all_thumbnails": True,
        "ignore_no_formats_error": True,
        "outtmpl": {"default": str(work_dir / "%(title)s_%(id)s.%(ext)s")},
        "quiet": True,
        "no_warnings": True,
    }

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.extract_info(url, download=True)
    except Exception as exc:
        if log:
            log(f"⚠️ yt-dlp 缩略图提取失败: {exc}")
        return []

    IMG_SUFFIXES = (".jpg", ".jpeg", ".png", ".webp")

    # 扫描新文件
    after = {p.name for p in work_dir.iterdir()}
    new_files = [
        str(work_dir / name)
        for name in (after - before)
        if Path(work_dir, name).suffix.lower() in IMG_SUFFIXES
    ]

    # 若无新文件（如 retry 时 yt-dlp 不再重复下载），返回目录中已有图片
    if not new_files:
        existing = [
            str(p) for p in sorted(work_dir.iterdir())
            if p.is_file() and p.suffix.lower() in IMG_SUFFIXES
        ]
        return existing

    return sorted(new_files)


def handle_image_task(record: TaskRecord, runner: TaskRunner) -> Dict[str, Any]:
    """图片分析任务（Phase X.4 + N9 扩展）。

    payload 字段：
      - source: 必填，HTTP(S) URL 或本地文件路径
      - source_type: "url" | "local"（可省略，依赖 source 自动判断）
      - vision_model / text_model / api_key：可选，从 settings 兜底
      - ocr: {enabled, ...} N9 PaddleOCR 开关
      - assoc: {enabled, directions: [...]} N9 联想方向
      - prompt: {enabled, format} N9 提示词格式

    状态机：FETCH → OCR → VLM → ASSOCIATION → STORE → SUCCESS
    产物：data/workspaces/<pid>/image/<task_id>.json
    """
    import re as _re

    payload = record.payload
    task_id = record.task_id
    log = lambda msg: runner.append_log(task_id, msg)  # noqa: E731

    source = str(payload.get("source") or "").strip()
    if not source:
        raise ValueError("image task 需要 payload.source（URL 或文件路径）")
    source_type = str(payload.get("source_type") or "").strip().lower() or (
        "url" if source.startswith(("http://", "https://")) else "local"
    )

    # N9: 读取 preflight 子参数
    ocr_params = payload.get("ocr") or {}
    ocr_enabled = isinstance(ocr_params, dict) and ocr_params.get("enabled", False)
    assoc_params = payload.get("assoc") or {}
    assoc_enabled = isinstance(assoc_params, dict) and assoc_params.get("enabled", False)
    assoc_directions = assoc_params.get("directions", ["usage"]) if assoc_enabled else []
    fp_params = payload.get("prompt") or {}
    prompt_format = fp_params.get("format", "mj") if isinstance(fp_params, dict) else "mj"

    from shared.config import get_workspace_root

    image_dir = get_workspace_root(record.project_id) / "image"
    image_dir.mkdir(parents=True, exist_ok=True)

    log(f"🖼 image_task | source_type={source_type} | source={source[:80]}")
    if ocr_enabled:
        log("🔤 OCR 已启用（PaddleOCR）")
    if assoc_enabled:
        log(f"🔗 联想分析已启用 | directions={assoc_directions}")

    # ── 1. FETCH ────────────────────────────────────────────
    runner.store.update(task_id, status=TaskStatus.FETCH.value)
    runner.set_progress(task_id, 0.05, "拉取图片...")

    if source_type == "url":
        req = urllib.request.Request(source, headers={"User-Agent": "Mozilla/5.0"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                image_bytes = resp.read()
        except Exception as err:
            raise RuntimeError(f"图片下载失败：{err}") from err

        # #3: 检测下载内容是否为图片；若是 HTML 页（如小红书图文），
        #     回退到 yt-dlp write_all_thumbnails 提取
        if not image_bytes[:4] in (b"\x89PNG", b"RIFF") and not image_bytes[:2] in (b"\xff\xd8",):
            if log:
                log(f"🔍 下载内容非图片（前 16 字节: {image_bytes[:16].hex()}），尝试 yt-dlp 缩略图提取…")
            thumb_paths = _extract_thumbnails_via_ytdlp(source, image_dir, log)
            if thumb_paths:
                log(f"✅ yt-dlp 提取 {len(thumb_paths)} 张图片到 {image_dir}")
                # 用第一张图继续后续 VLM/OCR 流程
                image_bytes = Path(thumb_paths[0]).read_bytes()
                source_type = "local"
                source = thumb_paths[0]
            else:
                raise RuntimeError(f"URL 不是直接图片地址，且 yt-dlp 未能提取缩略图: {source[:80]}")
    else:
        local = Path(source)
        if not local.is_file():
            raise RuntimeError(f"本地图片不存在：{source}")
        image_bytes = local.read_bytes()

    # 通过文件头简单判断格式
    if image_bytes[:4] == b"\x89PNG":
        mime = "image/png"
    elif image_bytes[:2] == b"\xff\xd8":
        mime = "image/jpeg"
    elif image_bytes[:4] == b"RIFF" and image_bytes[8:12] == b"WEBP":
        mime = "image/webp"
    else:
        mime = "image/jpeg"  # 兜底

    img_b64 = base64.b64encode(image_bytes).decode()
    log(f"📦 图片已加载，{len(image_bytes)//1024} KB，mime={mime}")

    # ── 1.2 EXIF + 基本信息提取（I1） ────────────────────────
    import io
    from PIL import Image
    from PIL.ExifTags import TAGS, GPSTAGS

    dimensions: Dict[str, Any] = {}
    exif_data: Dict[str, Any] = {}
    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            dimensions = {
                "width": img.width,
                "height": img.height,
                "format": img.format or mime.split("/")[-1].upper(),
                "size_kb": round(len(image_bytes) / 1024, 1),
            }
            raw_exif = img.getexif()
            if raw_exif:
                # 基础 TAGS
                tag_map = {TAGS.get(k, k): v for k, v in raw_exif.items()}
                make = str(tag_map.get("Make", "")).strip()
                model = str(tag_map.get("Model", "")).strip()
                if make and model and model.lower().startswith(make.lower()):
                    exif_data["device"] = model
                elif make or model:
                    exif_data["device"] = f"{make} {model}".strip()
                exif_data["lens"] = str(tag_map.get("LensModel", "")).strip() or None
                dt = str(tag_map.get("DateTimeOriginal", "")).strip()
                if dt:
                    exif_data["time"] = dt

                # ExifIFD 子 IFD（光圈/快门/ISO）
                exif_ifd = raw_exif.get_ifd(0x8769)
                fn = exif_ifd.get(33437)  # FNumber
                if fn:
                    try:
                        exif_data["aperture"] = f"f/{float(fn):.1f}"
                    except (TypeError, ValueError):
                        pass
                et = exif_ifd.get(33434)  # ExposureTime
                if et:
                    try:
                        exif_data["shutter"] = (
                            f"1/{int(round(1 / float(et)))}s"
                            if float(et) < 1
                            else f"{float(et)}s"
                        )
                    except (TypeError, ValueError, ZeroDivisionError):
                        pass
                iso = exif_ifd.get(34855)  # ISOSpeedRatings
                if iso:
                    exif_data["iso"] = f"ISO {iso}"

                # GPS
                gps_ifd = raw_exif.get_ifd(0x8825)
                if gps_ifd:
                    def _to_deg(vals):
                        try:
                            d, m, s = float(vals[0]), float(vals[1]), float(vals[2])
                            return d + m / 60 + s / 3600
                        except Exception:
                            return None

                    lat_v = gps_ifd.get(2)
                    lat_ref = gps_ifd.get(1, "N")
                    lon_v = gps_ifd.get(4)
                    lon_ref = gps_ifd.get(3, "E")
                    if lat_v and lon_v:
                        lat = _to_deg(lat_v)
                        lon = _to_deg(lon_v)
                        if lat is not None and lon is not None:
                            if lat_ref == "S":
                                lat = -lat
                            if lon_ref == "W":
                                lon = -lon
                            exif_data["gps"] = {"lat": round(lat, 6), "lon": round(lon, 6)}

                # 清理空值
                exif_data = {k: v for k, v in exif_data.items() if v}
    except Exception as exc:
        log(f"⚠️  EXIF 提取失败（不影响主流程）：{exc}")

    # ── 1.5 OCR（N9: PaddleOCR，独立于 VLM） ───────────────
    ocr_text = ""
    if ocr_enabled:
        runner.set_progress(task_id, 0.15, "PaddleOCR 文字提取中...")
        try:
            from shared.ocr_service import extract_text

            ocr_text = extract_text(image_bytes)
            if ocr_text:
                log(f"🔤 OCR 提取 {len(ocr_text)} 字")
            else:
                log("🔤 OCR 未检测到文字")
        except Exception as err:
            log(f"⚠️  PaddleOCR 失败，回退 VLM OCR：{err}")
            ocr_text = ""  # 回退：VLM prompt 里也会提取 ocr_text

    # ── 2. VLM ──────────────────────────────────────────────
    runner.store.update(task_id, status=TaskStatus.VLM.value)
    runner.set_progress(task_id, 0.35, "视觉模型分析中...")

    settings = load_settings()
    api_key = (
        str(payload.get("api_key") or "").strip()
        or (settings.openai_api_key or "").strip()
    )

    # 构造 VLM prompt——如果 PaddleOCR 已成功提取文字，则不在 prompt 里要求 ocr_text
    ocr_json_line = (
        "" if ocr_text
        else '"ocr_text": "图中可见文字（无则空字符串）",\n'
    )
    # N9: 根据 prompt_format 调整提示词部分
    if prompt_format == "sd":
        prompt_block = (
            '"prompts": {\n'
            '   "sd": {"positive": "Stable Diffusion 正向提示词（英文）", "negative": "负向提示词"}\n'
            ' }'
        )
    elif prompt_format == "json":
        prompt_block = '"prompts": {\n   "json": "结构化场景描述（英文 JSON 字符串）"\n }'
    else:
        prompt_block = (
            '"prompts": {\n'
            '   "mj": "Midjourney 提示词（英文，50-80词）",\n'
            '   "sd": {"positive": "Stable Diffusion 正向提示词（英文）", "negative": "负向提示词"},\n'
            '   "json": "结构化场景描述（英文 JSON 字符串）"\n'
            ' }'
        )

    if not api_key:
        log("⚠️  未提供 api_key，跳过视觉分析")
        description = ""
        prompts: Dict[str, Any] = {"mj": "", "sd": {"positive": "", "negative": ""}, "json": ""}
        tags: Dict[str, List[str]] = {}
    else:
        registry = create_default_registry()
        profile = registry.resolve_default_profile(settings, "vision")
        provider = registry.build(profile)
        vision_model = (
            str(payload.get("vision_model") or "").strip()
            or profile.default_models.get("vision")
            or (settings.vision_model or "").strip()
        )
        if not vision_model:
            log("⚠️  未配置 vision_model，跳过视觉分析")
            description = ""
            prompts = {"mj": "", "sd": {"positive": "", "negative": ""}, "json": ""}
            tags = {}
        else:
            log(f"🔍 调用 vision model={vision_model}")
            analysis_prompt = (
                "你是一名专业的图像分析助手。请分析这张图片并以纯 JSON 格式输出，不要有 markdown 代码块。\n"
                "JSON 结构如下：\n"
                '{"description": "中文详细描述（100-200字）",\n'
                f' {ocr_json_line}'
                f' {prompt_block},\n'
                ' "tags": {"subject": [], "scene": [], "style": [], "lighting": [], "color": [], "composition": []}}'
            )
            try:
                raw = provider.chat(
                    ChatRequest(
                        model=vision_model,
                        messages=[{
                            "role": "user",
                            "content": [
                                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{img_b64}"}},
                                {"type": "text", "text": analysis_prompt},
                            ],
                        }],
                        temperature=0.3,
                        max_tokens=1200,
                    )
                )
                m = _re.search(r"\{[\s\S]*\}", raw)
                parsed: Dict[str, Any] = json.loads(m.group()) if m else {}
            except Exception as err:
                log(f"⚠️  视觉分析失败：{err}")
                parsed = {}

            description = str(parsed.get("description") or "")
            # PaddleOCR 优先；仅当 PaddleOCR 无结果时用 VLM 的 ocr_text
            if not ocr_text:
                ocr_text = str(parsed.get("ocr_text") or "")
            prompts = parsed.get("prompts") or {"mj": "", "sd": {"positive": "", "negative": ""}, "json": ""}
            tags = parsed.get("tags") or {}

    log(f"📊 分析完成 | description={description[:40]}...")

    # ── 2.5 联想分析（N9: 多方向 VLM 调用） ────────────────
    associations: Dict[str, str] = {}
    if assoc_enabled and assoc_directions and api_key:
        runner.set_progress(task_id, 0.70, "联想分析中...")
        direction_prompts: Dict[str, str] = {
            "usage": "从用途角度分析这张图片：它适合用在什么场景？（如社交媒体、印刷、UI 设计、广告等）给出 3-5 个具体用途建议。",
            "design": "从设计角度分析这张图片：构图、配色、排版、视觉层次各有什么特点？哪些设计手法值得借鉴？",
            "competitor": "从竞品角度分析这张图片：同类型内容中，这种风格/手法的优劣势是什么？有哪些改进空间？",
            "emotion": "从情绪角度分析这张图片：它传达了什么情绪和氛围？目标受众会产生什么感受？如何强化或调整情绪表达？",
        }
        # 确保有可用的 vision model
        if not vision_model:
            log("⚠️  未配置 vision_model，跳过联想分析")
        else:
            for direction in assoc_directions:
                d_prompt = direction_prompts.get(direction)
                if not d_prompt:
                    continue
                try:
                    resp = provider.chat(
                        ChatRequest(
                            model=vision_model,
                            messages=[{
                                "role": "user",
                                "content": [
                                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{img_b64}"}},
                                    {"type": "text", "text": d_prompt + "\n请用中文回答，200-400字。"},
                                ],
                            }],
                            temperature=0.5,
                            max_tokens=800,
                        )
                    )
                    associations[direction] = resp.strip()
                    log(f"🔗 联想 [{direction}] 完成，{len(resp)}字")
                except Exception as err:
                    log(f"⚠️  联想 [{direction}] 失败：{err}")
                    associations[direction] = ""

    # ── 3. STORE ────────────────────────────────────────────
    runner.store.update(task_id, status=TaskStatus.STORE.value)
    runner.set_progress(task_id, 0.90, "归档图片产物...")


    result: Dict[str, Any] = {
        "task_id": task_id,
        "project_id": record.project_id,
        "source": source,
        "source_type": source_type,
        "description": description,
        "ocr_text": ocr_text,
        "prompts": prompts,
        "tags": tags,
    }
    if exif_data:
        result["exif"] = exif_data
    if dimensions:
        result["dimensions"] = dimensions
    if associations:
        result["associations"] = associations
    # URL 图片可直接用源地址做缩略图
    if source_type == "url":
        result["cover_thumbnail"] = source
    json_path = image_dir / f"{task_id}.json"
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    runner.set_progress(task_id, 1.0, "图片任务完成")
    log(f"✅ 产物已归档：{json_path}")

    return {**result, "json_path": str(json_path.resolve())}


def handle_audio_task(record: TaskRecord, runner: TaskRunner) -> Dict[str, Any]:
    """音频分析任务（Phase X.A）。

    payload 字段：
      - source: 必填，HTTP(S) URL 或本地文件路径
      - source_type: "url" | "local"（可省略，依 source 前缀自动判断）
      - audio_model: 可选，默认 FunAudioLLM/SenseVoiceSmall

    状态机：FETCH → TRANSCRIBE → SUMMARIZE → STORE → SUCCESS
    产物：data/workspaces/<pid>/audio/<task_id>.json
    """
    import mimetypes

    payload = record.payload
    task_id = record.task_id
    log = lambda msg: runner.append_log(task_id, msg)  # noqa: E731

    source = str(payload.get("source") or "").strip()
    if not source:
        raise ValueError("audio task 需要 payload.source（URL 或文件路径）")
    source_type = str(payload.get("source_type") or "").strip().lower() or (
        "url" if source.startswith(("http://", "https://")) else "local"
    )

    # N8: 读 audio 子参数（兼容老 boolean / 缺字段）
    def _task_enabled(key: str, default: bool) -> bool:
        v = payload.get(key)
        if isinstance(v, dict):
            return bool(v.get("enabled", default))
        if isinstance(v, bool):
            return v
        return default

    asr_params = payload.get("asr") if isinstance(payload.get("asr"), dict) else {}
    music_params = payload.get("music") if isinstance(payload.get("music"), dict) else {}
    subtitle_params = payload.get("srt") if isinstance(payload.get("srt"), dict) else {}

    whisper_lang = str(asr_params.get("whisper_lang") or "auto").strip().lower()
    asr_enabled = _task_enabled("asr", True)
    diarization_enabled = _task_enabled("voiceprint", False)
    music_enabled = _task_enabled("music", False)
    subtitle_enabled = _task_enabled("srt", True)
    _music_confirmed = bool(payload.get("music_mode_confirmed"))

    log(
        f"🎵 audio_task | source_type={source_type} | source={source[:80]} | "
        f"lang={whisper_lang} | diarize={diarization_enabled} | music={music_enabled} | "
        f"subtitle={subtitle_enabled}" + (f" | music_confirmed" if _music_confirmed else "")
    )

    # ── 1. FETCH ────────────────────────────────────────────
    runner.store.update(task_id, status=TaskStatus.DOWNLOAD.value)
    runner.set_progress(task_id, 0.05, "拉取音频文件...")

    # A3 重跑：文件已在首次运行时下载，跳过
    from shared.config import get_workspace_root
    audio_dir = get_workspace_root(record.project_id) / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    audio_local_path: Path
    content_type = ""
    yt_dlp_meta: Dict[str, Any] = {}

    def _remember_ytdlp_metadata(meta: Dict[str, Any]) -> Dict[str, Any]:
        mapped = _apply_ytdlp_metadata_to_task(record, runner, meta)
        yt_dlp_meta.update(mapped)
        return mapped

    if source_type == "url":
        url_path = source.split("?")[0]
        audio_filename = url_path.split("/")[-1] or "audio.mp3"
        audio_local_path = audio_dir / f"{task_id}_{audio_filename}"
        _is_platform = is_platform_url(source)
        if _music_confirmed and audio_local_path.exists():
            log("📦 音频文件已存在（重跑），跳过下载")
            audio_bytes = audio_local_path.read_bytes()
        elif _is_platform:
            # 先无副作用预取元数据，保证 audio-only 也能拿到 title/thumbnail
            pre_meta = fetch_ytdlp_metadata(source, log=lambda m: runner.append_log(task_id, m))
            if pre_meta:
                _remember_ytdlp_metadata(pre_meta)

            log(f"🎬 检测到平台 URL，使用 yt-dlp 抽取音频流")
            result = run_ytdlp_download(
                url=source,
                output_dir=str(audio_dir),
                format_selector="bestaudio/best",
                log=lambda m: runner.append_log(task_id, m),
                progress_callback=lambda p, msg: runner.set_progress(task_id, 0.05 + p * 0.1, msg),
                # R15 audio 任务也在下载中就回写标题，让 ProcessingPage 立刻显示真实名字
                info_callback=_remember_ytdlp_metadata,
            )
            if not result.get("ok"):
                raise RuntimeError(f"音频下载失败（yt-dlp）：{result.get('error', '未知错误')}")

            # R13.6.2 把 yt-dlp 元数据回写到 task.result，让 ProcessingPage 在 audio 阶段显示真实标题
            _remember_ytdlp_metadata(result)

            audio_local_path = Path(result["save_path"])
            audio_filename = audio_local_path.name
            audio_bytes = audio_local_path.read_bytes()
            content_type = ""
        else:
            req = urllib.request.Request(source, headers={"User-Agent": "Mozilla/5.0"})
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    audio_bytes = resp.read()
                    content_type = resp.headers.get("Content-Type", "")
            except Exception as err:
                raise RuntimeError(f"音频下载失败：{err}") from err
            audio_local_path.write_bytes(audio_bytes)
    else:
        local = Path(source)
        if not local.is_file():
            raise RuntimeError(f"本地音频不存在：{source}")
        audio_bytes = local.read_bytes()
        audio_filename = local.name
        if _music_confirmed:
            audio_local_path = local  # 重跑直接用原路径
        else:
            audio_local_path = audio_dir / f"{task_id}_{audio_filename}"
            audio_local_path.write_bytes(audio_bytes)

    # 推断 MIME
    guessed, _ = mimetypes.guess_type(audio_filename)
    audio_mime = guessed or content_type.split(";")[0].strip() or "audio/mpeg"
    log(f"📦 音频已加载，{len(audio_bytes)//1024} KB，mime={audio_mime}，filename={audio_filename}")

    # ── 1.5 VAD（N8 / A3）────────────────────────────────────
    runner.store.update(task_id, status=TaskStatus.PROBE.value)
    runner.set_progress(task_id, 0.15, "VAD 人声活动检测...")
    vad_result = run_vad(audio_local_path)
    speech_ratio = (
        vad_result.total_speech_duration / max(vad_result.total_duration, 0.1)
        if vad_result.total_duration > 0
        else 1.0
    )
    log(
        f"🔍 VAD | has_speech={vad_result.has_speech} | "
        f"speech={vad_result.total_speech_duration:.1f}s / total={vad_result.total_duration:.1f}s"
        f" ({speech_ratio:.1%})"
    )
    # A3: 无人声占比 > 80% + 未启用音乐分析 + 非已确认重跑 → 弹窗等用户确认
    _music_confirmed = bool(payload.get("music_mode_confirmed"))
    if speech_ratio < 0.2 and not music_enabled and not _music_confirmed:
        runner.append_log(
            task_id,
            f"🎵 人声占比仅 {speech_ratio:.1%}（< 20%），等待用户确认是否切换音乐分析模式",
            level="warning",
        )
        partial_result = {
            "awaiting_confirm": True,
            "speech_ratio": round(speech_ratio, 3),
            "total_duration": round(vad_result.total_duration, 2),
            "vad": vad_result.to_dict(),
        }
        runner.store.update(
            task_id,
            status=TaskStatus.AWAITING_CONFIRM.value,
            progress=0.18,
            result=partial_result,
        )
        return partial_result

    # 若无人声 + ASR 仍开启，按 spec 跳过 ASR（避免空 LLM 调用）
    skip_asr = (not vad_result.has_speech) or (not asr_enabled) or _music_confirmed

    # ── 2. TRANSCRIBE ────────────────────────────────────────
    runner.store.update(task_id, status=TaskStatus.ASR.value)
    runner.set_progress(task_id, 0.30, "语音转文字中...")

    settings = load_settings()
    api_key = str(payload.get("api_key") or "").strip() or (getattr(settings, "openai_api_key", "") or "").strip()
    base_url = str(payload.get("base_url") or "").strip() or (getattr(settings, "openai_base_url", "") or "https://api.siliconflow.cn/v1").strip()
    audio_model = str(payload.get("audio_model") or "").strip() or "FunAudioLLM/SenseVoiceSmall"

    transcript_text = ""
    transcript_segments: List[Dict[str, Any]] = []

    if skip_asr:
        log("⏭️  跳过 ASR（无人声或未启用）")
    else:
        # R18.1.2: 通过 asr_router 按优先级尝试本地 ASR（mlx > fast > remote）
        from backend.app.services.asr_router import run_local_asr_with_fallback, select_asr_engine

        tcfg = settings.transcriber
        engine = select_asr_engine(api_key=api_key)
        log(f"🔍 选用 ASR 引擎：{engine}")

        try:
            transcript_text, transcript_segments, _, asr_engine = run_local_asr_with_fallback(
                file_path=str(audio_local_path),
                api_key=api_key,
                api_base=base_url,
                model_name=tcfg.whisper_model_size or "base",
                audio_model=audio_model,
                language=whisper_lang if whisper_lang != "auto" else "",
                initial_prompt=tcfg.initial_prompt or "",
                log_callback=log,
                progress_callback=lambda ratio, msg: runner.set_progress(
                    task_id, 0.30 + ratio * 0.35, msg
                ),
            )
            log(f"✅ 转写完成（{asr_engine}），{len(transcript_text)} 字符 / {len(transcript_segments)} 段")
        except (RuntimeError, FileNotFoundError) as err:
            raise RuntimeError(f"ASR 全部失败，无法转写音频：{err}") from err

    # ── 3. SUMMARIZE ─────────────────────────────────────────
    runner.store.update(task_id, status=TaskStatus.SUM.value)
    runner.set_progress(task_id, 0.70, "生成摘要中...")
    summary = ""

    if transcript_text and api_key:
        log("📝 调用 chat model 生成摘要...")
        registry = create_default_registry()
        profile = registry.resolve_default_profile(settings, "chat")
        provider = registry.build(profile)
        chat_model = (
            str(payload.get("text_model") or "").strip()
            or getattr(profile.default_models, "chat", None)
            or (getattr(settings, "text_model", "") or "").strip()
        )
        if chat_model:
            try:
                # R18: 优先使用 summary_template（新模板系统）
                summary_template_id = str(payload.get("summary_template") or "").strip()
                summary_max_tokens = 1200
                if summary_template_id:
                    from backend.app.services.summary_templates import get_template
                    tpl = get_template(summary_template_id)
                    prompt = tpl.user_prompt.replace("{transcript}", transcript_text[:12000])
                    summary_max_tokens = 3000
                    log(f"📝 LLM 总结 | template={tpl.label} ({summary_template_id})")
                else:
                    prompt = f"请将以下音频转写内容总结为 100-200 字的中文摘要：\n\n{transcript_text[:3000]}"
                    log("📝 LLM 总结 | template=default (100-200字摘要)")
                summary = provider.chat(
                    ChatRequest(
                        model=chat_model,
                        messages=[{"role": "user", "content": prompt}],
                        temperature=0.3,
                        max_tokens=summary_max_tokens,
                    )
                )
                log(f"📋 摘要生成完成，{len(summary)} 字符")
            except Exception as err:
                log(f"⚠️  摘要生成失败：{err}")

    subtitle_paths: Dict[str, str] = {}

    # ── 3.5 说话人分离（N8）──────────────────────────────────
    diarization_dict: Optional[Dict[str, Any]] = None
    if diarization_enabled and vad_result.has_speech:
        runner.set_progress(task_id, 0.75, "说话人分离（pyannote）...")
        log("🎤 说话人分离中（pyannote.audio）")
        diar = run_diarization(audio_local_path)
        if diar is None:
            log("⚠️  说话人分离未执行（缺 HF_TOKEN / 模型协议未同意 / 包不可用）")
        else:
            diarization_dict = diar.to_dict()
            log(f"✅ 检测到 {diar.num_speakers} 个说话人，{len(diar.segments)} 段")
            if transcript_segments:
                transcript_segments = assign_speakers_to_segments(transcript_segments, diar)

    # ── 3.6 音乐分析（N8 / A3）──────────────────────────────
    music_dict: Optional[Dict[str, Any]] = None
    _run_music = music_enabled or _music_confirmed
    if _run_music:
        runner.set_progress(task_id, 0.82, "音乐特征分析（librosa）...")
        music_features = analyze_music(audio_local_path)
        if music_features is None:
            log("⚠️  音乐分析未执行（librosa 不可用或文件读取失败）")
        else:
            log(
                f"🎼 BPM={music_features.bpm:.1f} | key={music_features.key} | "
                f"duration={music_features.duration:.1f}s"
            )
            # LLM 生成 Suno/Udio 提示词（若有 api_key）
            if api_key:
                runner.set_progress(task_id, 0.86, "生成音乐提示词...")
                registry = create_default_registry()
                profile = registry.resolve_default_profile(settings, "chat")
                provider = registry.build(profile)
                music_chat_model = (
                    str(payload.get("text_model") or "").strip()
                    or (getattr(settings, "text_model", "") or "").strip()
                    or "Qwen/Qwen2.5-7B-Instruct"
                )

                def _music_llm(system: str, user: str) -> str:
                    return provider.chat(
                        ChatRequest(
                            model=music_chat_model,
                            messages=[
                                {"role": "system", "content": system},
                                {"role": "user", "content": user},
                            ],
                            temperature=0.5,
                            max_tokens=400,
                        )
                    )

                music_features = generate_music_prompt(music_features, _music_llm)
            music_dict = music_features.to_dict()

            # A3.3: 多段音乐 6 维度切分
            if _music_confirmed:
                try:
                    from shared.audio_analyzer import segment_audio, analyze_music_segments
                    runner.set_progress(task_id, 0.89, "多段音乐特征切分...")
                    boundaries = segment_audio(str(audio_local_path))
                    if len(boundaries) > 1:
                        segments = analyze_music_segments(str(audio_local_path), boundaries)
                        music_dict["segments"] = [s.to_dict() for s in segments]
                        music_dict["music_mode"] = True
                        log(f"🎵 多段分析完成，共 {len(segments)} 个片段")
                    else:
                        music_dict["music_mode"] = True
                        log("🎵 未检测到分段边界，使用整体分析")
                except Exception as seg_err:
                    music_dict["music_mode"] = True
                    log(f"⚠️  多段切分失败（{seg_err}），已回退整体分析")

    # ── 3.7 字幕导出（N8）──────────────────────────────────
    # R18: 专有名词修正 + include_timestamps 开关
    proper_nouns = str(payload.get("proper_nouns") or "").strip()
    include_timestamps = bool(payload.get("include_timestamps", True))
    if subtitle_enabled and transcript_segments:
        # R18: 专有名词修正（批量 LLM 调用）
        if proper_nouns and api_key:
            try:
                runner.set_progress(task_id, 0.88, "专有名词修正...")
                segments_json = json.dumps(
                    [{"idx": i, "text": s.get("text", "")} for i, s in enumerate(transcript_segments)],
                    ensure_ascii=False,
                )
                # 分块处理（每块 8000 字）
                chunk_size = 8000
                chunks = [segments_json[i:i+chunk_size] for i in range(0, len(segments_json), chunk_size)]
                all_corrections = []
                for ci, chunk in enumerate(chunks):
                    correction_prompt = (
                        f"你是字幕校对员。下面是用户提供的专有名词清单（可能含人名/术语/品牌），"
                        f"请在转写文本中找出读音相近但拼写错误的位置，替换为清单里的正确写法。"
                        f"只改专有名词，不改其他文字。输出 JSON：[{{\"idx\": 原始idx, \"original\": 原文, \"corrected\": 修正后}}]。\n\n"
                        f"专有名词清单：{proper_nouns}\n\n转写片段：{chunk}"
                    )
                    resp = provider.chat(ChatRequest(
                        model=chat_model,
                        messages=[{"role": "user", "content": correction_prompt}],
                        temperature=0.1,
                        max_tokens=2000,
                    ))
                    try:
                        corrections = json.loads(resp)
                        if isinstance(corrections, list):
                            all_corrections.extend(corrections)
                    except json.JSONDecodeError:
                        log(f"⚠️  专有名词修正结果解析失败（chunk {ci}），跳过")
                # 应用修正
                if all_corrections:
                    for c in all_corrections:
                        idx = c.get("idx")
                        corrected = c.get("corrected")
                        if isinstance(idx, int) and 0 <= idx < len(transcript_segments) and corrected:
                            original = transcript_segments[idx].get("text", "")
                            transcript_segments[idx]["text"] = corrected
                            if original != corrected:
                                log(f"📝 修正 #{idx}: {original[:20]}... → {corrected[:20]}...")
                    log(f"✅ 专有名词修正完成，共 {len(all_corrections)} 处")
            except Exception as e:
                log(f"⚠️  专有名词修正失败（保留原始转写）: {e}")

        # 字幕导出
        srt_text = export_srt(transcript_segments)
        txt_text = export_txt(transcript_segments, with_speaker=bool(diarization_dict))
        if include_timestamps:
            srt_path = audio_dir / f"{task_id}.srt"
            srt_path.write_text(srt_text, encoding="utf-8")
            subtitle_paths = {"srt": str(srt_path.resolve())}
        else:
            txt_path = audio_dir / f"{task_id}.txt"
            txt_path.write_text(txt_text, encoding="utf-8")
            subtitle_paths = {"txt": str(txt_path.resolve())}
        log(f"📄 字幕已导出（{len(transcript_segments)} 段）")

    # ── 4. STORE ─────────────────────────────────────────────
    runner.store.update(task_id, status=TaskStatus.STORE.value)
    runner.set_progress(task_id, 0.92, "归档音频产物...")

    try:
        audio_duration_sec = float(yt_dlp_meta.get("video_duration") or 0)
    except (TypeError, ValueError):
        audio_duration_sec = 0.0
    if audio_duration_sec <= 0:
        audio_duration_sec = float(vad_result.total_duration or 0)
    audio_title = str(yt_dlp_meta.get("video_title") or audio_filename)

    # segment_refiner：切细过长字幕段（在存入 results 前）
    transcript_segments = refine_segments(transcript_segments)

    result: Dict[str, Any] = {
        "task_id": task_id,
        "project_id": record.project_id,
        "source": source,
        "source_type": source_type,
        **yt_dlp_meta,
        "duration_sec": audio_duration_sec,
        "transcript": transcript_text,
        "transcript_segments": transcript_segments,
        "summary": summary,
        "audio": {
            "title": audio_title,
            "filename": audio_filename,
            "url": source if source_type == "url" else "",
            "duration_sec": audio_duration_sec,
            "duration_str": "",
            "mime": audio_mime,
            "size_bytes": len(audio_bytes),
        },
        "tracks_meta": {
            "total_sec": audio_duration_sec,
            "transcript_count": len(transcript_segments),
        },
        "vad": vad_result.to_dict(),
        "diarization": diarization_dict,
        "music": music_dict,
        "music_segments": music_dict.get("segments", []) if music_dict else [],
        "music_mode": bool(_music_confirmed or (music_dict and music_dict.get("music_mode"))),
        "subtitle_paths": subtitle_paths,
    }
    json_path = audio_dir / f"{task_id}.json"
    json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    runner.set_progress(task_id, 1.0, "音频任务完成")
    log(f"✅ 产物已归档：{json_path}")

    return {**result, "json_path": str(json_path.resolve())}


# ── R19-B: AV synthesis handler ───────────────────────────────

def handle_av_synthesis_task(record: TaskRecord, runner: TaskRunner) -> Dict[str, Any]:
    """综合笔记任务：关键帧 + 转写 → 图文教学笔记 Markdown。

    依赖（需在同一 workspace 内已有产物）：
    - 视频分析产物（json_data/ 下的 *_视觉数据.json + frames/）
    - 音频转写产物（audio/ 下的 *.json，含 transcript_segments）

    payload 字段：
      - api_key: 可选，LLM API key（缺省从 settings 读取）
      - text_model: 可选，chat model 名称
    """
    from backend.app.services.av_synthesis import (
        align_frames_to_transcript,
        llm_final_synthesis,
        llm_global_summary,
        llm_split_chapters,
        load_frames_manifest,
        load_transcript,
    )
    from backend.app.services.av_synthesis.render import (
        AVSynthesisContext,
        GalleryRow,
        render_av_synthesis_md,
    )

    payload = record.payload
    task_id = record.task_id
    log = lambda msg: runner.append_log(task_id, msg)  # noqa: E731

    settings = load_settings()
    api_key = (
        str(payload.get("api_key") or "").strip()
        or settings.openai_api_key.strip()
    )
    if not api_key:
        raise ValueError("av_synthesis 任务需要 API key（请在设置中配置或在 payload 中传入）")

    # ── 1. 定位 workspace 产物 ────────────────────────────────
    workspace_root = get_workspace_root(record.project_id)
    json_dir = get_workspace_json_dir(record.project_id)

    runner.set_progress(task_id, 0.05, "加载依赖产物...")
    log("📂 开始加载帧数据和转写数据")

    # 查找视频分析产物目录（json_data 下含 frames/ 子目录的目录）
    frame_dirs = [d for d in json_dir.iterdir() if d.is_dir() and (d / "frames").is_dir()]
    if not frame_dirs:
        raise FileNotFoundError(f"workspace {record.project_id} 中未找到视频分析产物（json_data/*/frames/）")

    # 加载帧数据（从第一个找到的分析产物目录）
    frames = load_frames_manifest(frame_dirs[0])
    if not frames:
        raise FileNotFoundError(f"帧数据为空：{frame_dirs[0]}")
    log(f"✅ 加载 {len(frames)} 个关键帧")

    # 查找音频转写产物
    audio_dir = workspace_root / "audio"
    audio_jsons = list(audio_dir.glob("*.json")) if audio_dir.exists() else []
    if not audio_jsons:
        raise FileNotFoundError(f"workspace {record.project_id} 中未找到转写产物（audio/*.json）")

    transcript_segments = load_transcript(audio_jsons[0])
    if not transcript_segments:
        raise FileNotFoundError(f"转写数据为空：{audio_jsons[0]}")
    log(f"✅ 加载 {len(transcript_segments)} 段转写")

    # 提取元数据
    audio_data = json.loads(audio_jsons[0].read_text(encoding="utf-8"))
    metadata: Dict[str, Any] = {
        "title": audio_data.get("video_title") or audio_data.get("audio", {}).get("title") or "未命名",
        "author": audio_data.get("uploader") or audio_data.get("video_uploader") or "",
        "duration_display": _format_sec_short(audio_data.get("duration_sec") or audio_data.get("audio", {}).get("duration_sec") or 0),
    }

    # ── 2. 时间戳对齐 ────────────────────────────────────────
    runner.set_progress(task_id, 0.15, "帧-转写对齐中...")
    aligned = align_frames_to_transcript(frames, transcript_segments)
    log(f"✅ 对齐完成：{len(aligned)} 帧")

    # ── 3. LLM 分章节 ───────────────────────────────────────
    runner.set_progress(task_id, 0.25, "LLM 拆分章节...")
    log("🤖 调用 LLM 拆分章节...")
    chapters = llm_split_chapters(aligned, metadata, api_key)
    log(f"✅ 拆分为 {len(chapters)} 个章节")

    # ── 4. LLM 全局摘要 ─────────────────────────────────────
    runner.set_progress(task_id, 0.50, "LLM 生成全局摘要...")
    log("🤖 调用 LLM 生成全局摘要...")
    transcript_text = "\n".join(seg.text for seg in transcript_segments)
    summary = llm_global_summary(transcript_text, api_key)
    log(f"✅ 摘要生成完成：{len(summary)} 字")

    # ── 5. LLM 最终综合 ─────────────────────────────────────
    runner.set_progress(task_id, 0.70, "LLM 最终综合分析...")
    log("🤖 调用 LLM 生成最终综合...")
    final_synthesis = llm_final_synthesis(aligned, chapters, api_key)
    log(f"✅ 综合分析完成：{len(final_synthesis)} 字")

    # ── 6. 渲染 Markdown ────────────────────────────────────
    runner.set_progress(task_id, 0.85, "渲染 Markdown...")

    gallery_rows = [
        GalleryRow(
            timestamp_display=_format_sec_short(af.frame.timestamp),
            image_path=af.frame.image_path,
            scene_description=af.frame.scene_description,
        )
        for af in aligned
    ]

    # 格式化完整转写（带时间戳）
    full_transcript_lines = []
    for seg in transcript_segments:
        ts = _format_sec_short(seg.start)
        full_transcript_lines.append(f"[{ts}] {seg.text}")
    full_transcript = "\n".join(full_transcript_lines)

    ctx = AVSynthesisContext(
        title=metadata.get("title", "未命名"),
        platform=metadata.get("author", ""),
        author=metadata.get("author", ""),
        duration_display=metadata.get("duration_display", ""),
        summary=summary,
        gallery_rows=gallery_rows,
        chapters=chapters,
        full_transcript=full_transcript,
        final_synthesis=final_synthesis,
    )
    md = render_av_synthesis_md(ctx)

    # ── 7. 写出文件 ─────────────────────────────────────────
    out_path = workspace_root / "av_synthesis.md"
    out_path.write_text(md, encoding="utf-8")

    runner.set_progress(task_id, 1.0, "综合笔记完成")
    log(f"✅ 综合笔记已生成：{out_path}")

    return {
        "av_synthesis_path": "av_synthesis.md",
        "chapter_count": len(chapters),
        "frame_count": len(frames),
        "segment_count": len(transcript_segments),
    }


def register_pipeline_handlers(runner: TaskRunner) -> None:
    runner.register("download",  handle_download_task)
    runner.register("analyze",   handle_analyze_task)
    runner.register("create",    handle_create_task)
    runner.register("storyboard", handle_storyboard_task)
    runner.register("note",      handle_note_task)
    runner.register("text",      handle_text_task)
    runner.register("image",     handle_image_task)
    runner.register("audio",     handle_audio_task)
    runner.register("av_synthesis", handle_av_synthesis_task)
