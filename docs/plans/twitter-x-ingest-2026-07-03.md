# 接入 X（Twitter）帖子：正文 + 视频分析 + 合并总结

> 计划日期：2026-07-03
> 执行者：小米（终端）；审查：Codex
> 状态：待执行

---

## 1. 背景

用户希望粘贴一条 X（Twitter）帖子链接（示例：`https://x.com/Etudecn/status/2072321319140782304`），系统能：

- **视频帖**：拿到帖子正文文字 + 下载帖子里的视频 → 走现有 ASR + VLM 帧分析 → **把帖子正文一起并入合并总结**。
- **图文帖**（无视频，只有文字/图片）：参考现有**小红书图文**路径落地（标题 + 正文 + 图片，走 LLM 总结/风格化）。

产品决策（用户已拍板）：

1. 视频帖 + 纯图文帖**都做**。
2. **只支持公开可匿名下载**的帖子；私密/受限帖友好报错即可，不做 cookie 兜底。
3. 图文帖**参考小红书图文**（同一套 `image_text_service` 路径）。

---

## 2. 根因 / 现状（已实测，非猜测）

现状：项目**已具备**所需的全部处理能力，仅缺 X 平台的识别与抓取接入。

| 能力 | 现状 | 证据 |
|---|---|---|
| 视频下载 | `yt-dlp` 2026.03.17，其 Twitter extractor 匿名可用 | 实测 `extract_info` 返回 `extractor_key=Twitter`、`title`、`description`（完整正文）、`duration=2678s`、`formats` 非空 |
| 视频分析 | `av_combined` 路径已实现 ASR→VLM 帧→LLM 合并总结 | `backend/app/services/pipeline_tasks.py` `_generate_combined_summary` / `_build_combined_summary_prompt` (~L944–1018)、av_combined 分支 (~L1079–1177) |
| 图文抓取框架 | `image_text_service` 已有平台分发（xiaohongshu / bilibili / generic） | `_detect_platform` + `_dispatch_fetch`，统一返回 `{title, paragraphs, images, ...}` 交 `note_assembler` |
| X 图文匿名抓取 | Twitter syndication API 匿名可用 | 实测 `GET https://cdn.syndication.twimg.com/tweet-result?id=<id>&token=<算法token>&lang=en` 返回 `text`/`photos`/`video`/`user`/`mediaDetails` 全字段 |

**缺口**：两张平台表（后端 `_PLATFORM_HOST_MAP`、sniffer `_PLATFORM_DOMAIN_KEYWORDS`）+ 前端 `platformPrefixFromUrl` 均**未收录** x.com / twitter.com；无 X 抓取适配器；合并总结未纳入"帖子正文"。

---

## 3. 修复方案（4 块，按依赖顺序）

### 块 1 · 平台识别加 X（`twitter`）

- 后端 `backend/app/routes/workspaces.py` `_PLATFORM_HOST_MAP`：新增 `(("x.com", "twitter.com"), "twitter")`。
- `shared/url_sniffer.py` `_PLATFORM_DOMAIN_KEYWORDS`：新增 `"x.com"` / `"twitter.com"` → `("twitter", "video", ["video", "image_text"])`（默认按视频，后续块 3 精细分流）。
- 前端 `platformPrefixFromUrl`（与后端同语义处，`frontend/src` 内搜 `platformPrefixFromUrl`）：加 x.com / twitter.com → `twitter`，保证 UI 平台前缀显示一致。

### 块 2 · 新建 X 抓取适配器 `shared/twitter_share.py`

- 仿 `shared/xiaohongshu_share.py`，对外暴露两个函数：
  - `fetch_twitter_meta(url) -> dict`：调 syndication API，返回原始 `{text, photos, video, user, id_str, ...}` 的规范化视图（含 `has_video: bool`、`author: str`）。供 sniff 分流与"帖子正文"注入使用。
  - `fetch_twitter(url) -> dict`：图文路径用，返回与 `fetch_xiaohongshu` **完全一致的结构** `{ok, title, paragraphs, images, ...}`，`images` 走本地下载缓存（复用 xhs 的图片下载模式）。
- token 算法：`n = (int(id)/1e15) * pi`，取 `n` 的 JS `Number.toString(36)` 去掉 `0.` / `.`（计划已验证可用，实现时把算法封为内部函数并加单测）。
- 私密/受限帖：syndication 返回非 200 或缺 `text` 时，返回 `{ok: False, error: "该 X 帖子不可匿名访问（可能为私密/受限）"}`。

### 块 3 · sniff 分流：视频帖 vs 图文帖

- `shared/url_sniffer.py` `sniff_url`：命中 `platform == "twitter"` 时，调 `fetch_twitter_meta` 判断：
  - `has_video == True` → `primary_type="video"`（交给 yt-dlp 下载 + av_combined）。
  - 否则 → `primary_type="text"`（图文）。
- `backend/app/routes/workspaces.py` `_IMAGE_TEXT_PLATFORMS`：加入 `"twitter"`，使 `primary_type=text` 的 X 帖子 override 落为 `image` 类型（与小红书同处理）。
- `backend/app/services/image_text_service.py`：
  - `_detect_platform` 加 `twitter` 分支（host 含 `x.com`/`twitter.com`）。
  - `_dispatch_fetch` 加 `if platform == "twitter": from shared.twitter_share import fetch_twitter; return fetch_twitter(url)`。

> 注意：sniff 阶段调 syndication 是一次额外网络请求，需加超时（≤10s）与 try/except 兜底；失败时退回 `primary_type="video"`（yt-dlp 兜底），不要让整个 sniff 抛错。

### 块 4 · 帖子正文注入合并总结

- 目标：视频帖走 av_combined 时，最终 LLM 合并总结里包含"帖子正文 + 语音转写 + 画面分析"。
- 在 download / av_combined 阶段把 X 帖子正文（yt-dlp 的 `description` 或 `fetch_twitter_meta` 的 `text`）挂到任务产物元数据（参考现有 R13.1 "继承 download 阶段 yt-dlp 视频元数据"的机制，`pipeline_tasks.py` ~L301）。
- `_build_combined_summary_prompt`（~L988）：当存在帖子正文时，作为独立段落（如「【原帖正文】…」）拼进 prompt，位置在 transcript / 帧描述之前，作为背景上下文。
- 仅当来源平台为 twitter 且有正文时启用，**不影响** bilibili/youtube 等既有视频总结行为。

---

## 4. 涉及文件清单

| 文件 | 改动 |
|---|---|
| `backend/app/routes/workspaces.py` | `_PLATFORM_HOST_MAP` + `_IMAGE_TEXT_PLATFORMS` 加 twitter；正文元数据透传（块 4） |
| `shared/url_sniffer.py` | `_PLATFORM_DOMAIN_KEYWORDS` 加 X；`sniff_url` twitter 分流 |
| `shared/twitter_share.py` | **新建**：syndication 抓取 + 图文结构化 + token 算法 |
| `backend/app/services/image_text_service.py` | `_detect_platform` / `_dispatch_fetch` 加 twitter |
| `backend/app/services/pipeline_tasks.py` | `_build_combined_summary_prompt` 注入帖子正文；download 阶段透传正文 |
| `frontend/src`（`platformPrefixFromUrl`） | 前端平台前缀加 x.com/twitter.com |
| `backend/tests/…` | 新增 twitter_share token + 结构单测；sniff 分流单测 |

预计 5–7 个文件。**≥5 文件触发风险求证**：本计划已列全，执行中若发现需改计划外文件（尤其 schema / 前端提交流程），先回报再动。

---

## 5. 验收标准

自验（小米必须自己跑并附数据，不许只看代码）：

1. **视频帖**：`https://x.com/Etudecn/status/2072321319140782304`
   - sniff 判为 `video`，平台前缀 `twitter`。
   - av_combined 产出合并总结，且总结内容**可见帖子正文要点**（Anthropic 工程师 45 分钟搭 5 个 AI 助手）+ 视频语音/画面信息。
2. **图文帖**：找一条只有文字/图片、无视频的公开 X 帖
   - 落为 `image` 类型，产出 `{title, paragraphs, images}`，图片本地缓存成功，走小红书同款 note 总结。
3. **私密/受限帖**：友好报错，pipeline 不崩、不写脏数据。
4. **回归**：bilibili / youtube / 小红书 各跑一条，行为无变化（尤其合并总结未被块 4 污染）。
5. `cd backend && pytest`（带 KMP 环境）全绿；`cd frontend && npm run build` 通过。

---

## 6. 给小米的执行须知与红线

- **自验强制**：token 算法、syndication 结构、yt-dlp 抓取都要**自己跑一遍打印结果**再写代码，禁止凭记忆猜字段名。
- **网络请求全部加超时 + try/except 兜底**，任何抓取失败不得让 sniff / pipeline 抛未捕获异常。
- **不改 schema、不改 `.env`、不装新依赖**（yt-dlp 已装）。syndication 用标准库 `urllib`/现有 `requests`，不引第三方 twitter 库。
- **不动既有 bilibili/youtube/xhs 分支逻辑**，X 分支必须是**增量**；块 4 的正文注入用平台条件 gate 住。
- 后端验证前先确认 uvicorn 是**新进程**（含 `--reload` / `.venv`），别在旧进程上验（见项目历史教训）。
- 遇到实际代码与本计划不符、或需跨计划外文件，按 CLAUDE.md §5 求证格式**先停下问**，不要自行扩范围。
