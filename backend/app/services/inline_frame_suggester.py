"""学习模式视频：为每段转录推荐最接近的关键帧。

纯时间戳匹配，不调 LLM。
"""

from __future__ import annotations

from typing import Any, Dict, List


def suggest_inline_frames(
    frames: List[Dict[str, Any]],
    transcript_segments: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """为每段转录推荐最接近的关键帧。

    Args:
        frames: 关键帧列表，每项需有 timestamp (秒, float/str) 和 image_path。
        transcript_segments: 转录段落列表，每项需有 start (秒) 和 text。

    Returns:
        推荐列表，每项 { segment_idx, frame_timestamp, frame_path, scene_description }。
        相邻段落推荐同一帧时只保留给后者（去重）。
    """
    if not frames or not transcript_segments:
        return []

    # 预处理帧时间戳
    parsed_frames = []
    for f in frames:
        ts = f.get("timestamp", 0)
        if isinstance(ts, str):
            ts = _parse_ts(ts)
        parsed_frames.append({
            "timestamp": float(ts),
            "image_path": str(f.get("image_path") or f.get("frame_image_path") or ""),
            "scene_description": str(f.get("scene_description") or f.get("description") or ""),
        })

    # 按时间戳排序
    parsed_frames.sort(key=lambda f: f["timestamp"])

    suggestions: List[Dict[str, Any]] = []
    prev_frame_ts: float | None = None

    for idx, seg in enumerate(transcript_segments):
        seg_start = float(seg.get("start", 0))
        best = _find_nearest_frame(parsed_frames, seg_start)

        if best is None:
            continue

        # 去重：相邻段落推荐同一帧时只保留给后者
        if best["timestamp"] == prev_frame_ts:
            # 替换前一条（当前段更"靠近"该帧的末尾）
            if suggestions:
                suggestions[-1] = {
                    "segment_idx": idx,
                    "frame_timestamp": best["timestamp"],
                    "frame_path": best["image_path"],
                    "scene_description": best["scene_description"],
                }
        else:
            suggestions.append({
                "segment_idx": idx,
                "frame_timestamp": best["timestamp"],
                "frame_path": best["image_path"],
                "scene_description": best["scene_description"],
            })

        prev_frame_ts = best["timestamp"]

    return suggestions


def _find_nearest_frame(
    frames: List[Dict[str, Any]], target_sec: float
) -> Dict[str, Any] | None:
    """二分查找时间戳最接近 target_sec 的帧。"""
    if not frames:
        return None

    lo, hi = 0, len(frames) - 1

    # 边界
    if target_sec <= frames[0]["timestamp"]:
        return frames[0]
    if target_sec >= frames[hi]["timestamp"]:
        return frames[hi]

    # 二分
    while lo < hi:
        mid = (lo + hi) // 2
        if frames[mid]["timestamp"] < target_sec:
            lo = mid + 1
        else:
            hi = mid

    # lo 是第一个 >= target_sec 的位置
    before = frames[lo - 1]
    after = frames[lo]
    if abs(target_sec - before["timestamp"]) <= abs(after["timestamp"] - target_sec):
        return before
    return after


def _parse_ts(ts: str) -> float:
    """把 'MM:SS' 或 'HH:MM:SS' 转成秒数。"""
    parts = ts.strip().split(":")
    try:
        if len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    except ValueError:
        pass
    return 0.0
