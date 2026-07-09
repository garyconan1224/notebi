"""HTTP 客户端：调用 FastAPI 任务中心（Streamlit / 脚本共用）。"""

from __future__ import annotations

import json
from typing import Any, Iterator
from urllib.parse import urljoin

import requests

from shared.config import get_backend_base_url


def backend_health(base_url: str | None = None, *, timeout_sec: float = 2.0) -> bool:
    base = (base_url or get_backend_base_url()).rstrip("/") + "/"
    try:
        r = requests.get(urljoin(base, "health"), timeout=timeout_sec)
        return r.status_code == 200 and (r.json() or {}).get("status") == "ok"
    except Exception:
        return False


def create_pipeline_task(
    project_id: str,
    task_type: str,
    payload: dict[str, Any],
    *,
    base_url: str | None = None,
    timeout_sec: float = 120.0,
) -> dict[str, Any]:
    base = (base_url or get_backend_base_url()).rstrip("/")
    r = requests.post(
        f"{base}/pipeline/tasks",
        json={"project_id": project_id, "task_type": task_type, "payload": payload},
        timeout=timeout_sec,
    )
    r.raise_for_status()
    return r.json()


def get_pipeline_task(task_id: str, *, base_url: str | None = None, timeout_sec: float = 60.0) -> dict[str, Any]:
    base = (base_url or get_backend_base_url()).rstrip("/")
    r = requests.get(f"{base}/pipeline/tasks/{task_id}", timeout=timeout_sec)
    r.raise_for_status()
    return r.json()


def cancel_pipeline_task(task_id: str, *, base_url: str | None = None, timeout_sec: float = 60.0) -> dict[str, Any]:
    base = (base_url or get_backend_base_url()).rstrip("/")
    r = requests.post(f"{base}/pipeline/tasks/{task_id}/cancel", timeout=timeout_sec)
    r.raise_for_status()
    return r.json()


def retry_pipeline_task(task_id: str, *, base_url: str | None = None, timeout_sec: float = 60.0) -> dict[str, Any]:
    base = (base_url or get_backend_base_url()).rstrip("/")
    r = requests.post(f"{base}/pipeline/tasks/{task_id}/retry", timeout=timeout_sec)
    r.raise_for_status()
    return r.json()


def delete_pipeline_task(task_id: str, *, base_url: str | None = None, timeout_sec: float = 60.0) -> dict[str, Any]:
    base = (base_url or get_backend_base_url()).rstrip("/")
    r = requests.delete(f"{base}/pipeline/tasks/{task_id}", timeout=timeout_sec)
    r.raise_for_status()
    return r.json()


def purge_pipeline_tasks(*, project_id: str | None = None, base_url: str | None = None, timeout_sec: float = 60.0) -> dict[str, Any]:
    base = (base_url or get_backend_base_url()).rstrip("/")
    params: dict[str, str] = {}
    if project_id:
        params["project_id"] = project_id
    r = requests.post(f"{base}/pipeline/tasks/purge", params=params, timeout=timeout_sec)
    r.raise_for_status()
    return r.json()


def get_recent_tasks(
    limit: int = 10,
    *,
    base_url: str | None = None,
    timeout_sec: float = 5.0,
) -> list[dict[str, Any]]:
    """拉取最近任务列表（GET /pipeline/tasks?limit={limit}）。

    返回任务字典列表；后端不可达或返回格式异常时抛出异常，由调用方决定如何处理。
    """
    base = (base_url or get_backend_base_url()).rstrip("/")
    r = requests.get(f"{base}/pipeline/tasks", params={"limit": limit}, timeout=timeout_sec)
    r.raise_for_status()
    result = r.json()
    # 兼容后端返回纯列表或 {"tasks": [...]} / {"items": [...]} 两种格式
    if isinstance(result, list):
        return result
    if isinstance(result, dict):
        return result.get("tasks", result.get("items", []))
    return []


def iter_task_sse_events(
    task_id: str,
    *,
    base_url: str | None = None,
    timeout_sec: float = 600.0,
) -> Iterator[dict[str, Any]]:
    """
    消费 GET /pipeline/tasks/{id}/events 的 SSE 流，产出解析后的 JSON 对象。
    """
    base = (base_url or get_backend_base_url()).rstrip("/")
    url = f"{base}/pipeline/tasks/{task_id}/events"
    with requests.get(url, stream=True, timeout=timeout_sec) as resp:
        resp.raise_for_status()
        for raw in resp.iter_lines(decode_unicode=True):
            if not raw:
                continue
            line = raw.strip()
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if not payload:
                continue
            try:
                yield json.loads(payload)
            except json.JSONDecodeError:
                continue
