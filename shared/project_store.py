"""
项目存储：以本地 JSON 文件保存/加载创作会话，支持项目列表展示。
使用整合后的共享 projects/ 目录。
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from shared.config import PROJECTS_DIR

SCHEMA_VERSION = 1


@dataclass(frozen=True)
class ProjectMeta:
    project_id: str
    project_name: str
    product_name: str
    updated_at: str
    path: Path


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _slugify(raw: str, fallback: str = "untitled") -> str:
    cleaned = re.sub(r"[^\w\-]+", "-", (raw or "").strip(), flags=re.UNICODE)
    cleaned = re.sub(r"-{2,}", "-", cleaned).strip("-_")
    return cleaned or fallback


def ensure_projects_dir() -> Path:
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    return PROJECTS_DIR


def make_project_id(project_name: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{stamp}_{_slugify(project_name)}"


def save_project(payload: dict[str, Any], project_name: str, project_id: str | None = None) -> str:
    """保存项目快照。若 project_id 为空则按时间戳生成新 id。"""
    root = ensure_projects_dir()
    pid = (project_id or "").strip() or make_project_id(project_name)
    now_iso = _utc_now_iso()
    doc = {
        "schema_version": SCHEMA_VERSION,
        "project_id": pid,
        "project_name": project_name.strip() or "未命名项目",
        "created_at": payload.get("created_at") or now_iso,
        "updated_at": now_iso,
        "payload": payload,
    }
    out_path = root / f"{pid}.json"
    out_path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    return pid


def _safe_read_json(path: Path) -> dict[str, Any] | None:
    try:
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw)
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    if not isinstance(data.get("payload"), dict):
        return None
    return data


def list_projects(limit: int = 200) -> list[ProjectMeta]:
    """返回按更新时间倒序的项目元数据列表。"""
    root = ensure_projects_dir()
    metas: list[ProjectMeta] = []
    for p in root.glob("*.json"):
        data = _safe_read_json(p)
        if not data:
            continue
        payload = data.get("payload") or {}
        metas.append(
            ProjectMeta(
                project_id=str(data.get("project_id") or p.stem),
                project_name=str(data.get("project_name") or "未命名项目"),
                product_name=str(payload.get("product_name") or ""),
                updated_at=str(data.get("updated_at") or ""),
                path=p,
            )
        )
    metas.sort(key=lambda m: m.updated_at, reverse=True)
    return metas[: max(1, limit)]


def load_project(project_id: str) -> dict[str, Any]:
    """加载项目文档，返回完整 JSON 结构。"""
    pid = (project_id or "").strip()
    if not pid:
        raise ValueError("project_id 不能为空")
    path = ensure_projects_dir() / f"{pid}.json"
    if not path.is_file():
        raise FileNotFoundError(f"未找到项目：{pid}")
    data = _safe_read_json(path)
    if not data:
        raise ValueError(f"项目文件损坏或格式不合法：{path.name}")
    return data
