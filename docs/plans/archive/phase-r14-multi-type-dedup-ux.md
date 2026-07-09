---
name: phase-r14-multi-type-dedup-ux
status: ready
branch: feat/phase-r14-multi-type-dedup-ux
baseline_commit: e117f6e  # R13 merge 之后；建议先做 R13.6 再做 R14
owner: ds v4-pro via ccswitch
created_date: 2026-05-25
---

# Phase R14 — 多类型重复提交去重的用户体验改进

## 背景

R7.2 让"单 URL 多类型默认全勾"成为默认行为。用户实测发现：

- 提交一次 video + audio 后，**第二次同 URL 再次全勾提交** → 后端 `task_runner._has_active_duplicate` 拦下 video item 的 download 任务，返回 409
- 前端 toast 报「视频任务创建失败: Request failed with status code 409」
- 用户截图反馈：「已创建 1/2 个素材」很吓人，不知道哪边出问题

### 这是 bug 吗？

**不是**。`_has_active_duplicate` 的语义正确：同 project + 同 URL + task_type='download' 还在 active 时拒绝重复提交，避免浪费下载带宽。

audio task_type 不在 dedup 表里，所以单 URL 多类型场景的**第一次提交**两个 item 都能成功；**第二次提交**才会撞。

### 但 UX 不友好

1. 错误信息「Request failed with status code 409」是 axios 原文，没把后端 detail（"该链接已有正在执行的下载任务 xxx"）暴露给用户
2. 用户不知道为什么 1/2 失败、失败的那个该怎么办
3. 没有"跳到已有任务"的快捷入口

## 目标

把 409 的处理从「报红 toast 弹错误」改成「友好提示 + 跳转到已有任务」。

## 范围（3 项 commit）

| # | 内容 | 文件 | commit |
|---|---|---|---|
| R14.1 | 后端 409 详情结构化：返回 `existing_task_id` 字段，便于前端跳转 | workspaces.py L1305-1309 + 新增 schema | R14.1 |
| R14.2 | 前端 AddMaterialModal 识别 409 后改用 info toast + "查看已有任务"按钮 | AddMaterialModal.tsx L298-302 + PreflightDrawer | R14.2 |
| R14.3 | 前端在多类型提交前预检：sniff 阶段把"同 URL 已有 active download"标注，UI 默认不再勾该类型 | AddMaterialModal.tsx + 新建 API hook | R14.3 |

---

## R14.1 详细步骤 — 后端 409 结构化

**文件**：`backend/app/routes/workspaces.py` L1305-1309

**当前代码**：

```python
try:
    task_rec = _pipeline_runner.create_task(project_id, task_type, payload)
except ValueError as err:
    # 例如「同 URL 已有正在执行的下载任务」
    raise HTTPException(status_code=409, detail=str(err)) from err
```

**改动**：让 detail 变成结构化 dict，前端能拿到 existing_task_id：

```python
try:
    task_rec = _pipeline_runner.create_task(project_id, task_type, payload)
except ValueError as err:
    msg = str(err)
    # R14.1 从 task_runner 错误信息里提取 existing_task_id（格式："...已有正在执行的下载任务 xxx，..."）
    import re as _re
    m = _re.search(r"任务\s*([a-zA-Z]+-[0-9a-f]+)", msg)
    existing_id = m.group(1) if m else ""
    raise HTTPException(
        status_code=409,
        detail={
            "message": msg,
            "existing_task_id": existing_id,
            "reason": "duplicate_active_download",
        },
    ) from err
```

> 若觉得用正则解析错误信息脆弱，可以改造 `task_runner.create_task` 让它在 ValueError 上挂 attribute，或返回 (rec, existing_id) tuple。但本子任务先用正则，简单稳定。

### 测试

新增 `tests/backend/test_pipeline_409_structure.py`：

```python
def test_409_returns_structured_detail_with_existing_task_id(...):
    # 1. 创建一个 active download task
    # 2. 再次同 URL POST /workspaces/{ws}/items/{item}/pipeline
    # 3. 断言 response.status_code == 409
    # 4. 断言 response.json()["detail"]["existing_task_id"] 非空
    # 5. 断言 response.json()["detail"]["reason"] == "duplicate_active_download"
    ...
```

**commit**：`feat(phase-r14): R14.1 startItemPipeline 409 详情结构化，暴露 existing_task_id`

---

## R14.2 详细步骤 — 前端友好提示 + 跳转按钮

**文件**：`frontend/src/components/workspace/AddMaterialModal.tsx` L298-302

**当前**：

```typescript
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : '创建失败'
  errors.push(`${TYPE_META[type].label}: ${msg}`)
  toast.error(`${TYPE_META[type].label}任务创建失败: ${msg}`)
}
```

**改动**：识别 axios 409 错误并提取 existing_task_id，改用 info toast + action：

```typescript
} catch (err: unknown) {
  // R14.2 axios 错误：err.response.status === 409 + detail.existing_task_id 时显示友好提示
  const axiosErr = err as { response?: { status?: number; data?: { detail?: { existing_task_id?: string; message?: string; reason?: string } } } }
  const status = axiosErr?.response?.status
  const detail = axiosErr?.response?.data?.detail
  const existingId = detail?.existing_task_id
  const reason = detail?.reason

  if (status === 409 && reason === 'duplicate_active_download' && existingId) {
    // 视为成功（用户当前操作的目的——让这个 URL 跑起来——已经达成）
    succeeded++
    if (!firstTaskId) { firstTaskId = existingId; firstItemId = itemId }
    toast.info(`${TYPE_META[type].label} 已有正在执行的任务`, {
      description: '将跳转到已有任务',
      action: {
        label: '查看',
        onClick: () => window.location.assign(`/processing/${existingId}`),
      },
    })
  } else {
    const msg = err instanceof Error ? err.message : '创建失败'
    errors.push(`${TYPE_META[type].label}: ${msg}`)
    toast.error(`${TYPE_META[type].label}任务创建失败: ${msg}`)
  }
}
```

**同步改 PreflightDrawer.tsx L334 附近的同类逻辑**（"已创建 X/Y 个素材"的 toast 位置），相同改造。

### 测试

`frontend/src/__tests__/AddMaterialModal.test.tsx` 增加 1 个用例：

```typescript
it('shows info toast with link when receiving 409 duplicate_active_download', async () => {
  // mock createPipelineTask 第一次成功，第二次抛 axios 409
  // 断言 toast.info 被调用（不是 toast.error）
  // 断言 toast 的 action.label === '查看'
})
```

**commit**：`feat(phase-r14): R14.2 前端识别 409 duplicate_active_download，改用 info toast + 跳转按钮`

---

## R14.3 详细步骤 — 提交前预检（可选，做不做听用户）

**目标**：在 AddMaterialModal 打开时（已经走过 sniff），调一次 `/pipeline/tasks?status=active&url=<x>`（**需新增端点**）查同 URL 已有的活跃任务，把对应类型的 chip 默认置为 disabled 并提示「已在跑 audio-xxx」。

**新端点**（backend/app/routes/pipeline.py）：

```python
@router.get("/tasks/active-by-url")
def list_active_tasks_by_url(url: str, project_id: str | None = None) -> dict:
    """R14.3 列出同 URL 正在 active 的任务，前端用来在多类型勾选 UI 上提示已存在。"""
    norm = _runner._normalize_url_for_dedup(url)
    if not norm:
        return {"data": []}
    out = []
    for rec in _store.list_all():
        if project_id and rec.project_id != project_id:
            continue
        if rec.status in TERMINAL_STATUS_VALUES:
            continue
        existing = _runner._normalize_url_for_dedup(str(rec.payload.get("url") or rec.payload.get("source") or ""))
        if existing == norm:
            out.append({"task_id": rec.task_id, "task_type": rec.task_type, "status": rec.status})
    return {"data": out}
```

**前端**：

- 新 hook `useActiveTasksByUrl(url)` 拉一次
- 在 type-chip 上：若 `data.some(t => maps_to_type(t.task_type) === thisType)` → chip 显示 mono 提示 `已在跑 · 点击查看`，点击跳 `/processing/<id>`，**不会再下勾**

> ⚠️ 此项**视情况做**。R14.1+R14.2 已经把"重复提交"的体验改友好；R14.3 是把"提前避免重复提交"做绝。如果用户测试 R14.1+R14.2 后觉得够用，R14.3 可以延后或丢弃。

### 决议点

- **是否做 R14.3**：先做 R14.1 + R14.2，**部署后等用户反馈**再决定。

---

## 验收（R14.1 + R14.2 完成后）

1. 同 URL 两次全勾提交 video + audio：
   - 第一次：两个任务都建成功，toast.success「已创建 2 个素材」
   - 第二次：audio 重复（如果还 active）变成 info「已有正在执行的任务 · 查看」按钮
   - **不再出现红色 toast.error 报错**
2. 跑 `pnpm build && pnpm test --run && .venv/bin/python -m pytest tests/backend -q`
3. 不 push、不自行 merge，停下等授权

---

## 禁止事项

- ❌ 不放宽 dedup 规则（允许同 URL 重复跑同类型任务）—— 这会浪费下载带宽
- ❌ 不动 task_runner.create_task 内部去重比较逻辑（不在本 phase 范围）
- ❌ 不动 task schema
- ❌ 不 push 远端

---

## 备注

R14 顺序建议：**先做 R13.6，再做 R14**。
- R13.6 修标题显示 bug，是用户实测最直观的痛点
- R14 改 UX 优化错误处理，影响范围小但易测
- 两者**不相互依赖**，可以并行；但 R13.6 更紧急
