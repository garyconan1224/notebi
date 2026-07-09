---
name: phase-r21-p3-s3-followup
title: R21.P3.S3 收尾 — 学习视频补图 intent 链路修复 + av_combined 补图入口
status: done
owner: mimo 2.5pro
branch: fix/r21-p3-s3-followup
depends_on: 已 merge 的 R21 主体（A1-A6 + B1-B3）+ R21.P3.S3
created_date: 2026-05-29
completed_date: 2026-05-29
commits:
  - 0cf1e76
  - ef633de
  - 09563e7
---

# R21.P3.S3 收尾计划（交给 mimo 2.5pro 执行）

> 本文件是给 **Claude Code 的 mimo 2.5pro** 的可执行任务单。请严格按步骤做，每步都有"改哪、为什么、验收"。
> 当前分支已经是 `fix/r21-p3-s3-followup`（基于 main，R21 主体已合入 main）。

---

## 0. 必读约束（来自 CLAUDE.md，违反会出事故）

执行前请遵守以下铁律：

1. **用中文回复**。改代码前先一句话说明"改哪几个文件、为什么"，改完一两句总结。
2. **不要主动重构无关代码**。本计划只动列出的文件和行，其它一律不碰。
3. **红线绝不能碰**：
   - ❌ 不 `git push origin`（开源前暂缓所有 push）。
   - ❌ 不跑 `rm -rf` / `git reset --hard` / `git push --force` / `git clean -fd`。
   - ❌ 不改 `.env` / `.env.example`。
   - ❌ 不装新依赖。
   - ❌ 不 amend / rebase 主线 commit。
4. **遇到与本计划描述不符的实际情况**（行号漂移、字段名不同等）→ **停下来报告**，不要自作主张换方案。行号可能因前面的提交略有偏移，以"符号 / 关键字"为准定位。
5. **自己跑验证**：后端 `pytest` 或 `curl`，前端 `npx tsc --noEmit`，跑完报结果再 commit。只有 UI 动态交互才请用户帮看。
6. **commit 颗粒度**：每个 Step 一个 commit，信息格式 `fix(r21.P3.S3): <做了什么>`，结尾带
   `Co-Authored-By:` 行（按仓库现有风格）。**不要一次性把所有 Step 揉进一个 commit。**

---

## 1. 背景：补图为什么不工作（根因已定位）

学习视频的"按需补图"（在转录片段旁插入推荐截图）链路断在 **intent 字段写读不一致**：

- **前端写入**：`AddMaterialModal.tsx:626` 把 `intent` 写进**嵌套** `tasks.preflight.intent`。
- **后端存储**：`PreflightSaveRequest`（`workspaces.py:333`）**没有顶层 `intent` 字段**，`save_preflight`（`workspaces.py:1317`）构造 `PreflightConfig` 时也没传 `intent` → 数据模型里的**顶层** `item.preflight.intent`（`models/workspace.py:72`）**永远是空串**。
- **analyze pipeline**：从嵌套读（`workspaces.py:142-143` `_augment_video_analyze_payload`），所以 `result.intent` 能正确填上 → 字幕路径的 📷 按钮能出现。
- **推荐帧接口**：`get_suggested_inline_frames`（`workspaces.py:2429`）判断 `item.preflight.intent != "learning"` 读的是**顶层**（空串）→ **永远 return []** → 补图推荐拿不到。

**结论**：让顶层 `intent` 被正确写入即可打通。这是 Step 1。

另外 av_combined / 帧分析渲染路径（`VideoResultPage.tsx:664+`）没有转录列表，所以没有 📷 补图入口，这是 Step 2。

---

## Step 1：打通 intent 顶层字段链路（根因修复）

**目标**：让 `item.preflight.intent` 顶层字段被正确写入，使 `get_suggested_inline_frames` 能识别学习模式。

### 1a. 后端 — 给请求体加 intent 字段

文件 `backend/app/routes/workspaces.py`，`class PreflightSaveRequest`（约 333 行）：

在 `background_overrides` 之前或 `tasks` 之后加一个顶层字段：

```python
class PreflightSaveRequest(BaseModel):
    """前置配置保存请求体（设计文档第 4 章）。"""

    intent: str = Field(default="", description='"learning" | "replica" | ""')
    background_overrides: Dict[str, Any] = Field(default_factory=dict)
    models: Dict[str, str] = Field(
        default_factory=dict,
        description="键: vision|text|video，值: provider_id",
    )
    tasks: Dict[str, Any] = Field(
        default_factory=dict,
        description="勾选项及子参数；结构按 item.type 区分",
    )
```

### 1b. 后端 — save_preflight 传入 intent

同文件 `save_preflight`（约 1317 行），构造 `PreflightConfig` 时补 `intent`：

```python
    target.preflight = PreflightConfig(
        intent=req.intent,
        background_overrides=req.background_overrides,
        models=req.models,
        tasks=req.tasks,
    )
```

> 注意：`PreflightConfig`（`models/workspace.py:72`）已有 `intent: str = ""` 字段和 `from_dict` 反序列化（85 行），无需改模型。

### 1c. 前端 — 类型加 intent

文件 `frontend/src/types/workspace.ts`，`interface PreflightSaveRequest`（约 103 行）：

```typescript
export interface PreflightSaveRequest {
  intent?: string
  background_overrides?: Partial<WorkspaceBackground>
  models?: PreflightConfig['models']
  tasks?: PreflightConfig['tasks']
}
```

### 1d. 前端 — AddMaterialModal 同时写顶层 intent

文件 `frontend/src/components/workspace/AddMaterialModal.tsx`，`savePreflight` 调用处（约 633 行）。
**保留**现有嵌套写法（`tasks.preflight.intent`，analyze pipeline 仍从那里读），**额外**把 intent 提到顶层：

```typescript
          await savePreflight(wsId, itemId, {
            intent: type === 'video' ? videoIntent : undefined,
            background_overrides: effectiveBackground,
            models: mergedModels,
            tasks,
          })
```

> 为什么两处都写：嵌套是 analyze pipeline 的读源（别动），顶层是推荐帧接口的读源（这次补上）。两边都喂，链路才完整。

### Step 1 验收

1. 后端起服务（`uvicorn backend.app.main:app --host 127.0.0.1 --port 8000`），前端 `npx tsc --noEmit` 必须 EXIT=0。
2. 用 curl 验证顶层 intent 落库：
   ```bash
   # 建 ws / item 后，PUT preflight 带顶层 intent=learning
   curl -s -X PUT http://127.0.0.1:8000/workspaces/<WS>/items/<ITEM>/preflight \
     -H 'Content-Type: application/json' \
     -d '{"intent":"learning","tasks":{"preflight":{"intent":"learning"}}}' | python3 -m json.tool | grep -A2 intent
   ```
   返回的 item.preflight.intent 应为 `"learning"`（不再是空串）。
3. 跑一遍学习视频 pipeline 后，`GET /workspaces/<WS>/items/<ITEM>/inline-frames/suggested` **不再恒为 []**（前提是 frames + transcript 都有）。

提交：`fix(r21.P3.S3): 打通 preflight 顶层 intent 字段，修复学习视频补图推荐恒空`

---

## Step 2：av_combined / 帧分析路径补图入口

**目标**：在没有转录列表的帧分析渲染路径（`VideoResultPage.tsx:664+` 的 `return`）也能让用户触发"按需补图"。

### 现状

- 字幕路径（`isSubtitlePath`，约 480-645 行）：转录 `transcript.map` 里每段旁有 📷 按钮（约 580 行，`isLearning &&` 包裹），点开 `FramePickerModal`。
- 帧分析路径（约 664 行起的主 `return`）：有播放器 + 三轨 + 右侧 tab，**没有转录列表**，所以 📷 补图按钮无处挂载。

### 做法（建议先和用户确认 UI 落点，再动手）

在帧分析路径的右侧面板（content / summary tab 区域）或工具栏，当 `isLearning` 为真且有 `suggestedFrames` 时，加一个"补图"入口：
- 复用已有的 `suggestedFrames` state（约 102 行）、`handleInsertFrame`、`FramePickerModal`（约 630 行已挂载，可共用）。
- 不要新造一套补图逻辑，复用字幕路径已有的 handler 和弹窗组件。

> ⚠️ 这一步涉及 UI 布局判断，**落点不明确时停下来问用户**"补图按钮放右侧面板顶部还是 summary tab 内？"，不要自己拍板改大块布局。

### Step 2 验收

- `npx tsc --noEmit` EXIT=0。
- 起前后端，学习模式 + av_combined 结果页能看到补图入口，点击弹出 `FramePickerModal`，选帧后能插入。
- 这步必须**请用户帮看 UI**（动态交互无法纯代码验证）。

提交：`feat(r21.P3.S3): av_combined 结果页补充按需补图入口`

---

## 3. 收尾

1. 两个 Step 各自 commit 后，跑全量前端 `npx tsc --noEmit` + 相关后端 `pytest`（若有 workspaces 测试）确认绿。
2. 更新 `docs/EXECUTION_PLAN.md` 对应 R21.P3.S3 收尾项打勾，并在 `docs/COMPLETED_WORK.md` 追加记录（按文件顶部模板）。
3. **不要 push**，完工后提醒用户：本分支 `fix/r21-p3-s3-followup` 可 merge 进 main。

---

## 4. 关键文件 / 行号速查（可能漂移，以关键字为准）

| 作用 | 文件:行 | 关键字 |
|---|---|---|
| 请求体缺 intent（改） | `backend/app/routes/workspaces.py:333` | `class PreflightSaveRequest` |
| 构造 PreflightConfig（改） | `backend/app/routes/workspaces.py:1317` | `target.preflight = PreflightConfig(` |
| analyze 从嵌套读 intent（别动） | `backend/app/routes/workspaces.py:142` | `_augment_video_analyze_payload` |
| 推荐帧读顶层 intent（链路终点） | `backend/app/routes/workspaces.py:2429` | `if item.preflight.intent != "learning"` |
| 数据模型 intent 字段（无需改） | `backend/app/models/workspace.py:72` | `intent: str = ""` |
| 前端类型（改） | `frontend/src/types/workspace.ts:103` | `interface PreflightSaveRequest` |
| 前端写 intent（改） | `frontend/src/components/workspace/AddMaterialModal.tsx:626,633` | `preflight.intent = videoIntent` / `savePreflight(` |
| 结果页学习判定 | `frontend/src/pages/result/VideoResultPage.tsx:156` | `const isLearning = result?.intent === 'learning'` |
| 字幕路径 📷 按钮 | `frontend/src/pages/result/VideoResultPage.tsx:580` | `{isLearning && (` |
| 帧分析路径主 return（Step 2 落点） | `frontend/src/pages/result/VideoResultPage.tsx:664` | `<div className="vm-video-result-scope vd-layout">` |
| FramePickerModal 已挂载 | `frontend/src/pages/result/VideoResultPage.tsx:630` | `framePickerOpen &&` |
