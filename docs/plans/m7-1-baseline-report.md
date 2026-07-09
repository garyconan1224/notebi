---
title: M7-1 端到端勘验报告
status: done
created: 2026-06-04
---

# M7-1 端到端勘验报告

## 1. 测试结果总表

| # | 素材 | 预期类型 | sniff 结果 | pipeline 结果 | 问题 |
|---|---|---|---|---|---|
| 1 | `.txt` 本地文件 | text | N/A(upload) | **FAILED** | `text_loader.load_auto()` 不认 `.txt` 扩展名 |
| 2 | `.md` 本地文件 | text | N/A(upload) | **FAILED** | `text_loader.load_auto()` 不认 `.md` 扩展名 |
| 3 | `.pdf` 本地文件 | text | N/A(upload) | SUCCESS | ✅ |
| 4 | `.docx` 本地文件 | text | N/A(upload) | SUCCESS | ✅ |
| 5 | 少数派网页 | text | text ✅ | SUCCESS | ✅ |
| 6 | MBA智库网页 | text | text ✅ | SUCCESS | ✅ |
| 7 | 微信公众号 | text | text ✅ | SUCCESS | ✅ |
| 8 | 小红书图文 | text | text ✅ | SUCCESS | ✅（6 张图 + 正文 306 字） |
| 9 | B站 opus | **text** | **video** ⚠️ | **FAILED** | sniff 误判 → yt-dlp 找不到视频流 |

**通过率：6/9（67%）**。3 个失败各有不同根因。

---

## 2. 关键接入点勘验（精确到 file:line）

### 2.1 `handle_note_task` — 任务编排主函数
- **位置**：`backend/app/services/pipeline_tasks.py:1194`
- **PROBE 阶段**（`:1277-1282`）：**纯占位**，只做状态推进 + 进度条，没有实际媒体嗅探逻辑
- **download 步骤**（`:1247-1275`）：**写死 `run_ytdlp_download`**，没有根据内容类型选适配器
- **steps 默认值**（`:1207`）：`["download", "transcribe", "analyze", "note"]` — text 类不需要 download/transcribe
- **并行执行**（`:1287+`）：transcribe + analyze 可并行（R22），PROBE 结束进度 0.30

### 2.2 `url_sniffer` — URL 类型嗅探
- **位置**：`shared/url_sniffer.py`
- **B站路径规则**（`:40-46`）：只覆盖 `/video/`, `/read/`, `/audio/`, `/bangumi/`, `/list/`，**无 `/opus/`**
- **B站域名默认**（`:26`）：`("bilibili", "video", ["video", "audio"])` → `/opus/` fallback 为 video
- **小红书样板**（`:278-287`）：已实现"解析页面区分图文/视频"，是 M7 PROBE 的参考

### 2.3 `text_loader.load_auto()` — 文本文件加载
- **位置**：`shared/text_loader.py:333`
- **支持**：`.pdf`（`:351`）、`.docx`（`:353`）、URL（`:347`）
- **缺口**：**不认 `.txt` 和 `.md` 扩展名**（`:355-356` 直接 raise）

### 2.4 下载适配器
| 适配器 | 位置 | 用途 |
|---|---|---|
| `run_ytdlp_download` | `shared/video_download_ytdlp.py` | 视频/音频下载（通用） |
| `run_xiaohongshu_download` | `shared/xiaohongshu_share.py:278` | 小红书图文/视频 |
| `bilibili_nocookie` | `backend/app/downloaders/bilibili_nocookie.py` | B站无 cookie 下载 |
| `text_loader.load_url` | `shared/text_loader.py:233` | 网页文章正文提取 |

### 2.5 前端路由 — 4 个独立详情页
- **位置**：`frontend/src/router.tsx:71-109`
- `video_detail` / `image_detail` / `audio_detail` / `text_detail` — M7 需收敛为统一笔记页

### 2.6 `featuresToSteps` — 前端 feature → 后端 steps 映射
- **位置**：`frontend/src/lib/featuresToSteps.ts:95`
- **问题**：始终包含 `download` 步骤（`:96`），text 类不需要

### 2.7 `_bridge_to_pipeline_payload` — workspace item → pipeline payload
- **位置**：`backend/app/routes/workspaces.py:1358`
- text 分支返回 `("text", payload)`（`:1392`），不是 `("note", payload)`

### 2.8 `background_for_recognition` — 周边文字
- **位置**：仅在 `workspaces.py:147-149,1423-1424,1465-1466,1490-1491` 作为 preflight 透传
- **现状**：`pipeline_tasks.py` 中**未消费**此字段 → M7 需要在 PROBE/分析阶段接入

---

## 3. 缺口清单（供 M7-3~6 使用）

### 🔴 P0 必修（阻塞 M7 核心流程）

| ID | 缺口 | 影响 | 建议归属 |
|---|---|---|---|
| G1 | `text_loader.load_auto()` 不认 `.txt`/`.md` | 本地纯文文件全部失败 | M7-3（PROBE + download 泛化） |
| G2 | B站 `/opus/` 无 sniff 规则 | 图文动态误判为 video → yt-dlp 失败 | M7-2（统一入口 + sniff 角色降级） |
| G3 | `handle_note_task` PROBE 是占位 | 无法在下载后识别内容类型 | M7-3（PROBE 核心逻辑） |
| G4 | download 写死 `run_ytdlp_download` | 文章/图文类无法走对应下载器 | M7-3（download 泛化） |
| G5 | 前端 4 个独立详情页 | 无法统一展示笔记 | M7-6（统一笔记页） |

### 🟡 P1 重要（影响体验/正确性）

| ID | 缺口 | 影响 | 建议归属 |
|---|---|---|---|
| G6 | `featuresToSteps` 始终含 download | text 类多跑无意义步骤 | M7-2（统一入口） |
| G7 | `_bridge_to_pipeline_payload` text→"text" | note task 未被触发 | M7-3（PROBE 重算 steps） |
| G8 | `background_for_recognition` 未被消费 | 周边文字未进分析上下文 | M7-3（PROBE 接入） |
| G9 | source_excerpt 丢弃警告 | 摘要要点与原文匹配失败 | 低优，后续优化 |

### 🟢 P2 可延后

| ID | 缺口 | 影响 | 建议归属 |
|---|---|---|---|
| G10 | docx 上传 MIME 映射 | 可能影响类型推断 | M7-2（sniff 角色降级后不重要） |
| G11 | 前端 textarea 直接粘贴入口 | 未测试"直接粘贴文字成笔记" | M7-2 |

---

## 4. 复用确认（对齐开工卡 §5）

| 开工卡标 | 实际勘验 | 结论 |
|---|---|---|
| ✅ 复用 `handle_note_task` 编排框架 | `:1194` 确认，PROBE 占位在 `:1277` | ✅ 可复用，在 PROBE 插入识别逻辑 |
| ✅ 复用下载适配器 | yt-dlp/xhs/text_loader/bilibili_nocookie 全部可用 | ✅ 需要一个调度层选适配器 |
| ✅ 复用短链展开 | xhs `:70` resolve_xhs_share 已验证 | ✅ |
| ⛔ 不复用前期 sniff 定类型 | B站 opus 误判验证了问题 | ⛔ 确认需降级 |
| ✅ 复用 ASR/VLM | pipeline_tasks 已引入 | ✅ |
| 🔶 改写截帧策略 | 未测试（M7-4 范围） | 待 M7-4 |
| ✅ 复用 ln MD/HTML 同步 | 未测试（M7-5 范围） | 待 M7-5 |
| ✅ 复用 14 风格总结 | 未测试（M7-6 范围） | 待 M7-6 |

---

## 5. 结论与下一步

M7-1 勘验确认了开工卡的设计方向正确：
1. **前期 sniff 定类型是根因**——B站 opus 误判直接导致 pipeline 失败
2. **PROBE 阶段是正确的插入点**——位置已就绪，只缺实现
3. **text_loader 需要扩展**——`.txt`/`.md` 是基本需求

**下一步**：按开工卡建议顺序，M7-3（PROBE 内容识别 + download 泛化）是后端核心，建议先做。G1（text_loader 扩展）可在 M7-3 中顺手修。
