---
phase: IP（Integration Pass）
title: UI ↔ 后端 对接补齐
status: ready
branch: feat/integration-pass
created: 2026-05-20
priority: P1
estimate_hours: 6-8
depends_on: H5 已合并 + TaskRunner.append_log fix 已合并
---

# Integration Pass — 把"死按钮 / 死参数"全部接通

> 来源：2026-05-20 集成分析。H 系列首页 UI 1:1 完成，但部分按钮/参数没接后端
> 目标：用户每个能看见的可交互元素，要么真能用，要么显式禁用 + tooltip 说明原因

## 子任务清单（全部 ⭐ 小米执行）

### IP.1 Composer 高级参数 ↔ Preflight 对齐（4-6h）⚠️ 最复杂

**模型**：⭐ 小米 2.5 Pro（多文件 state 同步，模板化但要小心）
**预计**：4-6h

**改动文件**：
- `frontend/src/pages/WorkbenchPage/Composer.tsx`
- `frontend/src/pages/WorkbenchPage/PreflightDrawer.tsx`
- `frontend/src/pages/WorkbenchPage/types.ts`（如需要扩 types）

**策略 = 透传（不删 Composer UI）**：
1. Composer 已有 state：`quality / frameMode / fps / maxFrames / steps / asr 选择 / vision 选择 / text 选择 / 提示词风格 / workspaceSel`
2. 这些参数打包成 prop `composerDefaults` 传给 `<PreflightDrawer>`
3. PreflightDrawer 打开时用 `composerDefaults` 作为默认值（不覆盖用户已填的）
4. PreflightDrawer 提交时把这些字段塞进 `payload`：
   - `quality` → payload.quality
   - `frame_mode` (A/B) → payload.frame_mode
   - `fps` → payload.frame_interval_sec
   - `max_frames` → payload.max_frames
   - `enabled_steps` → payload.enabled_steps (array)
   - `vision_model_id` / `text_model_id` / `asr_model_id` → payload.vision_model / text_model / asr_model
   - `style` → payload.prompt_style
5. **后端 `_bridge_to_pipeline_payload` 已经接收这些字段了**（先 grep 确认，没有的话只透 vision_model/text_model 两个，其它 backlog）

**验收**：
- 在 Composer 调画质=720p、frameMode=A、fps=3
- 点开始解析 → Preflight 抽屉里这 3 个字段是 720p/A/3
- 改了 Preflight 里别的字段 → 提交后**两套字段都生效**
- 后端任务 logs 能看到选了 720p（grep yt-dlp 参数）

---

### IP.2 Composer 上传按钮接 AddMaterialModal（30 分钟）

**模型**：⭐ 小米
**预计**：30min

**改动文件**：`frontend/src/pages/WorkbenchPage/Composer.tsx`

**操作**：
1. import `AddMaterialModal` from `@/components/workspace/AddMaterialModal`
2. 加 state `const [uploadOpen, setUploadOpen] = useState(false)`
3. 上传按钮 (line ~199) 加 `onClick={() => setUploadOpen(true)}`
4. 渲染 `<AddMaterialModal open={uploadOpen} onClose={() => setUploadOpen(false)} workspaceId={workspaceSel[0] ?? ''} defaultTab="upload" />`
5. 如果 `workspaceSel` 为空，点上传时 toast.error("请先选择工作空间") 然后打开工作空间 popover

**验收**：点上传按钮 → 弹模态 → 能选文件 → 提交后任务进 store

---

### IP.3 TaskboardHead「编辑背景」接 BackgroundEditor（1h）

**模型**：⭐ 小米
**预计**：1h

**改动文件**：
- `frontend/src/pages/WorkspacePage/TaskboardPage/index.tsx`
- 可能新建 `frontend/src/pages/WorkspacePage/TaskboardPage/BackgroundEditor.tsx`

**操作**：
1. 先 grep `BackgroundEditor` 看现有组件是否能复用（很可能 WorkspaceDetail.tsx 里有）
2. 如有：抽出独立组件，在 TaskboardPage 里 lazy 引
3. 如没：新建小模态，5 个字段 input：contentType / participants[] / topic / glossary[] / purpose
4. 提交调 `PATCH /workspaces/{id}` body: `{ background: {...} }`（services/workspaces.ts 的 updateWorkspace）
5. TaskboardPage state 加 `bgEditorOpen`，传 `onEditBackground={() => setBgEditorOpen(true)}`

**验收**：点「编辑背景」→ 弹模态 → 改 5 字段 → 保存 → 头部显示新值

---

### IP.4 TagsTab 加编辑能力（2-3h）

**模型**：⭐ 小米
**预计**：2-3h

**改动文件**：
- `frontend/src/pages/WorkspacePage/TaskboardPage/TagsTab.tsx`
- 可能 `frontend/src/services/workspaces.ts`（如缺 patchItemTags）

**操作**：
1. 每个标签 chip 旁加 ❌ 按钮（hover 显示）
2. 点 ❌ → 调 `PATCH /workspaces/{wid}/items/{iid}` body `{ tags: { ...原 tags, [dim]: 去掉这个的数组 } }`
3. 维度底部加「+ 新增」按钮 → 弹 input → enter 后 PATCH
4. 用 optimistic update：本地先变 + 失败时 toast 回滚
5. 看 `backend/app/routes/workspaces.py` 第 1559 行附近的 tags API，如缺 PATCH 单独接口就走通用 update item

**验收**：能加、能删、能改、刷新后持久化

---

### IP.5 Storyboard 触发入口（2-3h）

**模型**：⭐ 小米
**预计**：2-3h

**改动文件**：
- `frontend/src/pages/WorkspacePage/TaskboardPage/MaterialCard.tsx`（加菜单项「生成分镜」）
- 新建 `frontend/src/pages/WorkspacePage/TaskboardPage/StoryboardLaunchModal.tsx`
- 可能 `frontend/src/services/pipeline.ts`（如缺直接创建 storyboard 任务的方法）

**操作**：
1. MaterialCard 卡片右上角加菜单（…）→ 「生成分镜任务」
2. 点击弹小表单：
   - 产品名（默认填素材标题）
   - 核心卖点（textarea）
   - 参考图选择（默认用本素材已有的截帧前 8 张）
3. 提交：`POST /pipeline` body `{ task_type: 'storyboard', payload: { project_id: workspace_id, product_name, core_features, image_paths: [...] } }`
4. 拿到 task_id → toast「分镜任务已启动」 → 跳 `/processing/${task_id}`
5. **不要**在 StoryboardPage 加触发——保持 StoryboardPage 纯展示，从这里跳过去看结果

**验收**：选一个有截帧的视频素材 → 「生成分镜」→ 跑通 → Processing 看进度 → 完成后 `/storyboard?workspace=X&item=Y` 显示 3 plan

---

### IP.6 Composer 工作空间选择 真传后端（1h）

**模型**：⭐ 小米
**预计**：1h

**改动文件**：
- `frontend/src/pages/WorkbenchPage/PreflightDrawer.tsx`
- `frontend/src/services/workspaces.ts`（addItem 调用）

**问题**：Composer 选了多个工作空间，但 `addItem(workspaceId, ...)` 只能传一个，所以只有第一个被关联

**操作**：
1. PreflightDrawer 接收 `workspaceIds: string[]` prop（从 Composer 传）
2. 如果 `workspaceIds.length === 0` → 不归入任何工作空间，但仍能跑任务（用 default workspace 或 unassigned）
3. 如果 `workspaceIds.length >= 1`：第一个用于创建 item，其余的循环调一个新 API `POST /workspaces/{id}/items/{itemId}/link`（如果没有，就先在第一个工作空间里建 item，剩下的 toast 告诉用户"已加进 X，其它 Y 个空间待手动添加"）
4. **简化方案（推荐）**：先只支持 1 个工作空间，多选 popover 改成单选，未来再做"一个 item 多 workspace"

**验收**：选 1 个工作空间 → 跑任务 → Taskboard 里能看到这个 item

---

## 完工标准

- 6 个子任务每个独立 commit
- pytest tests/backend -q 全绿
- pnpm build + pnpm lint（新文件）零错误
- 集成验收：从 0 走通一条完整路径（粘 URL → 选画质 → 提交 → 看进度 → 看结果 → 触发分镜 → 看 storyboard）

## 与下一阶段的关系

- Integration Pass 完成 = H 系列首页 100% 接通
- 接下来可以开 **[C] AI 导演**（H5.3 / H2.5 Style / Compare / Storyboard shot 网格升级 / 生成模型 API 接入 一起做）
- 或 **[D] 开源准备**
- N7b / N8b 仍独立可做
