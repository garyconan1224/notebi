# 复刻竖切①「复刻提示词」执行计划（给小米 · 2026-06-23）

> 上游设计交接：[`replica-full-line-2026-06-23.md`](replica-full-line-2026-06-23.md)。
> 用户拍板：先竖切「**复刻提示词**」端到端打通，作为整条 replica 链的模板；拉片/竞品随后各出计划。
> 用户原话：「之前可能做过，看能不能修改用」——**调研已确认：复刻页早做过（RP1-C），本计划是「复用+接线+裁剪」，不是重建。**

---

## 一、背景与根因（已实测确认，不要再凭代码猜）

用户选「复刻」走的**真实路径**（两条都建 `note` task → `handle_note_task`）：

- **链接**：`AddMaterialModal` → `generateNote(intent='replica', imageMode='replica_prompt')` → 后端 `POST /workspaces/{id}/items/generate-note`（[workspaces.py:1986](../../backend/app/routes/workspaces.py)）→ 永远建 `note` task（line 2072）。
- **本地**：`AddMaterialModal` → `savePreflight(intent='replica')` + `startItemPipeline` → `/start`（[workspaces.py:1929](../../backend/app/routes/workspaces.py)）→ `_bridge_to_pipeline_payload` 也建 `note` task。

根因三条：

1. **`handle_note_task` 不按 intent 分流**（[pipeline_tasks.py:2401](../../backend/app/services/pipeline_tasks.py)）：按 `payload.steps` 动态编排 download/transcribe/analyze/note，但全程无视 `intent`。`intent=='replica'` 只在极少用到的 Gemini 视频模型 prompt 模板里有个分支（[pipeline_tasks.py:255](../../backend/app/services/pipeline_tasks.py)），主流程碰不到。→ 选复刻 = 出一篇普通笔记。
2. **处理完成后没落到复刻页**（§6.5 核心缺口）：`ProcessingPage` 完成按钮（[ProcessingPage/index.tsx:364](../../frontend/src/pages/result/ProcessingPage/index.tsx)）：
   ```
   const isNote = (state?.taskType ?? taskType) === 'note'
   navigate(isNote ? '…/note' : '…/overview')   // replica → /overview，不是 /video_detail！
   ```
   复刻传的是 `state.taskType='replica'` → 落到 `/overview`（ResultsOverview），**根本没进复刻页**。
3. **步骤没裁**：复刻仍跑 transcribe + note（总结），既慢又产出对不上。

---

## 二、可复用遗产（RP1-C 复刻页，直接改造）

| 遗产 | 位置 | 状态 |
|---|---|---|
| **复刻页本体**：主帧大视图+缩略图轨道、帧多选、批量复制提示词、**导出复刻包**、MJ/SD 提示词格式 tabs、提示词版本栈 | `VideoResultPage.tsx`（1347 行）+ `result.css` | ✅ 完整，**默认就是复刻视图**（`isLearning = result.intent==='learning'`，[VideoResultPage.tsx:174](../../frontend/src/pages/result/VideoResultPage.tsx)；学习态走 NoteShell 不经此页，所以此页天然是复刻页） |
| 帧数据物化（analyze 产物 → `results.frames`） | `_materialize_video_results_from_analyze`（[workspaces.py:2223](../../backend/app/routes/workspaces.py)）+ `GET /…/result`（[workspaces.py:2345](../../backend/app/routes/workspaces.py)） | ✅ 复刻页取数端点 `getItemResult` 已对接 |
| intent 路由分流（卡片/库/overview 点进 replica→video_detail） | `resolveItemRoute.ts` | ✅ 已对，**但 ProcessingPage 完成按钮没用它**（根因 2） |
| 截帧能力：按镜头切帧 PySceneDetect、`frames_per_shot` | `shared/video_analyzer.py` | ✅ |
| 二级语义（旧）：`['复刻参考','竞品分析','内容学习','其他']` | `PreflightConfigPanel.tsx:79` | 参考即可，本次不直接接 |

**结论**：复刻提示词的「截帧 + 逐帧提示词渲染 + 导出」整套都现成。本竖切只需把链接起来、裁掉多余步骤、补二级入口。

---

## 三、执行方案（4 个 commit，按序；§6.5 每个都要实跑验证）

### Commit 1 ——「复刻落对结果页」（§6.5 核心，最高优先）

**目标**：选复刻 → 跑完 → 落到 `video_detail` 复刻页，而非 `/overview`。

1. `ProcessingPage/index.tsx` 完成跳转（line 360-369）：当 `(state?.taskType ?? taskType) === 'replica'` 时，按 item 类型落到复刻页：video→`video_detail`、image→`image_result`。**复用 `resolveItemRoute` 的映射逻辑**，别再 hardcode `/overview`。
   - 同步检查 line 99-117 的「download SUCCESS → analyze」假完成链是否也要带上 replica 落点（透传 `state.taskType`）。
2. `GET /…/result`（[workspaces.py:2345](../../backend/app/routes/workspaces.py)）响应里**补 `intent` 字段**（从 item 最近一条 note task 的 `payload.intent` 或 item.preflight.intent 取），让复刻页能正确判分支、且未来学习/复刻可共页。（当前不回 intent → 默认复刻视图，能跑但不显式，补上更稳。）

**接入函数**：`ProcessingPage`（完成按钮 onClick）、`get_item_result`。
**实跑标志（必须亲眼看到）**：粘贴一条 30~60s 短视频 → 选「复刻」→ 处理页点「查看结果」→ **落到复刻页**（页面有「导出复刻包」按钮 + 「已选 N / M 帧」工具条 + MJ/SD 提示词 tabs），URL 形如 `/workspaces/{id}/items/{itemId}/video_detail`。**不是** `/overview`、**不是** `/note`。

### Commit 2 ——「复刻二级 UI（仅复刻提示词）」

**目标**：「复刻」动作下展开二级，本竖切只上「复刻提示词」。

1. `AddMaterialModal.tsx`：当前 `selectedAction==='replica'` 只是单个「逐帧复刻」tab（line 510-513）。在其下加二级选择：**复刻提示词（默认选中、可用）** + 拉片分析 / 竞品对标（**占位、disabled、标"即将上线"**）。
2. 新增 payload 字段 `replica_kind`（本次固定 `'prompt'`），从 `generateNote` / `savePreflight` 透传到后端，为 Commit 3 的步骤分流 + 后续二级预留。**后端 `generate-note` 与 `/start` 两条路径都要透传**（别只接一条，参考根因里的双路径）。
3. 文案：弹窗标题/按钮区把「复刻」与二级说清楚（用户是新手，写人话）。

**接入函数**：`AddMaterialModal.handleGenerateNote`、`generateNote`（service）、`generate_note` + `_bridge_to_pipeline_payload`（后端透传 `replica_kind`）。
**实跑标志**：弹窗选「复刻」→ 见到 3 个二级、只有「复刻提示词」可点；提交后后端日志 payload 里有 `intent=replica` 且 `replica_kind=prompt`。

### Commit 3 ——「复刻提示词步骤裁剪」

**目标**：复刻提示词只跑「下载 → 截帧 → 画面提示词」，跳过 transcribe + note 总结（省 Whisper + LLM 总结）。

1. 在 `handle_note_task`（[pipeline_tasks.py:2401](../../backend/app/services/pipeline_tasks.py)）解析 steps 处（line 2414 附近）：当 `payload.intent=='replica'` 且 `replica_kind=='prompt'` 时，把 steps 收敛为 `['download','analyze']`（保留 PROBE）；**不要进 transcribe，也不要进 note 总结合成**。
   - 复刻页提示词是前端按帧 `description_parts` 套 MJ/SD 渲染的，所以**只要 analyze 截帧 + VLM 描述出来即可**，不需要 note.md。
2. **必须复用现有下载访问上下文**：下载仍走 `_resolve_download_kwargs` + `_download_note_source`（含 cookie/代理/风控），别新起裸调用（§6.5 第 3 条，B站 412 教训）。
3. 边界：若裁完 analyze 没产帧（无画面/纯音频），要给明确失败信息，别假成功。

**接入函数**：`handle_note_task`（steps 解析段）。
**实跑标志**：复刻任务日志出现 `steps=['download', 'analyze']`（**无 transcribe、无 note**）；任务 SUCCESS 后复刻页有帧 + 每帧可复制提示词；整体耗时明显短于同视频的笔记任务。

### Commit 4 ——「复刻项目入口」

**目标**：复刻页右上「复刻」按钮 → 复刻项目列表（只列 `intent='replica'` 的项目）。

1. 复刻页（`VideoResultPage`）右上加「复刻」按钮 → 跳到复刻项目列表。
2. 列表**复用 `LibraryPage` / 现有列表组件**，加 `intent='replica'` 筛选（数据源已有 intent 字段，见 `resolveItemRoute` 的判断依据）。列表项点进去用 `resolveItemRoute` → 回到复刻页。

**接入函数**：`VideoResultPage`（顶栏按钮）、`LibraryPage`（或其筛选）。
**实跑标志**：复刻页点「复刻」→ 列表只出做过复刻的项目（笔记项目不混入）→ 点一个 → 回到它的复刻页。

### （可选）Commit 5 —— replica_prompt 真出「生成式提示词」

先做完 1-4 实跑看复刻页现有提示词质量再决定：

- 现状：`image_mode='replica_prompt'` 实际等同 `vision`（[video_analyzer.py:737](../../shared/video_analyzer.py) 只对 `ocr` 特判），复刻页提示词 = 前端把 VLM 的 `description_parts`(主体/场景/色彩/构图/风格) 套 MJ/SD 模板。
- **若实跑发现这些提示词已能直接喂 Midjourney/可灵/Sora**：不做 Commit 5，省事。
- **若不够「可直接生图」**：在 `process_video` 给 `image_mode=='replica_prompt'` 加专用 VLM 提示词（画面→生成式 prompt），并接进 analyze。**这步等实跑结论 + 我补的 GitHub 拉片/复刻工具调研（提示词结构）再细化**，不要现在拍。

---

## 四、涉及文件清单

**前端**
- `frontend/src/pages/result/ProcessingPage/index.tsx`（C1 完成跳转）
- `frontend/src/components/workspace/AddMaterialModal.tsx`（C2 二级 UI + replica_kind 透传）
- `frontend/src/services/pipeline.ts` 或 `services/workspaces.ts` 的 `generateNote`（C2 透传 replica_kind）
- `frontend/src/pages/result/VideoResultPage.tsx`（C4 顶栏「复刻」按钮）
- `frontend/src/pages/LibraryPage/index.tsx`（C4 intent=replica 筛选）
- `frontend/src/lib/resolveItemRoute.ts`（只读复用，原则上不改）

**后端**
- `backend/app/routes/workspaces.py`：`generate_note`、`_bridge_to_pipeline_payload`（C2 透传 replica_kind）、`get_item_result`（C1 补 intent）
- `backend/app/services/pipeline_tasks.py`：`handle_note_task` steps 解析段（C3 裁剪）

---

## 五、验收（Codex 审 / 用户实跑都按这个）

每个 commit 必须满足对应「实跑标志」，且整条竖切端到端：

1. **接对路径**：改前用 `rg`+`Read` 确认改的就是用户真实走的那条（generate-note / start / handle_note_task），无并行 handler 漏接。
2. **真生效而非代码写了**：每个 commit 用**真实短视频链接走一遍 UI**（选复刻→处理→结果），靠**实跑标志/日志**确认新代码被触发；只跑单测、只看代码不算数。
3. **端到端硬指标**：粘贴短视频 → 选「复刻 / 复刻提示词」→ 处理日志 `steps=['download','analyze']` → 落到 **复刻页**（非 /overview / /note）→ 每帧有可复制提示词 + 可导出复刻包 → 复刻页「复刻」按钮能筛出 replica 项目。
4. 笔记路径**不回归**：选「笔记」仍走 transcribe+note → 落 NoteShell，一切照旧。
5. 单测：`backend/tests/test_inline_frames.py`（已有 replica intent 用例）等相关测试通过；新增分流逻辑补最小单测。

---

## 六、红线（务必遵守，CLAUDE.md §6 + §6.5）

- **接对真实路径**：generate-note 与 /start 双路径都要透传 `replica_kind`，别只接一条。
- **每个 commit 必须真实场景实跑确认「落到复刻页 / steps 已裁」**，把标志性现象写进 commit / 报告；不许只跑单测交差。
- 下载/外部访问**复用 `_resolve_download_kwargs` 等现成工具**，不起裸调用。
- **不重构无关代码**：复刻页（VideoResultPage）只加顶栏按钮、不大改其渲染；笔记链路一行不动。
- 不动 `.env`、不改 DB schema、不主动 push、不在脏树上做 commit 级审查。
- 拉片 / 竞品两个二级**本计划不做**（占位 disabled），等各自计划。
- replica_prompt 专用提示词（Commit 5）**不实跑过现状别动手**。

---

## 七、待我补充（不阻塞 1-4）

- WebSearch 额度恢复后，我补 GitHub「拉片 / 视频复刻 / 二创」工具调研 → 丰富 Commit 5 的提示词结构 + 后续拉片维度。slice-1 的 1-4 不依赖它，可先做。
