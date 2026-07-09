---
phase: IP.7
title: PreflightDrawer 真接 workspace item 流程 + 自动建空间
status: done
branch: feat/ip7-preflight-fix
created: 2026-05-20
completed_date: 2026-05-20
priority: P0（阻塞：当前所有 URL 任务跑不通）
estimate_hours: 2-3
actual_hours: 1.5
depends_on: IP.1~IP.6 已合并
commits:
  - 28693b5 feat(IP.7.1): 后端 /workspaces/auto-create 接口（LLM 自动命名）
  - 2c45989 fix(IP.7.2): PreflightDrawer 改走 workspace item 标准流程
  - e83a69b feat(IP.7.3): bridge 透传 Composer 高级参数到 download payload
  - 5bbda50 test(IP.7.4): API 级冒烟测试通过
---

# IP.7 修复"任意 URL 任务都失败"的 root cause

## 问题

用户粘 B 站 URL → 「开始解析」→ Processing 显示 `no videos found in /data/workspaces/.../videos`。

## Root cause

`frontend/src/pages/WorkbenchPage/PreflightDrawer.tsx` 第 153 / 174 行直接调 `createPipelineTask({ task_type: 'analyze', payload: { url } })`，**绕过了后端的 workspace item 桥接逻辑**。

后端 `_bridge_to_pipeline_payload`（workspaces.py:792）本来会判断：
- `source=url` → 先建 `download` 任务，download 成功后回调自动 enqueue `analyze`
- `source=local` → 直接 `analyze`

但 PreflightDrawer 写死 `analyze`，且每次用 `crypto.randomUUID()` 当 project_id，跟 workspace 完全脱钩。

## 修复策略

PreflightDrawer 改成走标准 3 步：

```
1. POST /workspaces/{wid}/items                 → 创建 item（source=url）
2. PUT  /workspaces/{wid}/items/{iid}/preflight → 保存参数
3. POST /workspaces/{wid}/items/{iid}/start     → 后端 bridge 创建 download
                                                  → 回调自动链 analyze
```

## 子任务

### IP.7.1 后端：新增「自动建工作空间」接口（30min）

**改动文件**：`backend/app/routes/workspaces.py`

**新增端点**：
```python
@router.post("/auto-create")
def auto_create_workspace(req: AutoCreateRequest) -> Dict[str, Any]:
    """根据 hint URL/text 用 LLM 生成名字，自动建空间。"""
```

**入参**：
```json
{ "hint_url": "https://www.bilibili.com/video/BV...", "hint_text": "" }
```

**逻辑**：
1. 复用 `shared/runtime_llm_config.py` 拿默认 text model + key
2. 调一次 LLM，prompt:
   ```
   根据下面的 URL 或文本，给一个 4-12 个汉字的简短中文工作空间名称（不要引号、不要标点）：
   {hint_url or hint_text}
   ```
3. LLM 失败时 fallback：用 platform name + 当前时间（如 "Bilibili · 0520-1746"）
4. 调 `_store.create_workspace(name=...)` 创建
5. 返回 `WorkspaceRecord`

**Pydantic schema**：
```python
class AutoCreateRequest(BaseModel):
    hint_url: str | None = None
    hint_text: str | None = None
```

**测试**：`tests/backend/test_workspace_auto_create.py`
- happy path：传 hint_url，断言返回 workspace 且 name 非空
- LLM 失败 fallback：mock LLM 抛错，断言用 fallback name

---

### IP.7.2 前端：services 加 autoCreateWorkspace + 改 PreflightDrawer 走标准流程（1.5h）

**改动文件**：
- `frontend/src/services/workspaces.ts`（加 autoCreateWorkspace + savePreflight + startItemPipeline 已存在）
- `frontend/src/pages/WorkbenchPage/PreflightDrawer.tsx`（替换提交逻辑）

**services 新增**：
```typescript
export async function autoCreateWorkspace(req: {
  hint_url?: string
  hint_text?: string
}): Promise<WorkspaceRecord> {
  const res = await http.post<WorkspaceRecord>(`${BASE}/auto-create`, req)
  return res.data
}
```

**PreflightDrawer 改造**：

删掉第 153 行的 `createPipelineTask` 调用 + 第 158-167 行的"补建 item"（IP.6 那段），换成：

```typescript
async function handleSubmit() {
  setSubmitting(true)
  try {
    // 1. 工作空间决定（如果没选，自动建）
    let wsId = workspaceId
    if (!wsId) {
      const ws = await autoCreateWorkspace({ hint_url: url })
      wsId = ws.workspace_id
      toast.info(`已自动创建工作空间「${ws.name}」`)
    }

    // 2. 创建 item
    const itemRes = await addWorkspaceItem(wsId, {
      type: 'video',
      source: 'url',
      source_value: url,
      name: url.split('/').pop()?.split('?')[0] || url,
    })
    const itemId = itemRes.item_id  // 注意 addWorkspaceItem 返回 schema

    // 3. 保存 preflight
    await savePreflight(wsId, itemId, {
      background_overrides: { content_type: contentType, topic, purpose },
      models: {
        vision: visionModelId,
        text: textModelId,
        // IP.1: 透传 Composer 高级参数也走 preflight
        ...(composerDefaults && {
          quality: QUALITY_MAP[composerDefaults.quality],
          frame_mode: composerDefaults.frameMode,
          frame_interval_sec: composerDefaults.fps,
          max_frames: composerDefaults.maxFrames,
          enabled_steps: composerDefaults.stepIds,
          prompt_style: composerDefaults.promptStyle,
        }),
      },
      tasks: {},  // 暂不传 tasks，后端用默认
    })

    // 4. 触发 start
    const startRes = await startItemPipeline(wsId, itemId)
    addTask({
      task_id: startRes.task_id,
      task_type: startRes.task_type,
      // ...
    })
    onSuccess?.(startRes.task_id)
    navigate(`/processing/${startRes.task_id}`, { state: { url } })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : '提交失败')
  } finally {
    setSubmitting(false)
  }
}
```

⚠️ 关键变量名：
- 第 76-81 行 payload 构造保留，但**只用于 preflight 的 background_overrides**，不再当作 createPipelineTask 的 payload

---

### IP.7.3 后端：让 _bridge_to_pipeline_payload 真接 Composer 高级参数（30min）

**改动文件**：`backend/app/routes/workspaces.py`

**问题**：IP.1 把 quality / frame_mode 等塞进了 payload，但 `_bridge_to_pipeline_payload`（line 792）只读 `models` 和少数 tasks，**不读 background_overrides 里的高级参数**。

**操作**（**先做 grep 确认现状**）：
1. 看 `_bridge_to_pipeline_payload` 第 870 行起的 video 分支
2. 如果 `item.preflight.background_overrides` 有 `quality / frame_mode / frame_interval_sec / max_frames / enabled_steps / prompt_style`，透传到 payload
3. 后端 `handle_download_task` 应该已经接受 quality 参数（如没有，留 TODO，本子任务不补）

**简单透传代码**（伪代码）：
```python
if item.source == "url":
    payload: Dict[str, Any] = {"url": item.source_value}
    bg = item.preflight.background_overrides or {}
    for k in ("quality", "frame_mode", "frame_interval_sec", "max_frames", "enabled_steps", "prompt_style"):
        if k in bg:
            payload[k] = bg[k]
    return "download", payload
```

---

### IP.7.4 真端到端冒烟测试（30min）

**操作**：
1. 重启后端 + 前端
2. 浏览器开 `/`
3. **不选工作空间**，粘一个真实的 B 站 URL（短视频，方便测）
4. 调画质=720p、frameMode=A、fps=3
5. 「开始解析」→ Preflight 抽屉里确认参数对
6. 提交
7. 看 toast：「已自动创建工作空间「XXX」」
8. 跳 Processing 页面
9. 看实时日志：应该是 download 任务在跑（yt-dlp）
10. 等 download 完成，再看 analyze 接力跑
11. 完成后跳 Result 页面

如哪一步卡住，写在 commit message 末尾"已发现问题"区，并贴日志。

---

## 完工标准

- ✅ 所有 4 子任务独立 commit
- ✅ `pytest tests/backend -q` 全绿（新增 1 个 test）
- ✅ `pnpm build` + `pnpm lint` 新文件零错误
- ✅ **手动跑通**一次 B 站 URL 端到端：粘 URL → 自动建空间 → download → analyze → result

## 与下一阶段的关系

完成后整个 H 系列首页 100% 真接通，可以正式进入 [C] AI 导演 或 [D] 开源准备。
