---
title: Track K · M6 开工卡 — 平台扩展（YouTube/抖音/快手 → 小红书）
status: ready
created: 2026-06-03
parent: docs/plans/track-K-notes-knowledge-base-design-draft.md
exec_env: 终端（小米模型执行）
branch: feat/k-m6-platforms
prereq: M4 已合并；分阶段：先验证 yt-dlp 已支持的平台，小红书图文最后（需装依赖，停下问用户）
---

# 目标（可验证）

让 YouTube / 抖音 / 快手 / 小红书 的链接也能做成笔记。**先验证 yt-dlp 已接入的平台（YouTube/抖音/快手）现状，再啃小红书图文（硬骨头）**。

> 心态：YouTube/抖音/快手 很可能现状已能下（验证为主）；小红书图文是真难点（yt-dlp 下不了图集，要装库 + 抗风控），到那步**停下问用户再装依赖**，卡住如实报、不硬刚。

---

# 现状锚点

| 能力 | 现状 | 位置 |
|---|---|---|
| 通用平台下载 | `is_platform_url` 已含 bilibili/**youtube/douyin/kuaishou/xiaohongshu/tiktok**；`run_ytdlp_download` + YouTube 专门 `player_client` 抗风控 + cookie 支持 | `shared/video_download_ytdlp.py:78` |
| 下载分派 | `handle_download_task` → `is_platform_url(source)` → `run_ytdlp_download` | `pipeline_tasks.py:482,2563` |
| 视频→笔记 | note 任务（download→transcribe→analyze→note），M2 已让视频默认 learning | `handle_note_task` |
| 嗅探 | url_sniffer 已识别这些平台 + 小红书标 image/text/video 混合 | `shared/url_sniffer.py` |
| 小红书图文 | ⚠️ yt-dlp 是视频下载器，**下不了图文笔记的图集** | — |

---

# 执行步骤

## Step 0 · 启动
- 对账（确认 M4 已并入 826cfff），从 main 新建 `feat/k-m6-platforms`；`./dev.sh`。

## Step 1 · 验证 yt-dlp 已支持平台（YouTube/抖音/快手，可能现状已通）
1. 各粘贴一个**短视频**链接（YouTube / 抖音 / 快手），走 note 流程，确认：下载成功 → 转写 → 出笔记（默认 learning）。
2. 记录每个平台：✅通 / ⚠️风控限流（如 YouTube 需 cookie、抖音水印）/ ❌失败原因。
3. 若某平台只差小修（如 meta 标题映射、类型识别），在 Step 2 补；**别为风控硬刚**（cookie/代理类问题如实记录）。

## Step 2 · 小修补齐（按 Step 1，逐项小 commit）
- 给验证中"差一点"的平台补最小改动（meta 映射 / 笔记形态 / 嗅探类型）。
- 不做深度抗风控（cookie 管理、代理池等超出本期）。

## Step 3 · 小红书（硬骨头，最后做）
1. **小红书视频**：先试现有 yt-dlp（is_platform_url 已含 xiaohongshu）能否下，能下就走 note 流程。
2. **小红书图文笔记**（图集+正文）：yt-dlp 下不了 → 需要 `gallery-dl`（图集）或 `xhs` 类库。
   - **⚠️ 装任何新库前，停下来把"要装哪个库、为什么、风险"列给用户，等明确同意再装**（§4 红线）。
   - 风控强（可能要 cookie/签名），下不动就如实报，标记 backlog，不硬刚。

## Step 4 · 验证 + 收尾
- 能跑通的平台：粘贴链接→出笔记；`pytest`(.venv + KMP_DUPLICATE_LIB_OK=TRUE) + `pnpm tsc` 绿；逐项 commit；不 push。

---

# 不在 M6 范围
- 深度抗风控（cookie 池 / 代理轮换）→ 后续。
- 小红书若风控下不动 → 标 backlog，不硬刚。
- 联网问答 → M4 已定不做。

---

# 红线 / 纪律
- **装新依赖（gallery-dl / xhs 等）前必须停下问用户**，列清库名/用途/风险。
- 风控/限流卡住 → 如实报告，不伪造、不硬刚；区分"代码 bug"和"平台风控"。
- 不破坏现有 B站 / yt-dlp 下载链路。
- 改前先解释；pytest 用 .venv；逐项 commit；不 push；拿不准先问。
