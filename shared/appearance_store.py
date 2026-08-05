"""外观设置持久化（Q6 / D6）。

主题 / 模式 / 三槽位字体走后端 JSON 存储 + GET/PATCH 回读，
不只写 localStorage。链路：写入 → GET/readback → 从回读值更新 UI。

旧 data-accent 值（sage/terra/lavender）迁移到完整主题由前端完成，
本存储只保存新 schema。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT_DIR: Path = Path(__file__).resolve().parent.parent
STORE_DIR: Path = ROOT_DIR / ".local"
SETTINGS_PATH: Path = STORE_DIR / "appearance_settings.json"

VALID_THEMES = ("paper", "graphite", "sage", "midnight")
VALID_MODES = ("light", "dark", "system")
FONT_SLOTS = ("ui", "cap", "sum")

DEFAULTS: dict[str, Any] = {
    "theme": "paper",
    "mode": "system",
    "fonts": {"ui": None, "cap": None, "sum": None},
    "uploaded_fonts": [],
    # Q3 / D3：Obsidian 直写目的地（非秘密配置；token 一律不保存）
    "obsidian": {"vault_path": "", "subdir": "", "direct_write": False},
    # 导出与同步：云笔记目的地的非敏感默认值（API token 一律不保存）
    "export_sync": {
        "notion_parent_page_id": "",
        "feishu_folder_token": "",
    },
}


def _ensure_store_dir() -> None:
    STORE_DIR.mkdir(parents=True, exist_ok=True)


def load_settings() -> dict[str, Any]:
    """读取外观设置；缺字段用默认值补齐（兼容旧文件）。"""
    _ensure_store_dir()
    doc: dict[str, Any] = {}
    if SETTINGS_PATH.is_file():
        try:
            raw = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                doc = raw
        except (json.JSONDecodeError, OSError):
            doc = {}
    merged = {
        "theme": doc.get("theme") if doc.get("theme") in VALID_THEMES else DEFAULTS["theme"],
        "mode": doc.get("mode") if doc.get("mode") in VALID_MODES else DEFAULTS["mode"],
        "fonts": {
            slot: (doc.get("fonts") or {}).get(slot)
            for slot in FONT_SLOTS
        },
        "uploaded_fonts": [
            entry for entry in (doc.get("uploaded_fonts") or [])
            if isinstance(entry, dict) and entry.get("id")
        ],
        "obsidian": {
            "vault_path": str((doc.get("obsidian") or {}).get("vault_path") or ""),
            "subdir": str((doc.get("obsidian") or {}).get("subdir") or ""),
            "direct_write": bool((doc.get("obsidian") or {}).get("direct_write") or False),
        },
        "export_sync": {
            "notion_parent_page_id": str(
                (doc.get("export_sync") or {}).get("notion_parent_page_id") or ""
            ),
            "feishu_folder_token": str(
                (doc.get("export_sync") or {}).get("feishu_folder_token") or ""
            ),
        },
    }
    return merged


def save_settings(doc: dict[str, Any]) -> None:
    _ensure_store_dir()
    SETTINGS_PATH.write_text(
        json.dumps(doc, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def update_settings(patch: dict[str, Any]) -> dict[str, Any]:
    """浅合并 patch（fonts / obsidian 按字段合并），落盘并返回回读结果。"""
    current = load_settings()
    if "theme" in patch:
        current["theme"] = patch["theme"]
    if "mode" in patch:
        current["mode"] = patch["mode"]
    if isinstance(patch.get("fonts"), dict):
        for slot in FONT_SLOTS:
            if slot in patch["fonts"]:
                value = patch["fonts"][slot]
                current["fonts"][slot] = str(value) if value else None
    if isinstance(patch.get("obsidian"), dict):
        for key in ("vault_path", "subdir"):
            if key in patch["obsidian"]:
                current["obsidian"][key] = str(patch["obsidian"][key] or "")
        if "direct_write" in patch["obsidian"]:
            current["obsidian"]["direct_write"] = bool(patch["obsidian"]["direct_write"])
    if isinstance(patch.get("export_sync"), dict):
        for key in ("notion_parent_page_id", "feishu_folder_token"):
            if key in patch["export_sync"]:
                current["export_sync"][key] = str(patch["export_sync"][key] or "")
    save_settings(current)
    return load_settings()
