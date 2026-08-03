# AI Handoff

## 当前执行指针（2026-08-03，2026-08-02 产品修订计划 Q1–Q7 完成）

- **当前分支**：`codex/continue-product-redesign`
- **当前 HEAD**：本文件所在提交，以 `git log` 为准。
- **本轮计划**：`docs/plans/2026-08-02-product-revision.md`（D1–D7 已确认并落地；**Q8 CrisperWhisper POC 未做**，需单独停点确认模型下载与许可证）。

### 提交历史（2026-08-02 计划，最新在前）

| 哈希 | 主题 | 批次 |
|---|---|---|
| 本文件所在提交（以 `git log` 为准） | docs: handoff 2026-08-02 plan Q1–Q7 | — |
| `a64f87e` | fix: make task diagnostics actionable and isolated | Q7 |
| `61c7463` | feat: render typed ai note artifacts | Q4 |
| `a94ecfb` | feat: unify note transcript and media exports | Q3 |
| `35fa545` | feat: add reading themes fonts and shared editing tools | Q6 |
| `dedf3da` | fix: preserve detected types through batch creation | Q5 |
| `feed12e` | feat: make media notes transcript first | Q2 |
| `4997f25` | fix: preserve note and preview state on first render | Q1 |

### 各批次落点（详见各 commit message）

- **Q1**：幽灵 v2 保存守卫、BV 号大小写、截帧区间控件重叠。
- **Q2**：结果页媒体工作区——画面点击播放/暂停、48px 控制带、时间轴 slider、独立故事板、D1 说话人四状态、沉浸式退出入口。
- **Q5**：批量创建不再硬建 video（probe 回写 canonical type）、模板 `show_in_create` 可见性（GET/PATCH 回读）。
- **Q6**：四主题套餐 × 明暗、字体三槽位（后端 settings 持久化）、共享编辑工具栏（H1/H2/H3）。
- **Q3**：导出信息架构重组（笔记/转录字幕/媒体/同步四域）、媒体导出（原视频/软字幕/烧录）、Obsidian 直写。
- **Q4**：AI 产物双轨（content_md + 按 kind 校验 content_json）、思维导图自有树渲染 + 真实 PNG/SVG 导出。
- **Q7**：终态批次删除（D5 边界确认框）、失败原因汇总首屏、诊断事件层（映射/脱敏/聚合）、NOTEBI_LOG_DIR 隔离。

### 最终测试 / 构建结果（真实退出码）

- 前端测试：`CI=true pnpm test` → 94 文件 / 497 passed，退出码 0。
- 后端测试：`.venv/bin/python -m pytest tests/backend backend/tests -q` → 1381 passed / 2 skipped，退出码 0。
  skipped 明细：`test_audio_analyzer.py:315`（silero-vad torch 模型，需 `RUN_AUDIO_MODEL_TESTS=1` 单跑）、`test_ocr_service.py:44`（PaddleOCR 模型不可用）。
- 构建：`pnpm build`（`tsc -b && vite build`）退出码 0。
- 各批均按 TDD 先红后绿；UI 批用 Playwright 实测关键交互。

### 未验证项 / 已知边界

- 各 commit message 的「未验证边界」段落为准；主要为真实素材端到端（真实视频导出/烧录、真实 LLM 产物、真实 vault 写入）与部分浏览器像素级走查。
- Q8 CrisperWhisper 2.0 POC 未启动：需先停点确认模型下载（大小/磁盘位置）与非商业研究许可证接受。
- 后端 2 个 skipped 为本地模型依赖缺失，本环境未验证。
- 未 push 到远端。

### 脏文件

无（工作区干净，本文件更新随本提交）

## 当前执行顺序

2026-08-02 计划 Q1–Q7 已全部完成。**Q8（CrisperWhisper）需用户单独确认模型下载与许可证后再执行**；其余后续操作需用户明确授权。

## 启动检查

```bash
git status --short --branch
git log --oneline -5
git branch --show-current
```

Git 与运行结果优先于本文档；若指针漂移，先报告再继续。
