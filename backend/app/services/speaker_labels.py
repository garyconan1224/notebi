"""说话人标签的确定性展示与持久化替换。"""

from __future__ import annotations

import re
from typing import Mapping


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
