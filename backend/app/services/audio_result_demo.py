from __future__ import annotations

"""音频结果页 demo fixture（Phase 2B）。

当 WorkspaceItem.results 里缺少 transcript 真数据时，由
`GET /workspaces/{ws}/items/{id}/audio_result` 退化到本模块给出的固定示例，
让前端音频播放器 + transcript 列表可跑通。

数据复用 video_result_demo 的 transcript 子集，去掉 frames / 三轨相关字段。
"""

from typing import Any, Dict, List


_TRANSCRIPT: List[Dict[str, Any]] = [
    {"t_sec": 0,   "t_str": "00:00", "text": "大家好，今天我们来看大疆 Pocket 4。"},
    {"t_sec": 12,  "t_str": "00:12", "text": "说实话，我是非常困惑的——这代到底升级了什么？"},
    {"t_sec": 42,  "t_str": "00:42", "text": "先把四代摆一起，看看外观区别。"},
    {"t_sec": 78,  "t_str": "01:18", "text": "三代封神，那四代呢？我们慢慢拆。"},
    {"t_sec": 125, "t_str": "02:05", "text": "新镜头模组用了碳纤维包覆，握感差别明显。"},
    {"t_sec": 192, "t_str": "03:12", "text": "夜景实测，巷子里的霓虹是个硬场景。"},
    {"t_sec": 238, "t_str": "03:58", "text": "ProRes RAW HQ 终于下放，调色空间大不一样。"},
    {"t_sec": 286, "t_str": "04:46", "text": "动态范围分屏对比，三代差距一目了然。"},
    {"t_sec": 354, "t_str": "05:54", "text": "最后到海边走一段，看看真实出片效果。"},
]


DEMO_TOTAL_SEC = 402  # 6:42


def build_demo_audio_result(item_id: str, item_name: str = "") -> Dict[str, Any]:
    """构造 Phase 2B 音频结果页 fixture。

    返回字段对齐 handoff 笔记建议的数据形状：
    audio / transcript / summary / tracks_meta。
    """
    return {
        "source": "demo_fixture",
        "audio": {
            "item_id": item_id,
            "title": item_name if item_name else "未命名音频",
            "url": "",  # 真实管线接入后填本地 mp3/m4a 路径 / 远端 URL
            "duration_sec": DEMO_TOTAL_SEC,
            "duration_str": "06:42",
        },
        "transcript": [dict(t) for t in _TRANSCRIPT],
        "summary": "本期音频围绕大疆 Pocket 4 展开，从外观对比、碳纤维握感、霓虹夜景实测、"
                   "ProRes RAW HQ 调色空间到海滩日落出片，逐步拆解四代升级点。",
        "tracks_meta": {
            "total_sec": DEMO_TOTAL_SEC,
            "transcript_count": len(_TRANSCRIPT),
        },
    }
