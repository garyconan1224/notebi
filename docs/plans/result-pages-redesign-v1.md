---
phase: RP1（结果页第一轮内容补齐 · Result Pages v1）
title: 音频 / 视频复刻 / 音视频学习笔记三页内容补齐与重构
status: historical（RP1 历史计划，勿作当前依据）
owner: TBD
note_20260605: 历史 RP1 计划；其中 AVSynthesisResultPage/ln 关系描述已旧，且复刻与笔记未分离。当前 M7 单素材笔记页(NoteShell)架构以 docs/plans/track-K-M7-result-pages-redesign.md 为唯一依据，本文不作架构依据。
estimated_hours: 50-70（拆 3 个子 phase 单独跑）
depends_on:
  - 现有 AudioResultPage / VideoResultPage / AVSynthesisResultPage(ln) 骨架已落地
user_source: 2026-05-30 会话，用户系统性提出三页内容规划需求；含纠正：复刻=截图反推提示词（≠AI 导演），音乐分析要"全家桶"重做
related_spec:
  - docs/spec/04-video.md §4.2（画面提示词 = 复刻）/ §4.3 路径2（合成笔记 = ln）
  - docs/spec/05-audio.md（音频结果页）
  - docs/spec/08-remix-export-progress.md（"AI 导演"延后，本期不动）
---

## 0. 总览

> 本规划只包含**结果页面**的内容补齐与体验改造。不涉及后端新模型、不动 Preflight 配置（除非新功能强依赖后端新字段）。
> **重要约束**：结果页显示哪些模块由用户**添加素材时 Preflight 勾选的分析任务**决定，未勾选项一律显示空态文案（见 [feedback memory: project-result-page-feature-gating]）。

三页拆成三个独立子 phase，可串行也可并行；建议串行（按用户反馈"一次只深做一个"），优先级：

| 子 phase | 工作量 | 优先级 | 理由 |
|---|---|---|---|
| **RP1-A 音频页打磨** | 12-16h | P0（先做） | 投入小、收益直接；多个功能后端已就绪只差前端暴露 |
| **RP1-B 音视频学习笔记重做** | 25-35h | P1 | 最大缺口、最复杂、最有差异化价值；放中间集中精力 |
| **RP1-C 视频复刻页增强** | 12-18h | P2 | 现状已可用，本轮只做"主帧大视图 + 音视频笔记联动" |

明确**不在本期范围**：
- "AI 导演" 模块（按需求改提示词去**生成**新图/视频）—— SPEC 08 已延后
- 风格 DNA 报告、A/B 提示词对比、接入可灵/即梦/Suno 生成 API
- 新增 Preflight 勾选项（如运镜提示词字段）

---

## RP1-A · 音频结果页打磨（12-16h）

### 现状

[shot-audio-transcript.png] [shot-audio-music.png] [shot-audio-summary.png]

`frontend/src/pages/result/AudioResultPage.tsx`（676 行）已实现：
- 播放器 + 波形条 + 点击跳转
- 6 tabs：**转录 / 音乐分析 / 总结 / 人声分离 / 音乐转写 / 提示词**
- 字幕同步高亮（`activeLineIdx` 按 `currentSec` 派生）
- 音乐分析 demo 数据已渲染（多段 + 风格 + Suno 提示词）

### 改造点

#### A-1 字幕在线编辑 + 点击跳转视频（3-4h）

**问题**：当前转录段是只读 div，鼠标点不能跳转、双击不能改字。

**方案**：
- 单击段落 → `audioRef.current.currentTime = seg.t_sec`（已实现 `seekTo`，只需把 div 改 button + onClick）
- 双击段落 → 切到 contentEditable 状态，blur 时调 `PATCH /workspaces/{ws}/items/{item}/transcript/segments/{i}` 保存
- 后端需要新加该 PATCH 端点（`transcript_service.py` 改 + 一条 SQL 字段更新），约 2h
- 撤销：保留原文做"恢复"按钮（前端 useState 存原值即可）

**数据契约影响**：transcript_segments 加 `edited_text: str | null`，导出字幕时优先用 edited_text。

#### A-2 说话人 confirm + 改名（2-3h）

设计稿 `audio_detail.jsx` 已有 `spkOverrides = { A: '张总', B: '李总' }` 形态，但前端没接。后端 `speaker_confirm.jsx`（设计稿）已设计完成。

**方案**：转录顶部加"说话人列表"芯片条，点击芯片打开 inline input 改名，所有该 spk 的段落标签自动更新。改名存到 `workspace_item.results.speaker_aliases`。

#### A-3 总结模板入口（2h）

**问题**：后端 `summary_templates.py` 有 9 个模板（concise/detailed/quotes/meeting/**xhs 小红书**/**longform 公众号**/...），前端只显示 default 一种。

**方案**：总结 tab 顶部加 segmented control（节选 4 个常用：精简 / 详细 / 小红书 / 公众号），点击调 `POST /workspaces/{ws}/items/{item}/summary?template=xhs`（后端路由已存在，前端补一个按钮即可）。结果加 localStorage 缓存（同 item × 同 template 不重复请求）。

#### A-4 音乐分析"全家桶"重构（5-7h）

用户反馈：音乐分析重新构思 → **三 sub-tab：素材库 / 报告 / 拆解**。

**Sub-tab 1：派生二创素材库**（默认）
- 显示当前段的 BPM / 调性 / 风格
- 为 **Suno / Udio / 即梦** 三个平台各生成一条**可一键复制**的提示词卡片
- 每张卡片下"动态画面提示建议"（一句话，如"赛博朋克霓虹街道，慢镜头"）
- "复制 → 生成同风格音乐"按钮（仅复制，不直接调 API；调 API 属于 AI 导演范畴，本期不做）
- 后端 `audio_analyzer.py` 已有 BPM/调性/风格输出，只需补 udio/即梦提示词模板（可前端拼接）

**Sub-tab 2：可视化咨询报告**
- BPM 走势线图（按段）
- 音量曲线（waveform 已有数据，叠加 dBFS 线即可）
- 频谱热图（如果后端没有就跳过）
- 乐器占比饼图（如果后端 `music_segments[].instruments` 有数据）
- 情绪走势线（按段 sentiment）
- 用 `recharts`（package.json 已有？需查），缺则 `pnpm add recharts`（属红线 §4.1 求证项 → **新增依赖前必须问用户**）
- 一键导出报告 PDF（复用后端 `av_synthesis/pdf_builder.py`）

**Sub-tab 3：教学拆解**
- 按段时间轴排列：每段一张卡片
- 卡片字段：时刻 / 风格 / "为什么动人"（调 LLM 一次性生成）/ 使用场景建议（vlog/广告/游戏）/ 类似作品推荐（3 条）
- 调 LLM 走 `chat_runner.py`，prompt 模板新建 `backend/app/services/music_teaching_prompts.py`
- 用户点段卡片 → 跳转音频对应位置播放

**未勾选音乐分析时**：保留现有空态文案"未勾选「音乐分析」或暂无数据"

#### A-5 小修

- 转录 tab 右侧 340px 信息卡（设计稿有，现没接）：显示音频元信息（时长/采样率/比特率/来源 URL）
- 字幕导出补"带说话人标注"开关
- 占位"等待真实数据"在 `transcript_segments` 为空时显示

### 验证

- 改完后：单元测试覆盖 transcript PATCH 端点、speaker_aliases 持久化
- 手测：勾"音乐分析"上传一个 bilibili 音频，端到端跑通三个 sub-tab
- 截图归档：`docs/e2e-test/screenshots/rp1a-*.png`

### Preflight 影响

不动 Preflight。所有新功能依赖的勾选项都已存在。

---

## RP1-B · 音视频学习笔记页（ln）重做（25-35h）

### 现状

[shot-avsynthesis.png] 当前页面 235 行 `AVSynthesisResultPage.tsx`，**只渲染 markdown**。无视频播放器、无字幕、无编辑、无截图功能。后端代码命名是 `ln`（learning notes）、文件 `ln.md`、路由 `/workspaces/{ws}/ln`，本期**全部沿用此命名**。

### 目标布局（草图）

```
┌──────────────────────────────────────────────────────────────┐
│ 顶栏：← 返回  ln · 综合笔记         [视图: HTML/MD] [导出 ▾] │
├──────────────────────────────┬───────────────────────────────┤
│  左 50%：视频播放器           │  右 50%：笔记编辑器           │
│  ┌─────────────────────┐     │  TOC                          │
│  │                     │     │  ─────────                    │
│  │   <video> 内嵌      │     │  # 标题                       │
│  │                     │     │  > 作者 · 时长 · 日期         │
│  └─────────────────────┘     │  ## 全局摘要 ...              │
│  ▼ 字幕轨（滚动跟随）         │  ## 关键帧画廊                │
│  > 00:12 当前字幕高亮         │  ![](frames/001.jpg)          │
│  > 00:30 下一句               │  ## 章节正文                  │
│  > 01:00 ...                  │  ...（contentEditable）       │
│                                │                               │
│  播放控制条                   │  ▼ 工具栏（光标处插入）      │
│  ▶ ⏸ 截图📷 引用字幕💬 标记⭐│  📷截图 💬引用 ⭐时间戳      │
└──────────────────────────────┴───────────────────────────────┘
```

### 改造点

#### B-1 双栏布局 + 视频播放器（4-5h）

- 拆 `AVSynthesisResultPage` 为 `LearningNotesPage`（保留旧路由别名）+ 子组件 `<LNVideoPanel>` `<LNNotesPanel>`
- 左侧 `<video src={workspace.video_url}>`，时长/进度/速度/全屏/快捷键（Space/←/→/J/K/L）
- 视频源：后端 `/static/data/projects/{project_id}/videos/{filename}` 已挂载

#### B-2 字幕跟随 + 点击跳转（3-4h）

- 复用 transcript 数据（同 audio 模块）
- 当前播放句高亮 + 自动滚动到视图中央
- 点击字幕句 → seek 视频
- 字幕可单段"引用进笔记"（A-1 同模式，光标位置插入 `> [00:12] xxx`）

#### B-3 HTML 视图 / MD 视图切换（4-5h）

- 视图状态 toggle，存 localStorage
- **HTML 视图**：用户看精排笔记 + contentEditable 编辑（基于 `react-markdown` 已渲染的 HTML，加 `contentEditable` 包装；保存时序列化回 markdown）
- **MD 视图**：CodeMirror 6 编辑 markdown 源码（package.json 需新增依赖 → 求证）
- 两种视图共享同一份 `ln.md` 数据源，双向同步：HTML 编辑 → 用 `turndown` 转回 md；MD 编辑 → react-markdown 直接渲染
- **简化方案（推荐先做）**：HTML 视图只读，MD 视图可编辑。等用户验证再做 HTML 编辑。这降低 50% 复杂度

**风险**：双向 HTML↔MD 转换不是 1:1（contentEditable 会产生 div/br 等噪声）。建议采用简化方案，写进文档说明。

#### B-4 在线编辑 + 自动保存（3-4h）

- MD 视图编辑 → debounce 1500ms → `PATCH /workspaces/{ws}/ln` 保存到 `ln.md`
- 后端新加 `@router.patch("/{workspace_id}/ln")`：写 `ln.md`、bump version、返回 200
- 顶栏显示"已保存 12:34"或"保存中…"
- 冲突处理：先做 last-write-wins（单机用户，并发概率低）

#### B-5 暂停截图 → 插入笔记到光标位置（6-8h）

**这是最难、最有差异化价值的功能**。

- 视频面板"📷截图"按钮：`<canvas>` 抓 `<video>` 当前帧 → toBlob → `POST /workspaces/{ws}/ln/screenshots` 上传到 `data/workspaces/{ws}/ln-screenshots/{timestamp}.png`
- 后端新加截图上传端点 → 返回 `{ url: "/static/.../ln-screenshots/xxx.png" }`
- 前端把 `![截图@03:42](url)` 字符串插入**MD 编辑器当前光标位置**（CodeMirror API `view.dispatch`）
- HTML 视图自动重渲染显示图
- 可选：截图后弹出迷你 toast"已插入笔记 ✓"，5s 内可撤销
- "放在我想放的位置" = 用户先在 MD 视图把光标放到想插入的地方，然后切回视频面板，点截图。整个流程通过光标位置完成，不需要拖拽

**简化方案**：先只做"截图插到笔记末尾"，等用户用过再做"插到光标位置"。

#### B-6 笔记 TOC + 时间戳锚点（2h）

- 解析笔记里 `[00:12]` `[01:30~05:00]` 等模式 → 渲染为可点击 chip → 点击跳转视频对应时刻
- TOC 已有（`extractToc`），保留并加"当前章节高亮"

#### B-7 导出菜单（2-3h）

- 现有 `R20: 多格式导出` 后端已支持 obsidian/pdf/docx → 前端 dropdown 暴露三个选项
- 加"导出当前页（HTML）"= 直接 print to PDF（浏览器原生）

#### B-8 AI 问答侧抽屉（可选，5-7h）

如果时间够：
- 笔记右下角浮动按钮"问 AI"打开右抽屉
- 输入"这段视频讲了什么？""3:42 那个画面什么意思？"
- 后端走 `rag_qa_service.py`（已有），上下文 = 当前 ln.md 全文 + transcript

**建议本期不做**，留作 RP1-B+ 第二轮。

### 数据契约影响

- 新增：`POST/PATCH /workspaces/{ws}/ln`、`POST /workspaces/{ws}/ln/screenshots`
- `ln.md` 新增可选字段：截图 base 路径在 frontmatter

### Preflight 影响

依赖"勾选 文案总结 · 路径2（音视频合并）" → 才生成 `ln.md`。
**未勾选时**：页面显示引导卡片"想要看 AI 整理的图文学习笔记？请在添加素材时勾选「文案总结 · 路径 2」"。

### 验证

- 跑一个真实视频任务，勾路径2，截全流程
- 测：编辑 → 刷新 → 仍在；截图 → 显示在笔记里；切 HTML/MD 内容一致
- 截图归档：`docs/e2e-test/screenshots/rp1b-*.png`

---

## RP1-C · 视频复刻页增强（12-18h）

### 现状

[shot-video-reproduce.png] `VideoResultPage.tsx`（1002 行）已实现：
- 视频播放器 + 字幕总结
- 8 帧横向轨道 + 点击切换 + 时间跟随高亮（`nearestFrameIdx`）
- 提示词三 tab（MJ / SD / JSON）+ 复制 / 收藏 / 失败重试
- 快捷键完备

### 用户原话核心需求

> "所有结的帧选择放大，播放视频的时候，帧也随着跟着移动，每个帧都有提示词，几种风格，还有视频的简单总结"

对照截图：**"帧跟随移动"已有**（高亮），**"几种风格"已有**（MJ/SD/JSON），**"视频简单总结"已有**（"内容摘要"）。
**唯一明确缺口**："帧选择放大"——当前帧太小（8 帧塞一行），可能想要主帧大视图。

### 改造点

#### C-1 主帧大视图 + 缩略图轨道（4-5h）

布局重构：

```
┌────────────────────────────────────────────────────────┐
│ ┌──────────────────┐  ┌──────────────────────────────┐│
│ │                  │  │ 帧 03 · 03:12 · 霓虹巷子      ││
│ │  当前帧 大图     │  │ ─────────────────────────    ││
│ │  （400×300）     │  │ MJ | SD | JSON ← 风格切换    ││
│ │                  │  │                              ││
│ │                  │  │ a cyberpunk neon alley...   ││
│ │                  │  │ --ar 16:9 --style raw       ││
│ └──────────────────┘  │                              ││
│                       │ [复制] [收藏] [失败重试]      ││
│                       └──────────────────────────────┘│
├────────────────────────────────────────────────────────┤
│ 缩略图轨道（横向滚动）                                 │
│ [01][02][▶03◀][04][05][06][07][08]                    │
└────────────────────────────────────────────────────────┘
```

- 主帧大图 ≈ 400×300，点击进入全屏 lightbox
- 缩略图轨道下移、变窄（80×60），跟随播放高亮
- 视频播放器移到顶部右侧 或 切到次要位置（"复刻"工作流时用户主要看帧，不是视频）

#### C-2 与音视频学习笔记联动（2-3h）

- 顶栏加 toggle："复刻视图 / 学习笔记视图"
- 学习笔记视图 = 跳转 RP1-B 那个页面
- 这样两个页面共享同一个 item，用户随时切换"我现在想拆解画面"还是"我想做笔记"

#### C-3 帧批量操作（2-3h）

- 多选帧 → 批量复制提示词（每帧一段）
- 多选帧 → 导出"复刻工作包"（zip：帧图 + 提示词 txt + 风格清单），后端新加 `POST /workspaces/{ws}/items/{item}/reproduce/export`

#### C-4 提示词在线编辑 + 版本（2-3h）

后端 `PromptVersionStack.tsx` 已存在版本机制。
- 每帧提示词右上角"✎ 改"→ inline editor，保存 = 新版本
- 版本切换 dropdown 直接换提示词显示

#### C-5 小修

- 帧标题（如 "霓虹巷子氛围"）在大图旁可改名
- 失败帧"重试"按钮接通后端（现在是 stub）
- 帧的"标签"（来自 SPEC 4.2.5 7 维度自动打标）显示在帧卡片底部

### 明确**不做**（属 AI 导演范畴）

- 风格 DNA 报告
- A/B 提示词对比
- 接入 MJ/SD API 直接生成新图
- 运镜提示词字段（SPEC 4.2.4 延后项，等 AI 导演阶段一起做）

### 数据契约影响

- 提示词版本：`PATCH /workspaces/{ws}/items/{item}/frames/{i}/prompt`（后端可能已存在，需查 `prompt_formats.py`）
- 复刻导出：新端点

### Preflight 影响

依赖"勾选 画面提示词生成"→ 才有帧数据。未勾选时整个复刻页显示空态引导。

### 验证

- 真实数据：找一个勾了画面提示词的视频，跑全流程
- 截图归档：`docs/e2e-test/screenshots/rp1c-*.png`

---

## 排期建议

| 周 | 工作内容 |
|---|---|
| W1 | RP1-A 音频页 A-1, A-2, A-3, A-5（不含音乐重构）（6-8h） |
| W2 | RP1-A 音乐"全家桶" A-4（5-7h） |
| W3-W4 | RP1-B 学习笔记 B-1~B-4（基础双栏+编辑）（14-18h） |
| W5 | RP1-B B-5 截图 + B-6/7 TOC/导出（10-13h） |
| W6 | RP1-C 视频复刻增强（12-18h） |

**单 phase 一次会话**，按全局 §3 启动协议来。每个子 phase 启动时再展开到具体 commit 颗粒。

## 已决议（2026-05-30 用户授权）

1. **HTML/MD 双向同步**（B-3）→ **直接做双向**，不走简化方案。
   - 技术栈：HTML 视图用 contentEditable + turndown 转回 md；MD 视图用 CodeMirror 6
   - 风险已知（contentEditable 噪声），实现时用白名单标签 + 净化函数控制
2. **截图插入光标位置**（B-5）→ **直接做光标插入**，不做"插到末尾"过渡版。
   - 实现关键：CodeMirror `view.state.selection.main.head` 取光标 offset，dispatch insert
3. **AI 问答抽屉**（B-8）→ **本期做**，但作用域限制为「**仅在学习笔记页内**问当前笔记 + 视频字幕」，不做全局问答。
4. **新增前端依赖**（CodeMirror 6 + turndown + recharts）→ **已授权**安装，在 RP1-B / RP1-A 实施会话开始时 `pnpm add` 并告知。
5. **复刻页 ↔ 笔记页同 item 切换视图**（C-2）→ **做，先试**。三个底线要求：
   - 逻辑符合：切换后保留视频播放位置 + 当前帧
   - 直接：顶栏一个 toggle，不弹窗、不二级菜单
   - UI：参考设计稿现有 tab 风格（`storyboard.jsx` 的 sb-tabs 形态）
6. **音乐三 sub-tab 命名**（A-4）→ **沿用：素材库 / 报告 / 拆解**。
   - 后续实现会话有更顺的名字可微调，无需再回来问

## 产品边界（澄清，避免混淆）

- **复刻** = 帧 / 截图 → AI 反推识别成提示词。**理解型功能**，本期 RP1-C 增强。
- **AI 导演** = 用户基于复刻提示词改 + 调生成 API 产出新图新视频。**生成型功能**，仍按 SPEC 08 延后到 [C]。
- 二者**功能不同**，"复刻先做 → AI 导演后做"是符合产品逻辑的顺序，不是 SPEC 误差。

---

## 附录：本规划不动的东西

- 不动 SPEC（除非新功能产出后回填 §05 / §04）
- 不动 Preflight（不新增勾选项）
- 不动 AI 导演（截然不同的产品阶段，按 SPEC 08 延后）
- 不动其它结果页（图片 / 文本）—— 用户本次没提
