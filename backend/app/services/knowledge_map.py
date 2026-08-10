"""把资料库素材聚合成可探索的信息地图数据。"""

from __future__ import annotations

from collections import defaultdict
from itertools import combinations
from typing import Any, Dict, Iterable, List, Sequence


def normalize_map_tags(tags: Any) -> List[str]:
    """兼容系统单值标签和 custom_tags 列表，返回稳定去重后的标签。"""
    if not isinstance(tags, dict):
        return []

    values: List[Any] = []
    for key, value in tags.items():
        if str(key).startswith("_"):
            continue
        if isinstance(value, list):
            values.extend(value)
        else:
            values.append(value)

    result: List[str] = []
    seen: set[str] = set()
    for value in values:
        if not isinstance(value, str):
            continue
        label = value.strip()
        if label and label not in seen:
            seen.add(label)
            result.append(label)
    return result


def build_knowledge_map(
    items: Sequence[Dict[str, Any]],
    *,
    limit: int = 60,
) -> Dict[str, Any]:
    """根据已筛选素材生成标签节点、共现边和内容详情。"""
    tag_items: Dict[str, set[str]] = defaultdict(set)
    item_tags: Dict[str, List[str]] = {}
    for item in items:
        item_id = str(item.get("item_id") or "")
        tags = sorted(normalize_map_tags(item.get("tags")))
        if not item_id or not tags:
            continue
        item_tags[item_id] = tags
        for tag in tags:
            tag_items[tag].add(item_id)

    ordered_tags = sorted(tag_items, key=lambda tag: (-len(tag_items[tag]), tag))
    visible_tags = set(ordered_tags[:limit])
    nodes = [
        {
            "id": f"tag:{tag}",
            "kind": "tag",
            "label": tag,
            "count": len(tag_items[tag]),
            "item_ids": sorted(tag_items[tag]),
        }
        for tag in ordered_tags[:limit]
    ]

    edge_items: Dict[tuple[str, str], set[str]] = defaultdict(set)
    for item_id, tags in item_tags.items():
        for source, target in combinations(sorted(set(tags) & visible_tags), 2):
            edge_items[(source, target)].add(item_id)
    edges = [
        {
            "id": f"edge:{source}:{target}",
            "source": f"tag:{source}",
            "target": f"tag:{target}",
            "kind": "co_tag",
            "weight": len(item_ids),
            "item_ids": sorted(item_ids),
        }
        for (source, target), item_ids in sorted(
            edge_items.items(), key=lambda pair: (-len(pair[1]), pair[0])
        )
    ]

    tagged_item_ids = {item_id for item_id in item_tags}
    return {
        "nodes": nodes,
        "edges": edges,
        "items": list(items),
        "stats": {
            "items": len(items),
            "tagged_items": len(tagged_item_ids),
            "tags": len(ordered_tags),
            "hidden_tags": max(0, len(ordered_tags) - len(visible_tags)),
        },
    }


def filter_knowledge_map_items(
    items: Iterable[Dict[str, Any]],
    *,
    workspace_id: str = "",
    collection_id: str = "",
    item_type: str = "",
    source: str = "",
    tag: str = "",
    favorite: bool | None = None,
) -> List[Dict[str, Any]]:
    """按地图筛选条件过滤素材，并保持输入顺序。"""
    filtered: List[Dict[str, Any]] = []
    normalized_tag = tag.strip()
    for item in items:
        collection_ids = {str(value) for value in item.get("collection_ids") or []}
        item_tags = set(normalize_map_tags(item.get("tags")))
        if workspace_id and item.get("workspace_id") != workspace_id and workspace_id not in collection_ids:
            continue
        if collection_id and collection_id not in collection_ids:
            continue
        if item_type and item.get("type") != item_type:
            continue
        if source and item.get("source") != source:
            continue
        if normalized_tag and normalized_tag not in item_tags:
            continue
        if favorite is not None and bool(item.get("favorite")) != favorite:
            continue
        filtered.append(item)
    return filtered
