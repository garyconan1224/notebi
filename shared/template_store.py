"""
模板持久化（本地 JSON，不入库）。

- 视频内置 6 类硬编码在 pipeline_tasks._VIDEO_TEMPLATE_PROMPTS
- 文字内置 5 类硬编码在 routes/templates._TEXT_BUILTIN_PROMPTS
- 用户自定义模板写 .local/video_templates.json
- category 字段区分 'video' | 'text'；老模板缺 category 默认 'video'（向后兼容）
"""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT_DIR: Path = Path(__file__).resolve().parent.parent
STORE_DIR: Path = ROOT_DIR / ".local"
STORE_PATH: Path = STORE_DIR / "video_templates.json"


@dataclass
class VideoTemplate:
    template_id: str = ""
    name: str = ""
    prompt: str = ""
    is_builtin: bool = False
    category: str = "video"  # 'video' | 'text'
    created_at: str = ""
    updated_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "VideoTemplate":
        return cls(
            template_id=str(data.get("template_id") or ""),
            name=str(data.get("name") or ""),
            prompt=str(data.get("prompt") or ""),
            is_builtin=bool(data.get("is_builtin", False)),
            category=str(data.get("category") or "video"),
            created_at=str(data.get("created_at") or ""),
            updated_at=str(data.get("updated_at") or ""),
        )


def _ensure_store_dir() -> None:
    STORE_DIR.mkdir(parents=True, exist_ok=True)


def load_templates() -> list[VideoTemplate]:
    """从 JSON 文件加载用户自定义模板。"""
    _ensure_store_dir()
    if not STORE_PATH.is_file():
        return []
    try:
        raw = json.loads(STORE_PATH.read_text(encoding="utf-8"))
        if not isinstance(raw, list):
            return []
        return [VideoTemplate.from_dict(t) for t in raw if isinstance(t, dict)]
    except (json.JSONDecodeError, OSError):
        return []


def load_templates_by_category(category: str) -> list[VideoTemplate]:
    """按 category 过滤用户自定义模板。"""
    return [t for t in load_templates() if t.category == category]


def save_templates(templates: list[VideoTemplate]) -> None:
    """全量覆写模板文件。"""
    _ensure_store_dir()
    STORE_PATH.write_text(
        json.dumps([t.to_dict() for t in templates], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def create_template(name: str, prompt: str, category: str = "video") -> VideoTemplate:
    now = datetime.now(timezone.utc).isoformat()
    template = VideoTemplate(
        template_id=uuid.uuid4().hex[:12],
        name=name,
        prompt=prompt,
        is_builtin=False,
        category=category,
        created_at=now,
        updated_at=now,
    )
    templates = load_templates()
    templates.append(template)
    save_templates(templates)
    return template


def update_template(template_id: str, name: str, prompt: str) -> VideoTemplate | None:
    templates = load_templates()
    for t in templates:
        if t.template_id == template_id:
            if t.is_builtin:
                return None  # builtin 不可编辑（route 层也有 403，防御）
            t.name = name
            t.prompt = prompt
            t.updated_at = datetime.now(timezone.utc).isoformat()
            save_templates(templates)
            return t
    return None


def delete_template(template_id: str) -> bool:
    templates = load_templates()
    for i, t in enumerate(templates):
        if t.template_id == template_id:
            if t.is_builtin:
                return False  # builtin 不可删
            templates.pop(i)
            save_templates(templates)
            return True
    return False


def duplicate_template(template_id: str, source_prompt: str) -> VideoTemplate | None:
    """以指定 prompt 为基准创建副本（用于复制内置模板）。

    对于非内置模板，source 必须在自定义列表中存在；找不到返回 None。
    """
    templates = load_templates()
    source = None
    for t in templates:
        if t.template_id == template_id:
            source = t
            break

    if source is None:
        return None  # 自定义模板不存在

    name = source.name if source else "副本"
    now = datetime.now(timezone.utc).isoformat()
    new_t = VideoTemplate(
        template_id=uuid.uuid4().hex[:12],
        name=f"{name}（副本）",
        prompt=source_prompt,
        is_builtin=False,
        category=source.category,
        created_at=now,
        updated_at=now,
    )
    templates.append(new_t)
    save_templates(templates)
    return new_t
