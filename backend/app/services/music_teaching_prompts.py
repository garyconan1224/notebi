"""音乐教学拆解：为每段音乐生成「为什么动人」的解释。"""

from __future__ import annotations

from dataclasses import dataclass

SYSTEM_PROMPT = "你是音乐教学专家，用 2-3 句中文解释一段音乐为什么动人，从节奏/调性/情绪角度。不要废话。"


@dataclass
class MusicTeachingRequest:
    bpm: float
    key: str
    music_prompt: str = ""


def build_teaching_prompt(req: MusicTeachingRequest) -> str:
    """构建用户提示词。"""
    parts = [f"BPM={req.bpm}", f"key={req.key}"]
    if req.music_prompt:
        parts.append(f"prompt={req.music_prompt}")
    return "，".join(parts)


async def generate_teaching_explanation(
    req: MusicTeachingRequest,
    chat_runner,
) -> str:
    """调用 LLM 生成教学解释。

    Args:
        request: 音乐段信息
        chat_runner: chat_runner 模块（复用现有 LLM 调用能力）

    Returns:
        2-3 句中文解释
    """
    user_prompt = build_teaching_prompt(req)

    try:
        response = await chat_runner.run_chat(
            system_prompt=SYSTEM_PROMPT,
            user_message=user_prompt,
            max_tokens=200,
        )
        return response.strip()
    except Exception as e:
        return f"生成失败：{str(e)}"
