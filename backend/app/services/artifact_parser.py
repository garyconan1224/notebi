"""Q4 / D7：把 AI 产物的 Markdown 解析为按 kind 校验的结构化 JSON。

设计要点：
- content_md 仍是可移植/降级的事实文本；content_json 是给界面语义渲染用。
- 解析是确定性的 Markdown → JSON（不额外调 LLM），坏输出尽量修复一次，
  仍无法得到合法结构时返回 None（前端回退 Markdown 并标注旧版）。
- mind_map 约束：单根、最多四层、节点 id 稳定、天然无环。
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

MAX_MIND_MAP_DEPTH = 4

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
_LIST_RE = re.compile(r"^(\s*)[-*+]\s+(.*)$")
_TASK_RE = re.compile(r"^(\s*)[-*+]\s+\[( |x|X)\]\s+(.*)$")
_TABLE_SEP_RE = re.compile(r"^\s*\|?\s*:?-{2,}.*$")


def _strip_md_inline(text: str) -> str:
    """去掉行内 Markdown 记号，保留可读文本。"""
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"\*([^*]+)\*", r"\1", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"~~([^~]+)~~", r"\1", text)
    return text.strip()


# ── mind_map ────────────────────────────────────────────────────


def _parse_mind_map(content_md: str) -> Optional[Dict[str, Any]]:
    """Markdown 多级列表 → {root:{id,text,children[]}}。

    单根：唯一顶层列表项即根；多个顶层项时用标题合成一个根。
    超过四层的节点并入第四层；id 用路径索引保证稳定。
    """
    lines = [ln for ln in content_md.splitlines() if ln.strip()]
    heading_text: Optional[str] = None
    items: List[tuple[int, str]] = []  # (indent, text)

    for ln in lines:
        m = _LIST_RE.match(ln)
        if m:
            indent = len(m.group(1).expandtabs(4))
            text = _strip_md_inline(m.group(2))
            if text:
                items.append((indent, text))
        else:
            h = _HEADING_RE.match(ln)
            if h and heading_text is None:
                heading_text = _strip_md_inline(h.group(2))

    if not items and not heading_text:
        return None

    if not items:
        return {"root": {"id": "n0", "text": heading_text or "", "children": []}}

    min_indent = min(ind for ind, _ in items)
    top_level = [text for ind, text in items if ind == min_indent]

    # 唯一顶层项即根；否则用标题（或占位）合成根，顶层项作为其子节点
    if len(top_level) == 1:
        root: Dict[str, Any] = {"id": "n0", "text": top_level[0], "children": []}
        body_items = [(ind, text) for ind, text in items if ind > min_indent]
        # 子节点的缩进基准 = 第二小的缩进（若有）
        child_indents = sorted({ind for ind, _ in body_items})
    else:
        root = {"id": "n0", "text": heading_text or "思维导图", "children": []}
        body_items = items
        child_indents = sorted({ind for ind, _ in items})

    indent_to_depth = {
        ind: min(i + 1, MAX_MIND_MAP_DEPTH - 1) for i, ind in enumerate(child_indents)
    }

    stack: List[tuple[int, Dict[str, Any]]] = [(0, root)]
    counters: Dict[str, int] = {}
    for ind, text in body_items:
        depth = indent_to_depth[ind] + 1  # 相对根的层级（1 起）
        depth = min(depth, MAX_MIND_MAP_DEPTH)
        while stack and stack[-1][0] >= depth:
            stack.pop()
        if not stack:
            stack = [(0, root)]
        parent = stack[-1][1]
        sibling_count = counters.get(parent["id"], 0)
        node_id = f"{parent['id']}-{sibling_count}"
        counters[parent["id"]] = sibling_count + 1
        node = {"id": node_id, "text": text, "children": []}
        parent["children"].append(node)
        stack.append((depth, node))

    return {"root": root}


# ── action_items ────────────────────────────────────────────────


def _parse_action_items(content_md: str) -> Optional[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for ln in content_md.splitlines():
        task = _TASK_RE.match(ln)
        if task:
            done = task.group(2).lower() == "x"
            text = _strip_md_inline(task.group(3))
        else:
            lst = _LIST_RE.match(ln)
            if not lst:
                continue
            done = False
            text = _strip_md_inline(lst.group(2))
        if not text:
            continue
        items.append({"id": f"a{len(items)}", "text": text, "done": done})
    if not items:
        return None
    return {"items": items}


# ── key_cards ───────────────────────────────────────────────────


def _parse_key_cards(content_md: str) -> Optional[Dict[str, Any]]:
    cards: List[Dict[str, Any]] = []
    current_title: Optional[str] = None
    body_lines: List[str] = []

    def flush() -> None:
        if current_title is not None:
            body = "\n".join(body_lines).strip()
            cards.append({
                "id": f"c{len(cards)}",
                "title": current_title,
                "body": body,
            })

    for ln in content_md.splitlines():
        h = _HEADING_RE.match(ln)
        if h and len(h.group(1)) >= 3:
            flush()
            current_title = _strip_md_inline(h.group(2))
            body_lines = []
        elif h and len(h.group(1)) < 3 and current_title is None:
            # 顶级标题作为第一张卡的标题（容错）
            current_title = _strip_md_inline(h.group(2))
            body_lines = []
        elif current_title is not None:
            if ln.strip():
                body_lines.append(_strip_md_inline(ln))
    flush()

    if not cards:
        return None
    return {"cards": cards}


# ── flashcards ──────────────────────────────────────────────────


def _parse_flashcards(content_md: str) -> Optional[Dict[str, Any]]:
    cards: List[Dict[str, Any]] = []
    question: Optional[str] = None
    answer_lines: List[str] = []
    in_answer = False

    def flush() -> None:
        nonlocal question, answer_lines, in_answer
        if question is not None:
            cards.append({
                "id": f"f{len(cards)}",
                "question": question,
                "answer": "\n".join(answer_lines).strip(),
            })
        question = None
        answer_lines = []
        in_answer = False

    for ln in content_md.splitlines():
        stripped = ln.strip()
        if not stripped:
            continue
        q = re.match(r"^(?:Q|问)\s*[:：]\s*(.*)$", stripped)
        a = re.match(r"^(?:A|答)\s*[:：]\s*(.*)$", stripped)
        if q:
            flush()
            question = _strip_md_inline(q.group(1))
            in_answer = False
        elif a:
            if question is None:
                continue
            answer_lines.append(_strip_md_inline(a.group(1)))
            in_answer = True
        elif in_answer and question is not None:
            # 答案的延续行
            answer_lines.append(_strip_md_inline(stripped))
    flush()

    if not cards:
        return None
    return {"cards": cards}


# ── glossary / timeline（表格）──────────────────────────────────


def _parse_table(content_md: str) -> Optional[List[List[str]]]:
    rows: List[List[str]] = []
    for ln in content_md.splitlines():
        if "|" not in ln:
            continue
        if _TABLE_SEP_RE.match(ln):
            continue
        cells = [c.strip() for c in ln.strip().strip("|").split("|")]
        if any(cells):
            rows.append([_strip_md_inline(c) for c in cells])
    return rows if len(rows) >= 2 else None


def _parse_glossary(content_md: str) -> Optional[Dict[str, Any]]:
    rows = _parse_table(content_md)
    if not rows:
        return None
    header = rows[0]
    out: List[Dict[str, str]] = []
    for row in rows[1:]:
        if not row or not row[0]:
            continue
        out.append({
            "term": row[0] if len(row) > 0 else "",
            "definition": row[1] if len(row) > 1 else "",
            "context": row[2] if len(row) > 2 else "",
        })
    if not out:
        return None
    return {"columns": header, "rows": out}


def _parse_timeline(content_md: str) -> Optional[Dict[str, Any]]:
    rows = _parse_table(content_md)
    if not rows:
        return None
    header = rows[0]
    out: List[Dict[str, str]] = []
    for row in rows[1:]:
        if not row or not any(row):
            continue
        out.append({
            "time": row[0] if len(row) > 0 else "",
            "event": row[1] if len(row) > 1 else "",
            "who": row[2] if len(row) > 2 else "",
            "impact": row[3] if len(row) > 3 else "",
        })
    if not out:
        return None
    return {"columns": header, "rows": out}


_PARSERS = {
    "mind_map": _parse_mind_map,
    "action_items": _parse_action_items,
    "key_cards": _parse_key_cards,
    "flashcards": _parse_flashcards,
    "glossary": _parse_glossary,
    "timeline": _parse_timeline,
}


def parse_artifact_json(kind: str, content_md: str) -> Optional[Dict[str, Any]]:
    """返回该 kind 的结构化 JSON；无法解析时返回 None（前端回退 Markdown）。"""
    parser = _PARSERS.get(kind)
    if parser is None:
        return None
    text = (content_md or "").strip()
    if not text:
        return None
    return parser(text)


def mind_map_stats(parsed: Dict[str, Any]) -> Dict[str, int]:
    """统计节点数与最大深度（用于校验与测试）。"""
    max_depth = 0
    count = 0

    def walk(node: Dict[str, Any], depth: int) -> None:
        nonlocal max_depth, count
        count += 1
        max_depth = max(max_depth, depth)
        for child in node.get("children", []):
            walk(child, depth + 1)

    root = parsed.get("root")
    if root:
        walk(root, 1)
    return {"nodes": count, "max_depth": max_depth}


def validate_mind_map(parsed: Dict[str, Any]) -> bool:
    """单根、≤4 层、id 唯一（树结构天然无环）。"""
    root = parsed.get("root")
    if not isinstance(root, dict):
        return False
    stats = mind_map_stats(parsed)
    if stats["max_depth"] > MAX_MIND_MAP_DEPTH:
        return False
    seen: set[str] = set()

    def collect_ids(node: Dict[str, Any]) -> bool:
        node_id = node.get("id")
        if node_id in seen:
            return False
        seen.add(node_id)
        return all(collect_ids(c) for c in node.get("children", []))

    return collect_ids(root)
