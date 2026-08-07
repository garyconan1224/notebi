# AI Handoff

## 当前执行指针（2026-08-07，导出面板 / 导图替换 / i18n 三大批次已并入 main）

- **当前分支**：`main`（无远端，未 push）。
- **当前 HEAD**：本文件所在提交，以 `git log` 为准；其前两个提交 `961780f` / `5a7eed9` 为合并后收尾修复。
- **本轮内容**：上一版 handoff（`f13ea6d`，2026-08-04 Q1–Q8 收尾）之后共 73 个提交，在两个功能分支完成并 fast-forward 合入 `main`：
  - `codex/fix-bilibili-cover-and-overflow`：设置重组、图片代理、浮动工具栏、四步导出面板、全站 i18n、表格/高亮/显示设置、bilibili 封面修复。
  - `codex/mindmap-mind-elixir`：M0–M3，用 mind-elixir 替换自研思维导图。
- **合并收尾**：合入后验证发现并修复三处问题——导出 article 模式段落合并回归与 `with_timestamp` 默认值（`961780f`）、前端 2 个 `tsc -b` 类型错误（`5a7eed9`）。

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
- **导图替换**：mind-elixir 接管渲染与交互（M1）、指针交互修复（M2）、插入为大纲落真实节点（M3）；节点增删改名、文字换行、持久化保留。
- **表格批**：表格插入、多色高亮 mark（`<mark data-color>` 内联 HTML 落盘）、正文显示设置移入独立设置页。
- **i18n**：note locale namespace 起步，覆盖导航、结果页、导出面板、全部设置页、文库/收藏/知识库/任务中心。
- **图片代理**：远端图统一走后端硬化代理；bili view API 被封时链接预览回退 yt-dlp。
- **交互精简**：版本历史合并单菜单、tone 选择器折叠、全屏移出更多菜单、章节证据条与播放器下合并时间轴移除（后者加入后复评移除）。

### 最终测试 / 构建结果（真实退出码，2026-08-07）

- 前端测试：`pnpm test` → 100 文件 / 552 passed，退出码 0。
- 后端测试：`.venv/bin/python -m pytest tests/backend backend/tests tests/test_*.py -m "not integration" -q` → 1490 passed / 2 skipped / 6 deselected，另有 2 个 twitter 环境性失败（见下）。
  skipped 明细：`test_audio_analyzer.py:315`（silero-vad torch 模型，需 `RUN_AUDIO_MODEL_TESTS=1` 单跑）、`test_ocr_service.py:44`（PaddleOCR 模型不可用）。
- 构建：`pnpm build`（`tsc -b && vite build`）退出码 0。
- 离线 E2E：`.venv/bin/python tests/e2e_qa.py` → 12/12，退出码 0。
- CDP 无头验收：导图 + 插入后面板关闭 19/19 PASS（scratch 数据 `ws-mindmap-qa`，不触真实笔记）。
- **类型检查盲区提醒**：前端 tsconfig 是 solution 风格，裸 `tsc --noEmit` 是空检查（假 OK），vitest/esbuild 不做类型检查；类型门禁必须用 `tsc -b` 或 `pnpm build`。

### 未验证项 / 已知边界

- twitter 2 个失败为环境性：`TestPlatformSniffTwitter` / `TestTwitterFetchTextOnly` 未标 integration 但真实访问 x.com / syndication API（本环境 SSL EOF），自 bootstrap 即存在，非本轮合并引入；`TestTwitterMetaReal` 已标 integration 被 deselect。
- MarkdownToc 对重复标题的锚点行为未专门验证。
- 真实素材端到端（真实视频导出/烧录、真实 LLM 产物、真实 vault 写入）与多视口像素级走查仍是边界；以各 commit message 的「未验证边界」段落为准。
- QA 环境保留 scratch 数据 `ws-mindmap-qa`；本地环境前端 5181 / 后端 8001（无 `/api` 前缀）不变。
- 未 push 到远端（项目约定暂缓至开源阶段）。

### 脏文件（未跟踪，保留不动）

- `test-audit-report-2026-08-03.md`：用户已有审计报告。
- `docs/plans/2026-08-04-result-page-export-redesign*.md`、`docs/plans/2026-08-06-speaker-diarization-accuracy-investigation.md`、`docs/plans/assets/`：用户管理的计划文件，本轮未操作。

### 待用户决定

- 两个已完全合并的功能分支（`codex/fix-bilibili-cover-and-overflow`、`codex/mindmap-mind-elixir`）是否 `git branch -d` 删除。
- 是否为本阶段打 tag。

## 当前执行顺序

本轮批次已全部并入 main，合并后收尾修复完成并复验全绿。下一步由用户指定新任务，或处理上方待决事项。

## 启动检查

```bash
git status --short --branch
git log --oneline -5
git branch --show-current
```

Git 与运行结果优先于本文档；若指针漂移，先报告再继续。
