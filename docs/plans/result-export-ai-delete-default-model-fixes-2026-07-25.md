---
status: proposed
owner: 小米（按本计划串行执行）
reviewer: Codex
created: 2026-07-25
updated: 2026-07-25
priority: P0
baseline_branch: codex/exec-notebi-cleanup
baseline_commit: aaff17d
---

# 结果页导出、AI 工具、删除同步与默认模型修复计划

## 0. 目标与执行边界

本计划一次解决用户确认的 6 组问题：

1. 导出菜单中的两种转写不再展示笔记标题；下载到本地的文件名必须保留笔记标题。
2. 导出菜单中的“当前正文.md”改为“Markdown”。
3. 导出菜单打开后，点击菜单外任意位置一次即可关闭；同时补齐 Escape、焦点返回和菜单互斥。
4. “原始素材”收进导出菜单，减少结果页顶部工具栏拥挤，同时保留预览、复制和下载能力。
5. 重做 AI 工具的信息架构；同时修复删除后任务数据不同步、首页把总结对象当 React 文本渲染而崩溃的问题，并提供友好错误兜底页。
6. 修复设置页默认模型保存成功后仍显示“未设置”的问题，保证保存、即时回显和刷新读回一致。

本轮允许修改与上述问题直接相关的前端、后端和测试代码；不新增数据库、不修改持久化 schema、不新增第三方依赖、不删除正常导出、OCR、关键帧、转写、总结或问 AI 能力。

执行前必须运行：

```bash
git status --short --branch
git log --oneline -5
git branch --show-current
```

本计划基线为 `codex/exec-notebi-cleanup` / `aaff17d`。仓库中下列已有未提交文件属于用户，必须原样保留，不得格式化、覆盖、暂存或提交：

```text
.workbuddy/memory/2026-07-21.md
.workbuddy/memory/MEMORY.md
.workbuddy/memory/2026-07-23.md
docs/plans/knowledge-favorites-search-research-2026-07-23.md
overview.md
```

若实际分支、接口、数据结构或用户可见行为与本计划不一致，立即停下报告，不得自行扩大范围。

## 1. 已完成的只读复现与根因结论

### 1.1 导出菜单把“菜单标签”和“下载文件名”混在了一起

当前结果页 `frontend/src/pages/result/NoteShell/index.tsx` 在菜单中展示：

```text
当前正文.md
{笔记标题} · 转写文本
{笔记标题} · 转写文本（区分说话人）
```

浏览器在用户提供的结果页已复现。后端 `backend/app/routes/export.py` 实际返回的转写下载文件名已经包含标题和转写模式后缀，说明主要错误在前端菜单文案层。现有 `tests/backend/test_export_api.py` 只断言后缀，不足以防止以后把标题丢掉。

正确契约：

- 菜单只表达“导出什么格式或内容”，不展示当前笔记标题。
- 文件名表达“这是哪一篇笔记”，必须包含经过安全处理的笔记标题。
- 菜单标签与文件名分别测试，不能再由同一个可见字符串兼任。

### 1.2 导出菜单缺少 outside-dismiss

`NoteShell` 已为模板菜单、AI 工具和编辑器偏好实现点击外部关闭，但 `exportDropRef` 没有对应监听。真实浏览器中打开导出菜单后，第一次点击空白处菜单仍保留。

### 1.3 “原始素材”是独立顶栏入口，导致工具栏拥挤

现有 `SourceMdModal` 已具备原始素材预览、复制和下载，`handleDownloadSourceMd` 也已使用标题生成文件名。无需新建后端接口，只需调整入口归属。

### 1.4 AI 工具只有一个真入口和一个禁用占位

当前 AI 菜单只有：

```text
基于当前笔记问 AI
更多 AI 工具（不可点击）
```

但项目中已经有两条完整能力：

- `FloatingAskAi`：基于当前笔记和完整转写证据问答。
- `NewSummaryModal` + 现有总结模板：创建新的总结任务和总结版本。

“更多 AI 工具”没有后端能力，不应作为禁用占位占据菜单。Open Design 的设计方向也确认：AI 菜单只保留“证据问答”和“生成新总结”两条真实路径。

### 1.5 删除后首页崩溃有三层原因

错误对象键：

```text
summary_id, template, version, summary_mode, name,
background_for_summary, content_md, model_used, coverage, created_at
```

与后台总结任务 `result.summary` 中的 `ItemSummary` 对象完全一致。

第一层：`frontend/src/pages/WorkbenchPage/RecentTasks.tsx` 的 `descFromResult()` 使用 TypeScript `as string` 强制断言：

```ts
return (result.note_summary || result.summary || ...) as string
```

断言不会把对象转换成字符串，随后 `{card.summary}` 把对象交给 React，触发 “Objects are not valid as a React child”。

第二层：首页“最近任务”没有排除 `task_type=summary` 的子任务。总结任务是笔记内部操作，不应该成为一张独立的素材任务卡。

第三层：`create_summary()` 创建的 summary task 没有追加到 `item.related_task_ids`。删除素材时，后端只清理 `related_task_ids` 中的任务，因此 summary task 会成为孤儿，仍被任务列表返回。任务 store 又会保留 SSE 写入的丰富 `result`，所以该问题具有“同一浏览器会话内生成总结后更容易出现，刷新新会话又可能暂时消失”的特征。

补充同步问题：

- 删除单个素材时，资料库前端调用 `removeByProject(workspace_id)`，会暂时清掉同一合集所有素材的任务，范围过大。
- 软删除整个合集后，后端 `list_tasks()` 已按 `trashed workspace` 过滤，方向正确；但 `WorkspaceList` 等入口没有统一即时清理前端 task store，页面之间会短暂不一致。

### 1.6 默认模型显示使用了错误的数据键

`frontend/src/pages/SettingPage/ProvidersAndModelsPage.tsx` 已把后端 provider 规范化为：

```ts
defaultModels: p.default_models ?? {}
```

但当后端返回权威的 `default_provider_for_<role>` 时，显示逻辑又读取：

```ts
p.default_models?.[role]
```

此时 `p` 是已经规范化的 `ProviderOption`，只有 `defaultModels`，因此 `modelId` 变成空字符串。保存成功后组件也没有重新拉取 provider 数据，所以 toast 成功而卡片仍显示“未设置”。

真实接口和页面已确认：

- `/providers` 当前返回 chat 的默认 provider 和 `default_models.chat`。
- 设置页仍把 chat、vision、embedding、rerank 全部显示为“未设置”。

## 2. 冻结后的产品与交互方案

### 2.1 顶部工具栏

结果页顶部只保留清晰的一级动作：

```text
[编辑/保存状态]  [导出 ▾]  [AI 工具 ▾]  [其它已有必要控制]
```

- 移除独立的“原始素材”按钮，入口移入导出菜单。
- 移除独立的“新建总结”按钮，能力移入 AI 工具菜单。
- `AI 工具` 使用现有橙色强调层级；`导出` 保持中性。
- 不新增 AI 工作台、不新增侧栏、不发明项目中不存在的模型能力。

### 2.2 导出菜单信息架构

按 Open Design 建议分为三组；组标题使用弱化小字，菜单项使用短标签：

```text
笔记正文
  Markdown
  HTML

转录与原始内容
  转写文本
  转写文本（区分说话人）
  原始素材

整理与展示
  PDF
  Word
  长图
  PPT
  Obsidian 包
```

具体行为：

- `Markdown`：导出当前正文，下载文件继续使用标题，例如 `{标题}-正文.md`。
- `转写文本`：菜单不带标题；下载文件为 `{标题}-转写文本（无时间轴）.txt` 或后端现有等价后缀。
- `转写文本（区分说话人）`：菜单不带标题；下载文件为 `{标题}-转写文本（区分说话人）.txt`。
- `原始素材`：打开现有 `SourceMdModal`，用户可以预览、复制或下载；下载文件继续为 `{标题}-原始素材.md`。
- 其它导出能力保持现有内容和格式，不趁机改变文件内容。

注意：原标题如果包含 `.flv`、`.mp4` 等源文件扩展名，本轮不擅自剥离；这是独立的标题规范问题，不属于本轮修复。

### 2.3 菜单统一交互

导出和 AI 菜单必须遵守同一套行为：

- 点击触发按钮：打开/关闭自身。
- 打开一个菜单时：关闭另一个菜单。
- 点击菜单内部：不误关；执行菜单项后关闭。
- 点击菜单外：一次 `pointerdown` 或 `mousedown` 即关闭。
- 按 `Escape`：关闭当前菜单并把焦点还给触发按钮。
- 菜单项支持 Tab；可见 focus 样式不能被移除。
- 窄屏下菜单不得超出视口，优先右对齐并设置安全最大宽度。
- 不新增 UI 依赖；复用现有样式与 Lucide 图标。

### 2.4 AI 工具菜单

只保留两条能力路径，每个主动作有标题、简短说明和图标：

```text
问 AI
基于当前笔记与转写证据继续提问

生成新总结
选择模板并生成一个新的总结版本
```

在两个主动作下方可以增加“常用模板”快捷项，但它们仍属于“生成新总结”，不是新的 AI 能力：

```text
标准总结  详细要点  大纲  问答卡  行动清单
```

行为：

- `问 AI` 调用现有 `FloatingAskAi`。
- `生成新总结` 调用现有 `NewSummaryModal`。
- 点击常用模板只负责以对应模板预选值打开 `NewSummaryModal`，仍需用户在弹窗中确认；不得点击即直接消耗模型额度。
- 移除“更多 AI 工具”禁用占位。
- 点击任一项后先关闭菜单，再打开对应浮层。
- 总结任务创建后继续使用现有进度提示和版本刷新逻辑；不在菜单里复制任务状态机。
- 正在创建总结时禁用重复提交并显示现有进行中状态；失败沿用现有 toast/错误说明。
- 对当前不支持问 AI 的素材类型继续使用现有 capability guard，不伪造可用状态。

## 3. 串行实施步骤

### 阶段 A：先写失败测试，锁定用户可见契约

#### A1. 导出与菜单交互测试

优先扩展 `frontend/src/__tests__/NoteShellSummarySwitch.test.tsx`；如果该文件职责过重，可新增 `frontend/src/__tests__/NoteShellToolbarMenus.test.tsx`。

必须覆盖：

1. 导出菜单显示 `Markdown`，不显示 `当前正文.md`。
2. 显示 `转写文本` 和 `转写文本（区分说话人）`，菜单项不包含笔记标题。
3. 显示 `原始素材`，顶栏不再有独立原始素材按钮。
4. 单击外部一次关闭导出菜单。
5. 单击菜单内部不会因为 outside handler 提前关闭；执行项目后正常关闭。
6. Escape 关闭并返回焦点。
7. 打开 AI 菜单会关闭导出菜单，反向亦然。
8. AI 菜单只提供“问 AI”“生成新总结”两条能力路径，可显示现有常用模板快捷项，但不显示“更多 AI 工具”。
9. 两个 AI 项分别打开现有 `FloatingAskAi` 与 `NewSummaryModal`。
10. 点击模板快捷项会预选模板并打开 `NewSummaryModal`，不会直接提交任务。

#### A2. 下载文件名测试

扩展 `tests/backend/test_export_api.py`：

- 对两种 transcript mode 断言完整 `Content-Disposition` 文件名包含安全处理后的标题。
- 同时断言对应模式后缀。
- 使用带中文、空格和不安全字符的标题，验证不会回退成无标题通用文件名。

补充前端 service 测试或纯函数测试：

- 响应带 `Content-Disposition` 时以后端文件名为准。
- 响应头缺失时，fallback 文件名也必须包含传入的笔记标题，不能退回无标题通用名。

不要把菜单显示文案拿来拼下载文件名；建立明确参数或小型 filename helper。

#### A3. 删除与首页防崩溃测试

新增 `frontend/src/__tests__/RecentTasks.test.tsx`：

- `result.summary` 为完整 `ItemSummary` 对象时，组件不抛异常。
- `task_type=summary` 不生成最近任务卡。
- 普通 note/audio/video/text 任务的字符串摘要仍正常显示。
- `description`、`note_summary` 为非字符串异常值时也不把对象交给 React。

扩展 `frontend/src/__tests__/taskStore.test.ts`：

- 精确移除一组 task ID 不影响同 workspace 的其它素材任务。
- `removeByProject` 仍只用于整个 workspace 隐藏/删除场景。
- 后端不再返回的已终结任务会从 store 消失；轻量轮询仍不洗掉仍存在任务的 SSE 丰富结果。

扩展 `backend/tests/test_summaries.py`：

- 创建 summary task 后，task ID 立即进入对应 item 的 `related_task_ids`。
- 创建 task 成功但关联 item 失败时，不留下不可追踪孤儿任务。

扩展 `tests/backend/test_workspaces_api.py`：

- 删除 item 会同时删除它的原始任务和 summary task。
- 同 workspace 其它 item 的任务不受影响。
- 批量删除遵守相同契约。

#### A4. 默认模型测试

新增 `frontend/src/__tests__/ProvidersAndModelsPage.test.tsx`：

1. GET `/providers` 返回 snake_case `default_models` 和 `default_provider_for_chat` 时，chat 卡片显示真实 provider/model。
2. 用户保存新默认模型后，成功 toast 与卡片回显一致。
3. 模拟刷新/重新挂载，再次 GET 后仍显示已保存值。
4. 清空默认模型后显示系统默认。
5. provider 不存在或 model 已从列表消失时，显示可理解的异常状态，不把有效配置误判为未设置。

#### A5. 路由错误兜底测试

为新错误页新增窄测试：

- 普通 `Error` 不显示原始 React 堆栈。
- 页面显示“页面暂时无法显示”、重试按钮和返回首页按钮。
- 开发环境可折叠显示脱敏后的简短错误信息；生产环境不展示堆栈。

### 阶段 B：修复导出菜单和 AI 工具

主要文件：

```text
frontend/src/pages/result/NoteShell/index.tsx
frontend/src/pages/result/NoteShell/note-shell.css
frontend/src/components/NewSummaryModal.tsx
frontend/src/services/workspaces.ts
frontend/src/__tests__/NoteShellSummarySwitch.test.tsx
或 frontend/src/__tests__/NoteShellToolbarMenus.test.tsx
tests/backend/test_export_api.py
```

实施要求：

1. 按 2.2 重排菜单，移除菜单中的动态标题。
2. 将独立“原始素材”入口移入导出菜单，复用 `SourceMdModal`，不重写内容获取。
3. 将“新建总结”收进 AI 工具，移除禁用占位；常用模板快捷项只向 `NewSummaryModal` 传递初始模板，不复制弹窗逻辑。
4. 为 `exportDropRef` 增加 outside-dismiss；补齐 Escape、焦点返回和互斥。
5. 为 transcript service 增加标题型 fallback 文件名，但后端 header 仍为权威源。
6. 不改变导出正文、HTML、PDF、Word、长图、PPT、Obsidian 的内容生成逻辑。

完成后先运行：

```bash
cd frontend
pnpm test --run src/__tests__/NoteShellSummarySwitch.test.tsx
# 若新建了独立测试文件，一并加入
pnpm build
cd ..
./.venv/bin/pytest -q tests/backend/test_export_api.py
```

### 阶段 C：修复总结任务关联、删除同步和首页渲染

主要文件：

```text
backend/app/routes/workspaces.py
frontend/src/pages/WorkbenchPage/RecentTasks.tsx
frontend/src/store/taskStore.ts
frontend/src/pages/LibraryPage/index.tsx
frontend/src/pages/WorkspacePage/TaskboardPage/index.tsx
frontend/src/pages/WorkspacePage/WorkspaceList.tsx
frontend/src/__tests__/RecentTasks.test.tsx
frontend/src/__tests__/taskStore.test.ts
backend/tests/test_summaries.py
tests/backend/test_workspaces_api.py
backend/tests/services/test_pipeline_list_result.py
```

#### C1. 后端建立 summary task 与 item 的真实关联

`create_summary()` 成功创建任务后，立即把新 `task_id` 追加到 `item.related_task_ids` 并持久化：

- 去重追加，不能覆盖原任务 ID。
- 更新失败时不得返回“已接受”；清理刚创建的任务并返回明确 500，避免孤儿任务。
- 不修改 `ItemSummary` schema。
- 删除 item 时继续复用已有 `related_task_ids` 清理路径。

#### C2. 前端按 task ID 精确同步

在 task store 增加批量精确移除能力，例如 `removeTasks(taskIds)`：

- 同时从 `tasks` 删除这些 ID。
- 对后端已经永久删除的 task，可加入 `hiddenTaskIds`，防止飞行中的旧轮询响应短暂复活。
- 不使用 `removeByProject` 代替单 item 删除。

各入口统一：

- 资料库删除单个 item：用该 item 的 `related_task_ids` 精确移除。
- 资料库批量删除 items：合并所选 items 的 `related_task_ids` 后精确移除。
- Taskboard 删除 item/批量 item：采用同样规则。
- 软删除整个 workspace：才使用 `removeByProject(workspace_id)`；后端 `list_tasks()` 已过滤 trashed workspace，轮询不会重新加入。
- `WorkspaceList` 删除合集后也调用 `removeByProject`，避免不同删除入口表现不一致。

不得在删除一个 item 时把同 workspace 其它 item 的任务清掉。

#### C3. 最近任务只展示顶层素材任务并做类型防御

`RecentTasks` 至少做两层保护：

1. 明确排除 `task_type=summary` 子任务；如果发现其它已确认的内部子任务同样进入首页，按现有任务类型契约列出后再加入排除集合，不猜测。
2. `descFromResult()` 只返回字符串。候选值不是字符串时跳过；不得用 `as string` 欺骗类型系统。

即使以后后端再次返回未知对象，首页也只能少一段摘要，不能整页崩溃。

#### C4. 保留服务端 trash 过滤

`backend/app/routes/pipeline.py:list_tasks()` 当前按 `trashed workspace` 排除任务，这是正确行为，必须保留并补回归测试：

- workspace 软删除后，全量任务列表不返回其任务。
- workspace 恢复后，历史任务重新可见。
- `default_project` 等不属于 workspace 的任务不被误删。

完成后运行：

```bash
cd frontend
pnpm test --run \
  src/__tests__/RecentTasks.test.tsx \
  src/__tests__/taskStore.test.ts
pnpm build
cd ..
./.venv/bin/pytest -q \
  backend/tests/test_summaries.py \
  tests/backend/test_workspaces_api.py \
  backend/tests/services/test_pipeline_list_result.py
```

### 阶段 D：修复默认模型规范化和读回

主要文件：

```text
frontend/src/pages/SettingPage/ProvidersAndModelsPage.tsx
frontend/src/__tests__/ProvidersAndModelsPage.test.tsx
```

实施要求：

1. 为 `/providers` 响应定义清晰 DTO，集中做一次 snake_case → camelCase 规范化。
2. `ProviderOption` 后续只读 `defaultModels`，不再混读 `default_models`。
3. `defaultProviderFor` 使用独立、带类型的 state；移除给数组挂 `_defaultProviderFor`、`_providersRaw` 等 `any` 私有属性的做法。
4. 把 provider 加载提取为稳定的 `loadProviders()`。
5. 保存默认模型成功后必须重新 GET `/providers`，以后端读回为最终事实，再显示成功 toast。
6. 同步更新现有 config/provider store，但不能让 localStorage 覆盖后端权威读回。
7. 保存失败时保留旧显示并给出错误提示；不能先显示成功。

不要修改后端 provider 持久化逻辑，除非测试证明后端 GET 无法读回刚保存的数据；当前只读证据显示后端已经正确保存 chat 默认模型。

完成后运行：

```bash
cd frontend
pnpm test --run src/__tests__/ProvidersAndModelsPage.test.tsx
pnpm build
```

### 阶段 E：增加友好路由错误页

建议新增：

```text
frontend/src/components/RouteErrorPage.tsx
frontend/src/__tests__/RouteErrorPage.test.tsx
frontend/src/router.tsx
```

在根 data route 上配置 `errorElement`：

- 用户只看到简洁说明，不再看到 React Router 默认的 “Hey developer” 和完整堆栈。
- 提供“重新加载”和“返回首页”。
- 开发环境可以折叠显示简短错误，禁止直接渲染任意对象。
- 这是最后防线，不得用错误页代替 C 阶段的根因修复。

完成后运行：

```bash
cd frontend
pnpm test --run src/__tests__/RouteErrorPage.test.tsx
pnpm build
```

### 阶段 F：真实浏览器验收

复用已运行的 NoteBi 前端 `5181` 和后端 `8001`；不得运行会改写 `.env` 或抢占端口的 launcher。

#### F1. 结果页

打开：

```text
http://localhost:5181/processing/note-fad1c7c0c3dd
```

逐项确认：

- 导出菜单不出现笔记标题。
- 标签为 `Markdown`，不是 `当前正文.md`。
- 两种转写标签正确。
- 原始素材在导出菜单中，预览、复制、下载仍可用。
- 点击外面一次关闭；Escape 关闭；焦点返回；导出/AI 菜单互斥。
- 下载两种转写并检查实际本地文件名都包含当前笔记标题。
- AI 工具只有“问 AI”“生成新总结”，两条现有流程都能进入。

#### F2. 删除同步与首页

使用一个可安全删除的测试素材，不得删除用户重要资料：

1. 创建一份新总结并等待成功。
2. 确认 summary task 被写入 item 的 `related_task_ids`。
3. 删除该 item。
4. 打开首页并等待至少两轮 5 秒任务轮询。
5. 首页不崩溃，被删素材和 summary task 不重新出现。
6. 同 workspace 其它素材任务仍存在。
7. 软删除一个测试 workspace：任务立即隐藏；恢复 workspace：历史任务可重新显示。

同时检查浏览器 console 无 React child object 错误。

#### F3. 默认模型

打开：

```text
http://localhost:5181/settings/providers-models
```

- 进入页面即正确显示后端已有 chat 默认模型。
- 改选一个可用模型，保存后卡片立即显示新值。
- 刷新页面后仍显示相同 provider/model。
- 清空默认值后显示系统默认，刷新保持一致。

#### F4. 错误页

只用测试注入或可控开发路由触发，不破坏真实数据：

- 错误页不展示默认 React Router 开发者页面。
- 重试和返回首页可用。
- 生产构建不暴露堆栈。

## 4. 总体验收命令

在各阶段窄测试通过后，再运行：

```bash
cd frontend
pnpm test --run \
  src/__tests__/NoteShellSummarySwitch.test.tsx \
  src/__tests__/RecentTasks.test.tsx \
  src/__tests__/taskStore.test.ts \
  src/__tests__/ProvidersAndModelsPage.test.tsx \
  src/__tests__/RouteErrorPage.test.tsx
pnpm build
cd ..

./.venv/bin/pytest -q \
  tests/backend/test_export_api.py \
  backend/tests/test_summaries.py \
  tests/backend/test_workspaces_api.py \
  backend/tests/services/test_pipeline_list_result.py
```

如果测试文件实际位于不同目录，以当前仓库真实路径为准，但必须在执行记录中写清替代命令和原因。不得把未运行的全量测试描述为“全部通过”。

提交前：

```bash
git diff --check
git status --short
git diff --stat
```

只暂存本计划范围内的代码和测试。不得暂存第 0 节列出的用户文件，不得 push。

建议单个本地提交：

```text
fix: refine result actions and task consistency
```

## 5. 强制停点

遇到以下情况必须停止并询问用户：

1. 需要新增 npm/pip 依赖。
2. 需要修改数据库、Workspace/ItemSummary 持久化 schema 或执行数据迁移。
3. 当前 title/file naming 契约与本计划不一致，尤其涉及是否剥离源文件扩展名。
4. 删除 item 需要删除 `related_task_ids` 以外的文件或任务，但关联关系无法从现有数据可靠推导。
5. summary task 已进入运行态，关联失败后无法安全清理。
6. 默认模型后端读回与当前只读证据相反。
7. 发现同主题 worktree、冲突分支或新的不属于本任务的未提交修改。
8. 为了通过测试必须改变其它素材类型、导出内容或任务状态语义。

停点格式：

> 我在执行【阶段】时发现：实际情况是 A，计划假定是 B。
> 方案 1：……（影响）
> 方案 2：……（影响）
> 我建议方案 X，因为……。请确认后我再继续。

## 6. 给小米的直接执行提示词

```text
请在 /Users/conan/Desktop/notebi 串行执行：
docs/plans/result-export-ai-delete-default-model-fixes-2026-07-25.md

基线：branch=codex/exec-notebi-cleanup，commit=aaff17d。

先完整阅读 CLAUDE.md、docs/AI_HANDOFF.md 前 80 行、docs/rules/agent-roles.md 和本计划，
再运行 git status --short --branch、git log --oneline -5、git branch --show-current。

以下用户未提交文件必须原样保留，不得编辑、格式化、暂存或提交：
.workbuddy/memory/2026-07-21.md
.workbuddy/memory/MEMORY.md
.workbuddy/memory/2026-07-23.md
docs/plans/knowledge-favorites-search-research-2026-07-23.md
overview.md

严格按 A→B→C→D→E→F 执行：
先写失败测试，再做最小实现；每个阶段运行计划列出的窄测试。
重点不是只隐藏报错，而是同时修复：
1) summary task 必须关联 item.related_task_ids；
2) 单 item 删除只能精确清理其 task IDs；
3) RecentTasks 排除 summary 子任务且永不渲染对象；
4) 默认模型统一规范化并在保存后从后端重新读回；
5) 导出菜单和 AI 菜单按冻结信息架构实现。

不要新增依赖、不要改 schema、不要运行会改写 .env/端口的 launcher、不要 push。
遇到计划与实际代码/接口/数据/用户行为不一致，按第 5 节格式立即停下问用户。

完成后交付：
- 修改文件清单；
- 每个根因与对应修复；
- 实际运行的测试命令和精确结果；
- 真实浏览器逐项验收结果；
- git diff --check / status / stat；
- 本地 commit hash（不 push）。
```

## 7. 设计依据与可追溯信息

Open Design 本轮项目：

```text
project: notebi-ai-tools-ux-2026-07-25
run: b8596c11-201c-4681-bf3d-349d2051a545
conversation: 54934b55-e9d4-4ce8-97f2-80c414c1a7a3
status: succeeded
preview: http://127.0.0.1:50844/api/projects/notebi-ai-tools-ux-2026-07-25/raw/notebi-export-ai-tools-prototype.html
```

已确认的设计判断：

- 延续 NoteBi 暖白、灰黑文字、细边框和少量橙色反馈。
- 菜单是“内容工具”，不是另起一套 AI 工作台。
- 导出按“笔记正文 / 转录与原始内容 / 整理与展示”分组。
- AI 只保留“证据问答 / 生成新总结”两条已有能力。
- 常用模板只作为“生成新总结”的预选快捷方式，仍进入现有确认弹窗。
- 层级依靠排版、间距、状态和分组，不堆叠装饰卡片或虚构功能。

Open Design 原型已通过 8/8 项自检，覆盖默认、悬停、忙碌、禁用、错误、成功、外部点击、Escape、焦点归还和窄屏底部面板。可打开：

[查看 Open Design 交互原型](http://127.0.0.1:50844/api/projects/notebi-ai-tools-ux-2026-07-25/raw/notebi-export-ai-tools-prototype.html)

原型用于视觉与交互参考；真实实现仍以本计划冻结的现有组件、接口和验收契约为准。
