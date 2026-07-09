"""提示词格式模板的预置（种子）数据。

这是 Phase 1G 增强版引入的「显示层模板」：
- 图片类 5 条：MJ / Nano Banana / GPT Image / 即梦 / JSON
- 视频类 7 条：可灵 3.0 / 即梦 2.0 / Veo 3.1 / Happy Horse 1.0 / 万相 2.2 / Runway / JSON

模板内可用占位符（前端 renderTemplate 实现）：
    {ts}            帧时间戳 "MM:SS"
    {title}         帧标题
    {subtitle}      帧副标题
    {description}   英文描述
    {tags}          所有标签平铺逗号串
    {tags.style}    分类标签（style / lighting / composition / color / lens / subject / scene）
    {prompt_mj}     原始 MJ 字段（保留访问）
    {prompt_video}  原始视频运镜字段

JSON 模板的 template 字段为空串，由前端 buildPromptText 走 JSON dump 分支。
用户可在设置页修改任意条目，或恢复默认。
"""

from __future__ import annotations

from typing import TypedDict


class PromptFormatSeed(TypedDict):
    id: str
    name: str
    category: str  # "image" | "video"
    template: str
    description: str
    is_default: bool


IMAGE_DEFAULTS: list[PromptFormatSeed] = [
    {
        "id": "mj",
        "name": "Midjourney",
        "category": "image",
        "template": "{description}, {tags.style}, {tags.lighting}, {tags.composition}, --ar 16:9 --style raw",
        "description": "Midjourney v6+ 风格，逗号分隔标签 + 命令参数",
        "is_default": True,
    },
    {
        "id": "nano_banana",
        "name": "Gemini Nano Banana",
        "category": "image",
        "template": (
            "Create an image: {description}. Visual style: {tags.style}. "
            "Lighting: {tags.lighting}. Composition: {tags.composition}. "
            "Color palette: {tags.color}."
        ),
        "description": "Gemini Nano Banana 偏自然语言指令",
        "is_default": True,
    },
    {
        "id": "gpt_image",
        "name": "OpenAI GPT Image",
        "category": "image",
        "template": (
            "A {tags.composition} photograph of {description}. "
            "Shot with {tags.lens}, {tags.lighting} lighting, {tags.style} aesthetic. "
            "{tags.color} tones throughout."
        ),
        "description": "GPT Image / DALL·E 偏完整英文句",
        "is_default": True,
    },
    {
        "id": "jimeng",
        "name": "即梦 (Jimeng)",
        "category": "image",
        "template": "{description}，{tags.style}，{tags.lighting}，{tags.color}，构图：{tags.composition}",
        "description": "即梦中文逗号分隔",
        "is_default": True,
    },
    {
        "id": "json",
        "name": "JSON 结构化",
        "category": "image",
        "template": "",
        "description": "结构化 dump，可直接喂给二次脚本",
        "is_default": True,
    },
]

VIDEO_DEFAULTS: list[PromptFormatSeed] = [
    {
        "id": "kling_3",
        "name": "可灵 3.0",
        "category": "video",
        "template": (
            "镜头：{tags.composition} 拍摄 {description}。"
            "光线：{tags.lighting}。运动：{prompt_video}。"
            "风格：{tags.style}。时长 5s，16:9。"
        ),
        "description": "可灵 3.0 中文运镜描述",
        "is_default": True,
    },
    {
        "id": "jimeng_2",
        "name": "即梦 2.0",
        "category": "video",
        "template": "{description}，{prompt_video}，{tags.style}，{tags.lighting}，竖版 9:16，时长 5s",
        "description": "即梦视频 2.0",
        "is_default": True,
    },
    {
        "id": "veo_3_1",
        "name": "Veo 3.1",
        "category": "video",
        "template": (
            "A {tags.composition} cinematic shot. {description}. "
            "Camera: {prompt_video}. Lighting: {tags.lighting}. "
            "Mood: {tags.style}. 16:9, 8 seconds."
        ),
        "description": "Google Veo 3.1 英文电影感描述",
        "is_default": True,
    },
    {
        "id": "happy_horse_1",
        "name": "Happy Horse 1.0",
        "category": "video",
        "template": (
            "Scene: {description}. Motion: {prompt_video}. "
            "Aesthetic: {tags.style}, {tags.color}. Shot type: {tags.composition}."
        ),
        "description": "Happy Horse 1.0",
        "is_default": True,
    },
    {
        "id": "wan_2_2",
        "name": "万相 2.2 (Wan 2.2)",
        "category": "video",
        "template": "主体：{description}\n运镜：{prompt_video}\n光照：{tags.lighting}\n风格：{tags.style}\n时长：5s",
        "description": "万相 2.2 中文分行结构",
        "is_default": True,
    },
    {
        "id": "runway",
        "name": "Runway",
        "category": "video",
        "template": "{description}. {prompt_video}. Style: {tags.style}, {tags.lighting}, {tags.color}. Cinematic, 16:9.",
        "description": "Runway Gen-3+",
        "is_default": True,
    },
    {
        "id": "json_video",
        "name": "JSON 结构化",
        "category": "video",
        "template": "",
        "description": "结构化 dump",
        "is_default": True,
    },
]


DEFAULT_ACTIVE_IMAGE_IDS: tuple[str, ...] = ("mj", "nano_banana", "gpt_image")
DEFAULT_ACTIVE_VIDEO_IDS: tuple[str, ...] = ("kling_3", "jimeng_2", "veo_3_1")


def all_seed_formats() -> list[PromptFormatSeed]:
    """图片 + 视频两类种子的合并列表。"""
    return [*IMAGE_DEFAULTS, *VIDEO_DEFAULTS]
