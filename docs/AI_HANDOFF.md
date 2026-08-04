# AI Handoff

## 当前执行指针（2026-08-04，Q1–Q8 审查修正完成）

- **当前分支**：`codex/continue-product-redesign`
- **当前 HEAD**：本文件所在提交，以 `git log` 为准。
- **本轮计划**：`docs/plans/2026-08-02-product-revision.md`。Q1–Q7 已落地；Q8 阶段 A（适配器/假模型/路由 POC）已完成，阶段 B 的真实模型下载与长音频基准仍需许可证与下载确认。
- **2026-08-04 审查修正**：诊断生产接入、烧录取消竞态、Obsidian 设置/冲突确认、probe 类型即时回写、Crisper 模型归一化、结构化产物修复、导出字体、1024 顶栏均已补齐。

### 提交历史（2026-08-02 计划，最新在前）

| 哈希 | 主题 | 批次 |
|---|---|---|
| 最新修正提交（以 `git log` 为准） | fix: close q1-q8 audit gaps | Q2–Q8 审查 |
| `9b9c3e2` | poc: evaluate crisperwhisper 2 transcription | Q8 阶段 A |
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

- 前端测试：`pnpm test` → 96 文件 / 506 passed，退出码 0。
- 后端测试：`.venv/bin/python -m pytest tests/backend backend/tests tests/test_*.py -m "not integration" -q` → 1476 passed / 2 skipped / 6 deselected，退出码 0。
  skipped 明细：`test_audio_analyzer.py:315`（silero-vad torch 模型，需 `RUN_AUDIO_MODEL_TESTS=1` 单跑）、`test_ocr_service.py:44`（PaddleOCR 模型不可用）。
- 构建：`pnpm build`（`tsc -b && vite build`）退出码 0。
- 离线 E2E：`.venv/bin/python tests/e2e_qa.py` → 12/12，退出码 0；真实网络 E2E 已正确标记 `integration`。
- 各批均按 TDD 先红后绿；UI 批用 Playwright 实测关键交互。

### 未验证项 / 已知边界

- 各 commit message 的「未验证边界」段落为准；主要为真实素材端到端（真实视频导出/烧录、真实 LLM 产物、真实 vault 写入）与部分浏览器像素级走查。
- Q8 阶段 B 未启动：未下载 CrisperWhisper 权重、未接受/代替用户接受非商业研究许可证，也未做 continuation 中文长音频真实基准。
- 后端 2 个 skipped 为本地模型依赖缺失，本环境未验证。
- 未 push 到远端。

### 脏文件

- `test-audit-report-2026-08-03.md` 为用户已有未跟踪审计报告，本轮保留且不纳入提交。

## 当前执行顺序

Q1–Q8 代码审查修正已完成。若继续 Q8 阶段 B，需用户单独确认模型下载位置/大小与非商业研究许可证；真实素材、真实 Vault、烧录视频和浏览器多视口像素级验收仍是后续验证边界。

## 启动检查

```bash
git status --short --branch
git log --oneline -5
git branch --show-current
```

Git 与运行结果优先于本文档；若指针漂移，先报告再继续。
