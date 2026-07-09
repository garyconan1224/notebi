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
        "prompt_mj": "DJI Pocket 4 on tripod, black backdrop, rim light, carbon fiber texture, studio photography, cinematic --ar 16:9 --style raw",
        "prompt_sd": {
            "positive": "DJI Pocket 4 on tripod, black background, rim lighting, ultra sharp, product photography, 8k",
            "negative": "blurry, low quality, distorted",
        },
        "prompt_video": "camera slowly orbits subject, rim light reveals silhouette, studio black",
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
        "prompt_mj": "4 action cameras side by side on white surface, product comparison, backlit, editorial --ar 16:9",
        "prompt_sd": {
            "positive": "4 action cameras flat lay, clean background, soft diffused light, editorial photography",
            "negative": "cluttered, harsh shadow",
        },
        "prompt_video": "static top-down shot of 4 cameras on white",
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
        "prompt_mj": "asian male presenter semi-profile, neon H bokeh background, studio interview, 35mm f/1.8 --ar 16:9 --style raw",
        "prompt_sd": {
            "positive": "man talking to camera, purple neon background bokeh, cinematic portrait, shallow depth of field",
            "negative": "flat lighting, low contrast",
        },
        "prompt_video": "slow push-in on presenter, neon bokeh shimmer behind",
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
        "prompt_mj": "camera lens module macro detail, carbon fiber texture, dramatic hard side light, product --ar 16:9",
        "prompt_sd": {
            "positive": "camera module close-up, carbon fiber pattern, hard side lighting, macro lens, pin-sharp detail",
            "negative": "soft focus, dust",
        },
        "prompt_video": "macro reveal of lens module, hard side light sweep",
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
        "prompt_mj": "neon letter H sign, purple magenta glow, bokeh, cyberpunk alley, volumetric fog, wet asphalt, blade runner mood --ar 21:9 --style raw --s 250",
        "prompt_sd": {
            "positive": "neon H sign glowing purple, foggy alley, bokeh, cyberpunk atmosphere, anamorphic lens flare",
            "negative": "daylight, clean street",
        },
        "prompt_video": "camera glides through neon alley, volumetric fog swirls",
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
        "prompt_mj": "camera LCD screen showing ProRes RAW HQ recording menu, dark interface, macro product detail --ar 16:9",
        "prompt_sd": {
            "positive": "camera LCD ProRes RAW HQ menu, dark background, macro lens, sharp edges, tech detail",
            "negative": "screen glare, motion blur",
        },
        "prompt_video": "macro slide across LCD interface, menu items in focus",
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
        "prompt_mj": "split screen two cameras same scene side by side, left vs right dynamic range comparison, cinematic --ar 16:9",
        "prompt_sd": {
            "positive": "side by side video comparison, two cameras same scene, dynamic range test, exposure difference",
            "negative": "watermark, blur",
        },
        "prompt_video": "static split-screen, same scene played twice",
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
        "prompt_mj": "silhouette woman walking on beach at golden hour, backlit, shallow DOF, hasselblad film grain, warm tones --ar 16:9",
        "prompt_sd": {
            "positive": "woman at beach sunset, silhouette, golden hour, bokeh, warm amber tones, Kodak Portra 400, emotional",
            "negative": "harsh shadows, oversaturated",
        },
        "prompt_video": "tracking shot following silhouette along shoreline, golden backlight",
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
