---
title: Track K · M7 结果页信息架构 + 分类型重设计（调研 + 设计细化，未开始搭建）
status: draft
owner: 待定
created: 2026-06-05
parent: docs/plans/track-K-M7-result-abilities-kickoff.md
relates: 当前分支 feat/k-m7-ability-1-text-chat（M7 三能力：编辑/问答/导出，T1/T2 已合）
note: 本文是「调研 + 设计细化」草案，未动任何业务代码。当前新增要求：单素材先做；每份笔记以 source.md → 风格 summaries → note.md 为内容层；统一支持选择总结风格、WYSIWYG 富文本编辑、Markdown 源码/对照、AI 问答与导出。
---

# 0. 背景：用户提的三个需求

1. **合并「任务中心」与「打开详情」**——现在需要点两层，且内容重复（标签、摘要看两遍）。
2. **调研市面笔记软件**（含 GitHub / BiliNote），看布局、UI、还缺哪些功能。
3. **在同一 NoteShell 下分内容形态设计笔记页**：纯文字 / 图片 / 图文 / 音频 / 视频笔记 / 带关键帧的视频笔记。
4. **所有 md 笔记都要有富文本/源码/对照**：一键切换即可在 WYSIWYG 富文本里编辑，也能看原始 Markdown 源码，并在桌面对照当前笔记与 Markdown/source 原文，方便在 nibi 内修改，也方便 Obsidian / 其他 AI 软件接力分析。

---

# 1. 现状盘点（事实，已核对代码）

## 1.1 当前信息架构 = 两层中转

```
任务中心(列表页)
  └─[点 item]→ /overview  ResultsOverview(index.tsx, 603行)
                 内容标签 + 「内容摘要」+ 统计(时长/字符数/关键帧/转录段落) + 入口按钮
  └─[点「打开详情」大按钮]→ 各 detail 页：
        video → /result        VideoResultPage   (1331行)
        image → /image_result  ImageResultPage   ( 621行)
        audio → /audio_result  AudioResultPage   ( 772行)
        text  → /text_result   TextResultPage    ( 771行)
        统一笔记能力来源（当前分散）：
          /ln           LearningNotesPage      视频伴随 + 编辑/问答/导出
          /av-synthesis AVSynthesisResultPage  md渲染 + TOC + 导出
```

- `ResultsOverview` 按 `item.type`（video/audio/image/text）取对应 result，状态机 loading/ready/processing/task_failed/error。
- `resolveDetailRoute`：video 走 `/result`，其余走 `DETAIL_ROUTE[type]`。

## 1.2 各结果页能力矩阵（M7-1 已勘验 + 本次复核）

| 页面 | 当前主体内容 | 当前编辑 | 当前AI问答 | 当前导出 | 目标笔记页怎么收 |
|---|---|---|---|---|---|
| TextResultPage | 全文 + 摘要 + 标签；代码里另有 SummariesTab / 联想 / 改写 / 翻译 / 多文对比 / 提示词版本栈 | ✓(T2，正文 textarea 自动保存) | ✓(T1，`NoteChatDrawer` inline) | md, Obsidian；PDF 缺 | **单篇笔记主线只保留摘要 + 全文 + 标签**；风格总结作为版本/模板能力接入；多文对比/改写翻译等移到工具入口或工作区能力 |
| VideoResultPage | summary / transcript / 字幕 / 关键帧；同时混有复刻包、提示词、提示词编辑 | ✗（只有复刻提示词编辑，不算笔记编辑） | ✗ | 字幕 + 复刻包 | 笔记页只收 summary + transcript + 字幕 + 可选关键帧 inline；复刻包/提示词全部留复刻线 |
| ImageResultPage | 原图 / 描述 / OCR / EXIF / 标签；同时以提示词 tabs 为主，另有多图对比 | ✗ | ✗ | 隐藏 | 图片笔记分两类：**文字图先 OCR 成 md 正文，再生成摘要和标签**；非文字图作为正文 inline 配图 + alt/描述元数据；**不收多图对比、不收提示词** |
| AudioResultPage | 播放器 / 转录 / 摘要 / 说话人 / 音乐分析 / 字幕；另有 `prompts` tab | 转录段/说话人可编辑，但不是整篇笔记编辑 | ✗ | 仅字幕 | 音频笔记收摘要 + 转录全文 + 标签 + 伴随播放器；说话人/音乐分析作为可折叠辅助；`prompts` 属复刻线 |
| LearningNotesPage(`/ln`) | `ln.md` + 阅读/MD切换 + 视频伴随区 + 转录轴 + 截图插入 + ChatDrawer + 多格式导出 | ✓ | ✓ | 多格式 ✓ | 产品上与 `/av-synthesis` 属于**同一套统一笔记能力**的一部分：它提供视频伴随、编辑、问答、截图等能力 |
| AVSynthesisResultPage(`/av-synthesis`) | `av_synthesis.md` 渲染 + 目录 + Markdown/PDF/Word/Obsidian 导出 | ✗（当前分支未见 PATCH/编辑器） | ✗（当前分支未见 ChatDrawer） | 多格式 ✓ | 产品上与 `/ln` 属于**同一套统一笔记能力**的一部分：它提供综合 md 渲染、TOC、导出能力；未来应收进同一 NoteShell |

> 代码复核结论（2026-06-05）：当前代码里 `/ln` 和 `/av-synthesis` 是两条路由、两份 md 来源；但**产品目标不是两种东西**。用户已确认：两者都应收敛为同一套统一笔记页能力——已有 md 作为源内容，再做风格总结、WYSIWYG 编辑、富文本/Markdown/source 对照、AI 问答和导出。报告后续按“代码分散、产品统一”处理。

## 1.3 三大痛点

- **P1 双层重复**：overview 的「标签 + 内容摘要」与 detail 的「摘要/正文预览」是同一份内容，看两遍、点两次。
- **P2 形态割裂**：5 个结果页各写各的壳（顶栏、加载态、收藏、导出按钮位置都不一致），无统一骨架，加一个能力要改 5 处。
- **P3 单篇笔记过载**：Text/Image 页把“单篇笔记”和“工作区工具能力”（多文/多图对比、联想、改写、提示词版本）放在一起，用户读一篇笔记时噪音过多；但“风格总结”本身是笔记能力，应以版本/模板方式进入统一笔记页。
- **P4 笔记/复刻混线**：Video/Image/Audio 页混入提示词、复刻包、提示词版本栈。提示词属于复刻链路，不属于笔记链路；结果页也应分开。

## 1.4 ⚠️ 底层数据现状：没有"统一 md 底座"（关键，影响新模型可行性）

用户心智模型 = **先有原始依据 md，再按风格总结，最后形成可编辑主笔记**。但核查 `services/workspaces.ts`，现状仍是各类型分散字段 + 两个 md 能力页，并未统一到 `source.md + summaries/* + note.md`：

| 类型 | 现有字段 | 有统一 md 笔记吗 |
|---|---|---|
| TextResult | `content`(全文) + `summary`(结构化) | 接近(content) |
| VideoResult | `frames[]` + `transcript[]` + `summary` | ✗ 分散 |
| AudioResult | `transcript` + `transcript_segments` + `summary` | ✗ 分散 |
| ImageResult | `description` + `ocr_text` | ✗ 分散 |
| LearningNotesPage(`/ln`) | `ln.md` / fallback video summary | ✓ 有 md 读写能力，但仍未统一到 `source.md + summaries/* + note.md` |
| AVSynthesisResultPage(`/av-synthesis`) | `av_synthesis.md` | ✓ 有 md 渲染/导出能力，但仍未统一到 `source.md + summaries/* + note.md` |

**结论**：要落地统一笔记模型，需后端先做**归一化**——每个单素材都产出/组装 `source.md + summaries/* + note.md + frontmatter`。现有 `/ln` 和 `/av-synthesis` 都证明 md 路线可行，但它们只是能力来源，不能继续作为两套产品概念。新增前置 **R0**（见 §6）。

---

# 2. 竞品调研

## 2.1 BiliNote（6000+ stars，业内首个视频转笔记，技术栈与 nibi 同：React19+FastAPI）

**布局**（`HomeLayout`，单页无中转层）：
```
[ NoteForm 输入 ] | [ MarkdownViewer 笔记正文(中心) ] | [ History 历史 ]
```

**笔记正文（MarkdownViewer）的关键设计**——直接可借鉴：
- **时间戳→可点 chip 跳原片**：正文里 `[00:00]` 渲染成圆角蓝 chip + ▶ 图标，点击跳视频对应秒。
- **目录锚点跳转**：heading 带 `scroll-m-20`，目录点击平滑滚动定位。
- **图片可缩放**（cursor-zoom-in）、代码块带复制、外链 ExternalLink。

**笔记顶栏（MarkdownHeader）**：左侧 = 版本 chip + 标签 + 创建时间 + **风格名**；右侧 = 复制 / 导出 Markdown。

**侧边能力**（components/）：`MarkmapComponent` = **脑图/思维导图**（markmap）、`ChatPanel` = RAG 问答（Function Calling 可查原文）、`transcriptViewer` = 转录、`StepBar` = 进度、`VideoBanner` = 视频横幅。

**功能特性**：多平台(B站/油管/抖音/快手/本地)、**笔记格式选择 + 风格选择**、多模态理解、**多版本记录**、自动截图、原片跳转、RAG 问答、浏览器插件(Markdown/脑图/问答四件套)。

## 2.2 GitHub / 开源项目补充调研（2026-06-05）

| 项目 | 相关方向 | 可借鉴点 | 对 nibi 的规划结论 |
|---|---|---|---|
| [BiliNote](https://github.com/JefferyHcool/BiliNote) | 视频 → Markdown 笔记 | README 明确支持结构化 Markdown、插入截图、原片跳转、AI 问答、多版本、浏览器插件四件套 | nibi 的视频/音视频笔记也应保持“正文为中心 + 时间戳跳原片 + 问答 + 导出”，而不是把提示词当主体 |
| [NoteIt](https://zhaorunning.github.io/NoteIt/) | 论文型“教学视频 → 可交互笔记” | 五段 pipeline：视频解析 → 层级结构 → 关键视觉信息 → note schema → 可交互 UI；UI 支持 text-only / text-image、concise / verbose、printable / interactive | nibi 可以把“富文本/MD源码/对照”理解成同一内容源的不同编辑/呈现方式；视频笔记应有章节/步骤结构和关键帧 inline，而不是只堆 transcript |
| [TubeSage](https://github.com/rmccorkl/tubesage) | Obsidian YouTube 笔记插件 | 提取 transcript、生成摘要、可选 timestamp links、按文件夹输出到 vault、支持多 provider 和本地 Ollama | nibi 的 `note.md` 应直接面向 Obsidian 接力：时间戳用标准链接/可解析语法，导出包少做私有结构 |
| [Obsidian Media Notes](https://github.com/jemstelos/obsidian-media-notes) | 媒体伴随笔记 | `media_link` frontmatter + 固定播放器；正文时间戳链接点击跳播放器；播放器和正文并存 | nibi 的音/视频 companion 设计是对的；frontmatter 应保存 `media.video/audio` 与 transcript timeline |
| [Open Notebook](https://github.com/lfnovo/open-notebook) | NotebookLM 开源替代 | 多 notebook、PDF/视频/音频/网页/Office 等 universal content、全文+向量搜索、带上下文聊天、内容 transformation、REST API | nibi 不应只做结果页 UI，还要让 `note.md` 成为 RAG/问答/自动化 API 的共同数据源；R0 比前端拼装更重要 |
| [NoteGen](https://github.com/codexu/note-gen) | Markdown AI 笔记软件 | 先记录碎片，再组织为可读笔记；原生 Markdown 存储；内置 RAG、MCP、图片识别/描述/复用 | nibi 的“结果页”应是可继续写作的笔记，而不是一次性报告；图片笔记应重视 OCR/描述/图片引用，不做提示词 |
| [Lokus](https://github.com/lokus-ai/lokus) | 本地 Markdown 笔记 + AI/MCP | 本地 Markdown 文件、wiki links、图谱、database views、MCP server、离线可用 | nibi 的 frontmatter/tag 体系应为未来 database view / 图谱 / MCP 做准备，但本轮先只落笔记页与元数据 |
| [anarlog](https://github.com/fastrepl/anarlog) | 本地会议/音频笔记 | 录音、本地转写、保存为 `.md` 文件，强调无云锁定、任意 LLM provider | 音频笔记也应以 `summary + transcript + tags` 的 md 文件为核心；说话人/音乐分析是辅助层 |
| [nb](https://github.com/xwmx/nb) | CLI Markdown 知识库 | frontmatter 是“人可读、未来友好”的元数据方式，支持 tagging/filtering/search/git/pandoc | `md + frontmatter` 方向成立；字段要简单稳定，不把所有复杂结构都塞正文 |

## 2.3 Notion / Obsidian（通用笔记软件）

- **Notion**：block 编辑器、模板、结构一致、对新手友好。
- **Obsidian**：本地优先 markdown、**阅读/编辑双模式**、stacked panes 多笔记并排、Canvas/Graph 关系图。
- 共性：**正文为中心，操作收在顶栏/侧栏；阅读态与编辑态切换；同一壳承载所有笔记**。

## 2.4 调研结论 → 给 nibi 的 9 条启发

1. **取消中转层**：BiliNote/Notion/Obsidian 都没有 overview→detail 两跳，列表点进去就是笔记本体。→ 对应需求1。
2. **统一笔记壳**：一个骨架（顶栏 + 正文 + 侧栏），各形态只换"正文区块"。→ 解 P2。
3. **三层内容即笔记底座**：所有单素材先有 `source.md` 原始依据，再通过风格总结生成 `summaries/*`，最后由用户应用到 `note.md` 主笔记；复刻向信息（提示词/复刻包）留在复刻线，不混进笔记页。→ 解 P3。
4. **原片/原素材跳转**：时间戳 chip、图片定位——nibi 视频已有关键帧，可把转录时间戳做成跳转 chip。
5. **富文本/源码/对照是同一内容源的不同编辑/呈现方式，不是第二份内容**：NoteIt 的 printable/interactable、Obsidian 的阅读/编辑都说明应从同一份源数据切换不同视图。
6. **主笔记默认保持克制**：单素材 `note.md` 默认围绕摘要、全文/转录/OCR、标签、必要元信息；详细要点/金句等通过“总结风格”主动生成，不作为默认主体；多文/多图对比属于工作区层能力。
7. **脑图**是高记忆点功能（"2小时网课压成5分钟脑图"），nibi 目前没有；但用户已决议先不做，留增强阶段。
8. **版本 + 风格**：nibi 已有 14 风格总结/多版本基础，应在顶栏显性化，但不要挤占正文阅读区。
9. **代码能力分散，产品需要统一**：`/ln` 已有编辑/问答/视频伴随，`/av-synthesis` 已有 md 渲染/TOC/导出；未来不是补一页、留一页，而是收敛到同一套 NoteShell。

## 2.5 「图文笔记」布局专项调研（用户重点要求）

- **小红书图文排版铁律**：每段 3-4 行、长短交替、**图文穿插**、留白；用户是"扫"不是"读"→ 关键信息突出、emoji+短句+小标题；**先写文字再插图**（图文分离编辑）；知识卡片走 **F 型动线**（左标题 + 右图示）。
- **Cubox / Readwise Reader（剪藏类）**：自动解析正文 + **图片 OCR + 图像物体识别**、阅读时高亮标注、嵌套标签/文件夹整理、导出 Notion。
- **→ 对 nibi「图片/图文」形态的结论**：① 文字型图片先 OCR 成 `note.md` 正文，再从正文生成摘要和标签；② 非文字型图片（效果、案例、界面、关键画面）作为正文 inline 配图，用 alt/描述增强检索；③ 图文素材按原语义做图文穿插，图片放到对应段落旁，不做跨图对比；④ 每图可挂 OCR/描述（折叠或元数据），但不出现提示词。

---

# 3. 需求1 方案：合并 overview + detail

## ✅ 已定：路线 A（干掉中转，列表直达笔记页）+ 分步走

**做法**：任务中心列表点 item → 直接进「统一笔记页」；overview 的标签/统计/摘要下沉为笔记页**顶部概览条**（可折叠）；最终删 `/overview` 路由（数据加载/状态机逻辑迁入新壳）。

**全做 vs 分步 —— 结论：必须分步**（项目铁律 §5「一会话一子任务」+ §4「跨 5 文件以上停下问」）：
- 「全做」= 抽壳 + 5 页套壳 + 概览条下沉 + 列表改直达 + 删路由，一次性跨 ~10 文件，风险高、不可回滚、破坏 git 颗粒度。
- 「分步」= 见 §6 R0→R5，每步独立分支/commit、可单独验证回滚。**R1 完成后页面先具备统一壳与总结风格版本池**，R2 再补 WYSIWYG/Markdown/对照。

## 3.1 未来信息架构（用户确认：先做好单素材，多素材后置）

### 3.1.1 产品层级

```
工作空间 / 任务中心
  └─ 点单个素材 → 单素材统一笔记页 <NoteShell>
       ├─ source.md      原始依据：全文 / OCR / transcript / 字幕（偏只读）
       ├─ summaries/*    不同总结风格与版本（已有 SummariesTab 能力）
       ├─ note.md        当前主笔记：用户最终阅读、WYSIWYG 编辑、导出
       └─ assets/*       图片 / 截图 / 关键帧 / 音视频引用资源

多素材综合 / 工作区综合
  └─ 后置，不在本轮主搭建范围。
```

### 3.1.2 内容流

```
原始素材
  → source.md（直转 md：OCR / transcript / 原文）
  → 选择总结风格（复用现有 summary_templates + SummariesTab）
  → summaries/{template}/vN.md（风格总结候选）
  → 用户应用其中一个版本
  → note.md（当前主笔记，可 WYSIWYG 编辑、Markdown 编辑、对照、问答、导出）
```

**关键约束**：
- `source.md` 是原始依据，建议默认只读，保留可追溯性。
- `summaries/*` 是风格总结版本池，不等于最终笔记；用户选择“应用到主笔记”后才写入 `note.md`。
- `note.md` 是唯一主笔记和导出主体；WYSIWYG 富文本只是编辑体验，底层仍保存 Markdown。
- `/ln` 和 `/av-synthesis` 不是未来两个产品概念，而是当前代码里分散的能力来源：`/ln` 提供视频伴随/编辑/问答，`/av-synthesis` 提供 md 综合渲染/TOC/导出。未来应收进同一 NoteShell。
- `/av-synthesis` 不再作为“未来多素材综合页”的默认方案写入本轮架构；多素材综合后续另开设计。
- Obsidian 包导出已经存在，后续是统一复用，不作为新增功能。

---

# 4. 需求3 方案：分类型笔记结果页（融合模型 · 仅笔记板块）

## 4.0 核心：单素材 NoteShell + 三层内容 + 媒体两姿态（用户已确认）

任何单素材笔记 = **source.md 原始依据 + summaries 风格总结 + note.md 当前主笔记 + 可选媒体**。媒体只有两种融合姿态：
- **图片 → inline 嵌入正文流**（单图嵌段落；同一素材多图只做图集/混排，不做跨图对比；视频关键帧同理）。
- **音视频 → companion 伴随播放区**（播放器 + 转录轴，与正文时间戳**双向联动**）。

布局公式：**`[note.md主编辑区] + [source/summary侧栏] + [可选 图inline] + [可选 音视频companion]`**。下面 6 类只是这些开关的组合，**不是 6 套独立代码**——共用同一个壳。复刻向（提示词/复刻包）**不进笔记壳**（见附C）。

## 4.1 统一笔记壳 <NoteShell>（所有类型共用，解 P2/P3）

```
┌──────────────────────────────────────────────────┐
│ 顶栏: ←返回 标题 [类型] 总结风格▾ 生成/应用  富文本|MD|对照  导出▾ │
├──────────────────────────────┬───────────────────┤
│ 概览条(可折叠,=原overview下沉):                      │
│   标签chips(6维+自由)·统计·摘要 [问AI][进分镜(视频)] │
├──────────────────────────────┤  伴随区(随类型可选): │
│  note.md 当前主笔记             │  · source.md 原始依据 │
│  [WYSIWYG富文本 | Markdown | 对照]│ · summaries版本列表   │
│  (摘要/正文/转录/OCR,图inline) │  · 音/视频播放器/转录轴 │
└──────────────────────────────┴───────────────────┘
```
- **共用**(所有类型)：顶栏 / 概览条 / 总结风格 / WYSIWYG富文本编辑 / Markdown源码 / 对照 / AI问答 / 导出。复用现有 `SummariesTab`、ln 的 `MdView·HtmlView·LNTranscriptPanel·ChatDrawer`、AV 的 md 渲染/导出。
- **随类型变**：正文区(图是否 inline) + 伴随区(有无音视频 companion)。
- 脑图留远期(用户决定先不做)；多素材综合后置。
- **重要命名**：UI 可叫「富文本 / Markdown / 对照」。工程内部可叫 `WysiwygEditor / MarkdownView / SplitCompareView`；不要把富文本叫成“另一个 html 文件”，否则容易误解为需要同时维护 `note.md` 和 `note.html` 两份数据。

## 4.2 结果页功能定义（只写笔记页，不写复刻页）

### 4.2.1 共用能力（所有笔记页）

| 功能 | 说明 |
|---|---|
| 标题 + 类型徽章 | 返回、标题、类型、状态/版本；不要把一堆工具按钮塞进标题区 |
| 标签概览条 | 展示 overview 下沉来的 6 维标签 + 自由标签；可重新生成/编辑；写入 frontmatter |
| 原始依据 source.md | 文本=全文；文字图=OCR；非文字图=描述/alt；音频/视频=转录/字幕；默认只读，供核对和重新总结 |
| 总结风格 | 复用已有 `summary_templates.py` + `SummariesTab`，生成不同风格/版本的 md 总结 |
| 当前主笔记 note.md | 用户最终阅读、编辑、问答、导出的当前笔记；可从某个 summary 版本应用而来 |
| 主体全文 | 文本=全文；文字图=OCR 后的 md 正文；非文字图=正文 inline 图片 + alt/描述；音频/视频=转录/字幕正文；图文/带关键帧视频=正文中 inline 图片/关键帧 |
| WYSIWYG富文本 / Markdown / 对照 | 同一份 `note.md` 的三种编辑/查看方式；保存只写 md |
| AI 问答 | 作用域限定为当前 `note.md` + 必要 transcript/media metadata |
| 导出 | Markdown / Obsidian 包 / PDF / Word 尽量复用已有能力；Obsidian 包不是新增功能 |

### 4.2.2 不属于单篇笔记主体的能力

这些能力代码里可能已经存在，但目标笔记页不把它们放在主阅读区：

| 能力 | 去向 |
|---|---|
| 多文对比 | 工作区级「对比/研究」入口，不属于单篇文字结果页 |
| 多图对比 | 工作区级「对比/研究」入口，不属于单张/单条图文笔记页 |
| 改写 / 翻译 / 联想 | 可放“处理工具”抽屉或工作区能力；不要挤占单篇笔记的阅读主线 |
| 提示词 / 提示词版本 / 复刻包 | **复刻链路**，结果页另做，不进笔记页 |
| AI 导演 / 图片批量 | 独立工作流，本报告不规划 |
| 多素材综合 | 用户已确认后置；本轮先做好单素材统一笔记页 |

## 4.3 分类型功能 + UI 线框

**① 纯文字 / 单篇文章**

目标：一眼读懂这篇内容，能继续编辑、问答、导出。

```
┌ ← 标题 [文字] 总结风格▾ 富文本|MD|对照 问答 导出▾ ┐
├ 标签概览条: 来源 · 字数 · 6维标签 · 自由标签        ┤
│  ## 摘要                                           │
│  一段摘要；详细要点/金句可由总结风格主动生成。      │
│                                                    │
│  ## 全文                                           │
│  文章正文 / 网页正文 / 本地 md 正文                 │
└────────────────────────────────────────────────────┘
```

保留：摘要、全文、标签、来源 URL、字数、编辑、问答、导出、总结风格版本池。  
不放默认主区：多文对比、改写翻译、提示词版本。要点/金句只作为用户主动选择的总结风格，不作为单篇默认结构。

**② 图片 / 单图笔记**

目标：如果图里主要是文字，先把图片文字 OCR 成一份可读 `note.md`，再在这份正文上生成摘要和标签；如果不是文字图，则把图片作为正文配图/案例图，并保留 alt/描述方便搜索。

```
┌ ← 标题 [图片] 总结风格▾ 富文本|MD|对照 问答 导出▾ ┐
├ 标签概览条: 图片尺寸 · EXIF摘要 · 标签             ┤
│  [原图预览，可放大]                                │
│                                                    │
│  ## 摘要                                           │
│  基于 OCR 正文生成的一段摘要                       │
│                                                    │
│  ## 正文                                           │
│  OCR 后的图片文字，按 markdown 段落/标题保存        │
│                                                    │
│  折叠: 原图 alt/描述 / EXIF / 文件信息             │
└────────────────────────────────────────────────────┘
```

保留：OCR 后的 md 正文、摘要、标签、原图引用、alt/描述、EXIF、编辑、问答、导出。  
不保留：提示词 tabs、提示词版本栈、多图对比、一键复制提示词。

**③ 图文 / 单条图文内容**

目标：一条图文素材内部的多张图和正文合成一篇笔记；图片按语义插入正文，不是多图对比。

```
┌ ← 标题 [图文] 总结风格▾ 富文本|MD|对照 问答 导出▾ ┐
├ 标签概览条: N张图 · 字数 · 标签                   ┤
│  图集缩略条 [1][2][3]…                            │
│                                                    │
│  ## 摘要                                           │
│  图文整体摘要                                      │
│                                                    │
│  ## 正文                                           │
│  段落文字                                          │
│  ![图1](assets/...)                                │
│  图1 OCR/alt/描述（可折叠）                        │
│  段落文字                                          │
│  ![图2](assets/...)                                │
└────────────────────────────────────────────────────┘
```

保留：同一素材内的图片、正文、OCR/alt/描述、标签。  
不保留：跨 item 多图对比、提示词。

**④ 音频**

目标：音频是“摘要 + 转录全文 + 播放器/时间轴”的笔记。

```
┌ ← 标题 [音频] 总结风格▾ 富文本|MD|对照 问答 导出▾ ┐
├ 标签概览条: 时长 · 转录段数 · 标签                 ┤
│  ## 摘要                     │ ♪ 音频播放器        │
│  一段音频摘要                │ 转录轴 / 当前句高亮 │
│                              │                     │
│  ## 转录全文                 │ 折叠: 说话人统计    │
│  [00:32] 可点击句子          │ 折叠: 音乐分析      │
└──────────────────────────────┴────────────────────┘
```

保留：摘要、转录、标签、播放器、时间戳跳转、说话人/音乐分析辅助。  
不保留：`prompt_output/prompts` 作为笔记页 tab。

**⑤ 视频笔记（合并 `/ln` + `/av-synthesis` 能力）**

目标：把现有 `/ln` 的视频伴随/编辑/问答/截图能力，与 `/av-synthesis` 的 md 渲染/TOC/多格式导出能力，统一到单素材 NoteShell。当前代码是两条路由，未来产品上是一套笔记页能力。

```
┌ ← 标题 [视频] 总结风格▾ 富文本|MD|对照 问答 导出▾ ┐
├ 标签概览条: 时长 · 转录段数 · 标签 · [进分镜]      ┤
│  ## 摘要                     │ ▶ 视频播放器        │
│  一段视频摘要                │                     │
│                              │ 转录轴 / 字幕        │
│  ## 转录 / 笔记正文          │                     │
│  [02:13] 句子可跳原片        │ 折叠: 关键帧索引     │
└──────────────────────────────┴────────────────────┘
```

保留：`source.md → summaries → note.md`、摘要、transcript/字幕、标签、播放器、截图插入、转录轴、AI 问答、TOC、导出、分镜入口、必要关键帧索引。  
不保留：帧提示词、复刻包、提示词 tabs、提示词编辑。

**⑥ 带关键帧的视频笔记**

目标：在⑤基础上，把关键帧作为正文证据 inline，而不是单独变成复刻卡片。

```
┌ ← 标题 [视频笔记] 总结风格▾ 富文本|MD|对照 问答 导出▾ ┐
├ 标签概览条: 时长 · 关键帧N · 转录段N · 标签        ┤
│  ## 摘要                     │ ▶ 视频播放器        │
│  ![帧@02:13](assets/...)     │ 转录轴              │
│  对应段落说明                │                     │
│  ![帧@05:40](assets/...)     │ 折叠: 关键帧目录     │
└──────────────────────────────┴────────────────────┘
```

保留：关键帧 inline、转录、摘要、标签、播放器联动。  
不保留：帧提示词/复刻包。

## 4.4 各类型「不进默认主笔记」清单（笔记页只留笔记向）

| 类型 | 留（笔记向 → md） | 不进默认主笔记 / 后置去向 |
|---|---|---|
| 纯文字 | 摘要 / 全文 / 标签 / 来源 / 风格总结版本 | 要点/金句仅作为用户主动选择的总结风格；多文对比/改写翻译去工具或工作区能力；提示词版本栈去复刻线 |
| 图片 | 文字图 OCR 后的 md 正文 / 摘要 / 标签 / 原图引用 / alt描述 / EXIF | 提示词 tabs / 提示词版本栈 / 多图对比 / 一键复制提示词 |
| 图文 | 同一素材内图集 / 正文图文混排 / OCR或alt描述 / 标签 | 跨素材多图对比 / 提示词 |
| 音频 | 摘要 / 转录 / 标签 / 播放器 / 说话人辅助 / 音乐分析辅助 | `prompts` / 提示词输出 |
| 视频/综合能力（现 `/ln` + `/av-synthesis` 分散） | md主体 / WYSIWYG与Markdown / 编辑 / AI问答 / 视频播放器 / 转录轴 / 截图inline / TOC / 导出 | 帧提示词 / 复刻包 / 提示词tabs / 提示词编辑 |
| 多素材综合 | 后置，暂不进入单素材主线 | 本轮不规划 |

## 4.5 新增决策：每份 md 都有「富文本 / Markdown源码 / 对照」一键切换

> 用户 2026-06-05 新增要求：md 都要有 html（或其他名字）做一键切换，可以看到带图带 UI 的页面，也可以看到原始 md，方便其他软件接力分析。

### 4.5.1 结论：一份源文件，三种编辑/查看方式

**唯一主笔记仍是 `note.md`（frontmatter + Markdown 正文）**。所谓「HTML」不是第二份持久化文件，而是 `note.md` 在前端提供的**富文本 / WYSIWYG 编辑体验**：

| 模式 | 给谁用 | 内容来源 | 行为 |
|---|---|---|---|
| 富文本（WYSIWYG） | 日常写作和修改 | 同一份 `note.md` | 像文档编辑器一样改标题、段落、列表、图片、引用、表格；保存时序列化为 Markdown |
| Markdown源码 | AI 接力 / 排查 / 高级编辑 | 同一份 `note.md` | CodeMirror 或 textarea，显示 frontmatter + 原始正文，可编辑自动保存 |
| 对照（Split Compare） | 审稿 / 调格式 / 查原文 | 同一份 `note.md` + 可选 `source.md` | 桌面宽屏左右分栏：富文本 vs Markdown，或 note.md vs source.md；移动端降级为二选一切换 |

这样做的关键价值：
- **不会双写不同步**：富文本只是编辑层，保存只写回 `note.md`。
- **其他软件可接力**：MD源码视图看到的内容，就是导出给 Obsidian / 其他 AI 的内容。
- **带图带 UI 不丢**：图片、关键帧、时间戳在 md 中是标准引用；nibi 富文本/渲染层把它们增强成图片预览、跳转 chip、伴随播放器。

### 4.5.2 交互细节

- 顶栏放一个 segmented control：`富文本 | Markdown | 对照`。
- 默认进入 `富文本`，因为用户总结完后主要是在可视化编辑器里继续修改。
- 切换偏好按用户/浏览器持久化：现有 ln 用 `localStorage('ln-view')`，统一后建议改为 `note-view-mode`，按全局复用；若未来需要按类型记忆，再扩展为 `note-view-mode:{type}`。
- 富文本和 Markdown 编辑后都沿用 1.5s debounce 自动保存：`保存中… / 已保存 HH:mm / 保存失败`。
- 富文本的图片、时间戳、目录、代码块复制等增强来自统一编辑/渲染组件；音视频跳转通过 frontmatter 的 transcript / media timeline 找原素材。
- 对照模式只在桌面宽屏启用；窄屏显示 `富文本 | Markdown` 两态，避免左右栏挤压。
- WYSIWYG 技术选型（如 Tiptap / Lexical / Milkdown / Toast UI Editor）会引入依赖，进入搭建前必须单独确认。

### 4.5.3 HTML 产物（用户 2026-06-05 确认：要做）

**`note.md` 是唯一底层源；`note.html` 是从 md 渲染出的「美观结果」产物**——用户原话：md 纯文本看不到图，html 能把格式和图片呈现好。所以 html **要做**，定位是**导出/渲染产物**，不是第二份可编辑源：
- **底层唯一源**：`note.md`(+frontmatter)。所有编辑只写回 md。
- **html 产物**：`note.html + assets/`，从 `note.md` **单向渲染**（带图、带格式、可离线打开），给需要渲染呈现的软件/展示用；**不反向编辑 html**（仍避免双写不同步）。
- **按目标软件选格式**（用户："每个软件不一样"）：Obsidian → 导出 md；需要渲染页 → 导出 html；另有 PDF / Word。导出菜单按目标给格式，统一从 `note.md` 渲染。
- 与「应用内富文本视图」分清：富文本(WYSIWYG)是**编辑体验**(写回 md)；html 是**导出产物**(只读渲染)。两者都从同一份 md 来。

### 4.5.4 现有代码复用依据（已核对）

- `LearningNotesPage` 已有 `html/md` 两态：默认 html，`localStorage('ln-view')` 记忆；`HtmlView` 用 `ReactMarkdown` 渲染，`MdView` 用 CodeMirror 编辑。
- `HtmlView` 已支持目录提取和时间戳 chip 跳视频。
- `patchLnMarkdown` 已支持保存 `ln.md`；`LNVideoPanel` 已支持视频播放和截图插入；`LNTranscriptPanel` 已支持转录轴；`ChatDrawer` 已支持问 AI；`exportLnObsidian` 已支持 Obsidian 包。
- `AVSynthesisResultPage` 已经是 `av_synthesis.md` 只读渲染/导出页，可借鉴 markdown 渲染、TOC 和导出。
- 现有 `HtmlView/MdView` 还不是完整 WYSIWYG，只是阅读渲染 + Markdown 编辑；要满足用户“内容总结完后可以修改编辑更好使”的目标，需要新增或引入真正的富文本编辑层。

→ 所以 R1 不应把 `/ln` 与 `/av-synthesis` 继续当两套产品做，而应抽成 `NoteShell / NoteBodySwitcher / WysiwygMarkdownEditor / MarkdownSourceView / SummaryVersionPanel`。

## 4.6 已有总结风格能力（代码已核对，未来统一接入 NoteShell）

现有代码已经做过“按风格生成总结”，不是新增能力：

| 层 | 代码事实 | 可复用点 |
|---|---|---|
| 模板定义 | `backend/app/services/summary_templates.py` 实际有 14 个模板（文件注释仍写 9 个） | 直接复用模板 id / label / prompt，不重写 |
| 总结生成 | `backend/app/services/summary_generator.py` 从 item.results 的 transcript/content/summary 构造 prompt 并生成 `ItemSummary` | R0 后改为优先吃 `source.md` |
| API | `GET/POST/GET/DELETE /workspaces/{ws}/items/{item}/summaries` | 保留版本化生成/删除/查看能力 |
| 前端 | `frontend/src/components/SummariesTab.tsx` | 已有新建、模板选择、版本列表、最多 3 份对比、复制、重新生成、删除 |
| 已接页面 | Text/Image/Audio/Video 结果页都已接 `SummariesTab` | 未来从 tab 工具收进 NoteShell 的“总结风格/版本”面板 |

当前模板（14 个）：

`concise` 简洁摘要、`detailed` 详细要点、`quotes` 金句提取、`meeting` 会议纪要、`xhs` 小红书风格、`longform` 公众号长文、`lecture` 教学笔记、`interview` 访谈整理、`shownotes` 播客 shownotes、`oral` 口播稿、`steps` 步骤教程、`outline` 大纲、`qa` 问答卡(Anki)、`actions` 行动清单。

未来 UI 规则：
- 顶栏或右侧面板放「总结风格」入口，默认展示常用模板：精简 / 教学 / 口播 / 教程。
- 生成结果先进入 `summaries/{template}/vN.md` 版本池，不直接覆盖 `note.md`。
- 用户点击“应用到主笔记”后，才把某个 summary 版本写入 `note.md`，再进入 WYSIWYG 编辑。
- “要点/金句”不作为单篇默认主体，但可作为用户主动选择的总结风格存在。
- 现有 SummariesTab 的“对比”是总结版本对比，可以保留；它不同于多文/多图工作区对比。

---

# 5. 需求2 落地：功能补充建议（按性价比排序）

| 优先级 | 功能 | 来源 | 现状 |
|---|---|---|---|
| P0 | 单素材统一 NoteShell | 用户确认 / 现有代码分散 | `/ln` 与 `/av-synthesis` 能力需合并，不再当两个产品概念 |
| P0 | 风格总结版本池 | 现有 `summary_templates.py` + `SummariesTab` | 14 个模板、版本、对比、复制、重生成已存在，需收进 NoteShell |
| P0 | WYSIWYG 富文本编辑 | 用户确认 | 现有是 ReactMarkdown 阅读 + CodeMirror/textarea 编辑，需新增或引入真正富文本编辑层 |
| P0 | AI 问答统一接入 | BiliNote/ln | text + `/ln` 已有，其他形态需统一 |
| P0 | Obsidian / Markdown 导出统一复用 | 现有 ln / AV 导出 | 已有，不作为新增能力 |
| P1 | 转录时间戳 → 可点 chip 跳原片 | BiliNote / 现有 `/ln` | `/ln` 局部已有，需统一到 NoteShell 并覆盖音频/视频 |
| P1 | 顶栏显性化版本 + 总结风格 | BiliNote / 当前 SummariesTab | 有数据和组件，但分散在 tab/页面内 |
| P2 | **脑图/思维导图**（markmap） | BiliNote | 无（需引依赖，⚠️§4 需问） |
| P2 | 笔记内目录锚点跳转 | BiliNote / 现有 `/ln` + `/av-synthesis` | 局部已有，需统一到 NoteShell |
| P3 | 关系图 / 工作空间内笔记互链 | Obsidian | 无（远期） |

---

# 6. 实施分期建议（与进行中的 M7 三能力衔接）

- **当前 M7 三能力（编辑/问答/导出）继续作为能力来源**，但统一笔记页不再按 `/ln` 和 `/av-synthesis` 两套产品拆。
- **Phase R0 内容底座**：单素材先落 `source.md + summaries/* + note.md + frontmatter` 契约；`source.md` 原始依据默认只读，`summaries` 复用已有模板版本，`note.md` 是当前主笔记。
- **Phase R1 NoteShell + 总结风格面板**：抽 `<NoteShell>`，把现有 `SummariesTab` 收成“总结风格/版本池”，支持“应用到主笔记”。
- **Phase R2 WYSIWYG / Markdown / 对照**：引入或实现真正富文本 Markdown 编辑器；保留 Markdown 源码；桌面支持 note.md vs Markdown 或 note.md vs source.md 对照。
- **Phase R3 媒体伴随与单素材分形态接入**：复用 `/ln` 视频伴随、转录轴、截图插入；接入 Text/Image/Audio/Video 单素材；只接笔记向字段，复刻向不进壳。
- **Phase R4 删中转与路由收敛**：任务中心列表直达统一笔记页 + `/overview` 下沉；`/ln` 与 `/av-synthesis` 能力并入统一路由后再考虑兼容/重定向。
- **Phase R5 增强**：时间戳跳转完善 / `note.html + assets/` 离线 HTML 导出（如需要）/ 脑图 / 关系图。多素材综合另开设计，不在本轮主线。

> 每个 Phase 独立分支 + 独立 commit，一会话一子任务（项目铁律 §5）。

## 6.1 开始搭建前必须先确认的细节

当前只做调研报告，不开始业务搭建。进入 R0/R1 前，建议用户先确认以下 6 个点：

| # | 细节 | 推荐默认 |
|---|---|---|
| 1 | UI 命名 | 顶栏显示「富文本 / Markdown / 对照」，而不是直接叫 HTML |
| 2 | 是否做对照模式 | 做，但仅桌面宽屏启用；移动端只保留二态切换 |
| 3 | 是否产出 `note.html` | **要**（用户已确认）：`note.md` 唯一源，`note.html+assets` 从 md 单向渲染作导出产物；按目标软件选 md/html/PDF/Word |
| 4 | 保存源 | `source.md` 默认只读；summary 版本独立保存；当前主编辑只保存 `note.md` |
| 5 | WYSIWYG 技术选型 | 搭建前单独确认；候选 Tiptap / Lexical / Milkdown / Toast UI Editor |
| 6 | 第一批接入顺序 | 先做单素材统一 NoteShell + source/summaries/note 内容流；再合并 `/ln` 与 `/av-synthesis` 能力；最后接 Text/Image/Audio/Video |

## 6.2 当前状态（给其他软件接力）

- **代码状态**：未开始本报告对应的统一结果页搭建；本文件是设计/调查报告。
- **已确认范围**：只动笔记板块；笔记 ≠ 复刻；复刻/AI导演/图片批量等其他线不动。
- **已确认底座方向**：`source.md + summaries/* + note.md + frontmatter`；对外主导出仍是 `note.md`。
- **新增设计要求**：①所有 md 笔记都有「富文本(WYSIWYG) / Markdown源码 / 对照」视图，默认富文本可编辑——用户确认要**真 WYSIWYG**（需装 Tiptap/Lexical 类库，搭建前确认选型，属 §4 装包红线）。②`note.md` 唯一底层源；`note.html + assets` 作为从 md **单向渲染**的美观导出产物（带图带格式），导出按目标软件选 md(Obsidian)/html(渲染页)/PDF/Word。
- **现有可复用代码**：`SummariesTab` + `summary_templates.py` 的风格总结；`LearningNotesPage(/ln)` 的 `HtmlView/MdView/LNVideoPanel/LNTranscriptPanel/ChatDrawer`；`AVSynthesisResultPage(/av-synthesis)` 的 markdown 渲染/TOC/导出；Text 页 T1/T2 的问答/编辑能力。
- **接力建议**：下一位工具先不要改业务代码，先 review §3.1、§4.5、§4.6 和 §6.1；确认后再从 R0 或 R1 开始。

---

# 7. 决策记录（2026-06-05 用户已拍板）

> 性质：✅=你在对话里明确拍板；🔶=外部 AI 推荐、方向合理但你未逐条确认；📄=代码核实事实。

| # | 决策 | 结论 | 性质 |
|---|---|---|---|
| 1 | 合并路线 | 路线 A（干掉中转，列表直达）+ 分步走 R0→R5 | ✅ |
| 2 | 类型体系 | 「md主体 + 图inline + 音视频companion」融合模型；6 类是同一壳开关组合 | ✅ |
| 3 | 脑图 | 先不做，留远期 | ✅ |
| 4 | 本轮范围 | 只敲定方案/设计，不动代码 | ✅ |
| 5 | 笔记/复刻边界 | 笔记≠复刻；本轮只动笔记板块，复刻线不碰 | ✅ |
| 6 | 三层内容 | `source.md` + `summaries/*` + `note.md` | 🔶 你认可"md底层+总结从md来"，三层结构是外部细化 |
| 7 | 富文本编辑 | 「富文本(WYSIWYG)/Markdown/对照」切换；默认富文本可编辑 | ✅ 要真 WYSIWYG（需装库） |
| 8 | `/ln`+`/av-synthesis` | 产品目标统一为一套笔记页能力 | 🔶 外部推荐 |
| 9 | 图片笔记规则 | 文字图先 OCR→md 再摘要；非文字图 inline 配图+alt | 🔶 外部推荐 |
| 10 | 总结风格 | 14 模板+SummariesTab；生成入 summaries，应用后写 note.md | 📄 代码事实 |
| 11 | 多素材 | 后置；先做好单素材 | ✅ |
| 12 | html 产物 | `note.md` 唯一源；`note.html+assets` 从 md 单向渲染作美观导出；按目标软件选 md/html/PDF/Word | ✅ 你已确认要 html |

## 2026-06-05 模型修正（用户纠正"6独立形态"→"md底座+媒体融合"）

核心模型改为：**source.md 原始依据 + summaries 风格总结 + note.md 主笔记 + 媒体融合层**。媒体两种姿态：图片 **inline 嵌入正文流**、音视频 **companion 伴随播放区(时间戳联动)**。布局公式 = `[note.md主编辑区] + [source/summary侧栏] + [可选图inline] + [可选音视频companion]`。

| # | 状态 | 结论 |
|---|---|---|
| 13 | 融合模型 | 已纳入 §3.1/§4，取代"6独立形态"的实现理解 |
| 14 | md 底座 R0 | 推荐后端归一化(治本)，不推荐前端临时组装（🔶 你倾向 md+frontmatter，R0 具体形态待开工确认） |
| 15 | HTML/富文本 | 已更新 §4.5.3：`note.md` 唯一源，`note.html+assets` 从 md 单向渲染作美观导出产物；富文本(WYSIWYG)视图只写回 md |

**下一步**：先 review §3.1、§4.5、§4.6、§6.1；确认后，从 R0/R1 开始，一会话一子任务。

---

# 附A · overview 概览页「逐元素去留」分析（用户 2026-06-05：不是全删，看哪些该留）

以截图（文字类 item 的概览页）为准，逐元素判去留（融进结果页时）：

| 元素 | 判定 | 去向 / 理由 |
|---|---|---|
| 顶栏 ←任务中心 / 标题 / 类型徽章 / 状态 | ✅ 留 | 与结果页顶栏合并，本就需要 |
| **内容标签（6维分类 + 自由标签）** | ✅✅ 重点留 | 知识库**元数据金矿** → 进结果页「概览条」+ 写入 md **frontmatter**（见附B） |
| 重新生成（标签） | ✅ 留 | 标签区操作 |
| 内容摘要（大卡） | ⚠️ 降级 | 与详情页摘要重复 → 收成概览条一行 / 折叠，不再占整块大卡 |
| 统计卡（字符数/时长/关键帧/转录段） | ✅ 留 | 概览条里一行 chip 即可 |
| **打开详情 → 大按钮** | ❌ 删 | 融合后无需跳转，结果页本身就是详情 |
| **文字详情 / 视频详情（次级入口）** | ❌ 删 | 同上，冗余跳转 |
| 进入分镜 | ✅ 留 | 去 StoryboardPage 的独立功能 → 结果页做成按钮 |
| LLM 对话 | ✅ 留 | AI 问答，结果页本就要有（M7） |
| 导出工作包 | ✅ 留 | 导出 → 结果页顶栏操作 |

**结论**：overview 作为「独立中转页」删除；但其 **内容标签 + 统计 + 进分镜/问答/导出入口** 全部保留，下沉为结果页顶部「概览条」(可折叠) + 顶栏操作。标签同时写入 frontmatter 喂知识库——这就是「融合」。

---

# 附B · md 作为知识库底座的分析（回答"md 作底层是否最合适"）

## B.1 nibi 知识库现状（已核实代码）
- 已有完整 RAG：`workspace_knowledge.py`(FAISS 索引→`data/.local/embeddings/`)、`rag_qa_service.py`(检索+引用问答)、`routes/rag.py`。
- **但索引/问答的数据源不是 md，是 item.results 分散字段**：`chat_context._format_results` 按 `item.type` 分支 pick `summary`/`transcript`/`ocr_text`/`description`/`frame_prompts` 临时拼文本。
- 即 **知识库现在就是"按类型临时拼接"**——脆、每加类型/字段都要改分支、与展示各拼各的。

## B.2 结论：md 合适，但要 **md + frontmatter 双层**（不是裸 md）

| | md 正文（给人 / LLM / RAG） | frontmatter YAML（给机器） |
|---|---|---|
| 装什么 | 摘要/正文/转写/OCR + 媒体**引用** | 类型/标签(6维)/时长/时间戳轴/帧路径/EXIF/来源/版本/媒体路径 |
| 服务谁 | 阅读、编辑、RAG 切块、问答 | 检索过滤、按标签/类型查、媒体定位、互链 |

**为什么 md 对知识库最优**：
1. RAG 友好——md 标题层级 = 天然 chunk 边界、引用定位清晰；现在按字段拼的文本没有结构。
2. 收敛代码——统一后 `_format_results` 按类型分支可删，知识库/问答/展示/导出**同一个源**。
3. 人读 + 可编辑 + Obsidian 兼容（nibi 已有 ln.md + Obsidian 导出），契合"本地优先创作者工具"。
4. 媒体在 md 里是引用、文件单独存——知识库索引文本、媒体按引用关联，分层正确。

**md 短板 → frontmatter/sidecar 兜底**：结构化过滤弱→frontmatter 字段；精确时间戳/帧塞正文会乱→frontmatter 存轴、正文只放可读 chip；互链/反链→解析 `[[wikilink]]` 建索引(Obsidian 模式)。

## B.3 三方案对比（结合"要做知识库"）

| 方案 | 展示 | 知识库 | 成本 | 债 |
|---|---|---|---|---|
| **①后端归一化 md+frontmatter（推荐）** | 统一壳直接读 md | RAG 直接吃 md，切块天然，删按类型分支 | 高(定 schema + 各 handler 加组装落盘) | 无，治本 |
| ②前端临时组装 | 前端拼 md 显示 | ❌ 不解决：后端仍按字段拼(现状) | 低 | 高，两套拼装 |
| ③先不动 | 现状 | 现状临时拼 | 0 | 维持 |

→ **推荐 ①**：它是"媒体融合展示 + 知识库索引 + 导出/Obsidian/版本"的**共同地基**，一次投入三处受益，还能简化现有 `_format_results`。这正是 **R0**。

## B.4 frontmatter schema 草案（R0 落地时细化）
```yaml
---
schema_version: 1        # ← 格式版本号，便于其他软件接力时识别
id: ...                  # 身份
workspace_id: ...
type: video|audio|image|text
title: ...               # 来源
source_url: ...
created_at: ...
tags:                    # 6维 + 自由（即原 overview 的内容标签）
  content_type: 教程
  domain: 科技
  difficulty: 入门
  duration_tier: 短
  density: 中
  tone: 中性
  free: [设计拆解, 风格模板]
media:                   # 媒体引用（文件单独存，md 只放引用；统一相对路径，便于打包接力）
  images: [assets/img1.png, ...]
  audio: assets/audio.mp3
  video: { path: assets/v.mp4, duration: 101 }
  frames: [{ sec: 133, path: assets/frame_0213.png }, ...]
layers:                  # 三层内容文件（接力软件可按需取）
  source: source.md      # 原始依据(只读)
  note: note.md          # 当前主笔记(本文件)
  summaries: [summaries/lecture/v1.md, ...]
exports:                 # 渲染产物(从 note.md 单向生成；按目标软件选)
  html: note.html        # 带图带格式的美观结果
version: 1               # note.md 的编辑版本号
---
（下面是 md 正文：摘要 / 正文全文或转写/OCR；图片用 ![](assets/...) 引用，时间戳用可点 chip）
```

---

# 附C · 结果页全貌 + 笔记向/复刻向剥离（用户 2026-06-05：笔记≠复刻，只动笔记板块）

## C.1 六个结果页看完后的定性

| 页面 | 笔记向（留给笔记板块） | 复刻向（剥离，本次不碰） | 离"md笔记"多远 |
|---|---|---|---|
| TextResultPage | 摘要/全文/标签/编辑/问答/导出 + SummariesTab | 多文对比/改写翻译/提示词版本栈不进单篇主体 | 近（结构化，非统一 md） |
| **LearningNotesPage(`/ln`)** | **md主体 + 视频 + 截图插入 + 转录轴 + 阅读/Markdown + 编辑 + 问答 + 导出** | — | ✅ 提供统一笔记页所需的一部分能力 |
| **AVSynthesisResultPage(`/av-synthesis`)** | **`av_synthesis.md` 渲染 + TOC + 多格式导出** | — | ✅ 提供统一笔记页所需的一部分能力 |
| AudioResultPage | 转录/总结/音乐分析/人声/字幕 | `prompts`(提示词) tab | 中（tab 工具页） |
| VideoResultPage | summary/transcript/字幕/三轨字幕轨 | 帧提示词/复刻包/提示词tabs/学习复刻toggle | 中（混了复刻） |
| ImageResultPage | 文字图 OCR→md 正文、摘要、标签、原图引用、EXIF、alt/描述 | **提示词 tabs（现为主体！）/多图对比** | 远（现以复刻为主） |

**关键**：
- **`/ln` 与 `/av-synthesis` 不是未来两个产品概念** → 当前代码分散，未来统一成同一套 NoteShell 能力。
- **`/ln` 已具备 md 编辑、阅读/Markdown 切换、视频伴随、截图插入、转录轴、问答、导出；`/av-synthesis` 已具备 md 渲染、TOC、多格式导出** → 两边能力合并，不各做一套。
- Video/Image/Audio 是"分析工具页"，混了笔记向 + 复刻向。本次只取**笔记向**统一进 md；**复刻向（提示词/复刻包）原样留在复刻线，不动**。
- ImageResultPage 现在**以提示词(复刻)为主** → "图片笔记"要重做笔记面：文字图先 OCR 成 md 正文，再生成摘要/标签；非文字图作为正文 inline 配图 + alt/描述，复刻面不碰。

## C.2 笔记板块边界（这次动什么 / 不动什么）
- ✅ 动：text/image/audio/video 单素材的**笔记向产出** → 统一到 `source.md + summaries/* + note.md + frontmatter` + 统一 NoteShell；合并 `/ln` 与 `/av-synthesis` 的能力。
- ❌ 不动：复刻流程、复刻结果页、提示词/复刻包、AI 导演、图片批量等——独立线，与笔记无关。
- ⏸ 后置：多素材综合 / 工作区综合；本轮先做好单素材。

## C.3 R0 产出 = 一组可接力的 md 文件（呼应"让其他软件接力分析"）
R0 把每个单素材笔记落成 **`source.md + summaries/* + note.md + frontmatter`**，存于 workspace。这套文件：
- **nibi 自身**：source 追溯、summary 风格版本、note 主编辑、知识库(FAISS 索引)、问答、导出形成同一套源；
- **对外接力**：标准 md + YAML，导出即可被 **Obsidian / 其他 AI / 其他笔记软件直接读取继续分析**——这是 md 作底座最大的对外价值，也是"让其他软件接力分析"的落地。
- 现状 `ln.md` 已验证读写/问答/导出可行；`av_synthesis.md` 已验证 md 渲染/TOC/导出可行；`SummariesTab` 已验证总结风格版本池可行。R0/R1 = 把这些能力收敛到统一单素材笔记。
- **富文本关系**：nibi 里的 WYSIWYG 富文本只负责把 `note.md` 变成更好编辑的界面；它不是第二份真相源。真正交给 Obsidian / 其他 AI 的仍是 `note.md`，必要时附 `source.md` 和 assets。

## C.4 给其他软件接力时的最小输入包

建议后续导出/交接包至少包含：

```
note.md                 # frontmatter + markdown 正文，当前主笔记/主导出
source.md               # 原始依据：OCR / transcript / 原文，建议只读
summaries/              # 不同总结风格和版本，可选导出
assets/                 # 图片、关键帧、截图、音视频引用资源
transcript.json         # 可选：精确时间轴，给需要结构化处理的软件
metadata.json           # 可选：nibi 内部状态/版本/任务来源，给自动化工具
```

其中 `note.md` 必须单独可读；`source.md` 用于追溯原始内容；`assets/` 缺失时，正文仍应保留摘要、OCR、转录文本等可分析内容。`transcript.json / metadata.json` 是机器增强层，不替代 frontmatter。
