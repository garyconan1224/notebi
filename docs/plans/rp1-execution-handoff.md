---
phase: RP1 执行交接（给 mimo v2.5pro 的启动手册）
title: 三页改造 → mimo 执行任务分配 + 启动提示词
status: ready
owner: Opus 4.7 出方案，mimo 2.5pro 执行
companion_plan: docs/plans/result-pages-redesign-v1.md（必须先读）
user_source: 2026-05-30 用户问"后面准备交给 mimo v2.5 pro 执行，给出对应计划和提示词（需要分析类的还是你做）"
---

## 0. 分配总则

按 [docs/rules/model-strategy.md](../rules/model-strategy.md) 四档决策树：
- **mimo 擅长**：单文件 / 3-5 文件 CRUD、模板代码、UI 组件、跑测试、接已有 API、文档维护。**RP1 多数子项落在这一档**。
- **Opus 4.7（我）做**：复杂技术选型、跨多组件协调设计、未知边界 case 梳理。**RP1 里只有 3 处需要我先出方案**。

---

## 1. 子项分配表（一张表看清谁做什么）

| 子项 | 工作量 | 谁做 | 理由 |
|---|---|---|---|
| **RP1-A 音频页** | | | |
| A-1 字幕在线编辑+跳转 | 3-4h | mimo | 单文件前端 + 1 个 PATCH 端点，纯模板代码 |
| A-2 说话人改名 | 2-3h | mimo | 设计稿 spkOverrides 已设计好，照搬 |
| A-3 总结模板入口 | 2h | mimo | 后端模板路由已存在，前端只加 segmented control |
| **A-4 音乐"全家桶"** | 5-7h | **我先分析 0.5h → mimo 实现** | sub-tab 2 报告涉及图表库选型 + 数据契约确认 |
| A-5 小修 | 1h | mimo | UI 微调 |
| **RP1-B 学习笔记 ln** | | | |
| B-1 双栏布局 + 视频播放器 | 4-5h | mimo | 组件级 + HTML5 video 标准用法 |
| B-2 字幕跟随 + 点击跳转 | 3-4h | mimo | 复用 A-1 模式 |
| **B-3 HTML/MD 双向同步** | 4-5h | **我先分析 1h → mimo 实现** | turndown 配置 / 净化白名单 / 双向同步策略要先定 |
| B-4 在线编辑 + 自动保存 | 3-4h | mimo | debounce + PATCH 标准模式 |
| **B-5 截图插光标** | 6-8h | **我先分析 1h → mimo 实现** | canvas 截帧 + 跨组件协调 + CodeMirror 光标 API，新模式 |
| B-6 TOC + 时间戳锚点 | 2h | mimo | 正则解析 + chip 渲染 |
| B-7 导出菜单 | 2-3h | mimo | dropdown 接已有路由 |
| B-8 AI 问答抽屉 | 5-7h | mimo | 调 rag_qa_service 已有，组件级；SSE 已有先例可参考 |
| **RP1-C 视频复刻** | | | |
| C-1 主帧大视图 + 缩略图轨道 | 4-5h | mimo | 纯前端布局重构 |
| C-2 复刻↔笔记联动 | 2-3h | mimo | router state 标准用法；"保留播放位置"用 URL hash |
| C-3 帧批量操作 | 2-3h | mimo | 选择 state + 后端 zip 路由 |
| C-4 提示词在线编辑+版本 | 2-3h | mimo | PromptVersionStack 已存在 |
| C-5 小修 | 1h | mimo | UI 微调 |

**总结**：18 个子项里，**15 个直接交给 mimo**，**3 个我先做技术分析（合计 2.5h）后交 mimo**。

---

## 2. 我必须先做的 3 项分析（在对应 mimo 会话开工前完成）

### 分析项 1：A-4 sub-tab 2 可视化报告（必须在 A-4 mimo 会话前做）

**为什么我做**：图表库选型 + 后端数据契约确认 + 组件骨架，是判断型工作，不是模板代码。

**我会产出**：
- `docs/plans/rp1-a4-music-charts.md` 短文档，含：
  - 选 recharts / echarts / chart.js（决定一个 + 理由）
  - 后端 `audio_analyzer.py` / `music_segments` 实际输出字段清单（用 codegraph 查）
  - 每张图表的数据源映射（"BPM 走势 → music_segments[].bpm"）
  - 缺失数据的降级方案（哪些图后端没数据先跳过）
  - 组件结构草图（5-6 个组件名 + props）

**触发时机**：A-1/A-2/A-3 mimo 会话进行中，我并行做完，A-4 启动时直接用。

### 分析项 2：B-3 HTML/MD 双向同步策略（必须在 B-3 mimo 会话前做）

**为什么我做**：contentEditable 的坑很多（粘贴富文本污染、不同浏览器行为差异、turndown 配置陷阱），mimo 直接做容易踩坑返工。

**我会产出**：
- `docs/plans/rp1-b3-html-md-sync.md` 短文档，含：
  - turndown 配置（白名单标签 + headingStyle + emDelimiter）
  - HTML 视图编辑时的输入净化策略（paste 钩子去除 style/class/script）
  - 双向同步触发点（HTML→MD 在 blur，MD→HTML 在每次 dispatch）
  - 已知 5 个边界 case + 处理方式（粘贴 Word、嵌入图片、表格、checkbox、内联代码）
  - 验证清单（mimo 写完后逐项过）

**触发时机**：B-1/B-2 mimo 会话进行中并行做，B-3 启动时直接用。

### 分析项 3：B-5 截图插光标跨组件设计（必须在 B-5 mimo 会话前做）

**为什么我做**：跨两个独立组件（视频面板 ↔ 笔记 CodeMirror）+ 异步上传 + 光标 state 保持，状态流复杂，要先画清楚。

**我会产出**：
- `docs/plans/rp1-b5-screenshot-flow.md` 短文档，含：
  - 数据流图：用户点截图 → canvas 抓帧 → blob → 上传 → 返回 url → CodeMirror 插入
  - 跨组件通信方式（zustand store 还是 ref 还是 event bus，定一个）
  - 视频面板需要暴露的 ref / 方法
  - CodeMirror 插入光标位置的 API 调用片段（贴可用的代码示例）
  - 错误处理（上传失败回滚 / 视频未加载完成时禁用按钮）
  - 后端端点 schema + 文件路径规范

**触发时机**：B-4 mimo 会话进行中并行做，B-5 启动时直接用。

> 这三份分析合计 ~2.5h，**我下次会话做完一并产出**。然后 mimo 全程接管 RP1。

---

## 3. mimo 启动提示词模板（每个子 phase 一份）

> **使用方式**：在 ccswitch CC 终端选 Sonnet 角色（→ 自动路由到 mimo 2.5pro），粘贴下面对应一段。每个 phase 一个会话。

### 3.1 通用前置说明（每条提示词隐含的会话开场）

mimo 启动协议（[docs/rules/mimo-onboarding.md](../rules/mimo-onboarding.md)）会自动跑：git log 对账 → 读 EXECUTION_PLAN → 读本 phase plan。**用户不用在提示词里重复**。

### 3.2 RP1-A 音频页（3 个独立子会话）

#### 提示词 A-1（字幕在线编辑 + 点击跳转）

```
做 RP1-A · A-1（字幕在线编辑 + 点击跳转视频），
详细规格见 docs/plans/result-pages-redesign-v1.md § RP1-A · A-1。

要点：
- frontend/src/pages/result/AudioResultPage.tsx 转录段 div 改 button + onClick → seekTo
- 双击 → contentEditable，blur 调 PATCH 保存
- 后端加 PATCH /workspaces/{ws}/items/{item}/transcript/segments/{i} 端点
  - 改 backend/app/services/transcript_service.py 加 update_segment_text 方法
  - 改 backend/app/routes/workspaces.py 加路由
  - results.transcript_segments[i] 加 edited_text 字段（可选 string）
  - 导出字幕时优先用 edited_text（改 services/subtitle_fetcher 相关导出函数）
- 加 1 个后端 pytest（PATCH 端点 happy path）+ 1 个前端 vitest（双击进入编辑态）

完成后：
- 跑 pytest 报数字
- pnpm build 确认 tsc 通过
- 一句话总结改了什么，等用户验收
- 不要 push，等用户 commit
```

#### 提示词 A-2（说话人改名）

```
做 RP1-A · A-2（说话人 confirm + 改名），
详细规格见 docs/plans/result-pages-redesign-v1.md § RP1-A · A-2。
设计稿参考 docs/design/components/speaker_confirm.jsx 和 audio_detail.jsx 的 spkOverrides 状态。

要点：
- AudioResultPage 转录顶部加说话人芯片条（基于 transcript_segments 里出现的 speaker 去重）
- 点芯片打开 inline input 改名
- 改名存到 workspace_item.results.speaker_aliases（dict[str, str]）
- 后端加 PATCH /workspaces/{ws}/items/{item}/speaker-aliases 端点
- 段落里 speaker 标签渲染时优先用 alias

完成后跑 pytest + pnpm build，一句话总结，不 push。
```

#### 提示词 A-3（总结模板入口）

```
做 RP1-A · A-3（总结模板入口），
详细规格见 docs/plans/result-pages-redesign-v1.md § RP1-A · A-3。

要点：
- 后端 summary_templates.py 已有 9 个模板：concise / detailed / quotes / meeting / xhs / longform 等
- 后端路由可能已经支持 ?template= 参数（请 rg 'template' backend/app/routes/workspaces.py 确认；没有就加）
- 前端总结 tab 顶部加 segmented control，4 个常用：精简 / 详细 / 小红书 / 公众号
- 点击调对应模板生成，localStorage 缓存（同 item × 同 template 不重复请求）

完成后跑 pytest + pnpm build，一句话总结，不 push。
```

#### 提示词 A-4（音乐"全家桶"）

> ⚠️ 启动前先确认 docs/plans/rp1-a4-music-charts.md 已就绪（Opus 4.7 产出）。否则停下来等。

```
做 RP1-A · A-4（音乐分析三 sub-tab："素材库 / 报告 / 拆解"），
详细规格见 docs/plans/result-pages-redesign-v1.md § RP1-A · A-4。
分析方案（必读）：docs/plans/rp1-a4-music-charts.md（图表库选型 + 数据契约 + 组件骨架）。

要点：
- 安装新依赖：pnpm add <按分析文档指定的图表库>（用户已授权）
- 按分析文档的组件骨架实现 3 个 sub-tab
- 教学拆解 sub-tab 的 LLM 调用：新建 backend/app/services/music_teaching_prompts.py，复用 chat_runner

未勾选音乐分析时显示空态，跑 vitest + pnpm build，一句话总结，不 push。
```

### 3.3 RP1-B 学习笔记（8 个子会话，按 B-1→B-8 顺序）

#### 提示词 B-1（双栏布局 + 视频播放器）

```
做 RP1-B · B-1（学习笔记页双栏布局 + 视频播放器），
详细规格见 docs/plans/result-pages-redesign-v1.md § RP1-B · B-1。

要点：
- 拆 frontend/src/pages/results/AVSynthesisResultPage.tsx 为：
  - frontend/src/pages/results/LearningNotesPage/index.tsx（容器）
  - .../LNVideoPanel.tsx（左 50%）
  - .../LNNotesPanel.tsx（右 50%）
- 路由保留 /workspaces/{ws}/av-synthesis 别名（兼容老链接）+ 新路由 /workspaces/{ws}/ln
- 视频源：后端 /static/data/projects/{project_id}/videos/{filename} 已挂载
  workspace_item.results 里找 video_url 或 video_path，需要 rg 'video_path|video_url' shared/ backend/app/ 确认
- 播放控制：原生 video controls 即可，快捷键 Space/←/→ 用 useEffect 绑

完成后访问 http://localhost:5177/workspaces/{某个有 ln.md 的 ws}/ln 看双栏出来。
跑 pnpm build，一句话总结，不 push。
```

#### 提示词 B-2（字幕跟随 + 点击跳转）

```
做 RP1-B · B-2（学习笔记页字幕轨跟随高亮 + 点击跳转），
详细规格见 docs/plans/result-pages-redesign-v1.md § RP1-B · B-2。

要点：
- 复用 A-1 模式（AudioResultPage 已有 activeLineIdx + seekTo 逻辑可参考）
- LNVideoPanel 下方加字幕轨，scrollIntoView({block:'center'}) 跟随当前播放句
- 点字幕 → 视频 seek
- 字幕"引用进笔记"按钮：调用 LNNotesPanel 暴露的 insertAtCursor(text) 方法（B-5 会复用）
  - 跨组件通信方式按 docs/plans/rp1-b5-screenshot-flow.md（已就绪后定的方式）
  - 如果 B-5 分析还没出，先用最简单的 ref forwarding，B-5 时再统一

跑 pnpm build，一句话总结，不 push。
```

#### 提示词 B-3（HTML/MD 双向同步）

> ⚠️ 启动前先确认 docs/plans/rp1-b3-html-md-sync.md 已就绪（Opus 4.7 产出）。

```
做 RP1-B · B-3（HTML 视图 / MD 视图 + 双向同步），
详细规格见 docs/plans/result-pages-redesign-v1.md § RP1-B · B-3。
技术方案（必读）：docs/plans/rp1-b3-html-md-sync.md（turndown 配置 / 净化白名单 / 同步策略 / 5 个边界 case）。

要点：
- 安装新依赖：pnpm add codemirror @codemirror/lang-markdown turndown @types/turndown（用户已授权）
- 按分析文档实现 ViewSwitcher（HTML / MD 切换，localStorage 存状态）
- HTML 视图 = react-markdown 渲染 + contentEditable 包装 + 净化函数
- MD 视图 = CodeMirror 6 + markdown 语言扩展
- 双向同步按分析文档的策略（HTML→MD 在 blur，MD→HTML 在 dispatch）
- 按分析文档的 5 个边界 case 逐项验证

跑 pnpm build + 手测 5 个边界 case，一句话总结，不 push。
```

#### 提示词 B-4（在线编辑 + 自动保存）

```
做 RP1-B · B-4（在线编辑 + 自动保存 ln.md），
详细规格见 docs/plans/result-pages-redesign-v1.md § RP1-B · B-4。

要点：
- MD 编辑 → debounce 1500ms → PATCH /workspaces/{ws}/ln
- 后端 backend/app/routes/export.py 已有 GET /workspaces/{ws}/ln，加 PATCH 路由
  - 写 data/workspaces/{ws}/ln.md，bump version（在 results.ln_version 加 1）
  - 返回 { saved_at, version }
- 顶栏显示「已保存 12:34」或「保存中…」
- last-write-wins，先不做冲突检测

跑 pytest + pnpm build，一句话总结，不 push。
```

#### 提示词 B-5（截图插光标）

> ⚠️ 启动前先确认 docs/plans/rp1-b5-screenshot-flow.md 已就绪（Opus 4.7 产出）。

```
做 RP1-B · B-5（视频暂停截图 → 插入笔记光标位置），
详细规格见 docs/plans/result-pages-redesign-v1.md § RP1-B · B-5。
技术方案（必读）：docs/plans/rp1-b5-screenshot-flow.md（数据流图 / 跨组件通信 / CodeMirror 光标 API 代码 / 错误处理）。

要点：
- 按分析文档的数据流逐步实现
- 后端加 POST /workspaces/{ws}/ln/screenshots
  - 接 multipart/form-data
  - 存 data/workspaces/{ws}/ln-screenshots/{timestamp}.png
  - 返回 { url: "/static/.../xxx.png" }
- 前端按分析文档实现 canvas 抓帧 + 上传 + CodeMirror dispatch insert

跑 pytest + 手测一次完整截图流程，一句话总结，不 push。
```

#### 提示词 B-6（TOC + 时间戳锚点）

```
做 RP1-B · B-6（TOC + 时间戳锚点），
详细规格见 docs/plans/result-pages-redesign-v1.md § RP1-B · B-6。

要点：
- 现有 extractToc 已实现，加「当前章节高亮」（根据 IntersectionObserver）
- 解析 markdown 里 [00:12] [01:30~05:00] 模式 → 渲染为可点击 chip
- chip 点击 → 视频 seek 到对应时刻（复用 B-2 的跨组件通信）
- 用 react-markdown 的 components 钩子，遇到匹配文本就替换成 chip 组件

跑 vitest + pnpm build，一句话总结，不 push。
```

#### 提示词 B-7（导出菜单）

```
做 RP1-B · B-7（学习笔记页导出菜单），
详细规格见 docs/plans/result-pages-redesign-v1.md § RP1-B · B-7。

要点：
- 后端 obsidian/pdf/docx 导出已存在（rg 'export.*ln' backend/app/routes/export.py 确认路由名）
- 顶栏「导出 ▾」dropdown 暴露三个选项
- 加「导出当前页 HTML」= window.print()（或 react-to-print 库；不用就跳过）

pnpm build，一句话总结，不 push。
```

#### 提示词 B-8（AI 问答抽屉）

```
做 RP1-B · B-8（学习笔记页内 AI 问答抽屉），
详细规格见 docs/plans/result-pages-redesign-v1.md § RP1-B · B-8。

要点：
- 笔记右下角浮动按钮「问 AI」打开右抽屉
- 走 backend/app/routes/rag.py 或 chat.py 已有路由（rg 确认现成端点）
- 上下文 = 当前 ln.md 全文 + transcript 段
- 仅限当前笔记 + 当前视频字幕（不做全局问答，按用户决议）
- 流式回复参考 LiveLog.tsx 或现有 SSE 处理

跑 pnpm build + 手测一次问答往返，一句话总结，不 push。
```

### 3.4 RP1-C 视频复刻（5 个子会话）

#### 提示词 C-1（主帧大视图 + 缩略图轨道）

```
做 RP1-C · C-1（视频复刻页主帧大视图 + 缩略图轨道），
详细规格见 docs/plans/result-pages-redesign-v1.md § RP1-C · C-1（含布局草图）。

要点：
- frontend/src/pages/result/VideoResultPage.tsx 布局重构
- 主帧大图 ≈ 400×300，点击 lightbox
- 缩略图轨道 80×60，跟随播放高亮
- 视频播放器移到次要位置

跑 pnpm build + 手测帧切换，一句话总结，不 push。
```

#### 提示词 C-2（复刻↔笔记联动）

```
做 RP1-C · C-2（复刻视图 / 学习笔记视图切换），
详细规格见 docs/plans/result-pages-redesign-v1.md § RP1-C · C-2。

要点：
- 顶栏一个 toggle（参考 docs/design/components/storyboard.jsx 的 sb-tabs 形态）
- 切换 = 改路由（/video_detail ↔ /ln）
- 保留视频播放位置：URL hash #t=120.5
- 两边页面 mount 时读 hash 设 currentTime

跑 pnpm build + 手测两个方向切换，一句话总结，不 push。
```

#### 提示词 C-3（帧批量操作）

```
做 RP1-C · C-3（帧多选 + 批量复制 + 导出复刻包），
详细规格见 docs/plans/result-pages-redesign-v1.md § RP1-C · C-3。

要点：
- 帧卡片加 checkbox（按住 Shift 多选）
- 工具栏「复制 N 帧提示词」「导出复刻包」
- 后端加 POST /workspaces/{ws}/items/{item}/reproduce/export
  - 打包 zip：frames/*.jpg + prompts.txt + styles.json + manifest.json
  - 返回 stream，前端触发下载

跑 pytest（zip 内容校验）+ pnpm build，一句话总结，不 push。
```

#### 提示词 C-4（提示词在线编辑 + 版本）

```
做 RP1-C · C-4（提示词在线编辑 + 版本管理），
详细规格见 docs/plans/result-pages-redesign-v1.md § RP1-C · C-4。

要点：
- 复用 frontend/src/components/result/PromptVersionStack.tsx 已有机制
- 每帧提示词右上角「✎」打开 inline editor
- 保存 = 新版本（已有 prompt_versions 表/字段，需 rg 确认）
- 版本切换 dropdown

跑 pytest + pnpm build，一句话总结，不 push。
```

#### 提示词 C-5（小修）

```
做 RP1-C · C-5（视频复刻页小修汇总），
详细规格见 docs/plans/result-pages-redesign-v1.md § RP1-C · C-5。

要点：
- 帧标题可改名（inline edit）
- 失败帧「重试」按钮接通后端
- 帧标签（7 维度自动打标，SPEC 4.2.5）显示在帧卡片底部

跑 pnpm build，一句话总结，不 push。
```

---

## 4. 排期建议

```
Week 1：我做 3 份分析（A-4/B-3/B-5）+ mimo 跑 A-1/A-2/A-3/A-5（4 个并行子会话，每个 2-4h）
Week 2：mimo 跑 A-4 + B-1 + B-2（顺序，3 个会话）
Week 3：mimo 跑 B-3 + B-4 + B-5（顺序，3 个会话；B-3/B-5 用我的分析文档）
Week 4：mimo 跑 B-6 + B-7 + B-8 + C-1（顺序，4 个会话）
Week 5：mimo 跑 C-2 + C-3 + C-4 + C-5（顺序，4 个会话）
```

**单 phase 单会话铁律**：mimo 一次会话只做表里一行。做完 commit 完就停下。下个子项开新会话。

---

## 5. 风险预案

| 风险 | 触发条件 | 应对 |
|---|---|---|
| mimo 在 A-4/B-3/B-5 启动时分析文档还没出 | Opus 4.7 没及时出方案 | mimo 检测到 plans/rp1-{xx}-*.md 不存在，立刻停下报告用户，不要硬上 |
| mimo 改完 build 失败 | 类型错误 / import 漏 | mimo 自己跑 `pnpm build` 看错误，能修就修；超过 3 次失败 → 报告用户，不要继续硬试 |
| mimo 跨 5+ 文件 | 实际改起来发现影响面比预期大 | 按 model-strategy §6 升档触发器，停下来让用户切 Opus |
| 后端字段名与规划文档不符 | results.video_url 实际叫 video_path 等 | mimo 用 codegraph / rg 查实际字段，写到 commit message，不要硬按规划文档名 |

---

## 6. 我下次会话要做的事（出 3 份分析）

下次会话开始时：
1. 启动协议（git log 对账 + 读 MEMORY.md + 读本文档）
2. 顺序产出：
   - `docs/plans/rp1-a4-music-charts.md`（30 分钟）
   - `docs/plans/rp1-b3-html-md-sync.md`（60 分钟）
   - `docs/plans/rp1-b5-screenshot-flow.md`（60 分钟）
3. commit 这三份 + 本文档
4. 提醒用户开 mimo 会话从 A-1 开始

合计约 2.5h，是一个标准 Opus 会话。

---

## 7. 2026-05-30 中场修订（RP1-B 启动前必读）

RP1-A 二次迭代会话中，mimo **越界做了 RP1-B 的 B-1 半成品**（commit `603e2ea` 含 `frontend/src/pages/results/LearningNotesPage/` 4 文件 + router 注册 `/workspaces/{ws}/ln`），用户 2026-05-30 决议「保留作为 B-1 初版」。

**对下游 B-1/B-2/B-3/B-5 mimo 提示词的影响**：

### 新 B-1 提示词补一段（启动时一并发给 mimo）

> 注意：`frontend/src/pages/results/LearningNotesPage/` 已存在 4 个文件（commit `603e2ea`），是只读 markdown 渲染骨架，**不符合 B-1 完整规格**。你的任务是**在现有文件基础上扩展**：
> - `LNVideoPanel.tsx` 已有视频 ref + 快捷键，但视频源 prop 没真实接入 → 接 `workspace.video_url` / `results.video_path`
> - `LNNotesPanel.tsx` 当前只用 react-markdown 只读 → B-1 阶段保持只读 OK（B-3 会重写）
> - `index.tsx` 已有双栏布局 + 加载状态机 → 检查 `getAVSynthesisMarkdown` 路径是否真的能拿到当前 workspace 的 ln.md
> - `learning-notes.css` 已有 298 行样式 → 检查是否对齐设计稿 audio_detail.jsx / video_detail.jsx 的样式风格
> - **重点**：路由 `/workspaces/{ws}/ln` 已注册，访问应该看到双栏但右侧可能空白（demo 没 ln.md）

### B-3 提示词强制要求**完全重写 LNNotesPanel.tsx**

> ⚠️ 现有 `LNNotesPanel.tsx`（84 行，只读 ReactMarkdown）**必须整个删除重写**为 [docs/plans/rp1-b3-html-md-sync.md](rp1-b3-html-md-sync.md) §3.2 / 3.3 / 3.4 的 CodeMirror 6 + contentEditable + turndown + DOMPurify 实现。不要在现有只读版本上「增量加」，会留下技术债。
> 同时 `index.tsx` 容器要按 §3.1 加 `view: 'html' | 'md'` state + ViewSwitcher。

### B-5 提示词强制要求**扩展 LNVideoPanel.tsx**

> 现有 `LNVideoPanel.tsx`（71 行，原生 video + 快捷键）**保留扩展**为 [docs/plans/rp1-b5-screenshot-flow.md](rp1-b5-screenshot-flow.md) §3.3 的完整版：
> - 加 `<canvas>` 抓帧 + 截图按钮
> - 调 `uploadLnScreenshot` API + `lnEditorStore.insertAtCursor`
> - 加 6 项错误处理

### B-2 提示词不变

字幕跟随逻辑可以直接加到现有 `LNNotesPanel.tsx`（react-markdown 渲染部分），B-3 重写时再合并到 CodeMirror 版本。

