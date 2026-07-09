"""Gemini 视频直接分析客户端。

使用 google-genai SDK File API 上传视频 → 等待 ACTIVE → generate_content → 删除文件。
缺 GEMINI_API_KEY 时给出明确错误。
"""

from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List

DEFAULT_VIDEO_MODEL = "gemini-2.5-flash"

_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*\n?(.*?)\n?\s*```", re.DOTALL)


def _parse_json_safely(text: str) -> Dict[str, Any]:
    """解析 JSON，兼容 Gemini 返回 ```json 包裹的情况。"""
    text = text.strip()
    m = _JSON_FENCE_RE.match(text)
    if m:
        text = m.group(1).strip()
    return json.loads(text)


@dataclass
class GeminiVideoResponse:
    """Gemini 视频分析的结构化返回。"""

    summary: str
    segments: List[Dict[str, Any]]
    raw_response: Dict[str, Any] = field(default_factory=dict)


class GeminiVideoClient:
    """Gemini 视频分析客户端。

    使用 google-genai SDK 的 File API 上传视频 → generate_content → 删除文件。
    缺 GEMINI_API_KEY 时构造即 raise RuntimeError。
    """

    def __init__(
        self,
        api_key: str | None = None,
        model: str = DEFAULT_VIDEO_MODEL,
    ) -> None:
        self.api_key = api_key or os.getenv("GEMINI_API_KEY", "").strip()
        if not self.api_key:
            raise RuntimeError(
                "GEMINI_API_KEY 未配置，video_model 路径暂不可用，请在 .env 添加后重试"
            )
        self.model = model

    def analyze_video(
        self,
        video_path: Path,
        intent: str,
        prompt_template: str,
    ) -> GeminiVideoResponse:
        """上传视频到 Gemini File API，获取结构化分析结果。

        Args:
            video_path: 本地视频文件路径
            intent: 视频意图（learning / replica / 默认）
            prompt_template: 已组装好的 prompt 文本

        Returns:
            GeminiVideoResponse 含 summary / segments / raw_response
        """
        import shutil
        import tempfile

        from google import genai
        from google.genai import types

        client = genai.Client(api_key=self.api_key)

        # 中文文件名会导致 SDK HTTP header ASCII 编码错误，需要复制到临时 ASCII 文件名
        upload_path = str(video_path)
        tmp_file: str | None = None
        try:
            if not video_path.name.isascii():
                fd, tmp_file = tempfile.mkstemp(suffix=video_path.suffix)
                os.close(fd)
                shutil.copy2(video_path, tmp_file)
                upload_path = tmp_file

            uploaded_file = client.files.upload(file=upload_path)

            # File API 上传视频后是 PROCESSING 状态，必须等 ACTIVE 才能 generate_content
            waited = 0
            while getattr(uploaded_file.state, "name", str(uploaded_file.state)) == "PROCESSING":
                if waited >= 180:
                    raise RuntimeError("Gemini 文件处理超时（>180s）")
                time.sleep(3)
                waited += 3
                uploaded_file = client.files.get(name=uploaded_file.name)

            file_state = getattr(uploaded_file.state, "name", str(uploaded_file.state))
            if file_state == "FAILED":
                raise RuntimeError("Gemini 文件处理失败")
            if file_state != "ACTIVE":
                raise RuntimeError(f"Gemini 文件状态异常: {file_state}（期望 ACTIVE）")

            gen_config = types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema={
                    "type": "object",
                    "properties": {
                        "summary": {"type": "string"},
                        "segments": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "start": {"type": "number"},
                                    "end": {"type": "number"},
                                    "text": {"type": "string"},
                                },
                                "required": ["start", "end", "text"],
                            },
                        },
                    },
                    "required": ["summary", "segments"],
                },
            )

            # SDK 内置 tenacity 重试（503/429），无需额外重试
            resp = client.models.generate_content(
                model=self.model,
                contents=[uploaded_file, prompt_template],
                config=gen_config,
            )
            data = _parse_json_safely(resp.text)
            return GeminiVideoResponse(
                summary=data.get("summary", ""),
                segments=data.get("segments", []),
                raw_response=data if isinstance(data, dict) else {},
            )
        finally:
            try:
                client.files.delete(name=uploaded_file.name)
            except Exception:
                pass
            if tmp_file and os.path.exists(tmp_file):
                os.unlink(tmp_file)
