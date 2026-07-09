"""
硅基流动统一 HTTP 客户端：Embedding、Rerank、Chat（含多模态）、视频帧分析。
整合自 AI 导演编剧工作台/siliconflow_client.py，并新增视频帧分析接口。
"""

from __future__ import annotations

import base64
import json
from collections.abc import Iterator
from typing import Any, Callable, Optional, Sequence

import requests
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from shared.config import embedding_char_limit_for_model, get_openai_compat_base_url


class SiliconFlowError(RuntimeError):
    """API 返回非预期状态或业务错误时抛出（通常不应重试）。"""


class SiliconFlowTransientError(RuntimeError):
    """限流或服务过载等可恢复错误，配合 tenacity 自动重试。"""


def _headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


@retry(
    reraise=True,
    stop=stop_after_attempt(5),
    wait=wait_exponential(multiplier=1, min=2, max=45),
    retry=retry_if_exception_type(
        (
            requests.Timeout,
            requests.ConnectionError,
            SiliconFlowTransientError,
        )
    ),
)
def _post_json(
    api_key: str,
    path: str,
    payload: dict[str, Any],
    timeout: int = 120,
) -> dict[str, Any]:
    """统一 POST。网络类错误与 429/503/504 触发重试；401/400 等立即失败。"""
    url = f"{get_openai_compat_base_url().rstrip('/')}{path}"
    resp = requests.post(url, headers=_headers(api_key), json=payload, timeout=timeout)
    if resp.status_code in (429, 503, 504):
        raise SiliconFlowTransientError(f"HTTP {resp.status_code}: {resp.text[:500]}")
    if resp.status_code >= 400:
        try:
            detail = resp.json()
        except json.JSONDecodeError:
            detail = resp.text
        raise SiliconFlowError(f"HTTP {resp.status_code}: {detail}")
    return resp.json()


def _sanitize_embedding_text(text: str, max_chars: int) -> str:
    """去掉首尾空白，截断到安全长度；空串用占位符，避免 API 拒收。"""
    s = (text or "").strip()
    if not s:
        return "（空文档）"
    if len(s) > max_chars:
        return s[:max_chars] + "…"
    return s


def create_embeddings(
    api_key: str,
    model: str,
    inputs: Sequence[str],
    on_batch: Optional[Callable[[int, int], None]] = None,
) -> list[list[float]]:
    """
    调用 /v1/embeddings。单次最多 32 条，自动分批。
    每条按所选模型的字符上限截断。
    """
    cap = embedding_char_limit_for_model(model)
    sanitized = [_sanitize_embedding_text(t, cap) for t in inputs]
    if not sanitized:
        return []
    total_batches = (len(sanitized) + 31) // 32
    out: list[list[float]] = []
    batch: list[str] = []
    done_batches = 0
    for text in sanitized:
        batch.append(text)
        if len(batch) >= 32:
            out.extend(_embed_batch(api_key, model, batch))
            batch = []
            done_batches += 1
            if on_batch is not None:
                on_batch(done_batches, total_batches)
    if batch:
        out.extend(_embed_batch(api_key, model, batch))
        done_batches += 1
        if on_batch is not None:
            on_batch(done_batches, total_batches)
    return out


def _embed_batch(api_key: str, model: str, batch: list[str]) -> list[list[float]]:
    data = _post_json(
        api_key,
        "/embeddings",
        {"model": model, "input": batch},
        timeout=180,
    )
    items = data.get("data") or []
    items_sorted = sorted(items, key=lambda x: x.get("index", 0))
    return [row["embedding"] for row in items_sorted]


def rerank_documents(
    api_key: str,
    model: str,
    query: str,
    documents: Sequence[str],
    top_n: int,
) -> list[dict[str, Any]]:
    """调用 /v1/rerank，返回官方 results 列表（含 index 与 relevance_score）。"""
    if not documents:
        return []
    payload = {
        "model": model,
        "query": query,
        "documents": list(documents),
        "top_n": min(top_n, len(documents)),
        "return_documents": False,
    }
    data = _post_json(api_key, "/rerank", payload, timeout=120)
    return list(data.get("results") or [])


def chat_completion(
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    temperature: float = 0.7,
    max_tokens: int = 8192,
    timeout: int = 300,
) -> str:
    """OpenAI 兼容 /v1/chat/completions，返回 assistant 文本。"""
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    data = _post_json(api_key, "/chat/completions", payload, timeout=timeout)
    choices = data.get("choices") or []
    if not choices:
        raise SiliconFlowError(f"无 choices 字段: {data}")
    msg = choices[0].get("message") or {}
    content = msg.get("content")
    if not isinstance(content, str):
        raise SiliconFlowError(f"异常 message 结构: {msg}")
    return content


def chat_completion_stream(
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    temperature: float = 0.7,
    max_tokens: int = 8192,
) -> Iterator[str]:
    """OpenAI 兼容流式 /v1/chat/completions（stream=True），逐块 yield 文本片段。

    每次 yield 的是单条 delta.content 字符串；调用方无需关心 SSE 格式。
    API 返回 [DONE] 或流结束时自动停止迭代。
    """
    url = f"{get_openai_compat_base_url().rstrip('/')}/chat/completions"
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    headers = _headers(api_key)
    with requests.post(url, headers=headers, json=payload, stream=True, timeout=300) as resp:
        if resp.status_code in (429, 503, 504):
            raise SiliconFlowTransientError(f"HTTP {resp.status_code}: {resp.text[:500]}")
        if resp.status_code >= 400:
            try:
                detail = resp.json()
            except Exception:
                detail = resp.text
            raise SiliconFlowError(f"HTTP {resp.status_code}: {detail}")
        for raw_line in resp.iter_lines():
            if not raw_line:
                continue
            line = raw_line.decode("utf-8") if isinstance(raw_line, bytes) else raw_line
            if not line.startswith("data: "):
                continue
            payload_str = line[6:]
            if payload_str.strip() == "[DONE]":
                break
            try:
                chunk = json.loads(payload_str)
            except json.JSONDecodeError:
                continue
            delta = (chunk.get("choices") or [{}])[0].get("delta") or {}
            text = delta.get("content")
            if text:
                yield text


def build_vision_user_content(
    prompt_text: str,
    images: Sequence[tuple[bytes, str]],
) -> list[dict[str, Any]]:
    """
    构造多模态 user content：一段说明文字 + 多张 data URL 图片。
    images: (bytes, mime_type) 例如 image/jpeg
    """
    parts: list[dict[str, Any]] = [{"type": "text", "text": prompt_text}]
    for raw, mime in images:
        b64 = base64.standard_b64encode(raw).decode("ascii")
        url = f"data:{mime};base64,{b64}"
        parts.append({"type": "image_url", "image_url": {"url": url}})
    return parts


def analyze_product_images(
    api_key: str,
    model: str,
    images: Sequence[tuple[bytes, str]],
) -> str:
    """调用视觉大模型，输出材质、颜色、设计细节等中文报告。"""
    instruction = (
        "你是资深产品视觉分析师。请根据图片输出结构化中文报告，包含：\n"
        "1. 整体观感与设计风格\n"
        "2. 主色、辅色与材质质感\n"
        "3. 关键设计细节（镜头、纹理、LOGO、开孔、按键等）\n"
        "4. 适合在广告分镜中强调的 3~5 个视觉卖点\n"
        "要求：条理清晰，避免臆测不存在的信息；若看不清请写明「不确定」。"
    )
    content = build_vision_user_content(instruction, images)
    messages: list[dict[str, Any]] = [
        {
            "role": "system",
            "content": "你擅长手机与消费电子产品的广告视觉拆解，输出用于导演与美术参考的专业描述。",
        },
        {"role": "user", "content": content},
    ]
    return chat_completion(api_key, model, messages, temperature=0.3, max_tokens=2048)


def analyze_video_frame(
    api_key: str,
    model: str,
    image_b64: str,
    video_title: str,
) -> dict[str, str]:
    """
    调用视觉大模型分析单帧图片（视频分析专用）。
    返回 {"description_zh": "...", "image_prompt_en": "..."}
    """
    prompt = (
        f"你是一位资深的视频内容分析师。这张图片截取自名为《{video_title}》的视频。\n\n"
        "请从两个角度分析这张图片：\n\n"
        "角度一·内容理解（最重要）：这张图在讲什么？是什么界面/场景？有什么关键信息？\n"
        "例如：标题文字、菜单列表、数据指标、代码片段、图表含义、操作步骤、关键结论。\n"
        "目标是让没看过视频的人通过你的解读，理解这帧传达的核心信息。\n\n"
        "角度二·画面描述：简要描述画面的视觉构成（主体、布局、配色），用于将来复刻。\n\n"
        "必须严格按照以下 JSON 格式输出，不要有任何 markdown 代码块标记，不要有多余废话：\n"
        "{\n"
        '  "content_zh": "【内容理解】这张图展示的是……关键信息有……，'
        "它在视频中的作用是……（如果是纯黑/纯白过渡帧，写「纯色过渡帧」）。"
        ' 目标：让读者不用看视频就知道这帧在讲什么。至少写 2-3 句话。",\n'
        '  "description_zh": "【画面描述】简要描述画面的视觉构成、布局和配色。'
        ' 如果是纯色过渡帧，写「纯色过渡帧」。",\n'
        '  "image_prompt_en": "英文提示词，用于 AI 复刻此画面。分 2-3 段描述核心视觉元素、'
        '场景环境、镜头视角。如果是纯色过渡帧，则留空。"\n'
        "}"
    )
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
                    {"type": "text", "text": prompt},
                ],
            }
        ],
        "max_tokens": 2048,
        "temperature": 0.3,
    }
    data = _post_json(api_key, "/chat/completions", payload, timeout=120)
    choices = data.get("choices") or []
    if not choices:
        raise SiliconFlowError(f"无 choices 字段: {data}")
    raw = choices[0].get("message", {}).get("content", "").strip()

    import re
    match = re.search(r"\{[\s\S]*\}", raw)
    if match:
        try:
            parsed = json.loads(match.group())
            if "content_zh" in parsed or "description_zh" in parsed:
                return {
                    "content_zh": parsed.get("content_zh", ""),
                    "description_zh": parsed.get("description_zh", ""),
                    "image_prompt_en": parsed.get("image_prompt_en", ""),
                }
        except json.JSONDecodeError:
            pass
    return {"content_zh": "", "description_zh": raw, "image_prompt_en": ""}


def analyze_video_frames_batch(
    api_key: str,
    model: str,
    images_b64: list[str],
    video_title: str,
) -> list[dict[str, str]]:
    """
    批量分析多帧图片（视频分析专用）。
    一次请求传入 N 张帧，返回长度=N 的列表，按输入顺序对齐。
    每个元素: {"description_zh": "...", "image_prompt_en": "..."}
    若解析失败或长度不符 → raise，由调用方回退逐帧。
    """
    import re

    n = len(images_b64)
    prompt = (
        f"我按时间顺序给你 {n} 张图片，截取自视频《{video_title}》。\n"
        f"请严格输出一个 JSON 数组，长度必须等于 {n}，第 i 个元素对应第 i 张图。\n"
        "每个元素格式：\n"
        '{"index": i(从1开始), "content_zh": "...", "description_zh": "...", "image_prompt_en": "..."}\n'
        "不要 markdown 代码块，直接输出 JSON 数组。\n\n"
        "content_zh（最重要）：这张图在讲什么？是什么界面/场景？有什么关键信息？"
        "（标题/菜单/数据/代码/图表/操作步骤/关键结论）。"
        "目标是让没看过视频的人通过你的解读理解这帧传达的核心信息。至少 2-3 句话。"
        "如果是纯黑/纯白过渡帧，写「纯色过渡帧」。\n"
        "description_zh：简要描述画面的视觉构成、布局和配色（用于将来复刻）。纯色过渡帧写「纯色过渡帧」。\n"
        "image_prompt_en：英文提示词，用于 AI 复刻此画面，分 2-3 段描述。纯色过渡帧留空。"
    )

    # 构造 content: text + 每张图
    content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    for b64 in images_b64:
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
        })

    max_tokens = min(8192, n * 700)
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": content,
            }
        ],
        "max_tokens": max_tokens,
        "temperature": 0.3,
    }
    data = _post_json(api_key, "/chat/completions", payload, timeout=180)
    choices = data.get("choices") or []
    if not choices:
        raise SiliconFlowError(f"无 choices 字段: {data}")
    raw = choices[0].get("message", {}).get("content", "").strip()

    # 去掉可能的 markdown 围栏
    raw_clean = re.sub(r"```json\s*", "", raw)
    raw_clean = re.sub(r"```\s*$", "", raw_clean)

    # 提取 JSON 数组
    match = re.search(r"\[[\s\S]*\]", raw_clean)
    if not match:
        raise SiliconFlowError(f"批量帧分析返回中无 JSON 数组: {raw[:200]}")

    try:
        parsed = json.loads(match.group())
    except json.JSONDecodeError as e:
        raise SiliconFlowError(f"批量帧分析 JSON 解析失败: {e}") from e

    if not isinstance(parsed, list):
        raise SiliconFlowError(f"批量帧分析返回非数组: {type(parsed)}")

    if len(parsed) != n:
        raise SiliconFlowError(
            f"批量帧分析计数不符: 期望 {n}，实际 {len(parsed)}"
        )

    # 按 index 升序对齐（如果有的话），否则按数组序
    if parsed and isinstance(parsed[0], dict) and "index" in parsed[0]:
        parsed.sort(key=lambda x: x.get("index", 0))

    # 提取需要的字段，确保按输入序对齐
    result = []
    for item in parsed:
        result.append({
            "content_zh": item.get("content_zh", ""),
            "description_zh": item.get("description_zh", ""),
            "image_prompt_en": item.get("image_prompt_en", ""),
        })
    return result


def generate_video_summary(
    api_key: str,
    model: str,
    video_title: str,
    frame_descriptions: str,
) -> str:
    """调用文本大模型，生成视频全局视觉总结。"""
    prompt = (
        f"我将提供视频《{video_title}》的逐帧画面描述流水账。请你作为专业导演，"
        "帮我写一份【全局视觉总结】（只关注画面，不涉及声音）。\n"
        "要求详细讲述：这个视频做了什么、怎么做的、展示了哪些核心内容、"
        "主要使用了哪些镜头语言（如特写、推拉摇移、转场方式），"
        f"是一个总结式的宏观讲述。字数在300-500字左右。\n\n以下是逐帧描述：\n\n{frame_descriptions}"
    )
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 1024,
        "temperature": 0.5,
    }
    data = _post_json(api_key, "/chat/completions", payload, timeout=120)
    choices = data.get("choices") or []
    if not choices:
        raise SiliconFlowError(f"无 choices 字段: {data}")
    return choices[0].get("message", {}).get("content", "").strip()


def get_model_ids(api_key: str, sub_type: str) -> list[str]:
    """
    GET /v1/models?sub_type=chat|embedding|reranker
    返回当前 Key 在硅基流动可见的模型 id 列表。
    """
    k = (api_key or "").strip()
    if not k:
        return []
    url = f"{get_openai_compat_base_url().rstrip('/')}/models"
    resp = requests.get(
        url,
        headers=_headers(k),
        params={"sub_type": sub_type},
        timeout=45,
    )
    if resp.status_code >= 400:
        try:
            detail = resp.json()
        except json.JSONDecodeError:
            detail = resp.text
        raise SiliconFlowError(f"HTTP {resp.status_code}: {detail}")
    data = resp.json()
    out: list[str] = []
    for m in data.get("data") or []:
        if isinstance(m, dict) and m.get("id"):
            out.append(str(m["id"]))
    return sorted(set(out))


def explain_error(err: Exception) -> str:
    """将底层异常映射为面向用户的可读提示。"""
    msg = str(err)
    low = msg.lower()

    if "http 401" in low or "unauthorized" in low:
        return "鉴权失败（401）。请检查 API Key 是否正确、是否仍有效。"
    if "http 429" in low or "rate limit" in low:
        return "触发限流（429）。请稍后重试，或降低并发与请求频率。"
    if "http 503" in low or "http 504" in low:
        return "服务暂时不可用（503/504）。建议稍后重试。"
    if "20012" in low or ("model" in low and "not" in low and "exist" in low):
        return (
            "模型不可用（可能是 20012）。请在侧边栏重新同步模型列表，"
            "并选择当前账号已开通的模型。"
        )
    if "20015" in low:
        return "输入过长（20015）。请减少文本长度后重试。"
    if "20042" in low or "must less than 512 tokens" in low:
        return "嵌入输入超长（20042）。请改用长上下文嵌入模型，或缩短输入内容。"
    if isinstance(err, (requests.Timeout, requests.ConnectionError)):
        return "网络超时或连接失败。请检查网络后重试。"
    return f"{msg}。可尝试更换模型或稍后重试。"
