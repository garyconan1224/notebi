"""Q6 / D6：外观设置（主题/模式/字体三槽位）+ 字体上传。

持久化契约：写入 → GET/readback → 从回读值更新 UI（spec §7）。
字体上传安全边界：仅 WOFF2/WOFF/TTF/OTF（扩展名 + 文件签名），
≤20MB，存 DATA_DIR/fonts/<id>/，以生成 id 提供；被占用字体不可删。
"""

from __future__ import annotations

import re
import uuid
from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from shared.config import DATA_DIR
from shared.appearance_store import (
    FONT_SLOTS,
    load_settings,
    save_settings,
    update_settings,
)

router = APIRouter(prefix="/settings", tags=["settings"])

FONTS_ROOT = DATA_DIR / "fonts"

MAX_FONT_BYTES = 20 * 1024 * 1024

# 扩展名 → 允许的文件签名（魔数）
_FONT_SIGNATURES: Dict[str, tuple[bytes, ...]] = {
    ".woff2": (b"wOF2",),
    ".woff": (b"wOFF",),
    ".ttf": (b"\x00\x01\x00\x00", b"true", b"typ1"),
    ".otf": (b"OTTO",),
}


class ObsidianSettings(BaseModel):
    vault_path: Optional[str] = Field(default=None, max_length=2000)
    subdir: Optional[str] = Field(default=None, max_length=500)
    direct_write: Optional[bool] = None


class AppearancePatch(BaseModel):
    theme: Optional[Literal["paper", "graphite", "sage", "midnight"]] = None
    mode: Optional[Literal["light", "dark", "system"]] = None
    fonts: Optional[Dict[str, Optional[str]]] = Field(
        default=None,
        description="三槽位字体 family：ui / cap / sum；null 表示回退默认链",
    )
    obsidian: Optional[ObsidianSettings] = Field(
        default=None,
        description="Q3/D3：Obsidian 直写目的地配置（非秘密；token 不保存）",
    )


@router.get("")
def get_settings() -> Dict[str, Any]:
    return load_settings()


@router.patch("")
def patch_settings(body: AppearancePatch) -> Dict[str, Any]:
    patch: Dict[str, Any] = {}
    if body.theme is not None:
        patch["theme"] = body.theme
    if body.mode is not None:
        patch["mode"] = body.mode
    if body.fonts is not None:
        unknown = set(body.fonts.keys()) - set(FONT_SLOTS)
        if unknown:
            raise HTTPException(
                status_code=422,
                detail=f"未知字体槽位: {sorted(unknown)}（仅支持 {list(FONT_SLOTS)}）",
            )
        patch["fonts"] = body.fonts
    if body.obsidian is not None:
        patch["obsidian"] = body.obsidian.model_dump(exclude_none=True)
    return update_settings(patch)


@router.post("/fonts", status_code=201)
async def upload_font(file: UploadFile = File(...)) -> Dict[str, Any]:
    filename = file.filename or "font.bin"
    ext = ""
    if "." in filename:
        ext = "." + filename.rsplit(".", 1)[-1].lower()
    if ext not in _FONT_SIGNATURES:
        raise HTTPException(
            status_code=422,
            detail="仅支持 .woff2 / .woff / .ttf / .otf 字体文件",
        )

    content = await file.read()
    if len(content) > MAX_FONT_BYTES:
        raise HTTPException(status_code=413, detail="字体文件超过 20MB 限制")

    signatures = _FONT_SIGNATURES[ext]
    if not any(content.startswith(magic) for magic in signatures):
        raise HTTPException(
            status_code=422,
            detail="文件签名与扩展名不符，不是有效的字体文件",
        )

    font_id = uuid.uuid4().hex[:12]
    target_dir = FONTS_ROOT / font_id
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / f"{font_id}{ext}"
    target_path.write_bytes(content)

    entry = {
        "id": font_id,
        "family": f"user-{font_id}",
        "filename": target_path.name,
        "ext": ext,
        # 前端经 /static 挂载直接引用，无需额外下载接口
        "url": f"/static/fonts/{font_id}/{target_path.name}",
    }
    settings = load_settings()
    settings["uploaded_fonts"].append(entry)
    save_settings(settings)
    return entry


@router.delete("/fonts/{font_id}", status_code=204)
def delete_font(font_id: str) -> None:
    if not re.fullmatch(r"[0-9a-f]{12}", font_id):
        raise HTTPException(status_code=404, detail="字体不存在")
    settings = load_settings()
    entry = next(
        (e for e in settings["uploaded_fonts"] if e.get("id") == font_id),
        None,
    )
    if entry is None:
        raise HTTPException(status_code=404, detail="字体不存在")

    family = entry.get("family")
    used_slots = [slot for slot, value in settings["fonts"].items() if value == family]
    if used_slots:
        raise HTTPException(
            status_code=409,
            detail=f"字体仍被 {used_slots} 槽位使用，请先回退默认链再删除",
        )

    settings["uploaded_fonts"] = [
        e for e in settings["uploaded_fonts"] if e.get("id") != font_id
    ]
    save_settings(settings)

    import shutil

    shutil.rmtree(FONTS_ROOT / font_id, ignore_errors=True)
    return None
