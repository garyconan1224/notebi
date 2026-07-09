"""
视频画面深度拆解核心逻辑 v3（整合版）
提取自 video-analyzer-new/analyze_videos.py，去除内置 HTTP Dashboard。
供 Streamlit 页面直接调用。

主要功能：
- 视频抽帧（OpenCV）
- 逐帧视觉分析（硅基流动视觉模型，并发）
- 全局视觉总结（硅基流动文本模型）
- 三位一体输出：JSON + Markdown + HTML
- 断点续传支持
- 分析结果自动同步到 data/json_data/（供导演台知识库使用）
"""

from __future__ import annotations

import base64
import json
import logging
import re
import shutil
import threading
from concurrent.futures import CancelledError, ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional
from html import escape as _esc

try:
    import cv2
except ImportError:
    cv2 = None  # type: ignore[assignment]

from shared.config import (
    API_CONCURRENCY,
    COLLECT_DIR_NAME,
    ARCHIVE_DIR_NAME,
    FRAME_INTERVAL_SEC,
    JPEG_QUALITY,
    JSON_DATA_DIR,
    MAX_IMAGE_SIDE,
    SHORT_VIDEO_THRESHOLD,
    TEXT_MODEL_ANALYZER,
    VIDEO_EXTENSIONS,
    VIDEOS_DIR,
    VISION_MODEL_ANALYZER,
    VLM_FRAMES_PER_CALL,
    ensure_data_dirs,
)
from shared.sf_client import analyze_video_frame, analyze_video_frames_batch, generate_video_summary, SiliconFlowError

logger = logging.getLogger(__name__)

# ── 进度回调类型 ──────────────────────────────────────────────

ProgressCallback = Optional[Callable[[float, str], None]]


# ── 进度状态数据类 ─────────────────────────────────────────────

@dataclass
class VideoProgress:
    """单视频分析进度。"""
    video_name: str
    total_frames: int = 0
    analyzed_frames: int = 0
    current_timestamp: str = ""
    status: str = "pending"  # pending / analyzing / summarizing / done / failed / skipped
    percent: float = 0.0
    error: str = ""


@dataclass
class AnalysisState:
    """一次批量分析的全局状态（线程安全）。"""
    videos: list[VideoProgress] = field(default_factory=list)
    finished: bool = False
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False, compare=False)
    recent_live_frames: list[dict[str, Any]] = field(default_factory=list)
    _live_lock: threading.Lock = field(default_factory=threading.Lock, repr=False, compare=False)

    def push_live_frame(self, video_name: str, frame_data: dict[str, Any], frames_dir: Path) -> None:
        """供任务中心轮询展示最近关键帧与 JSON 片段。"""
        img = str(frame_data.get("frame_image") or "")
        path_str = ""
        if img:
            p = (frames_dir / img).resolve()
            if p.is_file():
                path_str = str(p)
        desc = str(frame_data.get("content_zh") or frame_data.get("description_zh") or "")
        snap: dict[str, Any] = {
            "video_name": video_name,
            "timestamp": frame_data.get("timestamp"),
            "content_zh": str(frame_data.get("content_zh") or "")[:500],
            "description_zh": desc[:500],
            "frame_json": {
                "timestamp": frame_data.get("timestamp"),
                "content_zh": str(frame_data.get("content_zh") or "")[:280],
                "description_zh": desc[:280],
                "image_prompt_en": (str(frame_data.get("image_prompt_en") or ""))[:200],
            },
            "frame_image": img,
            "frame_image_path": path_str,
        }
        with self._live_lock:
            self.recent_live_frames.append(snap)
            if len(self.recent_live_frames) > 40:
                self.recent_live_frames = self.recent_live_frames[-40:]

    def live_frames_snapshot(self) -> list[dict[str, Any]]:
        with self._live_lock:
            return list(self.recent_live_frames)

    def update(self, idx: int, **kwargs: Any) -> None:
        with self._lock:
            v = self.videos[idx]
            for k, val in kwargs.items():
                setattr(v, k, val)
            if v.total_frames > 0:
                v.percent = round(v.analyzed_frames / v.total_frames * 90.0, 1)
            if v.status == "done":
                v.percent = 100.0

    def snapshot(self) -> list[dict[str, Any]]:
        with self._lock:
            return [
                {
                    "video_name": v.video_name,
                    "total_frames": v.total_frames,
                    "analyzed_frames": v.analyzed_frames,
                    "current_timestamp": v.current_timestamp,
                    "status": v.status,
                    "percent": v.percent,
                    "error": v.error,
                }
                for v in self.videos
            ]


# ── 工具函数 ──────────────────────────────────────────────────

def format_timestamp(seconds: int) -> str:
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    return f"{h:02d}:{m:02d}:{s:02d}"


def sanitize_filename(name: str) -> str:
    """将文件名中的特殊字符替换为下划线，保留字母数字和下划线。"""
    return re.sub(r"[^\w]", "_", name)


def extract_product_name(filename_stem: str) -> str:
    """从文件名智能提取商品名。"""
    name = re.sub(r"[(\[][^)\]]*[)\]]", "", filename_stem).strip()
    name = re.sub(r"\s+", " ", name).strip()
    if not name:
        return filename_stem

    NOISE_WORDS = {
        "reveal", "review", "unboxing", "hands-on", "handson",
        "first", "look", "official", "trailer", "ad", "promo",
        "commercial", "teaser", "concept", "introduction", "intro",
        "launch", "event", "keynote", "presentation", "demo",
        "test", "comparison", "vs", "versus", "benchmark",
        "video", "clip", "short", "shorts", "reel", "reels",
        "hands", "new", "latest", "best", "top",
        "4k", "8k", "hd", "uhd", "fhd", "1080p", "720p",
    }

    words = name.split()
    product_words = []
    for word in words:
        lower = word.lower().strip(".,!?-_")
        if not lower or lower in NOISE_WORDS:
            break
        product_words.append(word)

    result = " ".join(product_words).strip()
    return result if result else filename_stem


def resize_frame(frame: Any) -> Any:
    """等比缩放帧到 MAX_IMAGE_SIDE 以内。"""
    h, w = frame.shape[:2]
    if max(h, w) > MAX_IMAGE_SIDE:
        scale = MAX_IMAGE_SIDE / max(h, w)
        frame = cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return frame


def frame_to_base64(frame: Any) -> str:
    """OpenCV 帧 → 内存 JPEG → Base64，不写磁盘。"""
    frame = resize_frame(frame)
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
    if not ok:
        raise RuntimeError("JPEG 编码失败")
    return base64.b64encode(buf).decode("utf-8")


def save_frame_to_disk(frame: Any, filepath: Path) -> None:
    """将帧保存为本地 JPEG。"""
    frame = resize_frame(frame)
    cv2.imwrite(str(filepath), frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])


def extract_first_frame(video_path: str | Path, output_path: str | Path) -> bool:
    """提取视频首帧并保存为 JPEG，成功返回 True。"""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return False
    try:
        ok, frame = cap.read()
        if not ok or frame is None:
            return False
        save_frame_to_disk(frame, Path(output_path))
        return True
    finally:
        cap.release()


def probe_duration_seconds(video_path: str | Path) -> int:
    """探测视频时长（秒，向下取整）；打不开或拿不到帧率时返回 0。"""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return 0
    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
        frames = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0
        if fps <= 0 or frames <= 0:
            return 0
        return int(frames / fps)
    finally:
        cap.release()


def make_frame_filename(safe_name: str, ts: str) -> str:
    return f"{safe_name}_{ts.replace(':', '_')}.jpg"


def is_transition_frame(description: str) -> bool:
    return "纯色过渡帧" in description


# ── 视频信息 ──────────────────────────────────────────────────

def find_videos(directory: Path) -> list[Path]:
    """递归查找目录下所有视频文件。"""
    videos = []
    for f in sorted(directory.iterdir()):
        if f.is_file() and f.suffix.lower() in VIDEO_EXTENSIONS:
            videos.append(f)
    return videos


def compute_frame_interval(duration_sec: int) -> int:
    """根据视频时长自动决定抽帧间隔。"""
    if FRAME_INTERVAL_SEC > 0:
        return FRAME_INTERVAL_SEC
    return 1 if duration_sec <= SHORT_VIDEO_THRESHOLD else 2


def get_video_info(video_path: Path) -> tuple[int, int, int]:
    """返回 (时长秒, 预计帧数, 间隔秒)。"""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return 0, 0, 1
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.release()
    duration = int(total / fps)
    interval = compute_frame_interval(duration)
    estimated = max(duration // interval, 1)
    return duration, estimated, interval


def extract_frames(video_path: Path, interval_sec: int = 2, max_frames: int | None = None):
    """生成器：按间隔抽帧，yield (秒, frame)。

    max_frames: N7 引入；非 None 时最多产出指定帧数（对应 SPEC §4.2.1 模式 A 的「最大帧数」）。
    """
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"无法打开视频: {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(int(round(fps * interval_sec)), 1)
    idx = 0
    yielded = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if idx % step == 0:
            yield int(idx / fps), frame
            yielded += 1
            if max_frames is not None and yielded >= max_frames:
                break
        idx += 1
    cap.release()


def extract_frames_by_scenes(video_path: Path, frames_per_shot: int = 3):
    """N7: 用 PySceneDetect 检测镜头切换，每镜头取 2 或 3 帧。

    frames_per_shot=2 → 首帧 + 尾帧（适合简单运镜）
    frames_per_shot=3 → 首帧 + 中间帧 + 尾帧（默认，适合复杂镜头）

    返回生成器，yield (sec, frame) 与 extract_frames 同形状。
    极短视频或无切换点时 fallback 到首帧。
    """
    try:
        from scenedetect import ContentDetector, detect
    except ImportError as err:
        raise RuntimeError(
            "scenedetect 未安装。请执行 pip install 'scenedetect>=0.6.4'"
        ) from err

    if frames_per_shot not in (2, 3):
        frames_per_shot = 3

    scenes = detect(str(video_path), ContentDetector())

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"无法打开视频: {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # 计算每镜头要取的 frame index 列表
    targets: list[int] = []
    if not scenes:
        # fallback：取首帧（不抛错，让上层照常处理）
        targets.append(0)
    else:
        for start_tc, end_tc in scenes:
            start_f = start_tc.frame_num
            end_f = max(end_tc.frame_num - 1, start_f)
            if frames_per_shot == 2:
                picks = [start_f, end_f]
            else:
                mid_f = (start_f + end_f) // 2
                picks = [start_f, mid_f, end_f]
            for f in picks:
                if 0 <= f < total_frames and (not targets or f != targets[-1]):
                    targets.append(f)

    # 去重 + 排序后直接 seek 到每个目标 frame
    targets = sorted(set(targets))
    try:
        for f in targets:
            if f < 0 or f >= total_frames:
                continue
            cap.set(cv2.CAP_PROP_POS_FRAMES, f)
            ret, frame = cap.read()
            if not ret:
                continue
            yield int(f / fps), frame
    finally:
        cap.release()


# ── 安全名称管理 ──────────────────────────────────────────────

_VIDEO_SAFE_NAMES: dict[str, str] = {}


def assign_safe_names(video_paths: list[Path]) -> None:
    """为每个视频分配唯一的安全名称，同名商品自动加数字后缀。"""
    _VIDEO_SAFE_NAMES.clear()
    name_counts: dict[str, int] = {}
    for vp in video_paths:
        base = sanitize_filename(extract_product_name(vp.stem))
        name_counts[base] = name_counts.get(base, 0) + 1

    name_idx: dict[str, int] = {}
    for vp in video_paths:
        base = sanitize_filename(extract_product_name(vp.stem))
        if name_counts[base] > 1:
            idx = name_idx.get(base, 0) + 1
            name_idx[base] = idx
            _VIDEO_SAFE_NAMES[str(vp.resolve())] = f"{base}_{idx}"
        else:
            _VIDEO_SAFE_NAMES[str(vp.resolve())] = base


def get_safe_name(video_path: Path) -> str:
    """获取视频的唯一安全名称（须先调用 assign_safe_names）。"""
    key = str(video_path.resolve())
    if key in _VIDEO_SAFE_NAMES:
        return _VIDEO_SAFE_NAMES[key]
    return sanitize_filename(extract_product_name(video_path.stem))


# ── 输出目录 ──────────────────────────────────────────────────

def get_output_dir(video_path: Path) -> Path:
    """{商品名}_分析报告/ — 与视频同级的专属项目文件夹。"""
    return video_path.parent / (get_safe_name(video_path) + "_分析报告")


# ── 断点续传 ──────────────────────────────────────────────────

CHECKPOINT_FILE = "_checkpoint.jsonl"


def load_checkpoint(output_dir: Path) -> list[dict[str, Any]]:
    """加载断点数据，返回已分析的帧列表。"""
    cp_path = output_dir / CHECKPOINT_FILE
    frames = []
    if not cp_path.exists():
        return frames
    try:
        with open(cp_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    frames.append(json.loads(line))
    except (json.JSONDecodeError, OSError):
        pass
    return frames


def append_checkpoint(output_dir: Path, frame_data: dict[str, Any]) -> None:
    """每分析完一帧，立即追加到断点文件（崩溃安全）。"""
    cp_path = output_dir / CHECKPOINT_FILE
    with open(cp_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(frame_data, ensure_ascii=False) + "\n")


def clear_checkpoint(output_dir: Path) -> None:
    """分析全部完成后清理断点文件。"""
    cp_path = output_dir / CHECKPOINT_FILE
    if cp_path.exists():
        cp_path.unlink()


# ── 完成检测 ──────────────────────────────────────────────────

def _check_json_complete(jp: Path) -> bool:
    try:
        with open(jp, "r", encoding="utf-8") as f:
            data = json.load(f)
        return (
            isinstance(data, dict)
            and "global_visual_summary" in data
            and isinstance(data.get("frames"), list)
            and len(data["frames"]) > 0
        )
    except (json.JSONDecodeError, OSError):
        return False


def is_already_processed(video_path: Path, target_json_dir: Path | None = None) -> bool:
    """检测分析结果是否完整。"""
    sn = get_safe_name(video_path)

    # 1. 检查与视频同级的 _分析报告 目录
    out = get_output_dir(video_path)
    jp = out / (sn + "_视觉数据.json")
    if jp.exists() and jp.stat().st_size > 0 and _check_json_complete(jp):
        return True

    # 2. 检查目标 JSON 目录（默认 data/json_data/）
    json_dir = target_json_dir or JSON_DATA_DIR
    gjp = json_dir / (sn + "_视觉数据.json")
    if gjp.exists() and gjp.stat().st_size > 0 and _check_json_complete(gjp):
        return True

    return False


# ── 结果保存 ──────────────────────────────────────────────────

def save_results(
    output_dir: Path,
    safe_name: str,
    original_title: str,
    product_name: str,
    summary: str,
    frames: list[dict[str, Any]],
) -> tuple[str, str, str]:
    """三位一体输出：JSON + Markdown + HTML。"""
    jp = output_dir / (safe_name + "_视觉数据.json")
    mp = output_dir / (safe_name + "_图文分镜.md")
    hp = output_dir / (safe_name + "_图文分镜.html")
    frames_dir = output_dir / "frames"

    json_frames = [
        {
            "timestamp": fr["timestamp"],
            "content_zh": fr.get("content_zh", ""),
            "description_zh": fr["description_zh"],
            "image_prompt_en": fr["image_prompt_en"],
        }
        for fr in frames
    ]
    json_data = {
        "video_title": original_title,
        "product_name": product_name,
        "global_visual_summary": summary,
        "frames": json_frames,
    }
    with open(jp, "w", encoding="utf-8") as f:
        json.dump(json_data, f, ensure_ascii=False, indent=2)

    _save_markdown(mp, original_title, product_name, summary, frames)
    _save_html(hp, frames_dir, original_title, product_name, summary, frames)

    return jp.name, mp.name, hp.name


def _save_markdown(
    md_path: Path,
    original_title: str,
    product_name: str,
    summary: str,
    frames: list[dict[str, Any]],
) -> None:
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(f"# 视频拆解：《{original_title}》\n\n")
        f.write(f"> 商品名：{product_name}\n\n")
        f.write("## 全局视觉总结\n\n")
        f.write(summary + "\n\n---\n\n")
        f.write("## 逐帧拆解\n\n")
        for fr in frames:
            f.write(f"### [{fr['timestamp']}]\n\n")
            if fr.get("content_zh"):
                f.write(f"- **内容**：{fr['content_zh']}\n")
            f.write(f"- **描述**：{fr['description_zh']}\n")
            if fr["image_prompt_en"]:
                f.write(f"- **提示词**：{fr['image_prompt_en']}\n")
            f.write("\n---\n\n")


_THEME_LIGHT = {
    "bg": "#f8f9fa", "sf": "#ffffff", "sf2": "#f1f3f5", "bd": "#dee2e6",
    "ac": "#5c6bc0", "acl": "#3949ab", "txt": "#212529", "mut": "#868e96",
    "grn": "#2e7d32", "cpbg": "#f1f3f5", "img_bg": "#e9ecef",
    "hero_bg": "linear-gradient(180deg,#e8eaf6 0%,#f8f9fa 100%)",
    "prompt_txt": "#495057",
}
_THEME_DARK = {
    "bg": "#0f0f14", "sf": "#1a1a24", "sf2": "#22222e", "bd": "#2d2d3d",
    "ac": "#7986cb", "acl": "#9fa8da", "txt": "#e8e8f0", "mut": "#8888a0",
    "grn": "#66bb6a", "cpbg": "#2d2d44", "img_bg": "#1a1a24",
    "hero_bg": "linear-gradient(180deg,#1a1a28 0%,#0f0f14 100%)",
    "prompt_txt": "#aab0b8",
}

_HTML_TEMPLATE = r'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{product_name} - AI 视频拆解</title>
<style>
:root{{
  --bg:{bg};--sf:{sf};--sf2:{sf2};--bd:{bd};
  --ac:{ac};--acl:{acl};--txt:{txt};--mut:{mut};
  --grn:{grn};--cpbg:{cpbg};
}}
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",
  "Hiragino Sans GB","Microsoft YaHei",sans-serif;
  background:var(--bg);color:var(--txt);line-height:1.7}}
.hero{{text-align:center;padding:80px 20px 40px;background:{hero_bg}}}
.hero h1{{font-size:2.5em;font-weight:800;color:var(--acl);margin-bottom:10px}}
.hero .sub{{color:var(--mut);font-size:1.05em}}
.wrap{{max-width:1200px;margin:0 auto;padding:0 32px}}
.sec-t{{font-size:1.4em;font-weight:700;margin:56px 0 24px;color:var(--acl)}}
.sum-card{{background:var(--sf);border:1px solid var(--bd);border-radius:16px;padding:36px;
  line-height:2;white-space:pre-wrap;font-size:.95em;box-shadow:0 1px 4px rgba(0,0,0,.06)}}
hr.dv{{border:none;border-top:1px solid var(--bd);margin:56px 0}}
.fr{{display:flex;align-items:center;background:var(--sf);border:1px solid var(--bd);
  border-radius:16px;overflow:hidden;margin-bottom:28px;box-shadow:0 1px 4px rgba(0,0,0,.06);transition:box-shadow .2s}}
.fr:hover{{box-shadow:0 4px 16px rgba(0,0,0,.15)}}
.fr-img{{flex:0 0 45%;position:relative;background:{img_bg};display:flex;align-items:center;justify-content:center}}
.fr-img img{{width:100%;display:block}}
.fr-img .ts{{position:absolute;top:12px;left:12px;background:rgba(92,107,192,.92);color:#fff;
  font-weight:700;font-size:.8em;padding:4px 14px;border-radius:16px;backdrop-filter:blur(8px)}}
.fr-img .tr{{position:absolute;top:12px;right:12px;background:rgba(0,0,0,.6);color:#fff;
  font-size:.75em;padding:3px 10px;border-radius:12px}}
.fr-txt{{flex:1;padding:28px;display:flex;flex-direction:column;gap:16px}}
.fr-lbl{{font-weight:700;color:var(--acl);font-size:.9em;margin-bottom:4px}}
.fr-desc{{color:var(--txt);line-height:1.85;font-size:.92em}}
.pw{{position:relative}}
.pb{{background:var(--sf2);border:1px solid var(--bd);border-radius:12px;padding:16px 80px 16px 16px;
  font-family:"SF Mono","Fira Code","Menlo",monospace;font-size:.82em;color:{prompt_txt};
  line-height:1.7;white-space:pre-wrap;word-break:break-word;max-height:280px;overflow-y:auto}}
.cb{{position:absolute;top:8px;right:8px;background:var(--cpbg);color:var(--acl);border:1px solid var(--bd);
  border-radius:8px;padding:6px 14px;font-size:.78em;font-weight:600;cursor:pointer;transition:all .2s;font-family:inherit}}
.cb:hover{{background:var(--ac);color:#fff;border-color:var(--ac)}}
.cb.ok{{background:var(--grn);color:#fff;border-color:var(--grn)}}
@media(max-width:768px){{.fr{{flex-direction:column}}.fr-img{{flex:none}}.wrap{{padding:0 16px}}.hero h1{{font-size:1.8em}}}}
.foot{{text-align:center;padding:48px 20px;color:var(--mut);font-size:.82em}}
</style>
</head>
<body>
<div class="hero">
  <h1>{product_name}</h1>
  <p class="sub">视频画面深度拆解 · 共 {frame_count} 帧</p>
</div>
<div class="wrap">
  <h2 class="sec-t">📝 全局视觉总结</h2>
  <div class="sum-card">{summary}</div>
  <hr class="dv">
  <h2 class="sec-t">🎞️ 逐帧图文拆解</h2>
  {frames_html}
</div>
<div class="foot">由 AI 视频画面拆解工具自动生成</div>
<script>
function cp(b){{var t=b.closest('.pw').querySelector('.pb').textContent;
navigator.clipboard.writeText(t).then(function(){{b.textContent='✓ 已复制';b.classList.add('ok');
setTimeout(function(){{b.textContent='📋 复制';b.classList.remove('ok')}},2000)}})}}
</script>
</body>
</html>'''


def _compute_avg_brightness(frames_dir: Path, frames: list[dict[str, Any]]) -> float:
    total, count = 0.0, 0
    sample = frames[:min(8, len(frames))]
    for fr in sample:
        img_file = fr.get("frame_image", "")
        if not img_file:
            continue
        img_path = frames_dir / img_file
        if not img_path.exists():
            continue
        img = cv2.imread(str(img_path))
        if img is None:
            continue
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        total += gray.mean()
        count += 1
    return total / count if count else 80


def _build_frame_html(fr: dict[str, Any], frames_dir: Path) -> str:
    ts = fr["timestamp"]
    desc = fr["description_zh"]
    prompt = fr["image_prompt_en"]
    img_file = fr.get("frame_image", "")
    transition = is_transition_frame(desc)

    parts = ['<div class="fr">']
    parts.append('<div class="fr-img">')
    if img_file:
        parts.append(f'<img src="frames/{_esc(img_file)}" alt="{_esc(ts)}">')
    parts.append(f'<span class="ts">⏱️ {_esc(ts)}</span>')
    if transition:
        parts.append('<span class="tr">过渡帧</span>')
    parts.append("</div>")

    parts.append('<div class="fr-txt">')
    parts.append('<div><div class="fr-lbl">👀 画面描述</div>')
    parts.append(f'<div class="fr-desc">{_esc(desc)}</div></div>')

    if prompt:
        parts.append('<div class="pw">')
        parts.append('<div class="fr-lbl">🪄 生图提示词</div>')
        parts.append(f'<div class="pb">{_esc(prompt)}</div>')
        parts.append('<button class="cb" onclick="cp(this)">📋 复制</button>')
        parts.append("</div>")

    parts.append("</div></div>")
    return "\n".join(parts)


def _save_html(
    html_path: Path,
    frames_dir: Path,
    original_title: str,
    product_name: str,
    summary: str,
    frames: list[dict[str, Any]],
) -> None:
    frames_html_parts = [_build_frame_html(fr, frames_dir) for fr in frames]
    brightness = _compute_avg_brightness(frames_dir, frames)
    theme = _THEME_DARK if brightness > 170 else _THEME_LIGHT
    html = _HTML_TEMPLATE.format(
        product_name=_esc(product_name),
        summary=_esc(summary),
        frame_count=len(frames),
        frames_html="\n".join(frames_html_parts),
        **theme,
    )
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)


# ── 归档：JSON 自动同步到 data/json_data/ ─────────────────────

def sync_json_to_data_dir(
    output_dir: Path,
    safe_name: str,
    target_json_dir: Path | None = None,
) -> Optional[Path]:
    """将分析完成的 JSON 复制到目标目录（默认 data/json_data/）。"""
    src = output_dir / (safe_name + "_视觉数据.json")
    if not src.exists():
        return None
    if target_json_dir is None:
        ensure_data_dirs()
    else:
        target_json_dir.mkdir(parents=True, exist_ok=True)
    dst_dir = target_json_dir or JSON_DATA_DIR
    dst = dst_dir / (safe_name + "_视觉数据.json")
    shutil.copy2(str(src), str(dst))
    return dst


# ── 主处理管线 ────────────────────────────────────────────────

def _analyze_frame_task(
    sec: int,
    frame_img: Any,
    api_key: str,
    vision_model: str,
    product_name: str,
    safe_name: str,
    frames_dir: Path,
    cancel_event: Optional[threading.Event] = None,
    image_mode: str = "vision",
) -> Optional[dict[str, Any]]:
    """并发 worker：编码帧 → 调用视觉 API → 保存图片 → 返回 frame_data。

    cancel_event 已置位时直接返回 None（跳过 VLM API 调用），让取消时尚未启动的
    worker 立刻收口，不再发起新的网络请求。
    """
    if cancel_event is not None and cancel_event.is_set():
        return None
    ts = format_timestamp(sec)
    img_b64 = frame_to_base64(frame_img)
    try:
        if image_mode == "ocr":
            from shared.ocr_service import extract_text_from_array
            ocr_text = extract_text_from_array(frame_img)
            result = {
                "content_zh": ocr_text,
                "description_zh": "[OCR提取文本] " + (ocr_text if ocr_text else "(无文字)"),
                "image_prompt_en": ""
            }
        else:
            result = analyze_video_frame(api_key, vision_model, img_b64, product_name)
    except Exception as e:
        result = {"content_zh": "", "description_zh": f"[分析失败: {e}]", "image_prompt_en": ""}
    img_filename = make_frame_filename(safe_name, ts)
    save_frame_to_disk(frame_img, frames_dir / img_filename)
    return {
        "timestamp": ts,
        "content_zh": result.get("content_zh", ""),
        "description_zh": result["description_zh"],
        "image_prompt_en": result["image_prompt_en"],
        "frame_image": img_filename,
    }


def _analyze_frames_batch_task(
    batch: list[tuple[int, Any]],
    api_key: str,
    vision_model: str,
    product_name: str,
    safe_name: str,
    frames_dir: Path,
    cancel_event: Optional[threading.Event] = None,
    image_mode: str = "vision",
) -> Optional[list[dict[str, Any]]]:
    """并发 worker（批模式）：编码 N 帧 → 调用批量 API → 保存图片 → 返回 frame_data 列表。

    batch: [(sec, frame_img), ...] 按时间顺序。
    cancel_event 已置位时直接返回 None（跳过 VLM API 调用）。

    关键：批量 API 失败或计数不符时，回退到逐帧 analyze_video_frame（保质量+不丢帧）。
    """
    if cancel_event is not None and cancel_event.is_set():
        return None

    # 编码每帧
    frames_b64: list[str] = []
    frame_infos: list[tuple[int, str, Any]] = []  # (sec, timestamp, frame_img)
    for sec, frame_img in batch:
        ts = format_timestamp(sec)
        img_b64 = frame_to_base64(frame_img)
        frames_b64.append(img_b64)
        frame_infos.append((sec, ts, frame_img))

    # 尝试批量调用
    batch_ok = False
    results: list[dict[str, str]] = []
    if image_mode == "ocr":
        # OCR 模式下直接跳过批量 VLM，走下面的逐帧 OCR
        batch_ok = False
    else:
        try:
            results = analyze_video_frames_batch(api_key, vision_model, frames_b64, product_name)
            if len(results) == len(batch):
                batch_ok = True
            else:
                logger.warning("批量帧分析计数不符(%d≠%d)，回退逐帧", len(results), len(batch))
        except Exception as e:
            logger.warning("批量帧分析失败(%s)，回退逐帧", e)

    # 回退：逐帧调用
    if not batch_ok:
        results = []
        for sec, frame_img in batch:
            if cancel_event is not None and cancel_event.is_set():
                return None
            ts = format_timestamp(sec)
            img_b64 = frame_to_base64(frame_img)
            try:
                if image_mode == "ocr":
                    from shared.ocr_service import extract_text_from_array
                    ocr_text = extract_text_from_array(frame_img)
                    result = {
                        "content_zh": ocr_text,
                        "description_zh": "[OCR提取文本] " + (ocr_text if ocr_text else "(无文字)"),
                        "image_prompt_en": ""
                    }
                else:
                    result = analyze_video_frame(api_key, vision_model, img_b64, product_name)
            except Exception as e:
                result = {"content_zh": "", "description_zh": f"[分析失败: {e}]", "image_prompt_en": ""}
            results.append(result)

    # 组装 frame_data 并保存图片
    frame_data_list: list[dict[str, Any]] = []
    for i, (sec, ts, frame_img) in enumerate(frame_infos):
        img_filename = make_frame_filename(safe_name, ts)
        save_frame_to_disk(frame_img, frames_dir / img_filename)
        frame_data_list.append({
            "timestamp": ts,
            "content_zh": results[i].get("content_zh", ""),
            "description_zh": results[i]["description_zh"],
            "image_prompt_en": results[i]["image_prompt_en"],
            "frame_image": img_filename,
        })

    return frame_data_list


@dataclass
class CaptureParams:
    """N7: 截帧子参数（来自 preflight.tasks.frame_prompts）。"""

    mode: str = "scene"  # "interval" | "scene"
    interval_sec: int = 5
    max_frames: int = 100
    frames_per_shot: int = 3  # 仅 scene 模式有效

    @classmethod
    def from_dict(cls, data: Any) -> "CaptureParams":
        """从前端 NotePreflightOverrides.frame_prompt 字段安全构造。

        前端字段：mode ("interval"|"ai_shot"), interval_sec, max_frames, frames_per_shot。
        ai_shot 映射为 scene 模式。
        兼容老字段名 capture_mode / scene_frames_per_shot 和 boolean 形状（true → 默认值）。
        """
        if not isinstance(data, dict):
            return cls()
        # 兼容前端字段名 mode / frames_per_shot（优先级更高）
        # 同时保留旧名 capture_mode / scene_frames_per_shot 作为 fallback
        raw_mode = str(data.get("mode") or data.get("capture_mode") or "scene").lower()
        if raw_mode in ("ai_shot",):
            raw_mode = "scene"
        if raw_mode not in ("interval", "scene"):
            raw_mode = "scene"
        mode = raw_mode
        try:
            interval = int(data.get("interval_sec") or 5)
        except (TypeError, ValueError):
            interval = 5
        try:
            max_f = int(data.get("max_frames") or 100)
        except (TypeError, ValueError):
            max_f = 100
        try:
            fps = int(data.get("frames_per_shot") or data.get("scene_frames_per_shot") or 3)
        except (TypeError, ValueError):
            fps = 3
        if fps not in (2, 3):
            fps = 3
        return cls(
            mode=mode,
            interval_sec=max(1, interval),
            max_frames=max(1, max_f),
            frames_per_shot=fps,
        )


def process_video(
    api_key: str,
    video_path: Path,
    video_idx: int,
    total_videos: int,
    state: AnalysisState,
    vision_model: str = VISION_MODEL_ANALYZER,
    text_model: str = TEXT_MODEL_ANALYZER,
    on_frame: Optional[Callable[[int, str], None]] = None,
    auto_sync_json: bool = True,
    target_json_dir: Path | None = None,
    capture_params: Optional["CaptureParams"] = None,
    concurrency: int | None = None,
    cancel_event: Optional[threading.Event] = None,
    frames_per_call: int | None = None,
    image_mode: str = "vision",
) -> Optional[Path]:
    """
    完整处理单个视频：抽帧分析 → 全局总结 → 三位一体保存（支持断点续传）。

    auto_sync_json: True 时将 JSON 同步到目标目录（默认 data/json_data/）。
    concurrency: VLM 多帧并发数；None 时回退到 config.API_CONCURRENCY。
    cancel_event: 协作取消信号；置位时停止提交新帧并放弃排队中的帧。
    frames_per_call: 多帧合并进一次 VLM 请求的帧数；None 时回退到 config.VLM_FRAMES_PER_CALL。
    返回分析报告目录路径，失败返回 None。
    """
    original_title = video_path.stem
    product_name = extract_product_name(original_title)
    safe_name = get_safe_name(video_path)

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        state.update(video_idx, status="failed", error=f"无法打开视频: {video_path.name}")
        return None
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_fc = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.release()
    duration = int(total_fc / fps)

    # N7: 用 capture_params 决定截帧方式；未传时 fallback 到原 interval 行为
    if capture_params is None:
        capture_params = CaptureParams(mode="interval", interval_sec=compute_frame_interval(duration), max_frames=10**6, frames_per_shot=3)
    interval = capture_params.interval_sec
    if capture_params.mode == "scene":
        # 估计值仅作进度显示参考，scene 模式的真实帧数要扫完才知道
        estimated = max(duration // 3, 1) * capture_params.frames_per_shot
    else:
        estimated = min(capture_params.max_frames, max(duration // interval, 1))

    output_dir = get_output_dir(video_path)
    output_dir.mkdir(parents=True, exist_ok=True)
    frames_dir = output_dir / "frames"
    frames_dir.mkdir(exist_ok=True)

    existing_frames = load_checkpoint(output_dir)
    analyzed_ts = {fr["timestamp"] for fr in existing_frames}

    state.update(video_idx, status="analyzing", total_frames=estimated)

    frames = list(existing_frames)
    frame_count = len(analyzed_ts)
    # 并发数：优先用调用方传入（来自 R23 性能档位），否则回退到 config 常量。
    worker_count = concurrency if (concurrency and concurrency > 0) else API_CONCURRENCY
    # 多帧合并数：优先用调用方传入，否则回退到 config 常量。
    batch_size = frames_per_call if (frames_per_call and frames_per_call > 0) else VLM_FRAMES_PER_CALL

    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        pending = {}

        if capture_params.mode == "scene":
            frame_iter = extract_frames_by_scenes(video_path, capture_params.frames_per_shot)
        else:
            frame_iter = extract_frames(
                video_path,
                interval_sec=capture_params.interval_sec,
                max_frames=capture_params.max_frames,
            )

        # 收集未分析的帧，按 batch_size 分组提交
        current_batch: list[tuple[int, Any]] = []
        for sec, frame_img in frame_iter:
            # 取消时停止提交新帧（已提交的在下方收集循环里放弃）。
            if cancel_event is not None and cancel_event.is_set():
                break
            ts = format_timestamp(sec)
            if ts in analyzed_ts:
                frame_count += 1
                state.update(video_idx, analyzed_frames=frame_count, current_timestamp=ts)
                continue
            current_batch.append((sec, frame_img))
            # 达到 batch_size 时提交一个批任务
            if len(current_batch) >= batch_size:
                future = executor.submit(
                    _analyze_frames_batch_task, current_batch,
                    api_key, vision_model, product_name, safe_name, frames_dir,
                    cancel_event, image_mode,
                )
                pending[future] = [sec for sec, _ in current_batch]
                current_batch = []

        # 提交剩余的帧（不足 batch_size 也作为一个批）
        if current_batch and (cancel_event is None or not cancel_event.is_set()):
            future = executor.submit(
                _analyze_frames_batch_task, current_batch,
                api_key, vision_model, product_name, safe_name, frames_dir,
                cancel_event, image_mode,
            )
            pending[future] = [sec for sec, _ in current_batch]

        for future in as_completed(pending):
            # 取消：撤销仍在排队中的批；已在途的 ≤worker_count 个 HTTP 请求让其自然结束。
            if cancel_event is not None and cancel_event.is_set():
                for f in pending:
                    f.cancel()
                break
            try:
                batch_result = future.result()
            except CancelledError:
                continue
            except Exception as e:
                # 整批失败，为每帧生成失败记录
                batch_result = []
                for sec in pending[future]:
                    batch_result.append({
                        "timestamp": format_timestamp(sec),
                        "description_zh": f"[分析失败: {e}]",
                        "image_prompt_en": "",
                        "frame_image": "",
                    })
            if batch_result is None:  # worker 在取消信号下跳过了该批
                continue
            # 逐帧展开批结果
            for frame_data in batch_result:
                frames.append(frame_data)
                append_checkpoint(output_dir, frame_data)
                frame_count += 1
                state.update(video_idx, analyzed_frames=frame_count, current_timestamp=frame_data["timestamp"])
                state.push_live_frame(video_path.name, frame_data, frames_dir)
                if on_frame:
                    on_frame(frame_count, frame_data["timestamp"])

    # 取消：跳过全局总结（省一次文本 API）与落盘，让后台线程尽快退出。
    if cancel_event is not None and cancel_event.is_set():
        state.update(video_idx, status="failed", error="已取消")
        return None

    if not frames:
        state.update(video_idx, status="failed", error="未提取到任何帧")
        return None

    frames.sort(key=lambda x: x["timestamp"])

    state.update(video_idx, status="summarizing")

    desc_lines = [f"[{fr['timestamp']}] {fr['description_zh']}" for fr in frames]
    desc_text = "\n".join(desc_lines)

    try:
        summary = generate_video_summary(api_key, text_model, product_name, desc_text)
    except Exception as e:
        summary = f"[全局总结生成失败: {e}]"

    save_results(output_dir, safe_name, original_title, product_name, summary, frames)
    clear_checkpoint(output_dir)

    if auto_sync_json:
        sync_json_to_data_dir(output_dir, safe_name, target_json_dir=target_json_dir)

    state.update(video_idx, status="done", analyzed_frames=frame_count)
    return output_dir


def _reuse_cached_analysis(
    video_path: Path,
    target_json_dir: Path | None = None,
) -> bool:
    """复用已缓存的 VLM 分析结果：读共享 json 的描述，按 timestamp 从当前视频重新截帧到当前 workspace。

    不调 VLM（保留省钱语义），仅重新截帧 + 写 _图文分镜.md + _视觉数据.json。
    返回 True 表示复用成功。
    """
    try:
        return _reuse_cached_analysis_inner(video_path, target_json_dir)
    except Exception:
        logger.warning("复用缓存分析失败: %s", video_path.name, exc_info=True)
        return False


def _reuse_cached_analysis_inner(
    video_path: Path,
    target_json_dir: Path | None = None,
) -> bool:
    """_reuse_cached_analysis 的实际逻辑，异常由外层捕获。"""
    if cv2 is None:
        return False

    sn = get_safe_name(video_path)
    json_dir = target_json_dir or JSON_DATA_DIR
    jp = json_dir / (sn + "_视觉数据.json")
    if not jp.exists() or not _check_json_complete(jp):
        return False

    try:
        with open(jp, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return False

    cached_frames = data.get("frames") or []
    if not cached_frames:
        return False

    output_dir = get_output_dir(video_path)
    output_dir.mkdir(parents=True, exist_ok=True)
    frames_dir = output_dir / "frames"
    frames_dir.mkdir(exist_ok=True)

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return False
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

    frames: list[dict[str, Any]] = []
    for fr in cached_frames:
        ts_str = str(fr.get("timestamp") or "")
        if not ts_str:
            continue
        parts = ts_str.split(":")
        try:
            seconds = int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        except (IndexError, ValueError):
            continue

        cap.set(cv2.CAP_PROP_POS_FRAMES, int(seconds * fps))
        ret, frame = cap.read()
        if not ret or frame is None:
            continue

        fname = make_frame_filename(sn, ts_str)
        img_path = str(frames_dir / fname)
        cv2.imwrite(img_path, frame)

        frames.append({
            "timestamp": ts_str,
            "content_zh": fr.get("content_zh", ""),
            "description_zh": fr.get("description_zh", ""),
            "image_prompt_en": fr.get("image_prompt_en", ""),
            "frame_image": fname,      # 仅文件名，供 _save_html/_compute_avg_brightness
            "image_path": img_path,    # 完整路径，供 _postprocess_frames/_collect_frames
        })

    cap.release()

    if not frames:
        return False

    save_results(
        output_dir,
        sn,
        str(data.get("video_title") or video_path.stem),
        str(data.get("product_name") or ""),
        str(data.get("global_visual_summary") or ""),
        frames,
    )
    return True


def run_batch_analysis(
    api_key: str,
    video_paths: list[Path],
    vision_model: str = VISION_MODEL_ANALYZER,
    text_model: str = TEXT_MODEL_ANALYZER,
    progress_cb: ProgressCallback = None,
    auto_sync_json: bool = True,
    target_json_dir: Path | None = None,
    capture_params: Optional["CaptureParams"] = None,
    concurrency: int | None = None,
    cancel_event: Optional[threading.Event] = None,
    frames_per_call: int | None = None,
    image_mode: str = "vision",
) -> AnalysisState:
    """
    批量分析视频（在后台线程中运行）。
    返回 AnalysisState 供调用方轮询进度。

    concurrency: VLM 多帧并发数；None 时回退到 config.API_CONCURRENCY。
    cancel_event: 协作取消信号；置位时停止处理后续视频并让在跑的截帧 worker 收口。
    frames_per_call: 多帧合并进一次 VLM 请求的帧数；None 时回退到 config.VLM_FRAMES_PER_CALL。
    """
    assign_safe_names(video_paths)
    state = AnalysisState(
        videos=[VideoProgress(video_name=vp.name) for vp in video_paths]
    )

    def _run() -> None:
        total = len(video_paths)
        for idx, vp in enumerate(video_paths):
            if cancel_event is not None and cancel_event.is_set():
                break
            if progress_cb:
                progress_cb(idx / max(total, 1), f"处理第 {idx + 1}/{total} 个视频：{vp.name}")
            if is_already_processed(vp, target_json_dir=target_json_dir):
                # A1: 复用模式 — 读缓存 json 描述，重新截帧到当前 workspace（不调 VLM）
                if _reuse_cached_analysis(vp, target_json_dir=target_json_dir):
                    state.update(idx, status="done", percent=100.0)
                else:
                    state.update(idx, status="skipped", percent=100.0)
                continue
            try:
                process_video(
                    api_key, vp, idx, total, state,
                    vision_model=vision_model,
                    text_model=text_model,
                    auto_sync_json=auto_sync_json,
                    target_json_dir=target_json_dir,
                    capture_params=capture_params,
                    concurrency=concurrency,
                    cancel_event=cancel_event,
                    frames_per_call=frames_per_call,
                    image_mode=image_mode,
                )
            except Exception as e:
                state.update(idx, status="failed", error=str(e))
        state.finished = True
        if progress_cb:
            progress_cb(1.0, "全部视频分析完成")

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()
    return state
