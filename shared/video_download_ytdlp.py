"""
yt-dlp 下载逻辑（与 Streamlit / 后端任务共用）。
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import time
from collections.abc import Callable
from typing import Any

from shared.config import ROOT_DIR


def cookie_base_dirs() -> list[str]:
    dirs = [
        str(ROOT_DIR / "data" / "cookies"),
        str(ROOT_DIR / "YouTubeDownloader"),
    ]
    out: list[str] = []
    for d in dirs:
        if d not in out:
            out.append(d)
    return out


def _existing_cookie_files(base_dirs: list[str]) -> list[str]:
    out: list[str] = []
    for base_dir in base_dirs:
        candidates = (
            os.path.join(base_dir, "cookies.txt"),
            os.path.join(base_dir, "www.youtube.com_cookies.txt"),
        )
        for p in candidates:
            if os.path.isfile(p) and p not in out:
                out.append(p)
    return out


def _existing_bili_cookie_files(base_dirs: list[str]) -> list[str]:
    out: list[str] = []
    for base_dir in base_dirs:
        candidates = (
            os.path.join(base_dir, "bilibili_cookies.txt"),
            os.path.join(base_dir, "www.bilibili.com_cookies.txt"),
        )
        for p in candidates:
            if os.path.isfile(p) and p not in out:
                out.append(p)
    return out


def _normalize_proxy(proxy: str) -> str:
    val = (proxy or "").strip()
    if not val:
        return ""
    if "://" not in val:
        return f"http://{val}"
    return val


def _is_youtube_url(url: str) -> bool:
    u = (url or "").lower()
    return "youtube.com" in u or "youtu.be" in u


def _is_bilibili_url(url: str) -> bool:
    u = (url or "").lower()
    return "bilibili.com" in u or "b23.tv" in u


def _is_douyin_url(url: str) -> bool:
    u = (url or "").lower()
    return any(d in u for d in ("douyin.com", "iesdouyin.com", "v.douyin", "dy.com"))


def _is_xiaohongshu_url(url: str) -> bool:
    u = (url or "").lower()
    return any(d in u for d in ("xiaohongshu.com", "xhslink.com", "xhslink.cn"))


def is_platform_url(url: str) -> bool:
    """检测 URL 是否属于已知需要 yt-dlp 处理的视频平台。"""
    if not url:
        return False
    u = url.lower()
    needles = (
        "bilibili.com", "b23.tv",
        "youtube.com", "youtu.be",
        "douyin.com", "iesdouyin.com", "v.douyin", "dy.com",
        "kuaishou.com", "kwai.com",
        "xiaohongshu.com", "xhslink.com",
        "weibo.com", "weibo.cn",
        "twitter.com", "x.com",
        "tiktok.com",
    )
    return any(n in u for n in needles)


def _bilibili_yt_dlp_extras() -> dict[str, Any]:
    ua = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    )
    return {
        "http_headers": {
            "User-Agent": ua,
            "Referer": "https://www.bilibili.com/",
            "Origin": "https://www.bilibili.com",
        },
        "retries": 5,
        "fragment_retries": 5,
        "extractor_retries": 3,
        "socket_timeout": 40,
    }


def _retryable_download_error(err: Exception) -> bool:
    msg = str(err).lower()
    needles = (
        "unable to download webpage",
        "http error",
        "timed out",
        "timeout",
        "connection refused",
        "connection reset",
        "ssl",
        "403",
        "412",
        "429",
        "503",
        "certificate",
        "temporary failure",
    )
    return any(x in msg for x in needles)


def _clean_ansi(text: str) -> str:
    ansi_escape = re.compile(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])")
    return ansi_escape.sub("", text)


_INTERMEDIATE_STREAM_RE = re.compile(r"\.f\d{3,6}\.[A-Za-z0-9]+$")
_FINAL_MEDIA_EXTS: frozenset[str] = frozenset(
    {".mp4", ".mkv", ".webm", ".mov", ".flv", ".m4a", ".mp3", ".wav", ".aac", ".opus"}
)


def _find_latest_final_media(output_dir: str) -> str:
    """扫描 output_dir 找最新的最终媒体文件（排除带 .fNNNNN.ext 的 yt-dlp 临时流）。

    多流合并下载场景下，progress_hook 只拿到中间流文件名，合并完成不会回调；
    此函数作为磁盘兜底，按 mtime 取最近产出的非中间文件。
    """
    if not output_dir or not os.path.isdir(output_dir):
        return ""
    candidates: list[tuple[float, str]] = []
    try:
        for name in os.listdir(output_dir):
            full = os.path.join(output_dir, name)
            if not os.path.isfile(full):
                continue
            if _INTERMEDIATE_STREAM_RE.search(name):
                continue
            ext = os.path.splitext(name)[1].lower()
            if ext not in _FINAL_MEDIA_EXTS:
                continue
            candidates.append((os.path.getmtime(full), full))
    except OSError:
        return ""
    if not candidates:
        return ""
    candidates.sort(reverse=True)
    return candidates[0][1]


def _transcode_to_mp4_if_needed(path: str) -> str:
    src = (path or "").strip()
    if not src or not os.path.isfile(src):
        return src
    root, ext = os.path.splitext(src)
    if ext.lower() == ".mp4":
        return src
    dst = root + ".mp4"
    try:
        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            src,
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "20",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            dst,
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        os.remove(src)
    except Exception:
        return src
    return os.path.abspath(dst)


def _build_attempts(
    *,
    url: str,
    browser: str,
    proxy: str,
    po_token: str,
    visitor_data: str,
    format_selector: str,
    output_dir: str,
    cookie_base_dirs_list: list[str],
    progress_hook: Any,
    filename_template: str = "%(title)s.%(ext)s",
    retry_count: int | None = None,
    socket_timeout: int | None = None,
    concurrent_fragment_downloads: int | None = None,
) -> list[dict[str, Any]]:
    # outtmpl 由调用者决定模板;默认保留旧硬编码以保证旧调用零行为变化
    base_opts: dict[str, Any] = {
        "outtmpl": os.path.join(output_dir, filename_template or "%(title)s.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "nocheckcertificate": True,
        "ignoreconfig": True,
        "writethumbnail": True,
        "concurrent_fragment_downloads": (
            concurrent_fragment_downloads if concurrent_fragment_downloads is not None else 5
        ),
        "progress_hooks": [progress_hook],
    }
    # 可选数值参数:None 则不写入,避免覆盖 yt-dlp 内部默认;非 None 覆盖对应键
    if retry_count is not None:
        base_opts["retries"] = retry_count
    if socket_timeout is not None:
        base_opts["socket_timeout"] = socket_timeout
    if format_selector:
        base_opts["format"] = format_selector
    normalized_proxy = _normalize_proxy(proxy)

    # 2-B：B站 DASH 分离流下载，提高分片并发从默认5→16，减轻单连接限速
    if _is_bilibili_url(url):
        frag = base_opts.get("concurrent_fragment_downloads", 5)
        if isinstance(frag, int) and frag < 16:
            base_opts["concurrent_fragment_downloads"] = 16

    # 2-C：aria2c 多连接下载器（用户已同意 brew install aria2），未装时自动跳过
    _aria2c_path = shutil.which("aria2c")
    if _aria2c_path:
        base_opts["external_downloader"] = _aria2c_path
        base_opts["external_downloader_args"] = {
            "aria2c": ["-x", "16", "-s", "16", "-k", "1M"],
        }

    attempts: list[dict[str, Any]] = []
    if _is_youtube_url(url):
        extractor_args: dict[str, Any] = {
            "youtube": {"player_client": ["android_vr", "mweb", "web_safari", "web"]}
        }
        if (po_token or "").strip():
            extractor_args["youtube"]["po_token"] = [f"web+{po_token.strip()}"]
        if (visitor_data or "").strip():
            extractor_args["youtube"]["visitor_data"] = [visitor_data.strip()]
        if normalized_proxy:
            base_opts["proxy"] = normalized_proxy
        for cookie_path in _existing_cookie_files(cookie_base_dirs_list):
            attempts.append({**base_opts, "cookiefile": cookie_path, "cookiesfrombrowser": (browser,), "extractor_args": extractor_args})
            attempts.append({**base_opts, "cookiefile": cookie_path, "extractor_args": extractor_args})
        attempts.append({**base_opts, "cookiesfrombrowser": (browser,), "extractor_args": extractor_args})
        attempts.append({**base_opts, "extractor_args": extractor_args})
    else:
        direct_opts = {k: v for k, v in base_opts.items() if k != "proxy"}
        # 非 YouTube（B站/抖音/小红书等国内平台）强制直连：
        # yt-dlp 在未设 proxy 时会读环境变量 HTTP_PROXY/HTTPS_PROXY，
        # 显式设 "" 同时禁用 opts 代理和环境变量代理，避免被终端代理拖死。
        direct_opts["proxy"] = ""
        bili_extras = _bilibili_yt_dlp_extras() if _is_bilibili_url(url) else {}

        def _append_bili_variants(core: dict[str, Any]) -> None:
            if bili_extras:
                attempts.append({**core, **bili_extras})
            attempts.append({**core})

        # B站优先用去掉 format 参数的 attempts（减少 412 重试）
        if _is_bilibili_url(url) and format_selector:
            stripped = {k: v for k, v in direct_opts.items() if k != "format"}
            for cookie_path in _existing_bili_cookie_files(cookie_base_dirs_list):
                _append_bili_variants({**stripped, "cookiefile": cookie_path})
            _append_bili_variants({**stripped})
            _append_bili_variants({**stripped, "cookiesfrombrowser": (browser,)})
            if normalized_proxy:
                ps = {k: v for k, v in direct_opts.items() if k != "format"}
                ps["proxy"] = normalized_proxy
                for cookie_path in _existing_bili_cookie_files(cookie_base_dirs_list):
                    _append_bili_variants({**ps, "cookiefile": cookie_path})
                _append_bili_variants({**ps})
                _append_bili_variants({**ps, "cookiesfrombrowser": (browser,)})
        else:
            for cookie_path in _existing_bili_cookie_files(cookie_base_dirs_list):
                _append_bili_variants({**direct_opts, "cookiefile": cookie_path})
            _append_bili_variants({**direct_opts})
            _append_bili_variants({**direct_opts, "cookiesfrombrowser": (browser,)})

            proxied: dict[str, Any] | None = None
            if normalized_proxy:
                proxied = {**direct_opts, "proxy": normalized_proxy}
                for cookie_path in _existing_bili_cookie_files(cookie_base_dirs_list):
                    _append_bili_variants({**proxied, "cookiefile": cookie_path})
                _append_bili_variants({**proxied})
                _append_bili_variants({**proxied, "cookiesfrombrowser": (browser,)})
    return attempts


# 格式降级链：首选格式不可用时按此顺序回退
_FORMAT_FALLBACK_CHAIN = [
    "bv*+ba/b",                  # B站 DASH：最佳视频 + 最佳音频合并
    "bestvideo+bestaudio/best",  # YouTube DASH：分离流合并
    "worst",                     # 绝对兜底
]


def _find_thumbnail(output_dir: str, video_path: str) -> str:
    """在视频同目录下查找 yt-dlp 下载的封面图。"""
    if not video_path:
        return ""
    stem = os.path.splitext(os.path.basename(video_path))[0]
    for ext in (".jpg", ".webp", ".png"):
        candidate = os.path.join(output_dir, stem + ext)
        if os.path.isfile(candidate):
            return candidate
    # 封面可能被 yt-dlp embedthumbnail 合并，或文件名不匹配；扫描通配
    for ext in ("*.jpg", "*.webp", "*.png"):
        import glob as _glob
        matches = sorted(_glob.glob(os.path.join(output_dir, ext)))
        if matches:
            return matches[0]
    return ""


def run_ytdlp_download(
    *,
    url: str,
    output_dir: str,
    browser: str = "chrome",
    proxy: str = "",
    po_token: str = "",
    visitor_data: str = "",
    format_selector: str = "best",
    cookie_base_dirs_list: list[str] | None = None,
    log: Callable[[str], None] | None = None,
    progress_callback: Callable[[float, str], None] | None = None,
    # 实时下载速度回调（字符串形式，例如 "1.23MiB/s"），供上层写入任务状态供前端展示
    speed_callback: Callable[[str], None] | None = None,
    # R15 在 yt-dlp 第一次拿到 info_dict（progress_hook 收到 info_dict 时）即时回调元数据，
    # 让上层在下载完成前就能把视频标题/封面写进 task.result，前端立刻显示真实标题
    info_callback: Callable[[dict[str, Any]], None] | None = None,
    # 阶段 3(M3)新增:来自 AppSettings.download / 前端 configStore。
    # 默认值沿用旧硬编码,使现有调用点在不传这些参数时行为完全不变。
    filename_template: str = "%(title)s.%(ext)s",
    retry_count: int | None = None,
    socket_timeout: int | None = None,
    concurrent_fragment_downloads: int | None = None,
) -> dict[str, Any]:
    """
    执行多策略 yt-dlp 下载。
    返回: ok, save_path, file_name, error, error_full, percent(最后)
    """
    try:
        import yt_dlp
    except ImportError:
        return {
            "ok": False,
            "save_path": "",
            "file_name": "",
            "error": "未安装 yt-dlp，请运行：pip install yt-dlp",
            "error_full": "",
            "percent": 0.0,
        }

    # ── 抖音 no-cookie 优先路径 ──
    if _is_douyin_url(url):
        if log:
            log("🎵 检测到抖音链接，尝试无 cookie 移动端路径…")
        try:
            from shared.douyin_mobile_share import run_douyin_mobile_download

            dy_result = run_douyin_mobile_download(
                url_or_text=url,
                output_dir=output_dir,
                log=log,
                progress_callback=progress_callback,
                speed_callback=speed_callback,
            )
            if dy_result.get("ok"):
                return dy_result
            if log:
                log(f"⚠️ 抖音移动端路径失败: {dy_result.get('error', '未知')}，回落 yt-dlp…")
        except ImportError as e:
            if log:
                log(f"⚠️ 无法导入 douyin_mobile_share 模块: {e}，回落 yt-dlp…")
        except Exception as e:
            if log:
                log(f"⚠️ 抖音移动端路径异常: {e}，回落 yt-dlp…")

    # ── 小红书 no-cookie 优先路径 ──
    if _is_xiaohongshu_url(url):
        if log:
            log("📕 检测到小红书链接，尝试无 cookie 路径…")
        try:
            from shared.xiaohongshu_share import run_xiaohongshu_download

            xhs_result = run_xiaohongshu_download(
                url_or_text=url,
                output_dir=output_dir,
                log=log,
                progress_callback=progress_callback,
                speed_callback=speed_callback,
            )
            if xhs_result.get("ok"):
                return xhs_result
            if log:
                log(f"⚠️ 小红书路径失败: {xhs_result.get('error', '未知')}，回落 yt-dlp…")
        except ImportError as e:
            if log:
                log(f"⚠️ 无法导入 xiaohongshu_share 模块: {e}，回落 yt-dlp…")
        except Exception as e:
            if log:
                log(f"⚠️ 小红书路径异常: {e}，回落 yt-dlp…")

    dirs = cookie_base_dirs_list if cookie_base_dirs_list is not None else cookie_base_dirs()
    task_state: dict[str, Any] = {
        "status": "starting",
        "percent": 0.0,
        "speed": "0KiB/s",
        "eta": "N/A",
        "save_path": "",
        "file_name": "",
    }

    def _hook(d: dict[str, Any]) -> None:
        # R15 在第一次收到 info_dict 时把元数据即时上报给上层（不等下载完成）
        if info_callback and not task_state.get("_meta_emitted"):
            _info = d.get("info_dict") or {}
            # playlist / multi-entry 取首条
            if "entries" in _info and _info.get("entries"):
                _first = _info["entries"][0] or {}
                _info = {**_info, **_first}
            _title = _info.get("title") or ""
            if _title:
                try:
                    info_callback({
                        "title": _title,
                        "duration": _info.get("duration") or 0,
                        "uploader": _info.get("uploader") or _info.get("channel") or "",
                        "thumbnail_url": _info.get("thumbnail") or "",
                    })
                    task_state["_meta_emitted"] = True
                except Exception:
                    pass  # 回调失败不影响下载

        if d.get("status") == "downloading":
            pct = _clean_ansi(d.get("_percent_str", "0%")).strip()
            speed = _clean_ansi(d.get("_speed_str", "N/A")).strip()
            eta = _clean_ansi(d.get("_eta_str", "N/A")).strip()
            try:
                percent = float(pct.replace("%", ""))
            except ValueError:
                percent = 0.0
            task_state.update({"status": "downloading", "percent": percent, "speed": speed, "eta": eta})
            # 节流：progress/speed 回调会持久化任务 JSON（fsync + 把每条进度写进 log），
            # yt-dlp 下载中每个 chunk 都触发本 hook（分片并发时更密集），若逐 tick 落盘会
            # 让 log 无限膨胀、每次全量重写越来越慢，反过来把下载线程饿死到 KiB/s（速度单调衰减）。
            # 因此对落盘型回调限流为最多每 ~1s 一次；下载完成分支不受影响，保证最终态准确。
            _now = time.monotonic()
            _last = task_state.get("_last_emit_ts", 0.0)
            if percent >= 99.0 or (_now - _last) >= 1.0:
                task_state["_last_emit_ts"] = _now
                if progress_callback:
                    progress_callback(min(0.99, max(0.02, percent / 100.0)), f"{percent:.0f}% {speed} ETA {eta}")
                # 独立地把实时速度字符串回调给上层，便于任务中心展示 MB/s / KB/s
                if speed_callback:
                    speed_callback(speed)
        elif d.get("status") == "finished":
            filename = d.get("filename", "")
            save_path = os.path.abspath(filename) if filename else ""
            task_state.update(
                {
                    "status": "finished",
                    "percent": 100.0,
                    "save_path": save_path,
                    "file_name": os.path.basename(save_path),
                }
            )

    def _pp_hook(d: dict[str, Any]) -> None:
        """postprocessor 完成事件：捕获 Merger/VideoConvertor 输出的最终文件路径。

        多流下载时 progress_hook 拿到的是中间流文件（.fNNNNN.ext），合并后中间文件被清理；
        此 hook 在 postprocessor 结束时覆盖 save_path 为合并后真实存在的文件。
        """
        if d.get("status") != "finished":
            return
        info = d.get("info_dict") or {}
        filepath = info.get("filepath") or info.get("_filename") or ""
        if filepath and os.path.isfile(filepath):
            abs_path = os.path.abspath(filepath)
            task_state["save_path"] = abs_path
            task_state["file_name"] = os.path.basename(abs_path)

    # 构建格式降级链：首选 → fallback1 → fallback2 → ... → worst
    _format_chain = [format_selector]
    for f in _FORMAT_FALLBACK_CHAIN:
        if f != format_selector:
            _format_chain.append(f)

    last_exc: Exception | None = None
    format_errors: list[str] = []

    for fmt_idx, fmt in enumerate(_format_chain):
        if fmt_idx > 0:
            if log:
                log(f"⬇️ 格式降级重试：{_format_chain[0]} → {fmt}")

        attempts = _build_attempts(
            url=url,
            browser=browser,
            proxy=proxy,
            po_token=po_token,
            visitor_data=visitor_data,
            format_selector=fmt,
            output_dir=output_dir,
            cookie_base_dirs_list=dirs,
            progress_hook=_hook,
            filename_template=filename_template,
            retry_count=retry_count,
            socket_timeout=socket_timeout,
            concurrent_fragment_downloads=concurrent_fragment_downloads,
        )
        for opts in attempts:
            opts["postprocessor_hooks"] = [_pp_hook]

        for i, opts in enumerate(attempts):
            if log:
                log(f"尝试策略 {i + 1}/{len(attempts)}（格式: {fmt}）…")
            try:
                info_dict: dict[str, Any] = {}
                with yt_dlp.YoutubeDL(opts) as ydl:
                    # extract_info(download=True) 与 ydl.download 等价，但能返回 info dict
                    info_dict = ydl.extract_info(url, download=True) or {}
                final_path = task_state.get("save_path", "")
                if not final_path or not os.path.isfile(final_path):
                    fallback = _find_latest_final_media(output_dir)
                    if fallback:
                        if log:
                            log(f"路径兜底：hook 路径 {final_path!r} 失效，扫描到 {os.path.basename(fallback)}")
                        final_path = fallback
                converted = _transcode_to_mp4_if_needed(final_path)
                task_state["save_path"] = converted
                task_state["file_name"] = os.path.basename(converted) if converted else ""
                if log:
                    log(f"下载成功：{task_state['file_name']}")
                thumbnail_path = _find_thumbnail(output_dir, converted)
                if thumbnail_path and log:
                    log(f"封面图：{os.path.basename(thumbnail_path)}")
                # 从 info_dict 抽取元数据（标题/时长/上传者），供前端 ProcessingPage 展示
                # 注：playlist / multi-entry 时取 entries[0]
                meta_src = info_dict
                if "entries" in meta_src and meta_src.get("entries"):
                    first = meta_src["entries"][0] or {}
                    meta_src = {**meta_src, **first}
                return {
                    "ok": True,
                    "save_path": converted,
                    "file_name": task_state.get("file_name", ""),
                    "thumbnail_path": thumbnail_path,
                    "title": meta_src.get("title") or "",
                    "duration": meta_src.get("duration") or 0,  # seconds (int/float)
                    "uploader": meta_src.get("uploader") or meta_src.get("channel") or "",
                    "thumbnail_url": meta_src.get("thumbnail") or "",
                    "description": meta_src.get("description") or "",
                    "upload_date": meta_src.get("upload_date") or "",
                    "error": "",
                    "error_full": "",
                    "percent": 100.0,
                }
            except Exception as err:  # noqa: BLE001
                last_exc = err
                low = str(err).lower()
                if log:
                    log(f"策略失败：{str(err)[:200]}")
                if "requested format is not available" in low:
                    continue
                if _retryable_download_error(err):
                    continue
                break  # 退出当前格式的尝试循环，尝试下一个格式

        # 当前格式所有尝试均失败，记录错误
        format_errors.append(f"{fmt}: {str(last_exc)[:200]}" if last_exc else f"{fmt}: unknown")

    full = _clean_ansi(" | ".join(format_errors) if format_errors else str(last_exc if last_exc else "未知错误"))
    return {
        "ok": False,
        "save_path": "",
        "file_name": "",
        "error": full.split("\n")[0][:400],
        "error_full": full,
        "percent": float(task_state.get("percent") or 0.0),
    }


def fetch_ytdlp_metadata(
    url: str,
    *,
    log: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    """只跑 yt-dlp extract_info(download=False) 拿元数据，不下载。

    返回 {"title", "duration", "uploader", "thumbnail_url"}，
    任何字段拿不到就给空字符串/0。失败时返回空 dict（调用方按缺省处理）。
    """
    try:
        import yt_dlp
    except ImportError:
        if log:
            log("⚠️ yt-dlp 未安装，跳过元数据预取")
        return {}

    ydl_opts: dict[str, Any] = {
        "quiet": True,
        "skip_download": True,
        "no_warnings": True,
    }

    cbs = cookie_base_dirs()
    if _is_bilibili_url(url):
        # B站反爬：extract_info 需要专用 header + B站 cookie，否则 HTTP 412（实测）。
        # 与下载路径（_build_attempts）保持同一套配方。
        ydl_opts.update(_bilibili_yt_dlp_extras())
        bili_cookies = _existing_bili_cookie_files(cbs)
        if bili_cookies:
            ydl_opts["cookiefile"] = bili_cookies[0]
    else:
        cookie_files = _existing_cookie_files(cbs)
        if cookie_files:
            ydl_opts["cookiefile"] = cookie_files[0]

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as exc:
        if log:
            log(f"⚠️ 元数据预取失败：{str(exc)[:120]}")
        return {}

    # playlist 取首条
    if info and info.get("_type") == "playlist":
        entries = info.get("entries")
        if entries:
            info = next(entries, None)
    if not info:
        return {}

    return {
        "title": info.get("title") or "",
        "duration": info.get("duration") or 0,
        "uploader": info.get("uploader") or "",
        "thumbnail_url": info.get("thumbnail") or "",
    }
