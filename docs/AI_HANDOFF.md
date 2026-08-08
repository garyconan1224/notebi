# AI Handoff

## 当前执行指针（2026-08-08，说话人精度 P0 合入 + P1 评测收尾）

- **当前分支**：`codex/fix-speaker-diarization`（无远端，未 push）。注意：handoff 上一段指针停在 `main`，但当前实际工作分支为 `codex/fix-speaker-diarization`，HEAD = `222e446`。
- **当前 HEAD**：`222e446`（说话人 P0 两提交 `9d12a1a` / `222e446` 已在分支上并完成真实素材验证）。
- **本轮内容**：说话人归属准确率 P0 完成并合入；P1（Community-1 vs WeSpeaker 模型 A/B）评测完成，结论是**保持 WeSpeaker，不切换默认管线**。

### 说话人 P0（已合入）

- **基线**：`77968bf` 起，计划文件 `docs/plans/2026-08-08-speaker-diarization-accuracy-p0.md`（完成后已按规则删除）。
- **`9d12a1a`** fix：移除 WeSpeaker 短段吞并（1.2s 短发言不再并入相邻主段）；`audio_analyzer.py` 新增 `label_transcript_segments`（先细分再归属）；归属收紧为覆盖率 ≥0.65 且相对第二名 ≥0.15，证据不足清除旧标签。
- **`222e446`** test：补短回应保留回归测试。
- **真实素材验证**（十字路口 Koji 对谈，120-220s，281 段）：新旧逻辑仅 3 段标签不同——1 处修复命中（303.36-304.80 "什么原因呢" SPEAKER_01→00），2 处阈值边界清除旧标签（530.80、571.16 覆盖率 61-64.5% 未达 0.65 → None）。整体无回归。

### 说话人 P1 评测（结论：保持 WeSpeaker）

- **模型**：`pyannote/speaker-diarization-community-1`（CC-BY-4.0，HF gated，用用户 token 下载至 HF 缓存；token 仅进程环境变量，未落盘）。
- **双人场景**（十字路口 120-220s）：两模型输出几乎一致，184-200s 长段均正确标 SPEAKER_01；WeSpeaker 在 151.7-154.1 拆出独立短段略细。**无实质差异**。
- **多人场景**（4.9 会议 2240-2340s，实际 3 人、部分重叠）：WeSpeaker 指定 4 人 → 多拆一人；Community-1 自动推断 3 人 → 人数正确，但碎片化严重（57 段 vs 38 段，大量 0.02-0.1s 碎片）。
- **结论**：两模型各有优劣（WeSpeaker 段稳定但多人人数偏多；Community-1 人数准但碎片多），不足以替换 WeSpeaker。**保持 P0 后的 WeSpeaker 管线**，P1 不切换默认。
- **已知边界**：0.65 阈值在 60-64% 覆盖区间偏保守（2 段被清标签）；多人场景 WeSpeaker 的 4→3 收窄是模型聚类局限，规则层改不动。

### 提交历史（本轮最新在前）

| 哈希 | 主题 |
|---|---|
| `222e446` | test(diarization)：短回应保留自己的标签 |
| `9d12a1a` | fix(diarization)：保留真实短发言 + 精度优先归属 |

---

## 上一轮执行指针（2026-08-07，导出面板 / 导图替换 / i18n 三大批次已并入 main）

- **当前分支**：`main`（无远端，未 push）。
- **当前 HEAD**：本文件所在提交，以 `git log` 为准；其前两个提交 `961780f` / `5a7eed9` 为合并后收尾修复。
- **本轮内容**：上一版 handoff（`f13ea6d`，2026-08-04 Q1–Q8 收尾）之后共 73 个提交，在两个功能分支完成并 fast-forward 合入 `main`：
  - `codex/fix-bilibili-cover-and-overflow`：设置重组、图片代理、浮动工具栏、四步导出面板、全站 i18n、表格/高亮/显示设置、bilibili 封面修复。
  - `codex/mindmap-mind-elixir`：M0–M3，用 mind-elixir 替换自研思维导图。
- **合并收尾**：合入后验证发现并修复三处问题——导出 article 模式段落合并回归与 `with_timestamp` 默认值（`961780f`）、前端 2 个 `tsc -b` 类型错误（`5a7eed9`）。
- **后续增量（2026-08-07）**：AI 产物行动项闭环——勾选持久化（前端 + 后端校验）、主任务+细节结构、导入反映完成状态（`d880e8c`→`6084b65`）；正文任务清单复选框可切换（`2a700f6`）。

### 提交历史（本轮分组，最新在前，详见各 commit message）

| 哈希 | 主题 |
|---|---|
| `9147fe7` | chore：删除已完成的导图计划文件 |
| `9182485` | feat：AI 产物插入成功后自动关闭 AI 工具面板 |
| `303b2da` | 导图 M3：「插入为大纲」把 markdown 解析成真实编辑器节点 |
| `07229dc` | 表格批：表格插入、多色高亮 mark、笔记显示设置页 |
| `073d0d0` | merge：导图分支 → 主线功能分支 |
| `4163618` `d53ce37` `5d4eb49` | 导图 M0–M2：mind-elixir 替换自研渲染、overflowHidden 指针交互修复 |
| `14330ba` | 自研导图 SVG 画布（后被 M1 替换） |
| `73325f8` `826db35` | 精简：移除播放器下合并时间轴、左下版本历史入口 |
| `f4002b1`→`eddcdc4` | i18n：全站 zh/en（shell / 结果页 / 设置 / 文库 / 收藏 / 知识库 / 任务中心） |
| `cd88f0f` `5bbf1b4` `bc3aa32` `9b2f1d1` | bilibili：封面批量解析器、行溢出、单链接封面持久化、失效提示 |
| `fadad6c` `4e18343` | 四步导出面板：内容/格式/选项/目的地；语言感知字幕、转写文档 txt/md/docx、烧录语言 |
| `69a1fab` `ce85e7d` `e43c0c4` `ce43d28` | 导出测试与修复：转写文档流、总结选项、Obsidian 去重、pptx/长图打包 |
| `61bcaad`→`4eccf54` | 图片代理：硬化代理挂载 + 封面/缩略图/帧/结果图全链路，bili 接口被封回退 yt-dlp |
| `3b80ac1` `35d7a73` `cbfa13e` | 浮动工具栏：选中触发、Aa 正文设置并入工具栏、下划线 mark |
| `3216a86` | 导图：节点文字换行 + 增删改名持久化 |
| `e80822c` `9037736` | 问 AI：富文本回答 + 可点击来源 chips |
| `4585544` `d1a4e27` `5df2af6` `b013a66` | 设置：export-sync 页、语言显式确认、obsidian 移出通用设置 |
| `5f3b740` `ccb89ee` `e966cb1` | 总结：章节帧对齐、内联帧占位；合并时间轴加入后整体移除 |

### 各批次落点

- **四步导出**：内容/格式/选项/目的地单面板；转写增加时间轴/说话人/语言（仅原文/双语/仅翻译）选项；媒体页简化为原视频 + 带字幕开关；目的地含 Notion/飞书/Obsidian。遗留快速下载路径（`downloadTranscript`）语义不变：无时间轴 + 480 字段落合并。
- **导图替换**：mind-elixir 接管渲染与交互（M1）、指针交互修复（M2）、插入为大纲落真实节点（M3）；节点增删改名、文字换行、持久化保留。M0–M3 明细：
  - **M0**：`5d4eb49` 计划文件（`docs/plans/2026-08-06-mindmap-mind-elixir-replacement.md`），背景 / 根因 / 修复方案 / 涉及文件 / 验收 / 执行红线，完成后已按项目规则删除（`9147fe7`）。
  - **M1**：`d53ce37` 用 mind-elixir（`@mind-elixir/mind-elixir` v4，core + 内置 nodeMenu/toolbar）替换自研 `mindMapToSvg` 只读 SVG，作为 Web Component 封装为 `MindElixirMindMap.tsx`（data 注入 / click 转发 / viewMode / theme 跟随暗色），`MindMapView` 删除 SVG + 缩放控件改承载该组件并保留 PNG/SVG 导出按钮；`MindMapToolbar` 精简为 插入图片 / 插入大纲 / 复制源码 / 下载 PNG / 下载 SVG；`parseMindMapSource` 补默认 root/children 字段满足 mind-elixir 节点契约；`mind-map-source.css` 由 SVG 画布规则改为源码 pre 规则；`package.json` / `pnpm-lock.yaml` 新增依赖（pnpm 安装，用户已授权）。
  - **M2**：`4163618` 修复 `.nibi-mind-map-visual` 为隐藏滚动条加的 `overflow-hidden` 把 mind-elixir 指针事件全部吃掉（拖拽平移 / 节点选中 / 右键菜单 / 缩放按钮全失效）；改为 `overflow: hidden` 保留、`overscroll-behavior: contain` 阻止滚轮冒泡，面板内滚动需求由 mind-elixir 自带拖拽平移覆盖。
  - **M3**：`303b2da` 「插入为大纲」不再逐行 `insertTextAtCursor`（多行会压进同一段落），改为 `parseMindMapSource` 把 source_json 解析成带层级 `- ` 缩进与 `- [ ]` 复选框的 markdown，经 `insertMarkdownAtCursor`（Milkdown `parserState` + `remark-parse` + `insert`）落成真实 bullet / task list 节点；`AiArtifactPanel` 新增 `buildMindMapOutlineMarkdown`，`mindMapToMarkdown` 保留供复制源码与兜底；面板测试补充层级 / 待办断言。
- **表格批**：表格插入、多色高亮 mark（`<mark data-color>` 内联 HTML 落盘）、正文显示设置移入独立设置页。
- **i18n**：note locale namespace 起步，覆盖导航、结果页、导出面板、全部设置页、文库/收藏/知识库/任务中心。覆盖明细：
  - `f4002b1`：新增 note locale namespace 与 i18n bootstrap 测试。
  - `403cd86` / `18e499d`：导出面板、浮动工具栏、思维导图与问 AI 文案。
  - `f17e35b` / `7f0cdcb` / `b70a09a`：笔记结果页顶栏、全局导航、应用壳与顶栏剩余标签。
  - `2f1cd1f` / `c45276c` / `a90f091` / `952cc11` / `2ea605d`：文库、工作台、任务中心、收藏与知识库核心标签。
  - `520a0de` / `3af84df` / `bb60e62` / `ef05f3b` / `c373812` / `829d5fe` / `a650fcc` / `32a0d24` / `ee2e0c2` / `713e486` / `eddcdc4`：通用设置、共享壳 / 主题标签、回收站 / 网络 / 导出同步 / 下载 / 诊断 / 性能 / 本地模型 / 模板、分析默认、转写器、提供商与模型、收藏、文库过滤与知识库页。
- **图片代理**：远端图统一走后端硬化代理；bili view API 被封时链接预览回退 yt-dlp。代理链路明细：`61bcaad` 挂载硬化后端图片代理（签名 URL、远端图代理）；`8b64ff1` 远端封面失败时回退图片链接本身；`206663b` 文库笔记封面；`6b16390` 任务 / 素材缩略图；`2a71134` 素材面板批量 / 既有缩略图；`0ffc2f2` 处理中页封面；`4eccf54` 三轨帧与图片结果源；`5aaf411` bili view API 412 时链接预览回退 yt-dlp。
- **交互精简**：版本历史合并单菜单、tone 选择器折叠、全屏移出更多菜单、章节证据条与播放器下合并时间轴移除（后者加入后复评移除）。

### e0f9317 时的最终测试 / 构建结果（真实退出码，2026-08-07）

- 前端测试：`pnpm test` → 100 文件 / 553 passed，退出码 0（连跑两次稳定）。
- 后端测试：`.venv/bin/python -m pytest tests/backend backend/tests tests/test_*.py -m "not integration" -q` → 1490 passed / 2 skipped / 6 deselected，另有 2 个 twitter 环境性失败（见下）。
  skipped 明细：`test_audio_analyzer.py:315`（silero-vad torch 模型，需 `RUN_AUDIO_MODEL_TESTS=1` 单跑）、`test_ocr_service.py:44`（PaddleOCR 模型不可用）。
- 构建：`pnpm build`（`tsc -b && vite build`）退出码 0。
- 离线 E2E：`.venv/bin/python tests/e2e_qa.py` → 12/12，退出码 0。
- CDP 无头验收：导图 + 插入后面板关闭 19/19 PASS（scratch 数据 `ws-mindmap-qa`，不触真实笔记）。
- **类型检查盲区提醒**：前端 tsconfig 是 solution 风格，裸 `tsc --noEmit` 是空检查（假 OK），vitest/esbuild 不做类型检查；类型门禁必须用 `tsc -b` 或 `pnpm build`。

### 后续增量验证结果（2a700f6 干净 worktree，2026-08-07）

因主树当时有另一会话未提交改动，行动项 / 任务清单批次（`d880e8c`→`2a700f6`）在 `/tmp/notebi-verify-2a700f6` detached worktree 中复验：

- 前端测试：100 文件 / 556 passed，退出码 0。
- 后端测试：1496 passed / 2 failed / 2 skipped / 6 deselected；失败仍为 twitter 真实网络环境性失败。
- 构建：`pnpm build` 退出码 0。
- 离线 E2E：12/12，退出码 0。

### 未验证项 / 已知边界

- twitter 2 个失败为环境性：`TestPlatformSniffTwitter` / `TestTwitterFetchTextOnly` 未标 integration 但真实访问 x.com / syndication API（本环境 SSL EOF），自 bootstrap 即存在，非本轮合并引入；`TestTwitterMetaReal` 已标 integration 被 deselect。
- MarkdownToc 对重复标题的锚点行为未专门验证。
- 真实素材端到端（真实视频导出/烧录、真实 LLM 产物、真实 vault 写入）与多视口像素级走查仍是边界；以各 commit message 的「未验证边界」段落为准。
- QA 环境保留 scratch 数据 `ws-mindmap-qa`；本地环境前端 5181 / 后端 8001（无 `/api` 前缀）不变。
- 未 push 到远端（项目约定暂缓至开源阶段）。
- 主树未提交的「逐段编辑转写翻译」功能（另一会话在制）不在上述验证范围内。

### 脏文件（未跟踪，保留不动）

- `test-audit-report-2026-08-03.md`：用户已有审计报告。
- `docs/plans/2026-08-04-result-page-export-redesign*.md`、`docs/plans/2026-08-06-speaker-diarization-accuracy-investigation.md`、`docs/plans/assets/`：用户管理的计划文件，本轮未操作。

### 待用户决定

- 两个已完全合并的功能分支（`codex/fix-bilibili-cover-and-overflow`、`codex/mindmap-mind-elixir`）是否 `git branch -d` 删除。
- 是否为本阶段打 tag。

## 当前执行顺序

本轮批次已全部并入 main，合并后收尾修复完成并复验全绿。行动项 / 任务清单增量也已复验。另一会话正在主树做「逐段编辑转写翻译」（未提交），完成后需再次同步本文件。

## 启动检查

```bash
git status --short --branch
git log --oneline -5
git branch --show-current
```

Git 与运行结果优先于本文档；若指针漂移，先报告再继续。
