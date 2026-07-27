# NoteBi Knowledge, Settings, Collections, and Task Center Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已经批准的网络/下载、标准日志、任务中心、合集和知识库设计分五个可独立验收、可回档的阶段落地。

**Architecture:** 保持 JSON workspace 为业务事实源；设置由后端持久化并由前端读回；任务中心复用现有 pipeline 引擎；标准日志承载任务和应用事件；合集继续使用 `content_id + lineage_id` 的独立副本模型；知识库每轮基于当次合集范围重新检索，并保存可追溯引用快照。

**Tech Stack:** FastAPI、Pydantic、Python JSON/JSONL 持久化、React、TypeScript、Zustand、Vitest、Testing Library、Pytest、Playwright、yt-dlp。

---

## 0. 执行依据和禁止事项

- 批准设计：`docs/superpowers/specs/2026-07-27-notebi-knowledge-tasks-settings-design.md`
- 本项目执行时使用 `superpowers:executing-plans`，遵守 Single-Agent Serial Principle；不得启动并行 subagent。
- 五份子计划：
  1. `docs/superpowers/plans/2026-07-27-network-download-settings.md`
  2. `docs/superpowers/plans/2026-07-27-standard-log.md`
  3. `docs/superpowers/plans/2026-07-27-task-center-batches.md`
  4. `docs/superpowers/plans/2026-07-27-collection-workspace.md`
  5. `docs/superpowers/plans/2026-07-27-knowledge-conversations.md`
- 不恢复 PO Token、Visitor Data、学习笔记选择、旧的文件夹/移动/整理/列表批量标签动作。
- 不创建第二套任务引擎、第二套合集数据或第二套日志事实源。
- 不重写既有 R0–R7 历史；所有改动从当前批准基线向前提交。
- 不修改、暂存或删除 `.workbuddy/`、`.qoder/`、`data/` 中的用户文件。
- 不向远端 push，除非用户单独授权。

## 1. 分支链和回档点

每个阶段都从上一个已经验收通过的阶段 HEAD 新建分支。不得同时开发两个阶段。

```bash
git switch codex/design-knowledge-tasks-settings
git status --short --branch
git log --oneline -5
```

期望：工作树干净，HEAD 至少包含批准设计提交 `c7c705b`。

分支顺序：

| 阶段 | 分支 | 起点 |
|---|---|---|
| S1 | `feat/s1-network-download-settings` | `codex/design-knowledge-tasks-settings` |
| S2 | `feat/s2-standard-log` | S1 验收通过 HEAD |
| S3 | `feat/s3-task-center-batches` | S2 验收通过 HEAD |
| S4 | `feat/s4-collection-workspace` | S3 验收通过 HEAD |
| S5 | `feat/s5-knowledge-conversations` | S4 验收通过 HEAD |
| S6 | `feat/s6-final-acceptance` | S5 验收通过 HEAD，仅允许测试、证据和文档 |

每阶段验收通过后创建只读回档标签：

```bash
git tag -a checkpoint/s1-network-download -m "S1 network and download accepted"
```

后续阶段依次使用 `checkpoint/s2-standard-log` 至 `checkpoint/s5-knowledge`。标签只在验收通过后创建；未通过不得移动已有标签。

## 2. 每阶段固定执行协议

### 2.1 开始

- [ ] 阅读本总计划、当前子计划、`CLAUDE.md`、`docs/AI_HANDOFF.md` 前 80 行和 `docs/rules/agent-roles.md`。
- [ ] 运行：

```bash
git status --short --branch
git log --oneline -5
git branch --show-current
git worktree list
```

- [ ] 若有不属于当前阶段的未提交改动、同主题 worktree 或起点不符，停止并报告，不得覆盖或隐藏。
- [ ] 从上一个已验收 HEAD 创建本阶段分支。
- [ ] 先运行当前子计划指定的基线测试，记录原始结果。

### 2.2 开发

- [ ] 严格按子计划顺序执行，一次只做一个任务。
- [ ] 每个行为变更先写失败测试，确认失败原因与预期一致，再写最小实现。
- [ ] 每个任务通过其定向测试后提交；不得把下一个任务的文件混进提交。
- [ ] 所有后端设置写入都做“写入 → GET 读回 → 值相等”闭环测试。
- [ ] 所有删除、清空、暂停、取消、重试都必须有正例和反例。
- [ ] UI 关键行为必须用真实浏览器验收，不能只凭 mock 测试判定通过。

### 2.3 阶段提交边界

阶段最后一个提交只允许包含：

- 当前阶段新增/更新的测试；
- 当前阶段验收脚本与脱敏证据；
- 当前阶段文档状态更新。

不得在“验收提交”中补业务代码。若发现业务缺陷，先新增失败测试，再以单独修复提交处理。

### 2.4 阶段验收

每阶段至少运行：

```bash
./.venv/bin/pytest backend/tests tests/backend -q
./.venv/bin/python -m compileall backend shared scripts
cd frontend
pnpm test --run
pnpm build
cd ..
git diff --check
```

另按子计划执行浏览器和真实媒体验收。任何未运行、超时或跳过项都必须标为“需要补充验证”，不得写“全部通过”。

## 3. 跨阶段接口冻结

### 3.1 设置接口

S1 完成后冻结：

```text
GET   /network_config
PATCH /network_config
POST  /network_config/test
GET   /download_config
PATCH /download_config
POST  /download_config/test-cookie
POST  /download_config/import-cookie
DELETE /download_config/cookie
```

S2–S5 只能消费这些接口；若必须改变字段或语义，停止并回到 S1 计划补充设计和迁移。

### 3.2 标准日志接口

S2 完成后冻结：

```text
GET /admin/logs?after_id=&before_id=&level=&category=&task_id=&batch_id=&workspace_id=&limit=
```

返回必须包含 `entries`、`latest_id`、`oldest_id`、`has_more_older`。S3–S5 只写事件，不创建第二个日志 API。

### 3.3 批次接口

S3 完成后冻结：

```text
POST /pipeline/batches/preview
POST /pipeline/batches
GET  /pipeline/batches
GET  /pipeline/batches/{batch_id}
POST /pipeline/batches/{batch_id}/pause
POST /pipeline/batches/{batch_id}/resume
POST /pipeline/batches/{batch_id}/cancel
POST /pipeline/batches/{batch_id}/retry-failed
DELETE /pipeline/batches/{batch_id}
```

S4 的合集页面消费这些接口，不再使用 workspace-scoped 的伪批次页。

### 3.4 合集和知识库身份

- `content_id`：某个可独立编辑副本。
- `lineage_id`：多个合集副本的共同来源身份。
- `item_id`：某个合集内记录身份，不可作为跨合集唯一内容身份。
- `source_id`：某个检索片段的稳定身份，必须包含 workspace、item、字段、分段或时间信息。
- `batch_item_id`：批次内逻辑输入身份；重试沿用该值，仅增加 `attempt_no`。

## 4. 最终 S6 验收

### 4.1 干净 worktree

- [ ] 从 S5 HEAD 建立临时 worktree；不复制主工作树的 `.env`、`data/` 或缓存。
- [ ] 在无 `data/`、无 `.env` 状态执行后端全量测试和 import smoke。
- [ ] 执行所有前端测试、生产构建和 `git diff --check`。

### 4.2 端到端场景

- [ ] 网络/下载：保存并刷新后值一致；智能路由对国内 URL 直连、YouTube 走代理；浏览器 Cookie 失败时可切 cookies.txt；PO Token 和 Visitor Data 不再出现。
- [ ] 标准日志：打开监控默认显示最新日志；能加载更早记录；任务、下载、知识库事件共用一个列表；过滤器 URL 可复现；导出内容已脱敏。
- [ ] 任务中心：多 URL 创建批次；预览重复项；暂停不等于取消；恢复继续调度；失败阶段重试不重复创建合集内容；FAB 与 `/tasks` 统计一致。
- [ ] 合集：列表不拉高页面；批量栏只在选中后出现；复制到多个合集后可独立编辑且可查看同源版本；删除合集默认保留唯一内容；融合笔记新增版本而非覆盖旧版本。
- [ ] 知识库：选一个、多个和全部合集连续提问；每轮重新检索；回答逐条引用；来源预览可回到音视频约 30 秒并尝试自动播放；自动播放拒绝有明确提示；证据不足时不编造。
- [ ] 五个视口检查无横向溢出：`360x800`、`768x1024`、`1280x720`、`1440x900`、`1920x1080`。
- [ ] 浏览器 console error 为 0；网络请求不存在未解释的 4xx/5xx。

### 4.3 最终报告

报告必须列出：

```json
{
  "baseline_commit": "<S5_HEAD>",
  "backend": {"passed": 0, "failed": 0, "skipped": 0},
  "frontend": {"passed_files": 0, "passed_tests": 0},
  "build": "pass",
  "browser_scenarios": [],
  "console_errors": 0,
  "horizontal_overflow": [],
  "unverified": [],
  "known_environment_limits": []
}
```

`unverified` 非空时，最终结论只能是“需要补充验证”。

## 5. 完成定义

只有同时满足以下条件才算完成：

- 五份子计划所有复选框完成；
- 每阶段定向测试、全量测试、构建和浏览器验收通过；
- S1–S5 各自有独立分支、清晰提交和回档标签；
- S6 仅含验收证据/测试/文档，没有业务代码；
- 主工作树中的用户未提交文件没有被修改；
- 没有 PO Token、Visitor Data、双日志、伪暂停或旧列表动作残留；
- 没有把“测试未覆盖”写成“功能已验证”。

## 6. 设计覆盖矩阵

| 批准决策 | 落地计划 |
|---|---|
| 单一标准日志、最新 200、更早分页、7 天/50 MB、脱敏导出 | Standard Log Tasks 1–7 |
| 网络/下载后端事实源、智能路由、解释和测试 | Network/Download Tasks 1–4、6–8 |
| 浏览器 Cookie 优先、cookies.txt 回退、移除 PO Token/Visitor Data | Network/Download Tasks 1、5、7 |
| 一个/多个/全部合集连续问答，每轮重新检索 | Knowledge Tasks 2、4–6、9 |
| AI 回答逐条引用、来源预览、媒体时间跳转/自动播放 | Knowledge Tasks 1、3、10–12 |
| 精确找原文不经过 LLM | Knowledge Task 7 |
| 紧凑合集页、删除无效动作、可复制到多个合集 | Collection Tasks 1、6–8 |
| 独立副本、同源比较、不自动合并 | Collection Tasks 1–2 |
| 融合笔记一等入口和版本历史 | Collection Tasks 3–4、7 |
| 删除合集默认保留内容 | Collection Task 5 |
| 全局任务中心与右下角浮层融合 | Task Center Tasks 8、10 |
| 批量来源、重复预览、常驻笔记设置 | Task Center Tasks 3–4、9 |
| 普通新建素材默认笔记且常用设置一屏可见 | Task Center Task 10 |
| 公平并发、暂停/恢复/取消、失败阶段重试 | Task Center Tasks 5–7 |
