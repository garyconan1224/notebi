"""Resolve approved batch inputs without creating tasks or workspaces."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

_TRACKING_KEYS = {
    "bbid",
    "share_medium",
    "share_source",
    "spm_id_from",
    "ts",
    "unique_k",
    "utm_campaign",
    "utm_content",
    "utm_medium",
    "utm_source",
    "vd_source",
}


def normalize_batch_source(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if "://" not in raw:
        return str(Path(raw).expanduser().resolve(strict=False))
    parts = urlsplit(raw)
    query = sorted(
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if key.lower() not in _TRACKING_KEYS
    )
    return urlunsplit(
        (
            parts.scheme.lower(),
            parts.netloc.lower(),
            parts.path.rstrip("/") or "/",
            urlencode(query),
            "",
        )
    )


def stable_batch_item_id(source_url: str, external_id: str = "") -> str:
    identity = f"{normalize_batch_source(source_url)}\n{str(external_id or '').strip()}"
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16]


def _collection_result(source_type: str, url: str) -> dict[str, Any]:
    # Reuse the already-tested platform resolvers used by workspace batch imports.
    from backend.app.routes import workspaces

    if source_type == "bilibili_parts":
        return workspaces._resolve_bilibili_multipart_source(url)
    if source_type == "youtube_playlist":
        return workspaces._resolve_youtube_playlist_source(url)
    if source_type in {
        "bilibili_collection",
        "bilibili_favorites",
        "bilibili_uploader",
    }:
        fallback = {
            "bilibili_collection": "Bilibili 合集",
            "bilibili_favorites": "Bilibili 收藏夹",
            "bilibili_uploader": "Bilibili UP 主投稿",
        }[source_type]
        return workspaces._resolve_ytdlp_collection_source(
            url,
            source_type=source_type,
            platform="bilibili",
            fallback_title=fallback,
        )
    raise ValueError(f"unsupported batch source type: {source_type}")


def resolve_batch_sources(
    *,
    source_type: str,
    urls: list[str],
    local_files: list[str],
) -> list[dict[str, Any]]:
    if source_type == "local_files":
        return [
            {
                "source_url": str(Path(value).expanduser().resolve(strict=False)),
                "source_title": Path(value).name or value,
                "external_id": "",
            }
            for value in local_files
            if str(value or "").strip()
        ]
    if source_type == "urls":
        from backend.app.routes import workspaces

        result = workspaces._resolve_multi_url_source(urls)
        return [
            {
                "source_url": str(item.get("source_url") or ""),
                "source_title": str(item.get("title") or ""),
                "external_id": str(item.get("external_id") or ""),
            }
            for item in result.get("items") or []
        ]

    resolved: list[dict[str, Any]] = []
    for url in urls:
        result = _collection_result(source_type, url)
        resolved.extend(
            {
                "source_url": str(item.get("source_url") or ""),
                "source_title": str(item.get("title") or ""),
                "external_id": str(item.get("external_id") or ""),
            }
            for item in result.get("items") or []
        )
    return resolved
