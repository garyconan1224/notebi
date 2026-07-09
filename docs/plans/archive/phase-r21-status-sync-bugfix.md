---
phase: R21
title: R19 上线后流程状态同步 bug 修 + 进度/资料库行为收口
status: ready
owner: xiaomi mimo v2.5-pro
estimated_hours: 10
depends_on:
  - R19 已合并（av_synthesis pipeline 跑通）
  - R18.1 已合并（本地 ASR + 失败弹窗）
related_spec:
  - docs/spec/04-pipeline-tasks.md
  - docs/spec/05-result-pages.md
user_report_date: 2026-05-27
user_screenshots:
  - 图1 下载刚完成、分析未开始，但下方步骤全部 DONE
  - 图2 同一项目在右侧任务面板出现 3 行
  - 图3 ProcessingPage 顶部 "查看结果" 按钮不应在未完成时可点
  - 图4 ProcessingPage 实时状态正确，右侧面板状态滞后/错乱
  - 图5 ASR 已 DONE，右侧任务面板仍显示 pending 0%
---

## 背景

R18.1 + R19 合并后，用户用真实 B 站 URL 跑端到端冒烟，发现 **流程状态在前端两个数据源之间不同步**，并暴露出若干进度上报和体验细节问题。本 phase 是 **bug 修 + 体验收口**，不含新功能（并行截帧/转写、性能档位设置押后到 R22/R23）。

**用户原话要点（11 条问题归类）**：

| # | 现象 | 类别 | 本 phase 处理 |
|---|---|---|---|
| 1 | 下载刚完成、分析未开始，左侧步骤已全部显示 DONE | A bug | ✅ |
| 2 | 同一项目在右侧任务面板出现 3 行 | A bug | ✅ |
| 4 | 左侧步骤页实时，右侧面板状态滞后/错乱 | A bug | ✅（与 5 同根因） |
| 5 | ASR 已完成、右侧面板仍 pending 0% | A bug | ✅ |
| 10 | 截帧进度卡 30% 很久，再进去直接 100%，百分比不真实 | A bug | ✅ |
| 11 | 任务完成后 "查看结果" 按钮点不动 | A bug | ✅ |
| 3 | 任务未完成时不应能从资料库打开"查看结果" | B 行为 | ✅ |
| 7 | 截帧/转录日志希望有更多业务细节，而不只是时间戳 | B 行为 | ✅ |
| 8 | 右上角倒计时应为全局总倒计时并自动递减 | B 行为 | ✅ |
| 6 | 截帧 + 转写并行（节省时间） | C 新功能 | ❌ → R22 |
| 9 | 设置中暴露性能档位（CPU/GPU/内存）控制并发 | C 新功能 | ❌ → R23 |

---

## 排查铁律（mimo 必读）

**先诊断、再改代码**。每个 bug 修之前必须先复现 + 抓到根因证据（后端字段 / 前端 store 快照 / SSE 事件序列）才能动手。`A1~A6` 任务里都写了"先复现"步骤——不准跳过。

**用户是新手程序员**，每改一处文件前用一句中文说明：「我准备改 X，原因是 Y」。

---

## A 类：状态同步 bug 修（优先）

### A0 端到端复现录像（统一前置）

> 所有 A 任务复用同一次冒烟，复现一次抓全证据，避免反复跑。

**步骤**：
1. `./start.sh` 起前后端
2. 浏览器粘 B 站 URL：`https://www.bilibili.com/video/BV1LSRhBQErk`（用户 R19 测试用的视频）
3. AddMaterialModal 默认勾选 av_synthesis（综合笔记）→ 提交
4. 全程录屏；同时浏览器 DevTools Network 抓 SSE / `/api/tasks` 列表请求；后端 `tail -f data/logs/*.log`
5. 把录屏 + 一段「下载刚完→分析未开始」的 SSE 流 + 一段「ASR 已完成、右侧仍 pending」的 `/api/tasks` 响应粘到本 phase 的「证据」附录里

**完工标准**：A0 不写代码，只交一份证据。后续 A1~A6 引用证据，写时贴 `证据 §N` 引用。

---

### A1 步骤全部 DONE bug（问题 1）

**怀疑根因**（已 spike，mimo 验证）：
- 文件：[frontend/src/pages/result/ProcessingPage/StepProgress.tsx](frontend/src/pages/result/ProcessingPage/StepProgress.tsx)（`deriveSteps`，第 53~88 行）
- 当 `currentStatus` 不在当前 task_type 的 `visibleStages` 列表里（例：父任务为 `analyze`，stage 渲染按 analyze 走，但实际 `currentStatus` 字段是 download 阶段的 `SUCCESS` 或类似），就走到 `currentIdx < 0` 分支；而此时如果 `progress >= 1`（download 子任务已完成、整体进度被错算成 1），**所有 stage 一起标 done**。
- 即：当 task 不在已知 stage 序列时不该一刀切，应保守显示 `queued` / `running`。

**任务**：
1. 在 A0 录屏对应的「下载刚完成那一刻」节点把 task JSON 完整打印（task_id / status / progress / task_type / payload.stage 字段都贴出来）
2. 改 `deriveSteps`：`currentIdx < 0 && progress >= 1` 时**不再无脑全部 done**。改为：
   - 如果 `currentStatus === 'SUCCESS'` 且 `progress >= 1`：保持现状（全 done）
   - 否则：全部 `queued`（保守）
3. 加单测 `StepProgress.test.tsx`：3 个 case
   - `currentStatus='DOWNLOAD'`, `progress=1.0`, taskType='video' → 只有 DOWNLOAD done，其余 queued
   - `currentStatus='SUCCESS'`, `progress=1.0`, taskType='video' → 全部 done
   - `currentStatus='UNKNOWN_STAGE'`, `progress=0.5`, taskType='video' → 全部 queued

**验收**：A0 录屏的「下载刚完成那一刻」截图，左侧步骤里只有 DOWNLOAD 是 ✓ DONE，其余应是灰色 queued。

---

### A2 任务面板重复 3 行 bug（问题 2）

**怀疑根因**（mimo 验证）：
- 文件：[frontend/src/components/FloatingTaskQueue.tsx](frontend/src/components/FloatingTaskQueue.tsx)（`rows` 计算，第 97~114 行）
- 现实数据：同一个 workspace 会产生多个 task（download, analyze, av_synthesis…）。当前 `tasks.filter(...).slice(0,8)` 按 task_id 各显一行——**这是设计行为，不是 bug**。
- 但用户预期是「**一个素材一行**」。需要按 `workspace_id` 或 `payload.url` / `payload.source_url` 归并：
  - 同 workspace + 同 url 视为同一个素材
  - 显示主导任务（取 status 优先级：RUNNING > QUEUED > FAILED > SUCCESS，progress 取最大）

**任务**：
1. 抓 A0 录屏对应时刻的 `/api/tasks` 响应粘到证据附录，证明确实是 3 个独立 task_id 同 workspace
2. 在 `FloatingTaskQueue.tsx` 加 dedup：`useMemo` 里先按 `${workspace_id}::${payload.url ?? task_id}` 分组 → 每组取代表 task → 再 slice(0,8)
3. 代表 task 进度取**组内 stage 加权平均**（download 30% + analyze 70% 权重，写在 const 里——音频/纯文本可微调，先这套）
4. 点击代表 task：跳到 `/processing/<代表 task_id>`（用户原来的体验保留）
5. 加单测：3 个不同 task_id 同 workspace 同 url → rows 长度 = 1，progress 是加权值

**验收**：A0 录屏对应时刻右侧面板只显示 1 行该 B 站视频。

---

### A3 SSE 与轮询数据源不一致（问题 4 + 5）

**怀疑根因**：
- 前端有两个数据源
  - `useTaskSse`（[frontend/src/hooks/useTaskSse.ts](frontend/src/hooks/useTaskSse.ts)）→ ProcessingPage 用
  - `usePipelineTasks`（[frontend/src/hooks/usePipelineTasks.ts](frontend/src/hooks/usePipelineTasks.ts)）→ FloatingTaskQueue 用，5s 轮询
- SSE 实时但只覆盖当前 task；轮询慢但覆盖全部。两份数据写到同一个 `taskStore`，**SSE 的 task 更新可能被滞后的轮询响应覆盖**（store 没有 `updated_at` 比较）。

**任务**：
1. 抓 A0 录屏「ASR 已 DONE 但面板 pending 0%」对应时刻的 store 状态（用 React DevTools 看 `taskStore.tasks`，把目标 task 的 `status / progress / updated_at` 截图）
2. 看 [frontend/src/store/taskStore.ts](frontend/src/store/taskStore.ts)：找 SSE 和轮询写回 store 的入口
3. 在 store 的 `upsertTask` / `updateTask` 加 **last-writer-wins-by-timestamp**：
   - 新增字段 `_localUpdatedAt`（client 收到时的 `Date.now()`）
   - 写入前比较：若传入的 `updated_at` 不晚于已有 `updated_at`，且 status/progress 没"往前"走（progress 不能倒退、status 不能从 SUCCESS 退回 RUNNING），**丢弃这次写入**
4. 加单测：模拟先 SSE 写 SUCCESS 100%，再来一个轮询响应 RUNNING 50% → store 状态仍是 SUCCESS 100%

**验收**：A0 录屏「ASR 已 DONE」时刻右侧面板该任务也立即显示 DONE。

---

### A4 截帧进度卡 30% → 突然 100%（问题 10）

**怀疑根因**：
- 后端文件：grep `set_progress` / `progress=` 在 `backend/app/pipeline/` 或 `backend/app/handlers/`（mimo 自己定位）
- 截帧步骤可能是「按帧数累加 progress」但中间没及时刷库；或者上报间隔太稀，每 N 帧才上报一次
- 也可能是前端 `StepProgress.pct` 计算被 stage 切换覆盖

**任务**：
1. 后端先加密集日志：截帧每完成 1 帧打一条 `logger.info(f"frame {i}/{total}")`，跑 A0 录屏看实际进度上报节奏
2. 根因二选一：
   - 若**后端不上报**：在截帧循环里每 5% 或每 N 秒（取小）调一次 `set_progress`
   - 若**前端覆盖**：在 ProcessingPage 加日志看 `currentStatus` 切换时机
3. 修完再跑一次 A0 录屏，看 30%~100% 之间是否平滑

**验收**：A0 录屏对应时刻截帧进度条肉眼可见平滑上升，不出现卡 30% 然后跳 100%。

---

### A5 "查看结果" 按钮点不动（问题 11）

**怀疑根因**：
- 文件：ProcessingPage（[frontend/src/pages/result/ProcessingPage/index.tsx](frontend/src/pages/result/ProcessingPage/index.tsx)）
- 100% 后按钮要么 disabled，要么 onClick 走的路由跳转条件没满足（可能要求 task_type === 'analyze' 而当前 task 是 av_synthesis）

**任务**：
1. A0 录屏复现「100% 后按钮点不动」时打开 DevTools 看按钮 DOM：是 `disabled` 还是 `onClick` 没触发？
2. 看「查看结果」按钮的实现，记下它跳转的 route 模板（应该是 `/result/...`）
3. 修：
   - 若是 disabled 条件错：补 av_synthesis / 其他新 task_type 到允许列表
   - 若是 route 没匹配：在 av_synthesis SUCCESS 时把 task_id 映射到正确的结果页路由
4. 加 e2e 或集成测试：mock 一个 SUCCESS 状态的 av_synthesis task → render ProcessingPage → 点击按钮 → 验证 `navigate` 被调用且参数正确

**验收**：A0 录屏跑完后按钮可点、跳到 R19 的 av_synthesis 结果页。

---

### A6 回归测试 + main 合并

完成 A1~A5 后：
1. 重跑 A0 录屏一次，确认 5 个 bug 全消失（一段视频证明即可）
2. 跑全部前端单测：`pnpm test` / `npm test`（按项目实际）
3. 跑后端 pytest：`pytest`
4. 给用户看录屏 + diff 摘要 → 用户授权后 merge `feat/phase-r21-status-sync-bugfix` 到 main

---

## B 类：行为收口（A 跑完之后做）

### B1 资料库 / 入口在未完成时正确 disabled（问题 3）

**目标**：未完成的素材，资料库卡片上的「查看结果」按钮 / ProcessingPage 顶栏「查看结果」要么 disabled、要么打开是「分析中」占位页（用户原话）。

**任务**：
1. 找资料库卡片组件：[frontend/src/pages/LibraryPage/](frontend/src/pages/LibraryPage/)（mimo 自己定位实际文件名）
2. 在卡片渲染处加判断：`material.status !== 'SUCCESS'` → 按钮 disabled + tooltip "分析中"；点击卡片打开 ProcessingPage（不是 ResultPage）
3. ProcessingPage 顶栏「查看结果」按钮同样规则——和 A5 改的地方对齐
4. 加单测：3 状态（QUEUED / RUNNING / SUCCESS）下卡片按钮的 disabled / 可点状态

**验收**：资料库点未完成的项进 ProcessingPage 不进 ResultPage；点完成的项进 ResultPage。

---

### B2 步骤日志显示业务细节（问题 7）

**目标**：截帧 / 转录步骤的日志展开区，希望看到 **"在做什么"** 而不只是 timestamp（用户原话）。

**当前现状**（[StepProgress.tsx](frontend/src/pages/result/ProcessingPage/StepProgress.tsx) `getLogsForStage`）：按关键词从全局 logs 过滤，已经做到。但用户感觉信息少——可能是后端 logger 写得不够详细。

**任务**：
1. 跑 A0 录屏对应的截帧 + ASR 日志，截图给用户看「目前显示的内容」
2. 在后端截帧 / ASR 代码里补业务日志：
   - 截帧：当前帧时间码、当前场景编号、累计帧数、跳过原因（如果有）
   - ASR：当前段时长 / 总时长、模型名、device、累计字符数
3. 前端 LiveLog 已能渲染（B2 不动 UI），跑一遍 A0 录屏验证更详细的日志能出现在折叠区
4. 注意：**只加业务日志，不加 debug 噪音**——每条日志要能让用户一眼看懂在做什么

**验收**：A0 录屏在截帧 / ASR 步骤展开日志，看到至少 5 条有业务内容的日志（不只是时间戳）。

---

### B3 右上角倒计时改为全局总倒计时（问题 8）

**目标**：右上角倒计时是**所有活跃任务一起的总剩余时间**，且会随时间自然递减（用户原话）。

**当前现状**：mimo 自己定位「右上角倒计时」组件（可能在 [SystemResourceCard.tsx](frontend/src/pages/result/ProcessingPage/SystemResourceCard.tsx) 或 ProcessingPage 顶部 header 区）。

**任务**：
1. 截图当前倒计时显示的位置和数值，让用户确认是哪个组件
2. 改实现：
   - 总剩余 = `sum(各活跃 task 的 ETA)` —— 每个 task 的 ETA = `(1 - progress) / 速率`，速率用「最近 60s 进度变化 / 60s」估算
   - 每 1s setInterval 自然递减；同时收到 SSE / 轮询新进度时 reset
   - 没有活跃任务时显示「—」或隐藏
3. 加 hook `useGlobalEta(tasks)`，独立测试
4. 单测：3 个任务进度 30/50/70 → ETA 合理（非 NaN、单调递减）

**验收**：A0 录屏跑一会儿，右上角数字肉眼可见在递减；任务完成一个数字大幅减少。

---

## C 类（押后）

| 编号 | 主题 | 估时 | 排在 |
|---|---|---|---|
| **R22** | Pipeline 并行调度：截帧 + 转写同时跑（issue 6） | 6-10h | R21 后第一档 |
| **R23** | 设置面板：性能档位（CPU/GPU/内存→并发槽位）（issue 9） | 4-6h | R22 后 |

R22 依赖：task_runner 当前调度图 / 各 stage 输入输出依赖关系。`av_combined` 里截帧和 ASR 都只依赖 download 产物，**理论上可并行**——但需要确认音频流和视频流是同一个 mp4 还是分开下载；并发跑时 CPU / 内存上限怎么控制。

R23 依赖：R22 完成后才有"槽位"概念。

R22 / R23 plan 文件本 phase 不展开，开新 phase 时再展。

---

## 工作流约束（必读）

- 分支：`feat/phase-r21-status-sync-bugfix`（一个分支跑完 A+B）
- commit 颗粒度：A0 一个 commit；A1~A5 每个一个 commit；A6 不单独 commit；B1~B3 每个一个 commit。共 ~9 个 commit。
- **不 push 到 origin**（项目 push 暂缓）
- **不改任何 R19 已合并的 av_synthesis 后端逻辑**，本 phase 只动状态显示 / 调度同步 / 日志详细程度
- 每完成一个子任务（A1 / A2 / ... / B3），用一句中文跟用户报告「做了什么」+「diff 行数」
- 遇到本计划没写明的歧义，按 CLAUDE.md §4 停下来问，不要自作主张

## 验收清单（用户最终对账）

- [ ] A0 录屏交付，附带 SSE 流 / store 快照证据
- [ ] A1 下载刚完成时左侧步骤不再全部 DONE
- [ ] A2 同一项目右侧面板只显 1 行
- [ ] A3 SSE / 轮询数据源一致
- [ ] A4 截帧进度平滑
- [ ] A5 "查看结果" 按钮可点且跳对页
- [ ] A6 回归录屏 + 全部测试 pass
- [ ] B1 未完成的素材在资料库 / 顶栏入口正确 disabled
- [ ] B2 截帧 / ASR 日志有业务细节
- [ ] B3 右上角倒计时是全局总剩余且自动递减
- [ ] 用户授权后本地 merge 到 main，更新 EXECUTION_PLAN.md / COMPLETED_WORK.md

---

## 证据附录（Opus 4.7 于 2026-05-28 抓取）

> A1~A5 写「证据 §N」引用此处。

---

### §1 ProcessingPage 状态错误截图（Bug A1 核心证据）

**测试 task**：`analyze-addde446a60c`（B 站视频 BV1LSRhBQErk）
**访问 URL**：`http://localhost:5173/processing/analyze-addde446a60c`
**抓取时间**：2026-05-28 08:29

**前端页面显示**（截图已附）：
- 状态：**待处理**
- 进度：**0%**
- 所有 7 个步骤（下载/探测/转写/截帧/视觉分析/总结/入库）均显示 `—`（无状态）
- Header 右上：`后端 127.0.0.1:8000 · offline`
- 右侧 TaskList 面板：`0 个活跃 · 暂无活跃任务`
- 底部右角 chip：`任务 · 2 项进行中`

**后端 `/pipeline/tasks` 同一时刻快照**（Bug A1 数据矛盾）：
```json
{
  "task_id": "analyze-addde446a60c",
  "task_type": "analyze",
  "status": "SUCCESS",
  "progress": 1.0,
  "project_id": "default_project",
  "source_url": "https://bilibili.com/video/BV1LSRhBQErk",
  "created_at": "2026-05-27T11:51:14.149279+00:00",
  "updated_at": "2026-05-27T12:19:18.012608+00:00"
}
```

> ⚡ 矛盾点：后端 `status=SUCCESS / progress=1.0` ↔ 前端显示「待处理 0%」

---

### §2 FloatingTaskQueue 重复行证据（Bug A2）

同一 B 站 URL `https://bilibili.com/video/BV1LSRhBQErk` 生成了 **2 个独立 task_id**：

```json
[
  {
    "task_id": "download-a498f97490df",
    "task_type": "download",
    "status": "SUCCESS",
    "progress": 1.0,
    "project_id": "default_project"
  },
  {
    "task_id": "analyze-addde446a60c",
    "task_type": "analyze",
    "status": "SUCCESS",
    "progress": 1.0,
    "project_id": "default_project"
  }
]
```

- 注意：两条 task 记录均**无 `workspace_id` 字段**，只有 `project_id`
- FloatingTaskQueue 按 `task_id` 分行 → 同一素材在队列里显示 2 行（实际 R19 提交还会有第 3 条 av_synthesis task）

---

### §3 "进行中" 计数矛盾证据（Bug A3/A4）

同一时刻，三处 UI 对「进行中任务数」的显示完全不一致：

| 位置 | 显示值 | 来源 |
|---|---|---|
| FloatingTaskQueue 右下角 chip | `任务 · 2 项进行中` | `usePipelineTasks` 5s 轮询 |
| ProcessingPage 右侧 TaskList 面板 | `0 个活跃 · 暂无活跃任务` | 未知（疑为另一 store 字段） |
| 后端 `/pipeline/tasks` 实际数据 | **0 个 RUNNING 任务** | ground truth |

后端全量统计：

```
总计：50 任务
  SUCCESS：35
  FAILED：6
  CANCELLED：8
  PENDING：1
  RUNNING：0
```

> ⚡ 矛盾点：后端 0 个 RUNNING ↔ 前端 chip 显示「2 项进行中」

---

### §4 后端连接状态误报（独立 Bug）

- 后端 `GET /health` 正常返回：`{"status":"healthy","version":"0.2.0","uptime_sec":418.37}`
- 前端 Header 显示：`• 后端 127.0.0.1:8000 · offline`

MCP Chrome 环境中 `fetch('http://127.0.0.1:8000/...')` 均报 `TypeError: Failed to fetch`（CORS/网络隔离），这解释了为何 MCP tab 中看到的 UI 一直显示 offline。正常用户通过 `./启动 VidMirror.command` 打开时不会复现此问题，但后端 online-check 逻辑仍需确认。

---

### §5 FAILED 任务详情（Bug 参考）

```
analyze-c3c030211922 (FAILED): "no videos found in .../test_project/videos"
analyze-cbb082fc5d53 (FAILED): "no videos found in .../test_project/videos"
analyze-3d2fc8694f9e (FAILED): "no videos found in .../test_project/videos"
audio-b3c9f237d981  (FAILED): "音频下载失败：HTTP Error 412: Precondition Failed"
audio-261db3332bd7  (FAILED): "音频下载失败：HTTP Error 412: Precondition Failed"
audio-764ec6c3b92a  (FAILED): "音频下载失败：HTTP Error 412: Precondition Failed"
```

---

### A0 完工结论

无法在 MCP 浏览器环境中捕获「真正进行中」的任务截图（MCP tab 连不上本地 8000），但已通过以下方式完成证据收集：

1. ✅ `§1` 抓到 ProcessingPage 在任务 SUCCESS 后仍显示「待处理 0%」的截图 + API 对比（Bug A1 直接证据）
2. ✅ `§2` 证明同一 URL 生成 2 个 task_id（Bug A2 根因）
3. ✅ `§3` 三处 UI 计数矛盾（Bug A3/A4 数据源不一致）
4. ✅ `§5` FAILED 任务列表（背景信息）

**mimo 执行 A1 时引用 §1；执行 A2 时引用 §2；执行 A3 时引用 §3。**
