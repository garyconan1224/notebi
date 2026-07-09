from __future__ import annotations

"""Subtitle-first extraction via yt-dlp metadata.

策略：先尝试取人工字幕（subtitles），取不到再取自动字幕（automatic_captions）。
下载 srt/vtt/json3 并解析为 segments（对齐 whisper 格式）。
"""

import re
from typing import Any, Dict, List, Optional, Tuple


# ── srt/vtt/json3 解析 ──────────────────────────────────────────


def _parse_srt(text: str) -> List[Dict[str, Any]]:
    """解析 SRT 格式字幕 → [{start, end, text}, ...]（时间单位秒）"""
    segments: List[Dict[str, Any]] = []
    # SRT 格式：序号 + 时间行 + 文本块
    blocks = re.split(r'\n\s*\n', text.strip())
    time_re = re.compile(
        r'(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})'
    )
    for block in blocks:
        lines = block.strip().splitlines()
        if len(lines) < 2:
            continue
        m = time_re.search(lines[1] if len(lines) > 1 else '')
        if not m:
            # 尝试第二行（有时序号独占一行）
            for line in lines:
                m = time_re.search(line)
                if m:
                    break
        if not m:
            continue
        g = [int(x) for x in m.groups()]
        start = g[0]*3600 + g[1]*60 + g[2] + g[3]/1000
        end = g[4]*3600 + g[5]*60 + g[6] + g[7]/1000
        # 时间行之后的都是文本
        time_line_idx = next(i for i, l in enumerate(lines) if time_re.search(l))
        txt = ' '.join(l.strip() for l in lines[time_line_idx+1:] if l.strip())
        txt = re.sub(r'<[^>]+>', '', txt)  # 去 HTML 标签
        if txt:
            segments.append({'start': start, 'end': end, 'text': txt})
    return segments


def _parse_vtt(text: str) -> List[Dict[str, Any]]:
    """解析 WebVTT 格式字幕 → [{start, end, text}, ...]（时间单位秒）"""
    # 去掉 WEBVTT 头部
    text = re.sub(r'^WEBVTT[^\n]*\n', '', text, flags=re.MULTILINE)
    text = re.sub(r'^NOTE[^\n]*\n(?:[^\n]+\n)*', '', text, flags=re.MULTILINE)
    # VTT 和 SRT 结构相似，复用解析
    return _parse_srt(text)


def _parse_json3(text: str) -> List[Dict[str, Any]]:
    """解析 YouTube json3 格式字幕 → [{start, end, text}, ...]"""
    import json
    try:
        data = json.loads(text)
    except Exception:
        return []
    events = data.get('events') or []
    segments: List[Dict[str, Any]] = []
    for ev in events:
        segs = ev.get('segs') or []
        txt = ''.join(s.get('utf8', '') for s in segs).strip()
        if not txt or txt == '\n':
            continue
        start = (ev.get('tStartMs') or 0) / 1000
        dur = (ev.get('dDurationMs') or 0) / 1000
        segments.append({'start': start, 'end': start + dur, 'text': txt})
    return segments


def _parse_subtitle_content(content: str, ext: str) -> List[Dict[str, Any]]:
    """根据扩展名解析字幕内容 → segments"""
    ext = ext.lower().lstrip('.')
    if ext == 'srt':
        return _parse_srt(content)
    elif ext in ('vtt', 'webvtt'):
        return _parse_vtt(content)
    elif ext == 'json3':
        return _parse_json3(content)
    # 兜底：按 VTT 解析
    return _parse_vtt(content)


# ── 主入口 ────────────────────────────────────────────────────

# 优先语言顺序：中文简体 > 中文 > 中文繁体 > 英文 > 日文 > 第一个可用
_PREFER_LANGS = ('zh-Hans', 'zh', 'zh-CN', 'zh-Hant', 'en', 'en-US', 'ja')


def _pick_lang(captions_dict: Dict[str, Any], prefer: Tuple[str, ...] = _PREFER_LANGS) -> Optional[str]:
    """从字幕字典中按优先级选语言，返回 lang key 或 None"""
    if not captions_dict:
        return None
    # 先按 prefer 顺序找
    for lang in prefer:
        if lang in captions_dict:
            return lang
        # 宽松匹配（yt-dlp key 可能是 zh-Hans-zh-Hant 等复合格式）
        for key in captions_dict:
            if key.startswith(lang):
                return key
    # 都没命中，返回第一个
    return next(iter(captions_dict), None)


def _download_subtitle_text(
    ydl: Any,
    info: Dict[str, Any],
    lang: str,
    is_auto: bool,
) -> Optional[Tuple[str, str]]:
    """下载指定语言的字幕轨道并返回 (内容, 扩展名)。

    is_auto=True 时从 automatic_captions 取，否则从 subtitles 取。
    返回 None 表示下载失败。
    """
    captions_dict = info.get('automatic_captions' if is_auto else 'subtitles') or {}
    tracks = captions_dict.get(lang) or []
    if not isinstance(tracks, list) or not tracks:
        return None

    # 优先找 srt/vtt/json3 格式的 track（有 url 的 dict）
    # yt-dlp tracks 格式：[{'ext': 'json3', 'url': '...'}, {'ext': 'vtt', 'url': '...'}, ...]
    # 或者有时是字符串 url 列表
    preferred_exts = ('srt', 'vtt', 'json3')
    best_track: Optional[Dict[str, str]] = None
    for ext in preferred_exts:
        for track in tracks:
            if isinstance(track, dict) and track.get('ext') == ext and track.get('url'):
                best_track = track
                break
        if best_track:
            break

    # 兜底：取第一个有 url 的 track
    if not best_track:
        for track in tracks:
            if isinstance(track, dict) and track.get('url'):
                best_track = track
                break
    if not best_track:
        return None

    url = str(best_track.get('url', ''))
    ext = str(best_track.get('ext', 'vtt'))
    if not url:
        return None

    # 用 yt-dlp 内置下载器下载（复用 ydl 的网络配置：proxy/cookie 等）
    try:
        content = ydl.urlopen(url).read().decode('utf-8', errors='replace')
    except Exception:
        return None

    return content, ext


def fetch_best_subtitle(
    url: str,
    *,
    proxy: Optional[str] = None,
    po_token: Optional[str] = None,
    visitor_data: Optional[str] = None,
    cookie_base_dirs: Optional[List[str]] = None,
    prefer_langs: Tuple[str, ...] = _PREFER_LANGS,
) -> Optional[Tuple[str, List[Dict[str, Any]], Dict[str, Any]]]:
    """尝试获取视频的平台字幕（CC）。

    优先人工字幕，取不到再取自动字幕；中文优先。
    返回 (transcript_text, segments, meta) 或 None。
    - transcript_text: 拼接的纯文本（供 LLM 总结用）
    - segments: [{start, end, text}, ...]（对齐 whisper 格式，供结果页时间戳跳转）
    - meta: {lang, source:'manual'|'auto'}

    无字幕 / 下载失败 / 解析为空 → 返回 None。
    """
    try:
        import yt_dlp
    except Exception:
        return None

    opts: Dict[str, Any] = {
        'quiet': True,
        'skip_download': True,
        'no_warnings': True,
        'ignoreconfig': True,
    }
    if proxy:
        opts['proxy'] = proxy
    if po_token:
        opts['po_token'] = po_token
    if visitor_data:
        opts['visitor_data'] = visitor_data

    # 复用 cookie_base_dirs 自动查找 cookie 文件（对齐 pipeline 的下载上下文，B站 412 必需）
    if cookie_base_dirs:
        opts['cookie_base_dirs'] = cookie_base_dirs

    # 整个字幕提取+下载都在 with 块内（ydl.urlopen 需要 ydl 实例）
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)

            if not isinstance(info, dict):
                return None

            subtitles = info.get('subtitles') or {}
            auto_subs = info.get('automatic_captions') or {}

            # 优先人工字幕，再自动字幕
            for is_auto, captions in [(False, subtitles), (True, auto_subs)]:
                if not isinstance(captions, dict) or not captions:
                    continue
                lang = _pick_lang(captions, prefer_langs)
                if not lang:
                    continue

                result = _download_subtitle_text(ydl, info, lang, is_auto)
                if not result:
                    continue
                content, ext = result

                segments = _parse_subtitle_content(content, ext)
                if not segments:
                    continue

                transcript_text = '\n'.join(s['text'] for s in segments)
                if not transcript_text.strip():
                    continue

                return transcript_text, segments, {
                    'lang': lang,
                    'source': 'auto' if is_auto else 'manual',
                }

    except Exception:
        return None

    return None
