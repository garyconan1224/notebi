---
phase: 修复浮动任务面板 note 复合任务进度显示 0%（前端进度映射 bug）
status: ready
owner: opus（读码定位+规划）/ xiaomi-mimo-2.5pro（执行）
cost_warning: |
  纯前端改动 + vitest 单测，零真实 API 调用、不花钱、不耗时。
  ⚠️ 不要起真实 VLM/note 任务去「复现」——没必要，且会踩 SiliconFlow 限流（见 realrun-verify §2）。
  复现只需前端单测，不碰后端、不碰真实任务。
note: |
  2026-06-02 opus 已读码 + curl 后端 API 定位（事实，mimo 别再猜）：
  - 后端 task.progress 正常：实测一条 note 任务 FRAMES 阶段 progress=0.79，在正常推进。
  - 纯前端显示问题：浮动任务面板把 note 任务进度算成 0%。
  - 与后端「取消进度顶到 100%」修复（commit a392f01）无关，是另一个独立 bug，只是同属「进度显示」家族。
---

## 0. 对账结论（mimo 必读 · 别再猜）

**现象**：浮动任务面板（右下角「任务 · 近期活跃」浮窗）里，`task_type === 'note'` 的任务进度恒显示 **0%**，聚合「平均 %」也几乎恒为 1%；但后端该任务的真实 `task.progress` 是正常的（实测 0.79）。

**根因**（已读码确认）：`frontend/src/components/FloatingTaskQueue.tsx` 约 **139–162 行**，计算每组代表任务进度时，只 `group.find` 出 `task_type === 'download'` 和 `task_type === 'analyze'` 两种子任务来加权：

```js
const downloadTask = group.find((t) => t.task_type === 'download')
const analyzeTask  = group.find((t) => t.task_type === 'analyze')
const downloadProgress = downloadTask ? (downloadTask.progress ?? 0) : 0
const analyzeProgress  = analyzeTask  ? (analyzeTask.progress  ?? 0) : 0
let weightedProgress
if (downloadTask && analyzeTask) {
  weightedProgress = downloadProgress * 0.3 + analyzeProgress * 0.7
} else if (downloadTask) {
  weightedProgress = downloadProgress
} else if (analyzeTask) {
  weightedProgress = analyzeProgress
} else {
  weightedProgress = 0          // ← BUG：note 等复合/单一任务落到这里，无视 representative.progress
}
```

`note` 既不是 `download` 也不是 `analyze` → 两个 find 都 undefined → 命中 `else`，进度被当成 **0**，**完全忽略了代表任务 `representative`（= 按 statusPriority 排序后的 group[0]，第 137 行）自身的 `.progress`**。下游 `avgPct`（约 191 行）用同一批行进度求平均，也跟着错。

**影响范围**：不止测试任务——做视频/音频笔记，前端提交的就是 `task_type === 'note'` 的复合任务（见 `frontend/src/services/pipeline.ts` 注释 `video/audio → note`）。因此**所有 note 笔记任务**在该面板进度恒显示 0%。`create`/`storyboard`/`text`/`image`/`audio` 等其它单一 task_type 同样落入 else=0，应一并覆盖。纯前端显示问题，**不影响后端真实执行**。

**修法方向**（surgical，只改 else 一处）：让 else 分支用代表任务的真实进度兜底——
```js
} else {
  weightedProgress = representative.progress ?? 0
}
```
保留 `download && analyze` 配对加权（148 行）和单 download/单 analyze（150/152 行）逻辑**不变**。这样 note/create/... 等任务直接采用后端 `task.progress`，download+analyze 配对仍按 0.3/0.7 加权。

---

## 1. mimo 启动提示词（直接复制）

```
修复浮动任务面板 note 任务进度显示 0%（纯前端进度映射 bug）。
背景必读: docs/plans/fix-task-queue-note-progress-mimo-prompt.md §0
⚠️零成本: 纯前端改 + vitest 单测。不要起任何真实 VLM/note 任务（没必要，且会踩 SiliconFlow 限流）。不碰后端、不动并发/Provider 配置。

【任务0: 对账（60s）】
  git log --oneline -5
  rg -n "downloadTask|analyzeTask|weightedProgress|representative" frontend/src/components/FloatingTaskQueue.tsx
  # 确认 139-162 行 else 分支 weightedProgress=0 的逻辑在位；不一致就停下问。

【任务1: 写失败测试（TDD 红）】
  在 frontend/src/__tests__/FloatingTaskQueue.test.tsx 新增一条用例，参考 144 行「合并成一行」用例的 mock/render 写法
  （用 usePipelineTasks mock 注入 tasks，makeTask 工厂设字段）：
    - 单条 task_type='note'、status='FRAMES'、progress=0.79 的任务
    - render(<FloatingTaskQueue />) 后断言该行进度显示「79%」（getByText('79%') 之类）
  cd frontend && pnpm test --run -t "note"
  # 预期红：当前会显示 0%（断言失败即复现成功）

【任务2: 修代码（绿）】
  改 frontend/src/components/FloatingTaskQueue.tsx 的 else 分支（约 154 行）：
    else { weightedProgress = 0 }
    → else { weightedProgress = representative.progress ?? 0 }
  其余（148 行 download&&analyze 加权、150/152 单类型）保持不变。
  cd frontend && pnpm test --run -t "note"   # 新用例转绿

【任务3: 验证（自己跑，报数字）】
  cd frontend && npx tsc --noEmit      # 类型检查 0 error
  cd frontend && pnpm test --run       # 全绿（新用例 + 既有 7 条 FloatingTaskQueue 用例不回归）
  cd frontend && pnpm build            # 构建通过

【收尾】
  git add -A（只含 FloatingTaskQueue.tsx + 其测试文件）
  git commit -m "fix(ui): 浮动任务面板 note 等复合任务按真实 task.progress 显示进度（修 0% bug）"
  # 不要 push
  把「改了哪几行 / 三项验证结果（tsc/test/build）/ 新用例红→绿」写进本文件 §2。

【红线（CLAUDE.md §4）】
  - surgical：只改 else 一处 + 加 1 条测试，禁止重构面板其它逻辑。
  - 不起真实任务、不改后端、不动 SiliconFlow/并发/Provider 配置。
  - 不 push；不留测试垃圾。
  - 若改动牵连 >5 文件 或 实际代码与本计划不符 → 停下问用户，别硬改。
```

---

## 2. 进度 / 结论记录（mimo 跑完填）

**改动**：
- `frontend/src/components/FloatingTaskQueue.tsx:154` — else 分支 `weightedProgress = 0` → `weightedProgress = representative.progress ?? 0`
- `frontend/src/__tests__/FloatingTaskQueue.test.tsx:183-201` — 新增 1 条用例「note 任务进度应按真实 task.progress 显示而非 0%」

**验证结果**：
- `npx tsc --noEmit` → 0 error ✅
- `pnpm test --run -t "note"` → 红→绿 ✅（红：显示 0% 断言失败；绿：79% 正确显示）
- `pnpm test --run` → FloatingTaskQueue 8 条全绿；9 条既有失败（SummariesTab/AVSynthesisResultPage）与本次无关 ✅
- `pnpm build` → 构建通过 ✅

**Commit**: `2329797` — `fix(ui): 浮动任务面板 note 等复合任务按真实 task.progress 显示进度（修 0% bug）`

---

## 3. 第二轮根因（mimo 必读 · 别再猜）：代表任务选错 → 状态误显 SUCCESS + 标题显 BV 号

**现象**（用户实测截图）：一条 B 站视频任务，左侧处理页还在「截帧 30%」、VLM 未开始，但右下角浮动面板该行却标 **SUCCESS / 51%**，标题显示成 BV 号而非视频标题。

**后端真实数据**（curl /pipeline/tasks，同一 url 两个 task 归一组）：
- `download`：SUCCESS，progress=1.0，**无 video_title / result.title**
- `analyze`：FRAMES，progress≈0.35，summary_path=av_combined，**payload.video_title='夯到爆！！Github…'（真实标题在这条）**

**根因**：`FloatingTaskQueue.tsx` 选「组代表 representative」用的 `statusPriority`（127-132 行）只有 `RUNNING/PENDING/FAILED/SUCCESS`，**漏了 note/analyze 流水线的真实运行态 DOWNLOAD/PROBE/FRAMES/ASR/VLM/SUM/STORE**：
- `analyze` 的 `FRAMES` 不在表里 → 优先级算成 0
- `download` 的 `SUCCESS` = 1
- 排序后 SUCCESS(1) > FRAMES(0) → **representative 错选成已完成的 download**（135 行注释「运行中的 analyze 盖过 download」的意图因此失效）

一个错选，连带两个显示错：
- **状态**：`getStageLabel('SUCCESS')` → PROCESSING_STAGES 无 SUCCESS → 落 `return status`（42 行）→ 原样显示英文「SUCCESS」。
- **标题**：`getTaskTitle(download)`（download 无标题）→ 取 url pathname 末段 = `BV1LY5J6pEZD`；真实标题在 `analyze.payload.video_title`，被忽略。

**进度不是主矛盾**：51% = download×0.3 + analyze×0.7（148 行加权），本就是「整条任务的总进度」（= 用户想要的）。它只是被错误的 SUCCESS 标签盖住才显得矛盾。**进度加权逻辑保持不动。**

**修法**（surgical，仍只动 FloatingTaskQueue.tsx）：把 statusPriority 查表换成基于 `isTaskTerminal`（已于 6 行导入）的 rank —— 运行中（任何非终态）最高、已完成 SUCCESS 最低：
```ts
const rankOf = (status: string): number => {
  if (status === 'FAILED') return 2
  if (status === 'PENDING') return 3
  if (isTaskTerminal(status)) return 1   // SUCCESS/CANCELLED：已结束，最低
  return 4                                // DOWNLOAD/PROBE/FRAMES/ASR/VLM/SUM/STORE：运行中，最高
}
group.sort((a, b) => rankOf(b.status) - rankOf(a.status))
```
representative 改对（→ analyze）后，状态自动显示「截帧」、标题用真实 video_title —— **一处修复连带修好状态+标题**。
（可选加固：`getStageLabel` 末行 fallback 对 SUCCESS/CANCELLED 返回「已完成/已取消」，而非英文原文。）

---

## 4. 第二轮 mimo 启动提示词（直接复制）

```
修复浮动任务面板「代表任务选错」：运行中的 analyze 被已完成的 download 盖过 → 状态误显 SUCCESS、标题显 BV 号。纯前端。
背景必读: docs/plans/fix-task-queue-note-progress-mimo-prompt.md §3
⚠️零成本: 纯前端改 + vitest 单测。不起真实任务、不碰后端、不动进度加权逻辑。

【任务0: 对账】
  git log --oneline -3      # 确认上一轮 2329797 在
  rg -n "statusPriority|representative|isTaskTerminal" frontend/src/components/FloatingTaskQueue.tsx

【任务1: 写失败测试（TDD 红）】
  frontend/src/__tests__/FloatingTaskQueue.test.tsx 新增用例（参考 144 行「合并成一行」写法）：
    同一 project_id + url 一组两条：
      download: status='SUCCESS', progress=1.0（不给 video_title）
      analyze : status='FRAMES',  progress=0.35, payload.video_title='夯到爆测试标题'
    render(<FloatingTaskQueue/>) 后断言该行：
      - 显示标题「夯到爆测试标题」（不是 BV 号 / url 段）
      - 阶段文案是「截帧」（不是 'SUCCESS'）
  cd frontend && pnpm test --run -t "代表"     # 预期红

【任务2: 修代码（绿）】
  FloatingTaskQueue.tsx 把 statusPriority 查表（约 127-136 行）替换为 rankOf：
    const rankOf = (s:string)=> s==='FAILED'?2 : s==='PENDING'?3 : isTaskTerminal(s)?1 : 4
    group.sort((a,b)=> rankOf(b.status)-rankOf(a.status))
  isTaskTerminal 已从 '@/types/task' 导入（6 行）。其余逻辑（进度加权、渲染）不动。
  cd frontend && pnpm test --run -t "代表"     # 转绿

【任务3: 验证（自己跑，报数字）】
  cd frontend && npx tsc --noEmit              # 0 error
  cd frontend && pnpm test --run               # 全绿（新用例 + 既有 8 条 FloatingTaskQueue 不回归）
  cd frontend && pnpm build                    # 构建通过

【收尾】
  git commit -m "fix(ui): 浮动面板代表任务改按运行态优先，修状态误显 SUCCESS + 标题显 BV 号"
  不要 push；把改动行号 + tsc/test/build 结果 + 红→绿证据写进本 md §5。

【红线（CLAUDE.md §4）】
  - 只动 FloatingTaskQueue.tsx 的 representative 选取 + 加 1 条测试；不重构、不碰进度加权、不碰后端。
  - 改动牵连 >5 文件 或 实际代码与本计划不符 → 停下问用户。
  - 不 push；不留测试垃圾。
```

---

## 5. 第二轮结论（mimo 跑完填）

**改动**：
- `frontend/src/components/FloatingTaskQueue.tsx:127-136` — 删 `statusPriority` 查表（只有 RUNNING/PENDING/FAILED/SUCCESS），替换为 `rankOf` 函数：运行态(非终态)=4 > PENDING=3 > FAILED=2 > 终态(SUCCESS/CANCELLED)=1
- `frontend/src/__tests__/FloatingTaskQueue.test.tsx:203-229` — 新增 1 条用例「运行中 analyze 被选为代表 → 标题用 video_title、阶段显示截帧」

**验证结果**：
- `npx tsc --noEmit` → 0 error ✅
- `pnpm test --run -t "代表"` → 红→绿 ✅（红：标题显 BV1LY5J6pEZD + 阶段显 SUCCESS；绿：标题显「夯到爆测试标题」+ 阶段显「截帧」）
- `pnpm test --run` → FloatingTaskQueue 9 条全绿；9 条既有失败（SummariesTab/AVSynthesisResultPage）与本次无关 ✅
- `pnpm build` → 构建通过 ✅

**Commit**: `e568e89` — `fix(ui): 浮动面板代表任务改按运行态优先，修状态误显 SUCCESS + 标题显 BV 号`
