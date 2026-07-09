---
title: Track K · M6 小红书集成重构 — 1 个笔记 item + 适配器接入 + 封面/归属修复
status: ready
created: 2026-06-03
parent: docs/plans/track-K-notes-knowledge-base-design-draft.md
exec_env: 终端（小米模型执行）
branch: feat/k-m6-xhs-rework
prereq: xiaohongshu_share 适配器已存在（函数测试过）；本次修"端到端创建"暴露的集成问题
---

# 背景：Desktop 端到端实测（curl + 浏览器）发现的真实问题

粘贴一个小红书分享链接，结果**建了 3 个割裂 item**、适配器没被调用。实测清单：

1. **重复建 3 个 item**：image(done) + text(done) + video(**failed**)。根因：`url_sniffer` 小红书 `possible_types=[image,text,video]`，前端为每个候选类型各建一个 item。
2. **没走 `xiaohongshu_share` 适配器，走了 yt-dlp**：image item 的图是 `_ytdlp_thumbs/…0.jpg`（缩略图、仅 1 张），图集没下全；video item yt-dlp 失败。适配器只接在 `video_download_ytdlp` 下载分派 + `link_preview` 预览，**创建/pipeline 这条线没调到它**。
3. **`results.project_id = "default_project"`**：产物存进 `data/workspaces/default_project/…`，没落当前 workspace（RP1-B 数据错位债）。
4. **item name = URL**（image/text），不是笔记标题。
5. **无封面**：`_cover_thumbnail(rec)`（`backend/app/routes/workspaces.py`）取不到图（图在 default_project + 只缩略图）。
6. **失败任务堆积**：浮动面板"8 进行中 / 7 失败"。
> text item 的 overview 渲染/摘要/标签其实是对的（正文经 background_for_recognition 进了分析）——说明不是全坏，是"创建+下载+归属"这条线错了。

---

# 目标（可验证）

小红书链接 → **1 个「小红书笔记」item** → 用 `xiaohongshu_share` 适配器免 cookie 取**图集 + 正文** → 出图文笔记 → 落**当前 workspace** + **有封面** + 进**资料库**可见、内容正确。

---

# 执行步骤

## Step 0 · 启动
- 对账，从 main 新建 `feat/k-m6-xhs-rework`；`./dev.sh`。

## Step 1 · 定方案（先定位 + 给方案，发我确认再写代码）
1. **收敛成 1 个 item**：查 `url_sniffer` 小红书返回 `[image,text,video]` → 前端（AddMaterialModal/Composer）如何据此建多个 item。定方案：小红书识别为**单一笔记**（建议 `primary_type` 收敛为单一，如 text/image 之一，或加一个"笔记"语义），只建 1 个 item。
2. **走哪个 pipeline**：小红书图文最接近 **M1 的 text 笔记流程**（正文 desc → 详细稿/总结）+ **图集作为附图**（下载到当前 workspace、引用、可选 VLM 描述）。确认现有 text/image pipeline 怎么接"正文+图集"，给最小接入方案。
3. **适配器接入点**：让该 item 的 pipeline 调 `xiaohongshu_share`（取 title/desc/imageList/video），而不是 yt-dlp。
4. 把"收敛方案 + pipeline 归属 + 适配器接入点 + 封面/project_id 修法"写出来发我，确认后再 Step 2。

## Step 2 · 实现（按确认方案，逐项小 commit）
- **P1 单 item**：小红书链接只建 1 个笔记 item。
- **P2 适配器接入**：pipeline 用 `xiaohongshu_share` 取图集+正文 → 图文笔记；不走 yt-dlp、不建 video item。
- **P3 归属**：`project_id`/产物目录落**当前 workspace**（治 default_project）。
- **P4 命名**：item name = 笔记标题（取 `note.title`）。
- **P5 封面**：图集首图（或视频封面）作为 item 封面，确保 `_cover_thumbnail` 取得到。
- **P6 失败任务**：清理/隐藏堆积的失败任务（至少别再建必失败的 video item）。

## Step 3 · 真·端到端验收（关键，不许只函数测试）
- `./dev.sh` 后**在 app 真粘贴**这两个链接创建：
  - 图文：`http://xhslink.com/o/3w7r5xADEqD`
  - 视频：`http://xhslink.com/o/c7LCUZRTFn`
- 断言：**只建 1 个 item** / 走了适配器（图集多张、非 _ytdlp_thumbs）/ project_id=当前 workspace / name=标题 / **有封面** / **进资料库可见** / overview 正文+图集正确。
- `pnpm tsc` + `pytest`(.venv + KMP_DUPLICATE_LIB_OK=TRUE)；逐项 commit；不 push。

---

# 红线 / 纪律
- 零新依赖（requests）；不带用户 cookie（靠分享链接自带 xsec_token）。
- **不破坏其他平台**：B站/YouTube/抖音视频仍走原 video note 流程。
- `__INITIAL_STATE__` 解析容错（抠不到降级 title+og，不崩）。
- Step 1 方案没发我确认前，别动手大改；跨文件改动逐项 commit；不 push。
