---
title: Track K · R4.6.1 修复 B站时长探测（HTTP 412 → 复用 B站 cookie+extras）
status: ready
owner: mimo 执行（Claude 已定位 + 实测验证）
depends_on: R4.5（probe-duration 依赖的 fetch_ytdlp_metadata）
created: 2026-06-10
---

# Track K · R4.6.1：修复 B站视频时长探测

> 📌 给 mimo：改 `shared/video_download_ytdlp.py` 1 个函数的 cookie/opts 段。根因已定位、修复已实测有效，照抄即可。1 commit。

---

## 0. 现象 & 根因（已实测，不用再查）

- **现象**：「添加素材」取画面卡片一直显示「识别后显示」，没有预估帧数 → `probeDuration` 返回 0。
- **根因**：`fetch_ytdlp_metadata`（`shared/video_download_ytdlp.py:594`）对 B站链接报 **HTTP 412（反爬）**，返回空 dict → duration=0。它用了**通用 cookie**（`_existing_cookie_files`，本机返回空 []）+ **没加 B站 extras**；而 B站需要**专用 cookie**（`_existing_bili_cookie_files` → `data/cookies/www.bilibili.com_cookies.txt`，存在）+ `_bilibili_yt_dlp_extras()` 的 header。下载路径用对了、元数据函数漏了。
- **实测**：加上 B站 cookie + extras 后，`extract_info` 成功，`duration=77.136`、标题正确。

---

## 1. 改动（`shared/video_download_ytdlp.py` 的 `fetch_ytdlp_metadata`）

把函数内构造 `ydl_opts` + 选 cookie 的那段（约 `:611–621`，即 `ydl_opts = {...}` 到通用 cookie 那几行）**整段替换**为：

```python
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
```

> `_is_bilibili_url` / `_bilibili_yt_dlp_extras` / `_existing_bili_cookie_files` / `_existing_cookie_files` / `cookie_base_dirs` 都是**同文件已有的模块级函数**，直接调即可，不用 import 新东西。函数其余部分（extract_info、playlist 取首条、return）保持不动。

---

## 2. 验证（自己跑，报结果）

```bash
KMP_DUPLICATE_LIB_OK=TRUE /Users/conan/Desktop/nibi/.venv/bin/python -c "
from shared.video_download_ytdlp import fetch_ytdlp_metadata
m = fetch_ytdlp_metadata('https://www.bilibili.com/video/BV15r766EEg8')
print('duration:', m.get('duration'))
"
```
- 期望：打印 `duration: 77.136`（或其它非 0 秒数），**不再是空/0**。
- 若仍报 412 或 0 → 确认 `data/cookies/www.bilibili.com_cookies.txt` 存在；不存在就停下来告诉用户「需要先有 B站 cookie 文件」（别自己造 cookie）。

---

## 3. 提交 + 红线

提交：`fix(k-10.R4.6.1): B站时长探测复用专用 cookie+extras — 修 HTTP 412`，带 Co-Authored-By，**不要 push**。

红线：
- ❌ 只改 `fetch_ytdlp_metadata` 这一个函数的 opts/cookie 段，别动 `run_ytdlp_download` / `_build_attempts` 等下载路径。
- ❌ 不引入新依赖、不碰 `data/cookies/`、不造 cookie。
- ⚠️ 改完跑 §2 验证脚本确认拿到非 0 时长再 commit；前端不用动（probeDuration 会自动拿到正确时长）。
