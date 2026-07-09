---
title: Track K · M7 统一「笔记」流程改造 — 选笔记即可，下载后内容驱动分析（不前期判类型）
status: superseded
superseded_by: docs/plans/track-K-M7-result-pages-redesign.md
owner: xiaomi mimo v2.5-pro（终端执行）
created: 2026-06-04
updated: 2026-06-04（方向重定：原"纯文页打磨"升级为"统一笔记流程"）
parent: docs/plans/track-K-notes-knowledge-base-design-draft.md
test_fixtures: docs/plans/m7-test-fixtures.md（9 条纯文素材，端到端反复用）
branch: 每个子任务独立分支 feat/k-m7-<n>-xxx，完工各自 merge
ui_source: docs/design/components/{text_detail,processing,preflight}.jsx + LearningNotesPage(ln) + docs/DESIGN_TOKENS.md
prereq: M1–M6 已合 main；ln 页已有「在线编辑 / AI 问答抽屉 / 多格式导出 / MD-HTML 双向同步 / 截图插入」可复用
---

> 🛑 **2026-06-05 SUPERSEDED — 勿按本卡开工**：本卡「统一 note pipeline / 下载后内容驱动分析 / md+html 详细稿 / M8 两两合并 / M9 全混合」方向**已废弃**。当前唯一依据 [`track-K-M7-result-pages-redesign.md`](track-K-M7-result-pages-redesign.md)（单素材 NoteShell：`source.md`+`summaries/*`+`note.md`，剥离复刻，多素材后置）。下方仅作历史参考。

# 0. 方向与北极星（先读，建立心智）

用户决议（2026-06-04）把 M7 从"纯文结果页打磨"升级为**统一「笔记」流程改造**：

> 用户**只选「笔记」**，不前期判类型；系统自己索引/下载；**下载后**按真实内容走不同分析路径；统一产出 **md + html 详细稿**；用户**再选总结**风格；最后是笔记三能力（编辑/问答/导出）。

**为什么这么改**：消除"前期靠 URL 猜类型"的根因——B站 `/opus/`、新平台、各种边缘 case 的误判全部自然消失（下载后内容在手，无需猜）。贴合 Track K 北极星"一切链接 → 笔记"。

---

# 1. 目标流程（核心蓝图）

```
① 选「笔记」───────── 统一入口，不前期猜类型（单 item）
        │
② 索引 / 下载 ──────── 按链接选下载器(B站/yt-dlp/网页/小红书/微信/本地)；短链(b23.tv)先展开
        │              连带抓「周边简介/描述文字」存进结果（背景上下文）
        ▼
③ PROBE 识别形态 + 内容驱动分析（自动）
     📝 文章/文字  → 整理正文（不转写、不截帧）
     🖼 图片/图文  → VLM 视觉识别(描述+OCR) + 配套文字（不转写、不截帧）
     🎬 视频       → 转写 ＋ 按需截帧(文案驱动) ＋ 截到的帧可 VLM 识别
     🎵 音频       → 转写
     （所有类型：周边简介作为分析背景一起喂模型）
        ▼
④ 统一产出「详细稿」= md 文档 ＋ html 双视图（复用 ln 的 MD/HTML 同步）
        ▼
⑤ 用户选总结风格（14 种）→ 出总结
        ▼
⑥ 笔记三能力：编辑 / AI 问答 / 导出(md·Obsidian·PDF)
```

---

# 2. 各内容类型分析路径（在 PROBE 阶段判明形态后自动决定）

| 形态 | 转写 | 截帧 | 视觉模型 | 产出 |
|---|---|---|---|---|
| 文章/文字（公众号/网页/B站专栏/opus/本地 txt-md-pdf-docx） | ✗ | ✗ | ✗ | 正文 → md/html |
| 图片/图文（小红书图文/图集/本地图） | ✗ | ✗ | ✅ VLM 描述+OCR | 图 + 文 → md/html |
| 视频 | ✅ | ✅ 按需(见 §4) | ✅ 截到的帧 | 转写+配图 → md/html |
| 音频 | ✅ | ✗ | ✗ | 转写 → md/html |

---

# 3. 两个横切设计

## 3.1 周边简介/背景文字一起抓
下载时连带把**简介/描述/周边文字**抓下来（视频简介、小红书正文、B站简介、公众号摘要等），存进结果，**分析/总结时作为背景上下文**喂模型。
→ 复用并扩展现有 `background_for_recognition`（M6 已有"正文进分析"概念，M7-1 勘验确认其存储与接入点）。

## 3.2 模型前期配置、自动调用
视觉模型(VLM)、转写(ASR)、文本模型(LLM) 在**设置→模型与渠道**里前期配好，笔记流程**自动读取调用**，用户不用每次选。
→ 现状已支持：`pipeline_tasks.py:1220-1221` 已从 `settings.vision_model/text_model` 读取。沿用。

---

# 4. 视频「按需截帧」设计（文案驱动，本 phase 唯一较新的逻辑）

不再"全截"，改"哪段文案需要配图就截哪里"，4 步：

1. 视频转写 → 拿到**带时间戳字幕**（现有 `transcript_segments`）
2. 把字幕喂 LLM，判断**哪些时间点需要配图**（讲到画面/操作步骤/图表/关键概念处）→ 返回时间戳列表
3. ffmpeg 在这些时间戳**定点截帧**（复用现有截帧底层，改为按 timestamp 单帧抽取）
4. 帧插入文案对应位置（复用 ln 的"截图插入笔记"能力）

**兜底**（必须实现）：LLM 判不出配图点 / 调用失败 → 回退"截关键镜头"(PySceneDetect) 或纯文字不配图。绝不因为判点失败而整条任务失败。

---

# 5. 复用决策（mimo 必读：复用 / 新写 / 别碰）

> **最强支点**：`handle_note_task` 在 download 后、分析前**已有 `PROBE` 占位阶段**（`pipeline_tasks.py:1277-1282`，注释写明"未来可接入媒体嗅探"）。M7 的"下载后识别→决定路径"**插进这里**，编排框架不重写。

| 环节 | 现有资产（精确位置） | 处理 |
|---|---|---|
| 任务编排框架 | `handle_note_task` `pipeline_tasks.py:1194`；steps 变量 `:1207`；PROBE `:1277` | ✅ **复用+在 PROBE 插入"识别→重算 steps"** |
| download 步骤 | `:1247` 写死 `run_ytdlp_download` | 🔶 **泛化**为"按内容选适配器" |
| 下载适配器 | `backend/app/downloaders/`（B站/yt-dlp/Article/Xhs）、`shared/xiaohongshu_share.py` | ✅ 复用 |
| 短链展开 | `url_sniffer.py` `_http_get_sniff:224`（已 `allow_redirects=True`） | ✅ 复用 |
| 前期类型判断 | `url_sniffer.sniff_url:252` | ⛔ **不再前期定 item 类型**；只保留"选下载器+短链展开" |
| 转写 ASR | `asr_fast_whisper`（`:1293` 引入） | ✅ 复用 |
| 视觉 VLM | `settings.vision_model`（`:1220`） | ✅ 复用 |
| 全截帧策略 | PySceneDetect/按秒（analyze 块 `:1393+`） | 🔶 ffmpeg 底层复用，"全截"换"按需"(§4) |
| LLM 判配图点 | — | 🆕 **新写**（唯一较新逻辑） |
| 背景文字 | `background_for_recognition`（位置待 M7-1 勘验） | ✅ 复用+扩展 |
| md/html 详细稿 | ln 页 MD/HTML 双视图+同步（`LearningNotesPage`，计划 `rp1-b3-html-md-sync.md`） | ✅ 复用 |
| 14 风格总结 | `SummariesTab`、`summary_generator`/模板 | ✅ 复用 |
| 问答/编辑/导出 | `ChatDrawer.tsx`(`workspaceId+systemPrompt`)、`patchLnMarkdown`、`av_synthesis/{pdf,docx}_builder.py` | ✅ 复用 |

## ⛔ 明确"不复用、改写"（硬复用会引 bug）
1. **前期 sniff 建多 item 的投入分发**（`AddMaterialModal`/`Composer`/`MaterialCard.resolveItemRoute:57`）→ 改成"选笔记=单 item"。
2. **"全截帧"策略** → 换按需（ffmpeg 底层留用）。
3. **结果页"按类型分 4 页"分发**（`router.tsx` 4 个 `*_detail`）→ 收敛到一个"笔记页"（泛化 ln：文章笔记隐视频区、图文笔记显图集区、视频笔记显视频+按需图）。否则又回类型分叉老路。

---

# 6. sniffer 角色降级
`url_sniffer` 不再用于"前期决定 item 类型"，仅保留两个轻用途：① 把短链(b23.tv 等)展开成真实 URL；② 给下载层一个"先用哪个适配器"的提示。真正类型判断在 PROBE 阶段（下载后）做。
→ B站 `/opus/` 不再需要单独加规则，被"下载后识别"自然覆盖。

---

# 7. 子任务拆分（一个会话做一个；推荐顺序，可调）

| # | 子任务 | 改哪 | 复用 | 验证 |
|---|---|---|---|---|
| **M7-1** | 端到端勘验（基线） | 只读/极小改 | — | 9 条素材各跑一遍，记现状+接入点+缺口 |
| **M7-3** | PROBE 内容识别 + download 泛化（后端核心，建议先于前端） | `pipeline_tasks.py` PROBE/download | 编排框架+适配器 | 各形态链接 download 后能识别+走对路径，pytest |
| **M7-2** | 统一「笔记」入口 | `AddMaterialModal`/`Composer`/sniff 角色/`featuresToSteps` | 投入 UI 外壳 | 选笔记=单 item，短链展开，抓到背景文字 |
| **M7-4** | 视频按需截帧 | 截帧+新判点逻辑 | 转写/ffmpeg/VLM/ln插图 | 视频笔记按文案配图，兜底生效 |
| **M7-5** | 统一详细稿 md+html | 详细稿产出 | ln MD/HTML 双视图 | 四形态都出 md+html，双向同步 |
| **M7-6** | 选总结 + 笔记页三能力 | 收敛统一笔记页 | 14风格/ChatDrawer/patch/导出 | 选总结、编辑、问答、导出 md/Obsidian/PDF |
| **M7-7** | 端到端验收 + 文档同步 | 文档 | — | 9 条回归 + 更新 EXECUTION_PLAN/COMPLETED_WORK/PROJECT_STATUS/FEATURE_MAP |

> 跑完 M7 后：M8=两两合并(图文/视频+文案)，M9=全混合(图+视频+文字)。

---

# 8. 第一个子任务详展 · M7-1 端到端勘验

**目的**：先看清现状，把 M7-3~6 的接入点和缺口钉死（后续子任务的依据）。**不大改代码**。

## Step 0 启动
- `git status` + `git log --oneline -20` 对账；从 main 新建 `feat/k-m7-1-baseline`；`./dev.sh`。

## Step 1 跑 9 条素材（在 app 真操作，见 `m7-test-fixtures.md`）
本地 4（txt/md/pdf/docx）+ 网页 2（少数派/MBA智库）+ 小红书 1 + 公众号 1 + B站 opus 1。
逐条记录：投入弹窗 → ProcessingPage（步骤/PROBE 表现）→ 结果页（内容/类型对不对）。

## Step 2 勘验关键接入点（精确到 file:line，供 M7-3~6 用）
- `handle_note_task` PROBE 阶段现状（`:1277`）、steps 怎么流转、download 怎么写死 yt-dlp（`:1247`）
- `background_for_recognition` 存哪、怎么进分析
- 各 downloader 适配器入口；小红书"下载后判型"现成样板（`url_sniffer.py:279`）
- ln 的 MD/HTML 同步 + 截图插入接入点

## Step 3 产出勘验结论
- 一份「M7-3/4/5/6 改动项 + 精确接入点 + 缺口」清单，发用户确认后再开 M7-3。

---

# 9. mimo 执行协议 + 红线

- **启动**：每个子任务先跑启动对账（`git log`），读本卡对应段 + `m7-test-fixtures.md`，**不整文件读大文件**（`rg -n` 定位再读片段）。
- **不确定就停**：实际代码与本卡接入点不符、或方案有歧义 → **停下问用户**，按 CLAUDE.md §4 求证模板，**不自作主张**。
- **复用优先**：§5 标 ✅ 的一律先找现成件，不重造；标 ⛔ 的按"改写"处理，别硬接。
- **验证**：`pnpm tsc` + `pytest`（`.venv` + `KMP_DUPLICATE_LIB_OK=TRUE`）+ `./dev.sh` 真端到端；改 UI 先读 `DESIGN_TOKENS.md` + 设计稿。
- **红线**：装新依赖(如截帧/PDF 需要的库)先停下问；一个会话一个子任务、逐项小 commit；**不主动 push**；不改 .env；复杂子任务(M7-3/M7-4)受阻可建议升级 Opus。
