# Task Center and Batch Processing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把右下角任务浮层、现有 pipeline 任务和批量导入统一为一个任务中心，支持预览、暂停、恢复、取消和失败阶段重试。

**Architecture:** 扩展现有 `TaskRecord`，新增持久 `TaskBatch` 和公平调度器；每个批次项保留稳定 `batch_item_id`，重试仅增加 attempt；全局 `/tasks` 是完整管理入口，FAB 只展示活动/异常摘要。

**Tech Stack:** FastAPI、Pydantic、JSON 持久化、现有 TaskRunner、React Router、Zustand、Vitest、Pytest、Playwright。

---

## Task 1: 扩展任务身份但保持兼容

**Files:**
- Modify: `backend/app/models/tasks.py`
- Modify: `backend/app/services/task_store.py`
- Modify: `frontend/src/types/task.ts`
- Test: `tests/backend/test_task_store.py`
- Test: `frontend/src/__tests__/taskStore.test.ts`

- [ ] 写失败测试：旧任务 JSON 无批次字段仍可加载；新任务可保存/读回 `batch_id`、`batch_item_id`、`attempt_no`。

```python
def test_retry_identity_round_trips(task_store):
    task = TaskRecord(
        task_id="attempt-2",
        batch_id="batch-1",
        batch_item_id="item-1",
        attempt_no=2,
        retry_of="attempt-1",
        **required_task_fields(),
    )
    task_store.save(task)
    assert task_store.get("attempt-2").batch_item_id == "item-1"
```

- [ ] 新字段全部 optional/default，避免破坏现有 standalone task。
- [ ] 从前端 `CreatePipelineTaskPayload` 删除 PO Token、Visitor Data 和旧 cookie dir 字段。
- [ ] 运行定向测试并提交：`feat(tasks): add stable batch task identity`

## Task 2: 批次模型和原子存储

**Files:**
- Create: `backend/app/models/task_batch.py`
- Create: `backend/app/services/task_batch_store.py`
- Test: `tests/backend/test_task_batch_store.py`

- [ ] 写失败测试覆盖创建、更新、原子写、损坏文件隔离和聚合计数。

```python
class BatchStatus(str, Enum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
    COMPLETED = "COMPLETED"
    PARTIAL = "PARTIAL"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    PARTIAL_CANCELLED = "PARTIAL_CANCELLED"

class TaskBatchItem(BaseModel):
    batch_item_id: str
    source_url: str
    title: str = ""
    duplicate_action: Literal["new", "skip", "copy", "reprocess"] = "new"
    selected: bool = True
    task_ids: list[str] = []
    current_attempt: int = 0
```

- [ ] `TaskBatch` 包含 `batch_id`、状态、来源快照、目标合集、设置快照、items、计数、创建/更新时间。
- [ ] 每个 batch 一个 JSON 文件，使用临时文件 + `os.replace` 原子写。
- [ ] 聚合状态由 item 最新 attempt 推导，不能由前端自由写。
- [ ] 运行测试并提交：`feat(tasks): persist task batches`

## Task 3: 批次预览复用现有来源解析

**Files:**
- Modify: `backend/app/routes/pipeline.py`
- Modify: existing batch-source resolver in `backend/app/routes/workspaces.py` or extract it to `backend/app/services/batch_source_resolver.py`
- Modify: `backend/app/services/workspace_store.py`
- Test: `tests/backend/test_task_batches.py`

- [ ] 写失败测试覆盖多 URL、本地文件、Bilibili 合集/收藏夹/UP 主/分 P、YouTube playlist。
- [ ] 写失败测试：按 `lineage_id`、标准化 URL、平台内容 ID 检测重复，并返回可选动作。

```python
def test_preview_marks_existing_lineage(client, workspace_with_item):
    response = client.post(
        "/pipeline/batches/preview",
        json={"source_type": "multi_url", "raw_input": workspace_with_item.source_url},
    )
    row = response.json()["items"][0]
    assert row["duplicate"] is True
    assert set(row["allowed_actions"]) == {"skip", "copy", "reprocess"}
```

- [ ] 解析器返回统一 `ResolvedBatchSourceItem`，不得让前端自行抓取或解析平台集合。
- [ ] 预览不创建 workspace、task、batch 或媒体文件。
- [ ] 目标合集可选；未选时创建一个明确命名的新合集，名称可在预览页修改。
- [ ] 运行测试并提交：`feat(tasks): preview batch sources and duplicates`

## Task 4: 创建批次和设置快照

**Files:**
- Modify: `backend/app/routes/pipeline.py`
- Create: `backend/app/services/task_batch_service.py`
- Modify: `frontend/src/components/workspace/NoteSettingsPanel.tsx`
- Test: `tests/backend/test_task_batches.py`

- [ ] 写失败测试：创建只接受预览返回的稳定 item 身份和用户选择；保存笔记风格、区分说话人、画面分析、笔记类型等常驻设置快照。
- [ ] 所有素材默认目标为笔记，不再有“学习笔记”动作选择。
- [ ] 每个 selected/non-skip item 创建一个 pipeline task，并写入 batch 身份；copy 动作复用合集复制，不重新分析。
- [ ] 请求幂等键重复时返回原批次，不创建第二批任务。
- [ ] 标准日志记录 `batch_created` 和 item 数，不记录 Cookie/完整凭据 URL。
- [ ] 运行测试并提交：`feat(tasks): create batches from reviewed preview`

## Task 5: 公平调度、暂停、恢复和取消

**Files:**
- Create: `backend/app/services/task_batch_scheduler.py`
- Modify: `backend/app/services/task_runner.py`
- Modify: `backend/app/routes/pipeline.py`
- Test: `tests/backend/test_batch_scheduler.py`
- Test: `tests/backend/test_task_batches.py`

- [ ] 用假 runner 写失败测试：两个批次在并发 2 时轮流获得槽位，不能让大批次饿死小批次。
- [ ] 写失败测试：暂停只阻止新 item 启动，当前阶段可安全完成；恢复继续调度。
- [ ] 写失败测试：取消阻止后续阶段/新任务，并将未启动项标取消；已成功项保留，批次为 `PARTIAL_CANCELLED`。

```python
def test_pause_is_not_cancel(scheduler, batch):
    scheduler.start_one(batch.batch_id)
    scheduler.pause(batch.batch_id)
    assert scheduler.current_task(batch.batch_id).cancel_requested is False
    assert scheduler.next_task(batch.batch_id) is None
```

- [ ] 并发上限读取 S1 的 DownloadConfig；运行中降低并发不杀死现有任务，只限制新任务。
- [ ] 后端重启时：已运行 attempt 按现有恢复规则标失败；批次保留，可重试，不伪装继续运行。
- [ ] 运行定向测试并提交：`feat(tasks): schedule batches with pause and resume`

## Task 6: 失败阶段重试

**Files:**
- Modify: `backend/app/services/task_batch_service.py`
- Modify: `backend/app/routes/pipeline.py`
- Modify: `backend/app/services/pipeline_tasks.py`
- Test: `tests/backend/test_task_batches.py`
- Test: `tests/backend/test_pipeline_tasks.py`

- [ ] 写失败测试：`retry-failed` 只为失败项创建新 attempt，保留 `batch_item_id`，`attempt_no + 1`，`retry_of` 指向上一 attempt。
- [ ] 写失败测试：已有下载/转写/分析产物按阶段恢复，不重复创建 workspace item。
- [ ] 若无法安全恢复某阶段，明确从最近可验证阶段开始，并在日志写出恢复点。
- [ ] 对非终态批次调用 retry 返回 409；没有失败项返回 409。
- [ ] 运行测试并提交：`feat(tasks): retry failed batch stages safely`

## Task 7: 批次 API 契约

**Files:**
- Modify: `backend/app/routes/pipeline.py`
- Test: `tests/backend/test_task_batches.py`

- [ ] 实现并测试：

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

- [ ] 列表支持 status/source/workspace/keyword/created 范围过滤和分页。
- [ ] DELETE 只允许终态，且只删除任务中心记录；是否删除合集内容必须另走合集删除流程。
- [ ] 所有冲突状态返回 409 和可读 `detail`。
- [ ] 运行测试并提交：`feat(tasks): expose batch lifecycle API`

## Task 8: 全局任务中心路由和导航

**Files:**
- Modify: `frontend/src/router.tsx`
- Modify: `frontend/src/layouts/AppShell.tsx`
- Create: `frontend/src/types/taskBatch.ts`
- Create: `frontend/src/services/batches.ts`
- Create: `frontend/src/pages/TaskCenter/TaskCenterPage.tsx`
- Create: `frontend/src/pages/TaskCenter/task-center.css`
- Test: `frontend/src/__tests__/TaskCenterPage.test.tsx`
- Test: `frontend/src/__tests__/productUiFiltering.test.tsx`

- [ ] 写失败测试：侧边栏有“任务中心”；`/tasks` 三个视图为批次、任务、失败；默认批次。
- [ ] 写失败测试：筛选、分页、空态、加载态、错误态完整；点击批次进入详情。
- [ ] 任务行显示所属批次/合集/阶段/进度；失败行提供重试和日志链接。
- [ ] 日志链接格式为 `/settings/monitor?batch_id=batch-1&task_id=task-1&level=ERROR`，实际值使用当前记录 ID。
- [ ] 运行定向测试并提交：`feat(tasks-ui): add global task center`

## Task 9: 新建批量任务一页完成

**Files:**
- Create: `frontend/src/pages/TaskCenter/BatchCreatePage.tsx`
- Create: `frontend/src/pages/TaskCenter/components/BatchSourceInput.tsx`
- Create: `frontend/src/pages/TaskCenter/components/BatchPreviewTable.tsx`
- Modify: `frontend/src/components/workspace/NoteSettingsPanel.tsx`
- Test: `frontend/src/__tests__/BatchCreatePage.test.tsx`

- [ ] 写失败测试：五类平台集合加多 URL/本地文件均可选择；预览前不创建任务。
- [ ] 预览表逐项选择 skip/copy/reprocess，并支持全选。
- [ ] 合集选择支持一个目标合集或新建合集；批次问答范围不在此页配置。
- [ ] 笔记风格、区分说话人、画面分析、识别类型等常用项始终可见；页面 1440x900 首屏能看到来源、目标、常用设置和提交按钮。
- [ ] 删除“你要做什么/学习笔记”单选。
- [ ] 运行测试并提交：`feat(tasks-ui): create reviewed batch jobs`

## Task 10: 普通新建素材默认笔记且常用设置常驻

**Files:**
- Modify: `frontend/src/components/workspace/AddMaterialModal.tsx`
- Modify: `frontend/src/components/workspace/GlobalAddMaterialModal.tsx`
- Modify: `frontend/src/components/workspace/NoteSettingsPanel.tsx`
- Test: `frontend/src/__tests__/AddMaterialModal.test.tsx`
- Test: `frontend/src/__tests__/GlobalAddMaterialModal.test.tsx`

- [ ] 写失败测试：普通单条导入不再显示“你要做什么/学习笔记”；提交 payload 的产品意图固定为 note。
- [ ] 写失败测试：链接、本地上传、Bilibili/YouTube 等来源下，笔记风格、识别类型、区分说话人和画面分析始终可见。
- [ ] 复用一个 `NoteSettingsPanel`，普通导入和批量导入不能维护两套字段或默认值。
- [ ] 1440x900 下无需滚动即可看到素材源、合集、常用设置和开始生成；360x800 允许 modal 内容区滚动，但底部提交按钮保持可达。
- [ ] 低频补充说明可折叠；不得把四个常用设置塞进“高级设置”。
- [ ] 运行定向测试并提交：`feat(add-material): keep common note settings visible`

## Task 11: 批次详情和 FAB 融合

**Files:**
- Create: `frontend/src/pages/TaskCenter/BatchDetailPage.tsx`
- Modify: `frontend/src/components/FloatingTaskQueue.tsx`
- Modify: existing `frontend/src/pages/BatchProcessingPage/*`
- Test: `frontend/src/__tests__/BatchDetailPage.test.tsx`
- Test: `frontend/src/__tests__/FloatingTaskQueue.test.tsx`

- [ ] 写失败测试：批次详情显示汇总、item 表、attempt、暂停/恢复/取消/重试和日志链接。
- [ ] 写失败测试：FAB 优先按 `batch_id` 聚合，standalone task 单列；只显示运行中或需关注项。
- [ ] 删除 FAB 的“暂停全部 = cancelTask”实现；暂停调用 batch pause，取消需二次确认。
- [ ] FAB “查看全部”进入 `/tasks`；批次行进入 `/tasks/batches/:id`。
- [ ] 旧 `/processing/batch/:workspaceId` 重定向到任务中心或保留只读兼容，不再作为新入口。
- [ ] 运行测试并提交：`feat(tasks-ui): unify batch detail and floating summary`

## Task 12: 阶段验收

- [ ] 运行后端批次/任务全量定向测试、前端任务中心测试、生产构建、`git diff --check`。
- [ ] 浏览器创建含成功/失败/重复项的批次；核对 FAB、列表、详情三处计数一致。
- [ ] 真实验证暂停后无新 item 开始、恢复后继续、取消不会删除成功内容。
- [ ] 真实验证失败阶段重试不产生重复 workspace item。
- [ ] 多批次并发观察至少 10 个调度选择，确认无单批次独占。
- [ ] 验收提交：`test(acceptance): verify task center and batch lifecycle`
