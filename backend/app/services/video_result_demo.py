from __future__ import annotations

"""视频结果页 demo fixture（Phase 1G）。

当 WorkspaceItem.results 里缺少 frames / transcript 真数据时，由
`GET /workspaces/{ws}/items/{id}/result` 退化到本模块给出的固定示例，
让前端三轨时间轴能跑通。

数据原型取自旧 handoff 原型中的提示词、分镜帧和字幕数据，
对齐 v1.1 §5.1 JSON schema。
"""

from typing import Any, Dict, List


_FRAMES: List[Dict[str, Any]] = [
    {
        "idx": 0,
        "ts": "00:00",
        "sec": 0,
        "shot_type": "product",
        "title": "Pocket 4 主体登场",
        "subtitle": "三脚架 + 黑色背景 + 描边光",
        "description": "DJI Pocket 4 on tripod, black backdrop, rim light",
        "tags": {
            "style": ["product", "studio light"],
            "lighting": ["rim light"],
            "composition": ["close-up"],
            "color": ["dark"],
            "lens": ["macro"],
            "subject": ["camera"],
            "scene": ["studio"],
        },
    },
    {
        "idx": 1,
        "ts": "00:42",
        "sec": 42,
        "shot_type": "comparison",
        "title": "四代横向对比",
        "subtitle": "白底平铺 + 编辑风",
        "description": "4 action cameras side by side on white surface",
        "tags": {
            "style": ["editorial", "minimal"],
            "lighting": ["soft diffused"],
            "composition": ["flat lay"],
            "color": ["white"],
            "lens": ["wide"],
            "subject": ["camera"],
            "scene": ["studio"],
        },
    },
    {
        "idx": 2,
        "ts": "01:18",
        "sec": 78,
        "shot_type": "portrait",
        "title": "主播访谈半侧脸",
        "subtitle": "霓虹 H 散景 + 35mm",
        "description": "asian male presenter semi-profile, neon H bokeh background",
        "tags": {
            "style": ["portrait", "interview"],
            "lighting": ["neon"],
            "composition": ["medium close-up"],
            "color": ["purple"],
            "lens": ["35mm"],
            "subject": ["man"],
            "scene": ["studio"],
        },
    },
    {
        "idx": 3,
        "ts": "02:05",
        "sec": 125,
        "shot_type": "macro",
        "title": "镜头模组特写",
        "subtitle": "碳纤维纹理 + 硬侧光",
        "description": "camera lens module macro detail, carbon fiber texture",
        "tags": {
            "style": ["macro", "product"],
            "lighting": ["hard side light"],
            "composition": ["extreme close-up"],
            "color": ["dark"],
            "lens": ["macro"],
            "subject": ["lens"],
            "scene": ["studio"],
        },
    },
    {
        "idx": 4,
        "ts": "03:12",
        "sec": 192,
        "shot_type": "atmosphere",
        "title": "霓虹巷子氛围",
        "subtitle": "紫红色 + 体积雾 + 湿地",
        "description": "neon letter H sign, purple magenta glow, foggy alley",
        "tags": {
            "style": ["cyberpunk", "cinematic"],
            "lighting": ["neon", "volumetric"],
            "composition": ["wide"],
            "color": ["purple", "magenta"],
            "lens": ["anamorphic"],
            "subject": ["sign"],
            "scene": ["street", "night"],
        },
    },
    {
        "idx": 5,
        "ts": "03:58",
        "sec": 238,
        "shot_type": "ui",
        "title": "ProRes RAW HQ 菜单",
        "subtitle": "屏幕 UI 宏观细节",
        "description": "camera LCD showing ProRes RAW HQ menu, dark interface",
        "tags": {
            "style": ["ui", "macro"],
            "lighting": ["screen glow"],
            "composition": ["close-up"],
            "color": ["dark"],
            "lens": ["macro"],
            "subject": ["screen"],
            "scene": ["studio"],
        },
    },
    {
        "idx": 6,
        "ts": "04:46",
        "sec": 286,
        "shot_type": "comparison",
        "title": "动态范围分屏",
        "subtitle": "Pocket 3 vs Pocket 4",
        "description": "split screen two cameras same scene side by side",
        "tags": {
            "style": ["comparison", "cinematic"],
            "lighting": ["natural"],
            "composition": ["split-screen"],
            "color": ["balanced"],
            "lens": ["normal"],
            "subject": ["scene"],
            "scene": ["outdoor"],
        },
    },
    {
        "idx": 7,
        "ts": "05:54",
        "sec": 354,
        "shot_type": "emotional",
        "title": "海滩日落剪影",
        "subtitle": "金时光 + Portra 400",
        "description": "silhouette woman walking on beach at golden hour",
        "tags": {
            "style": ["emotional", "cinematic"],
            "lighting": ["backlight", "golden hour"],
            "composition": ["wide"],
            "color": ["warm", "amber"],
            "lens": ["telephoto"],
            "subject": ["woman"],
            "scene": ["beach", "sunset"],
        },
    },
]


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


def build_demo_video_result(item_id: str, item_name: str = "") -> Dict[str, Any]:
    """构造 Phase 1G 视频结果页 fixture。

    返回字段对齐 v1.1 §5.1 JSON schema：video / frames / transcript / tracks_meta。
    """
    return {
        "source": "demo_fixture",
        "video": {
            "item_id": item_id,
            "title": item_name or "大疆 Pocket 4 首发体验",
            "url": "",  # 真实管线接入后填本地 mp4 路径 / 远端 URL
            "duration_sec": DEMO_TOTAL_SEC,
            "duration_str": "06:42",
        },
        "frames": [dict(f) for f in _FRAMES],
        "transcript": [dict(t) for t in _TRANSCRIPT],
        "tracks_meta": {
            "total_sec": DEMO_TOTAL_SEC,
            "frame_count": len(_FRAMES),
            "transcript_count": len(_TRANSCRIPT),
        },
    }
