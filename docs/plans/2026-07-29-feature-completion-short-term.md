# NoteBi 功能完成短期计划

状态：用户已确认
基线：`main` 的 `09f2797`
目标平台：macOS / Linux
执行方式：单 Agent、单阶段、独立分支、验证后再交接
执行进度：S0 已由 `ad29776` 完成，S1 已由 `d277157` 完成；下一阶段为 S2

## 1. 背景与现状证据

项目清理和音乐分析退役已经完成。当前主线具有真实可用的单素材导入、
四类笔记、合集、资料库、知识库、设置和任务执行链路；短期工作不是重做产品，
而是关闭半成品和界面承诺。

已确认缺口：

1. `workspaces.import_batch_source` 直接创建普通 pipeline task，没有写入
   `batch_id` / `batch_item_id`。现有本地批次记录停在 `running 0/2`，
   对应 task 已经 `SUCCESS`。
2. `ExportTab` 支持多选，却只调用第一个 item 的单项导出；已有
   `POST /workspaces/{id}/items/batch-export` 没有接入。
3. “任务默认勾选”是可见占位页，没有持久化和消费链路。
4. 文本笔记工具栏的加粗、斜体、标题、列表按钮全部禁用。
5. 合集“风格报告”是 `Phase [C]` 占位，用户已确认删除。
6. `docs/rules/business-contract.md` 仍包含音乐路径和“画面提示词生成”旧契约，
   必须先修正，避免后续实现恢复已退役功能。
7. 前端完整 lint 基线为 `101 errors / 8 warnings`；它是独立质量债，
   不得混入功能提交顺手大改。

WIP 分支 `codex/wip-batch-settings-cleanup` 只作为证据保留，不可整分支合并：

- 保存提交 `e90785b` 只有 6 个实际改动文件，但分支基线早于清理；
  整体合并会恢复大量已删除历史文件。
- WIP 事后补建 `TaskBatch`，却没有通过 `TaskBatchService` 调度和关联 task，
  无法收到完成回调。
- WIP 在 Cookie 模式为 `none` 时静默尝试浏览器 Cookie，不符合用户设置。
- 可重新实现的思路仅包括：合理的解析超时、下载设置保存区和批量弹窗布局。

## 2. 已冻结产品决定

- 删除“风格报告”，不开发替代报告。
- 实现“任务默认勾选”最小版，只包含当前笔记能力。
- 实现文本编辑器加粗、斜体、标题和列表工具栏。
- 不恢复 BPM、调性、风格、情绪、乐器、氛围、音乐分段、音乐教学、
  Suno / Udio 提示词或任何其他音乐分析。
- 浮动任务窗只在存在运行中任务时显示。
- 代理只由网络设置控制；Cookie 模式必须严格服从用户选择。
- 当前不做 Windows、安装包或整合包。

## 3. 优先级

评分公式：`(影响 + 风险) × (6 - 工作量)`，每项 1–5 分。
基础依赖可覆盖纯分数排序。

| 顺序 | 项目 | 影响 | 风险 | 工作量 | 分数 | 原因 |
|---|---|---:|---:|---:|---:|---|
| S0 | 修正规则契约并删除风格报告 | 5 | 4 | 1 | 45 | 防止后续按旧规则恢复音乐/提示词能力 |
| S1 | 批次生命周期闭环 | 5 | 5 | 3 | 30 | 当前会留下永久 running 记录，阻断任务中心可信度 |
| S2 | 多选批量导出 | 4 | 3 | 1 | 35 | UI 明确承诺与结果不一致，且后端能力已存在 |
| S3 | 任务默认勾选 | 4 | 3 | 3 | 21 | 可见设置页目前是空承诺，涉及保存和消费链路 |
| S4 | 文本编辑器工具栏 | 3 | 2 | 2 | 20 | 高频基础编辑能力缺失 |
| S5 | 可见占位和遗留入口清零 | 2 | 3 | 2 | 15 | 避免用户进入无功能页面，降低维护面 |
| S6 | lint 与验证债收敛 | 3 | 3 | 5 | 6 | 重要但不应阻断前面的小而确定修复 |

## 4. 分阶段执行

### S0：修正规则与删除风格报告

目标：

- 从合集头部、Tab 定义、面板分支、类型和相关测试中删除“风格报告”。
- 修正 `docs/rules/business-contract.md`：
  - 删除“仅分析音乐”和“纯音乐路径”；
  - 将旧“画面提示词生成”改为当前存在的画面分析/截帧依赖；
  - 明确无可用人声时给出可理解的失败或部分完成结果，不进入音乐分析。
- 检查 `docs/rules/project-map.md` 等当前规则是否仍把 AI 分镜、提示词生成或
  Replica 当作可开发主线。

验收：

- 当前前端路由和可见文案不存在“风格报告”或 `Phase [C]`。
- 当前规则中不存在音乐分析或提示词生成的正向开发指令。
- 前端相关窄测试通过，`git diff --check` 通过。

### S1：统一批次生命周期

目标：

- 所有批量入口最终调用同一个 `TaskBatchService.create_batch`。
- 禁止“先启动普通 task，再事后伪造批次记录”。
- 每个真实 task 必须持久化正确的 `batch_id`、`batch_item_id`、`attempt_no`。
- task 终态回调必须更新 batch item 和批次计数。
- 暂停只阻止派发新项，不取消已运行项；恢复继续派发。
- 取消、失败重试、后端重启恢复、幂等提交具有一致行为。
- 批量来源解析读取用户明确选择的 Cookie 模式；`none` 不得自动读取浏览器。
- 解析与下载实际网络请求只服从网络设置。

建议架构：

1. 保留 `/pipeline/batches/preview` 和 `/pipeline/batches` 为唯一批次契约。
2. 让工作台/AddMaterial 的合集、收藏夹、UP 主、分 P、播放列表入口复用该契约。
3. 将来源解析、重复项识别、workspace/item 落库和 task 调度拆成可测试服务；
   不在大型路由函数中复制生命周期。
4. `/workspaces/batch-sources/import` 若暂时保留，只允许作为兼容适配层，
   内部必须委托统一批次服务。

重点文件/接口：

- `backend/app/routes/task_batches.py`
- `backend/app/services/task_batch_service.py`
- `backend/app/services/task_runner.py`
- `backend/app/routes/workspaces.py`
- `frontend/src/components/workspace/AddMaterialModal.tsx`
- `frontend/src/pages/TaskCenterPage/*`
- `frontend/src/services/taskBatches.ts`

测试：

- 服务层：成功、失败、暂停/恢复、取消、重试、重启恢复、并发公平。
- API：预览、创建、重复提交、404/422/409、终态删除。
- 跨层回归：两个短任务完成后批次必须从 `0/2 running` 变成 `2/2 completed`；
  task JSON 的两个批次字段必须非空且与批次记录一致。
- 浏览器：创建批次、进入详情、看到实时计数、失败项重试、任务中心过滤。

风险停点：

- 若需要改变现有 workspace/item 数据结构或迁移已保存批次，先停下确认迁移方案。
- 若真实平台必须读取浏览器 Cookie 才能验收，先让用户明确选择 Cookie 模式；
  不自动绕过设置。

### S2：修复多选导出

目标：

- 选 1 项调用单项导出或批量接口均可，但结果必须准确。
- 选多项时调用现有 batch-export，输出一个 ZIP，包含所有成功选中项。
- 部分素材无结果时明确返回跳过/失败信息，不静默少导。

重点文件：

- `frontend/src/pages/WorkspacePage/TaskboardPage/ExportTab.tsx`
- `frontend/src/services/workspaces.ts`
- `backend/app/routes/workspaces.py`
- `tests/backend/test_export_api.py`

验收：

- 选择 N 项，ZIP 中存在 N 项对应目录或清单。
- 前端成功文案不能在只导出第一项时出现。
- 0 项禁用、缺失 item、文件名清洗和混合媒体测试通过。

### S3：实现任务默认勾选

最小字段：

- 默认摘要模板；
- 视频默认是否进行画面分析/嵌入帧；
- 默认截帧间隔；
- 音视频默认是否区分说话人；
- 默认说话人数：自动或明确人数。

明确不做：

- 不保存具体模型选择，继续使用模型与渠道页的有效默认模型。
- 不增加任何音乐分析字段。
- 不把旧 `music_analysis` 或未知旧字段回写。

契约：

- 设置必须有后端持久化和 GET/PATCH 读回。
- 页面保存成功后 GET 值相等，刷新后仍一致。
- 优先级为：本次任务显式选择 > 已保存任务默认值 > 代码默认值。
- 单素材 AddMaterial 和 `/tasks/new` 批次页消费同一份默认值。
- 老设置缺少字段时保持当前默认行为。

风险停点：

- 新增设置结构若需要迁移或会覆盖现有用户设置，先展示兼容读写方案。
- 若某字段在实际 pipeline 中没有消费者，不在 UI 中先做假开关。

### S4：文本编辑器基础工具栏

目标：

- 加粗、斜体支持选区包裹和无选区插入。
- 标题和列表执行块级转换，不用脆弱的字符串替换破坏 Markdown。
- 命令失败时不改变正文，自动保存和版本历史保持现有行为。

重点文件：

- `frontend/src/pages/result/NoteShell/MilkdownEditor.tsx`
- `frontend/src/pages/result/NoteShell/index.tsx`
- `frontend/src/store/lnEditorStore.ts`

验收：

- 四个按钮不再禁用，并有可访问名称和选中/不可用状态。
- 编辑、保存、刷新读回、历史版本恢复均保持正文一致。
- 中文、空选区、多行选区和嵌套列表至少各有一个测试。

### S5：可见占位和遗留入口清零

- 扫描当前路由、主导航、设置导航和合集页面。
- 用户可见入口只能是完整功能、明确兼容重定向或真实空状态。
- 删除无路由且无复用调用的旧页面入口；被 NoteShell 复用的
  `LNVideoPanel`、`LNTranscriptPanel`、时间码工具和样式不得误删。
- 核对视频质量等 UI 参数是否有真实消费者；没有则删除入口或补全消费，
  不保留假设置。

验收：

- 当前路由中不存在“开发中”“即将上线”“Phase [X]”。
- 无效旧页面不进入生产 bundle。
- 全部路由冒烟无 console error。

### S6：质量收口与 macOS/Linux 验收

质量债分批处理：

1. 先修阻断 `pnpm lint` 的规则错误，不做无关 UI 重构。
2. 修复 Vitest 嵌套 `vi.mock` 警告、pytest 未注册 mark 和 Starlette/httpx 警告。
3. 分析生产大 chunk，只有能安全拆分且有测量收益时才调整。
4. 每一批 lint 修复独立提交，避免掩盖功能回归。

最终自动验证：

```bash
.venv/bin/python -m pytest tests/backend -q
cd frontend && pnpm test
cd frontend && pnpm lint
cd frontend && pnpm build
.venv/bin/python -m compileall backend shared
.venv/bin/python -m pip check
git diff --check
```

最终真实验收矩阵：

- 输入：URL、单本地文件、多 URL、平台合集/播放列表、本地批量文件。
- 类型：视频、音频、图片、文本。
- 结果：任务终态、笔记生成、编辑保存、导出、知识库检索、删除同步。
- 恢复：失败、取消、重试、后端重启、网络直连/智能路由、Cookie 三种模式。
- 证据：API JSON + Playwright DOM 断言 + console error；只有视觉问题读取截图。

## 5. 短期完成定义

同时满足以下条件才算功能完成：

1. S0–S6 全部完成，当前计划中的可见占位为 0。
2. 四类笔记和批量流程具有真实 API/浏览器证据，不只是页面能打开。
3. 全量后端测试、前端测试、lint 和生产构建通过。
4. 设置满足保存、GET 读回、刷新一致。
5. `main` 工作区干净，数据目录和密钥未纳入提交。
6. 用户确认 macOS/Linux 功能可进入发布准备。

达到这些条件后，才允许进入长期路线图的 Windows 阶段。
