"""说话人标签的确定性展示与持久化替换。"""

from __future__ import annotations

import re
from typing import Mapping

SPEAKER_ROLE_OPTIONS = ("主持人", "我司领导", "客户", "讲师", "其他")


def apply_speaker_map(content: str, speaker_map: Mapping[str, object] | None) -> str:
    """将总结中的原始说话人 ID 替换为用户已确认的名称。

    只替换完整 token，避免 ``SPEAKER_00`` 误改 ``SPEAKER_001``。
    """
    if not content or not speaker_map:
        return content
    replacements = {
        str(raw_id).strip(): str(label).strip()
        for raw_id, label in speaker_map.items()
        if str(raw_id).strip()
        and str(label).strip()
        and str(raw_id).strip() != str(label).strip()
    }
    if not replacements:
        return content
    alternatives = "|".join(
        re.escape(raw_id) for raw_id in sorted(replacements, key=len, reverse=True)
    )
    pattern = re.compile(rf"(?<![A-Za-z0-9])({alternatives})(?![A-Za-z0-9])")
    return pattern.sub(lambda match: replacements[match.group(1)], content)


def apply_speaker_renames(
    content: str,
    previous_map: Mapping[str, object] | None,
    next_map: Mapping[str, object] | None,
) -> str:
    """同时替换原始 speaker id 与上一次已展示的姓名。

    历史总结可能已经被旧版本写成了用户姓名，不再含有 ``SPEAKER_00``。
    因此改名时不能只替换原始 id；这里使用占位符分两步替换，避免
    ``旧姓名 -> 新姓名`` 的链式替换污染其他说话人。
    """
    if not content:
        return content
    old = previous_map or {}
    new = next_map or {}
    replacements: dict[str, str] = {}
    for raw_id, next_label in new.items():
        raw = str(raw_id or "").strip()
        label = str(next_label or "").strip()
        if raw and label and raw != label:
            replacements[raw] = label
        previous_label = str(old.get(raw_id) or old.get(raw) or "").strip()
        if previous_label and label and previous_label != label and previous_label != raw:
            replacements[previous_label] = label
    if not replacements:
        return content
    alternatives = "|".join(
        re.escape(key) for key in sorted(replacements, key=len, reverse=True)
    )
    pattern = re.compile(rf"(?<![A-Za-z0-9])({alternatives})(?![A-Za-z0-9])")
    tokens = {key: f"\u0000SPEAKER_RENAME_{index}\u0000" for index, key in enumerate(replacements)}
    replaced = pattern.sub(lambda match: tokens[match.group(1)], content)
    for key, token in tokens.items():
        replaced = replaced.replace(token, replacements[key])
    return replaced


def build_speaker_profile_context(
    speaker_map: Mapping[str, object] | None,
    speaker_roles: Mapping[str, object] | None,
) -> str:
    """构造给模型看的姓名/角色档案，不把角色混入原始字幕文本。"""
    names = speaker_map or {}
    roles = speaker_roles or {}
    lines: list[str] = []
    for raw_id in sorted(set(names) | set(roles)):
        speaker_id = str(raw_id or "").strip()
        if not speaker_id:
            continue
        name = str(names.get(raw_id) or names.get(speaker_id) or "").strip() or "未命名"
        role = str(roles.get(raw_id) or roles.get(speaker_id) or "").strip()
        lines.append(f"- {speaker_id}：姓名：{name}；角色：{role or '未设置'}")
    if not lines:
        return ""
    return (
        "【说话人档案】\n"
        + "\n".join(lines)
        + "\n角色未知时不得推断；总结首次提及人物时可使用‘姓名（角色）’，后续保持姓名归属。\n"
    )
