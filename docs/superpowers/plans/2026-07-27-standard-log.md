# Standard Application Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用一个持久、脱敏、可分页的标准日志替代“任务活动/应用日志”双视图，打开监控页即看到最新记录。

**Architecture:** 后端用 JSONL 分段文件保存统一 `LogEvent`，logger handler 和任务状态桥接都写入同一 store；`/admin/logs` 同时支持向后增量和向前翻页；前端只轮询一个接口，默认定位最新，可加载更早日志并导出诊断包。

**Tech Stack:** Python logging、JSONL、FastAPI、React、TypeScript、Vitest、Pytest。

---

## Task 1: 定义持久日志事件和存储

**Files:**
- Create: `backend/app/services/runtime_log_store.py`
- Modify: `backend/app/services/runtime_log_buffer.py`
- Test: `tests/backend/test_runtime_log_store.py`

- [ ] 写失败测试覆盖重启持久性、严格递增 ID、并发 append、7 天清理和 50 MB 上限。

```python
def test_events_survive_store_recreation(tmp_path):
    first = RuntimeLogStore(tmp_path, max_bytes=50 * 1024 * 1024)
    event = first.append(level="INFO", category="app", message="started")
    second = RuntimeLogStore(tmp_path, max_bytes=50 * 1024 * 1024)
    assert second.query(limit=10).entries[0].id == event.id
```

- [ ] 定义事件：

```python
class LogEvent(BaseModel):
    id: int
    timestamp: datetime
    level: Literal["DEBUG", "INFO", "WARNING", "ERROR"]
    category: str
    message: str
    task_id: str | None = None
    batch_id: str | None = None
    workspace_id: str | None = None
    stage: str | None = None
```

- [ ] 存储使用按日期/大小轮转的 JSONL；单行写入临时锁保护，启动时从现有文件恢复最大 ID。
- [ ] 清理规则同时满足：删除 7 天前文件；总大小超过 50 MB 时从最旧分段删除，永不删除当前正在写入的分段。
- [ ] 原 `RuntimeLogBuffer` 保留兼容适配器或由新 store 替换；不得同时维护两个独立队列。
- [ ] 运行 `./.venv/bin/pytest tests/backend/test_runtime_log_store.py -q`。
- [ ] 提交：`feat(logs): persist unified log events`

## Task 2: 统一脱敏

**Files:**
- Modify: `backend/app/services/runtime_log_store.py`
- Modify: `backend/app/services/runtime_log_buffer.py`
- Test: `tests/backend/test_runtime_log_store.py`

- [ ] 写失败参数化测试覆盖 Bearer、Authorization、API key、代理密码、Cookie、cookies.txt 路径和用户主目录。

```python
@pytest.mark.parametrize(
    "raw",
    [
        "Authorization: Bearer abc.def",
        "proxy=http://user:pass@127.0.0.1:7890",
        "Cookie: SID=secret",
        "/Users/alice/Downloads/cookies.txt",
    ],
)
def test_sensitive_values_are_redacted(store, raw):
    event = store.append(level="INFO", category="test", message=raw)
    assert "secret" not in event.message
    assert "pass@" not in event.message
    assert "/Users/alice" not in event.message
```

- [ ] 在进入 store 前统一调用 `sanitize_log_text`；API 和导出层不得另写不一致的脱敏规则。
- [ ] 路径保留可诊断的末级名称，例如 `<HOME>/Downloads/cookies.txt`。
- [ ] 结构化字段只接受允许列表，不把任意 request body 写入日志。
- [ ] 运行测试并提交：`fix(logs): redact credentials and private paths`

## Task 3: 日志 API 支持最新、增量和更早分页

**Files:**
- Modify: `backend/app/routes/admin.py`
- Modify: `backend/app/main.py`
- Test: `tests/backend/test_admin_logs.py`

- [ ] 写失败测试：
  - 无游标返回最新 200 条并按时间升序展示；
  - `after_id` 只返回新记录；
  - `before_id` 返回更早记录；
  - `after_id` 与 `before_id` 同时传入返回 422；
  - task/batch/workspace/level/category 过滤正确。

```python
def test_default_query_returns_latest_window(client, seeded_logs):
    payload = client.get("/admin/logs?limit=200").json()
    assert len(payload["entries"]) == 200
    assert payload["entries"] == sorted(payload["entries"], key=lambda row: row["id"])
    assert payload["latest_id"] == seeded_logs[-1].id
    assert payload["has_more_older"] is True
```

- [ ] 响应固定为：

```json
{
  "entries": [],
  "latest_id": 0,
  "oldest_id": 0,
  "has_more_older": false
}
```

- [ ] lifespan 初始化 store 和 logging handler，并写一条 `application_started`；无 `data/` 时自动创建日志目录。
- [ ] `/admin/logs` 保持只读；“清空”仅清前端过滤/显示，不删除持久日志。
- [ ] 运行定向测试。
- [ ] 提交：`feat(logs): add cursor pagination and startup event`

## Task 4: 任务事件写入标准日志

**Files:**
- Modify: `backend/app/services/task_store.py`
- Modify: `backend/app/services/task_runner.py`
- Test: `tests/backend/test_task_store.py`
- Test: `tests/backend/test_pipeline_tasks.py`

- [ ] 写失败测试：任务创建、阶段变化、成功、失败、取消各写一条结构化事件；重复写相同状态不产生重复事件。

```python
def test_task_transition_emits_structured_log(task_store, log_store):
    task = task_store.create(make_task())
    task_store.update(task.task_id, status=TaskStatus.TRANSCRIBING, progress=30)
    events = log_store.query(task_id=task.task_id, limit=20).entries
    assert events[-1].stage == "TRANSCRIBING"
    assert events[-1].workspace_id == task.project_id
```

- [ ] TaskStore 接收事件 sink 或显式 logger adapter；不得从前端“任务活动”伪造日志。
- [ ] 每条状态日志包含 `task_id`、`batch_id`（存在时）、`workspace_id`、`stage`。
- [ ] 用户输入 URL 只记录域名/平台和脱敏后的标题，不记录 Cookie 或查询串凭据。
- [ ] 运行测试并提交：`feat(logs): bridge task lifecycle events`

## Task 5: 前端服务和单一日志控制台

**Files:**
- Modify: `frontend/src/services/monitor.ts`
- Modify: `frontend/src/components/ui/log-console.tsx`
- Modify: `frontend/src/pages/SettingPage/DeployMonitorPage.tsx`
- Test: `frontend/src/__tests__/DeployMonitorPage.test.tsx`

- [ ] 写失败测试：页面首次只请求 `/admin/logs?limit=200`，不存在任务/应用日志切换。
- [ ] 写失败测试：初始滚到底部；新日志到达且用户在底部时继续跟随；用户上滚后不抢滚动并显示“回到最新”。
- [ ] 写失败测试：点击“加载更早”使用当前 `oldest_id` 作为 `before_id`，并保持视觉锚点。
- [ ] 写失败测试：URL `?batch_id=b1&level=ERROR` 初始化过滤器。

```tsx
expect(screen.queryByRole('tab', { name: '任务活动' })).not.toBeInTheDocument()
expect(screen.queryByRole('tab', { name: '应用日志' })).not.toBeInTheDocument()
expect(screen.getByRole('heading', { name: '标准日志' })).toBeVisible()
```

- [ ] `monitor.ts` 类型包含全部结构化上下文字段和分页元数据。
- [ ] 删除 DeployMonitorPage 对任务列表的独立轮询；系统指标轮询可保留。
- [ ] 过滤器：级别、类别、task、batch、workspace、关键词；改变过滤器同步 URL。
- [ ] 控制台空状态区分“尚无日志”和“当前过滤无匹配”。
- [ ] 运行定向测试并提交：`feat(monitor): show one latest-first standard log`

## Task 6: 诊断导出

**Files:**
- Modify: `backend/app/routes/admin.py`
- Modify: `frontend/src/services/monitor.ts`
- Modify: `frontend/src/pages/SettingPage/DeployMonitorPage.tsx`
- Test: `tests/backend/test_admin_logs.py`
- Test: `frontend/src/__tests__/DeployMonitorPage.test.tsx`

- [ ] 写失败测试：导出只含当前过滤后的最多 5000 条、系统摘要和配置状态，不含密钥/代理密码/Cookie。
- [ ] 增加 `GET /admin/logs/export`，返回 JSON 或 zip；文件名含本地时间。
- [ ] 前端提供“导出诊断”，并明确“已自动脱敏，不包含 API 密钥和 Cookie”。
- [ ] 导出失败显示错误，不改变控制台现有内容。
- [ ] 运行测试并提交：`feat(monitor): export redacted diagnostics`

## Task 7: 阶段验收

- [ ] 运行：

```bash
./.venv/bin/pytest tests/backend/test_runtime_log_store.py tests/backend/test_admin_logs.py tests/backend/test_task_store.py tests/backend/test_pipeline_tasks.py -q
cd frontend
pnpm test --run src/__tests__/DeployMonitorPage.test.tsx
pnpm build
cd ..
git diff --check
```

- [ ] 启动后端，在空日志目录打开监控页，确认立即看到最新 startup 记录。
- [ ] 创建一个成功任务和一个失败任务，确认同一控制台出现对应事件。
- [ ] 重启后端，确认重启前日志仍可加载。
- [ ] 制造超过 200 条测试日志，确认默认最新和更早分页。
- [ ] 检查 console error=0、五视口无横向溢出。
- [ ] 验收提交：`test(acceptance): verify persistent standard log`
