---
status: approved_for_execution
created: 2026-07-20
updated: 2026-07-20
owner: Codex
executor: Claude Code
reviewer: Codex
priority: P0
---

# NoteBi 单产品化与复刻 / AI 分镜 / 提示词生产能力删除计划

## 1. 任务目标

把当前独立仓库从“单仓多产品、靠 `VITE_PRODUCT_MODE` 隐藏功能”收敛为真正的单一 NoteBi 产品。

本轮不是继续隐藏菜单，而是删除不属于 NoteBi 的业务代码、接口、任务类型、页面、构建模式和测试，同时保留 NoteBi 的笔记能力与画面理解能力。

本计划已经得到用户确认。执行者不得重新把复刻、AI 分镜、AI 导演、提示词生产能力保留为隐藏功能或未来占位。

## 2. 用户已确认的产品决策

1. **单一产品**：删除 `nibi` / `replicabi` 多产品模式，只保留 NoteBi。
2. **保留画面理解**：保留视频 / 图片的画面识别、关键帧、OCR、描述、标签、总结和笔记配图。
3. **删除提示词生产**：删除提示词格式、生成提示词、Prompt 版本、复刻包导出等生产型能力。
4. **永久删除旧复刻数据**：检测到 `workspace.kind == "replica"` 的旧数据时直接永久删除，不移入回收站、不转换成普通笔记、不保留备份。
5. **删除 AI 分镜与 AI 导演**：分镜页面、分镜任务、生成器与 AI 导演占位入口全部移除。
6. **不恢复 ReplicaBi**：不保留可通过环境变量或隐藏开关重新启用的路径。

## 3. 当前事实与调查证据

### 3.1 Git 基线

- 稳定基线：`main`，当前指向 `c676a7f`。
- 计划分支：`codex/plan-notebi-cleanup`。
- 无 Git remote，不允许主动新增远端或 push。
- 原 `codex/qa-notebi-bootstrap` 已完全合并并删除。

### 3.2 当前本地数据

只读扫描结果：

```text
note workspaces = 29
note items = 44
replica workspaces = 0
replica-intent tasks = 0
storyboard tasks = 0
```

因此当前机器没有需要实际删除的复刻数据，但永久删除逻辑仍必须覆盖升级用户或以后导入的旧数据。

### 3.3 当前功能不是单纯菜单残留

已确认存在以下真实调用链：

- 多产品配置：`frontend/src/config/product.ts`、启动器、三产品构建脚本、Windows 离线包构建校验。
- 复刻：合集 `kind`、添加素材 `intent=replica`、`replica_kind`、处理分流、结果页模式、复刻包导出、模板和测试。
- AI 分镜：前端页面、启动弹窗、`storyboard` task type、pipeline handler、`shared/storyboard_generator.py`。
- AI 导演：当前只有侧栏隐藏占位与配置开关，没有独立可用业务链。
- 提示词格式：图片结果页仍直接调用 `/prompt_formats_config`；视频结果页在 NoteBi 模式下隐藏，但相关代码仍编译并加载。
- Prompt 版本：模型、WorkspaceStore、API、图片结果页和对比组件均有真实代码。
- 导出：`backend/app/routes/export.py` 同时承载笔记、音频、字幕等正常导出，不能整文件删除。

## 4. 保留与删除边界

| 能力 | 处理 | 说明 |
|---|---|---|
| 视频 / 图片 / 音频 / 文字笔记 | 保留 | NoteBi 核心能力 |
| 视频关键帧与图片画面识别 | 保留 | 用于理解、总结、章节和笔记配图 |
| OCR、画面描述、视觉标签 | 保留 | 不再转成生图 / 生视频提示词 |
| 转写、字幕、说话人、总结版本 | 保留 | 与本轮无关，不得回退 |
| 知识库、搜索、问 AI、笔记导出 | 保留 | 单产品后只处理 NoteBi 数据 |
| `nibi` / `notebi` / `replicabi` 模式切换 | 删除 | NoteBi 成为唯一产品 |
| 复刻合集与复刻素材入口 | 删除 | 不再创建或展示 replica 数据 |
| 逐帧复刻 / 拉片生产 / 竞品复刻 | 删除 | 删除请求字段和 pipeline 分流 |
| AI 分镜 | 删除 | 删除页面、任务、后端 handler、生成器 |
| AI 导演 | 删除 | 删除占位入口、feature flag 与遗留文案 |
| 提示词格式设置 | 删除 | 删除页面、API、设置存储和默认模板 |
| MJ / SD / 视频生成提示词 | 删除 | VLM 只输出理解型字段 |
| Prompt 版本 / Diff | 删除 | 不再保存提示词版本 |
| 复刻工作包 / reproduce 导出 | 删除 | 正常笔记、字幕、音频、Obsidian 导出必须保留 |
| 旧 replica 数据 | 永久删除 | 严格按 `kind == "replica"` 定位 |

## 5. 架构决策

### 5.1 单产品配置

删除 `ProductMode`、`replicabi` 配置和 `showReplica/showStoryboard/showDirector/showPromptFormat` 等功能开关。

允许保留一个很小的 NoteBi 常量模块，用于：

- `APP_NAME = "NoteBi"`；
- NoteBi 的 localStorage key 前缀；
- 固定的构建标记。

不允许保留“以后改环境变量即可恢复旧功能”的分支。

### 5.2 Windows 离线包构建标记

当前 Windows 构建器依赖 `VITE_PRODUCT_MODE=notebi` 生成的 meta 标记检查前端包。删除多产品模式时必须保留这项防错能力：

- 将动态 product-mode meta 改成固定 NoteBi build marker，例如 `notebi-build=1`；
- 同步修改 `scripts/portable_preflight.py`、`scripts/build_windows_offline_bundle.py` 及其测试；
- 仍需拒绝打包缺少 NoteBi 标记的 `frontend/dist`。

不能因为产品只剩一个，就让 Windows 离线包接受任意或陈旧的前端构建产物。

### 5.3 旧复刻数据永久删除

保留最小的 `kind` 读取能力，只作为升级清理判据，不再作为产品分流能力。

后端启动完成、对外接收请求前，执行幂等清理：

1. 严格匹配原始记录的 `kind == "replica"`；
2. 从 WorkspaceStore 内存索引移除记录；
3. 删除 `data/workspaces/<workspace_id>.json`；
4. 删除 `data/workspaces/<workspace_id>/` 下该合集的素材产物；
5. 删除 `.local/tasks/` 中 `project_id == workspace_id` 的关联任务；
6. 失效全局知识库缓存，包括 `__global__` 与 `__global_sub__:*`；
7. 记录删除的 workspace / item / task 数量，不输出素材正文；
8. 部分删除失败时记录明确错误，并在下次启动继续重试。

安全约束：

- 删除目标必须由已解析、已校验的 workspace ID 生成；
- `resolve()` 后必须仍位于 `data/workspaces` 或 `.local/tasks` 对应根目录；
- 禁止对根目录、通配符、空 ID 或未验证路径执行递归删除；
- `kind` 缺失、为空、未知或为 `note` 时绝不能删除；
- 测试全部使用临时目录，不触碰真实 `data/`。

用户已经明确选择永久删除，因此不再弹二次确认、不移入 Trash，也不制作备份。

### 5.4 画面理解与提示词生产解耦

删除下面的生产型字段和 UI：

- `prompt_mj`；
- `prompt_sd`；
- `prompt_video`；
- 图片结果中的 `prompts` 生成格式；
- Prompt format tabs / picker；
- PromptVersion / Diff；
- 提示词脚本与复刻包。

保留理解型字段：

- `description`；
- `ocr_text`；
- `tags`；
- `shot_type` / 时间戳；
- 关键帧路径；
- 用于笔记总结的结构化视觉证据。

如果底层旧分析 JSON 仍含提示词字段，可以在读取时忽略，但新 pipeline 不应继续要求模型生成这些字段，也不应继续把 `image_prompt_en` 物化成提示词字段。

## 6. 分阶段执行计划

本任务跨前端、后端、数据清理、Windows 打包和测试，必须按阶段提交。不要一次性做全局替换。

### Phase 0：建立删除前基线

目标：先证明当前 NoteBi 基线可用，避免把历史失败误算成本轮回归。

执行：

1. 启动检查：

   ```bash
   git status --short --branch
   git log --oneline -5
   git branch --show-current
   ```

2. 当前分支必须从 `codex/plan-notebi-cleanup` 或其明确执行分支开始，工作区必须干净。
3. 先运行与产品边界、添加素材、结果页、导出、portable release 相关的现有测试。
4. 记录历史失败；不得为了本任务顺手修改无关失败。

建议基线命令：

```bash
cd frontend
pnpm test --run src/__tests__/productConfig.test.ts src/__tests__/productUiFiltering.test.tsx src/__tests__/AddMaterialModal.test.tsx
pnpm build
cd ..
.venv/bin/pytest backend/tests/test_product_kind_filtering.py tests/test_storyboard_generator_smoke.py tests/backend/test_prompt_formats_api.py backend/tests/test_reproduce_export.py tests/backend/test_export_api.py backend/tests/test_portable_release_tools.py -q
```

若实际测试路径或环境与当前仓库不符，先报告，不得自行换用另一套 Python 环境掩盖问题。

### Phase 1：删除多产品模式，固定为 NoteBi

目标：前端、启动器和构建链不再识别 `nibi` / `replicabi`。

主要改动：

- 简化 `frontend/src/config/product.ts`，或替换成固定 NoteBi 常量模块；
- 删除 `ProductMode`、`WorkspaceKind` 的 replica 分支、`isFeatureEnabled()` 和各 show flag；
- `AppShell` 只定义 NoteBi 导航；
- `router.tsx` 只定义 NoteBi 路由；
- `Hero`、Composer、Favorites、Search、Knowledge、Library 等不再读取 allowedKinds；
- 删除 `scripts/build_product_bundles.sh`；
- 删除 `scripts/serve_product_bundles.py`；
- 删除 `VITE_PRODUCT_MODE` 在 macOS、Windows、开发和构建启动器中的设置；
- 用固定 NoteBi build marker 替换动态 product-mode marker；
- 更新 README、安装文档、离线包文档和 portable release 测试。

注意：

- Search / Knowledge 后端可以暂时保留已有的安全过滤参数，直到 Phase 3 删除 replica 数据路径后再收敛；
- 不得改变 NoteBi 的端口 `5181/8001`；
- 不得回退 Windows 离线模式、源码模式和模型 manifest / SHA256 预检。

阶段验证：

- 前端 product 配置测试改为“只有 NoteBi”；
- `pnpm build`；
- portable release 定向测试；
- `rg` 确认启动器与生产代码不再存在 `replicabi`。

建议 commit：

```text
refactor(product): make NoteBi the only product mode
```

### Phase 2：加入旧 replica 数据永久清理

目标：任何旧复刻合集在后端可对外服务前被永久删除。

主要改动：

- 在 WorkspaceStore / TaskStore 增加按严格 ID 删除记录的最小方法；
- 在 FastAPI startup / lifespan 中编排清理，确保没有请求可在清理前读取 replica 记录；
- 删除旧的 `kind-summary`、`cleanup-by-kind` API 和前端清理卡片；
- 删除“保留但隐藏 / 移入回收站”的旧产品逻辑；
- 清理后统一失效全局知识库缓存。

必须新增测试：

1. 临时目录同时放 note 与 replica，启动清理后只删除 replica；
2. replica 的 metadata、资产目录、关联 task 都被删除；
3. note 数据、普通 task 和其它目录完全不变；
4. `kind` 缺失 / 未知值不删除；
5. 路径穿越 ID、符号链接或根目录目标被拒绝；
6. 重复执行幂等；
7. 有 replica 时触发全局与子范围知识库缓存失效；
8. 当前真实数据扫描仍为 29 个 note workspace、0 个 replica，测试不得改写这些文件。

建议 commit：

```text
feat(cleanup): permanently purge legacy replica data
```

### Phase 3：删除 AI 分镜与 AI 导演

目标：仓库不再含可执行 storyboard / director 产品能力。

前端删除：

- `frontend/src/pages/StoryboardPage/`；
- `frontend/src/pages/WorkspacePage/TaskboardPage/StoryboardLaunchModal.tsx`；
- AppShell 的“分镜”“AI 导演”项；
- `/storyboard` 路由；
- ResultsOverview / Taskboard / Queue 中的分镜入口与显示分支；
- task type union 中的 `storyboard`；
- 对应 CSS、文案和测试。

后端删除：

- `shared/storyboard_generator.py`；
- `pipeline_tasks.handle_storyboard_task`；
- `runner.register("storyboard", ...)`；
- storyboard import、初始状态映射、请求说明与 runtime model helper；
- 仅服务 storyboard 的测试。

不得机械删除普通内容中出现的“分镜”一词。例如用户笔记正文、知识标签或旧文件名可能只是内容，不代表功能调用。只删除可执行产品链和产品文案。

阶段验证：

- 创建 pipeline task 时 `storyboard` 不再是支持类型；
- `/storyboard` 不再注册；
- 侧栏和结果页无入口；
- note / analyze / image / audio / text task 注册保持不变。

建议 commit：

```text
refactor(product): remove storyboard and director features
```

### Phase 4：删除复刻业务链，统一为 note

目标：前后端不再创建、分流、展示或导出 replica 业务。

前端重点：

- 删除 `/replicas` 路由和导航；
- AddMaterialModal / GlobalAddMaterialModal 只保留笔记任务；
- 删除逐帧复刻、复刻二级类型和复刻设置步骤；
- Composer / Library / Favorites / RecentTasks 不再按 workspace kind 分流；
- `resolveItemRoute` 不再根据 `intent=replica` 进入旧结果路线；
- ProcessingPage / ResultsOverview / VideoResultPage 删除 replica mode；
- 删除复刻包导出按钮、复刻提示词脚本和 replica CSS layout；
- 删除 `style_replica` 模板入口和相关类型。

后端重点：

- Workspace 创建 / 自动创建 / 批量导入不再接受 replica kind；
- 删除公共请求中的 `replica_kind`；
- `intent` 可以继续保留 `learning` 等笔记分析语义，但不得再接受或生成 `replica`；
- 删除 pipeline 中 replica prompt 的 steps 裁剪、强制 analyze 和边界检查；
- 删除 `_get_video_model_prompt("replica")` 分支；
- 删除 primary view 的 replica 分支；
- 删除 `/reproduce/export`；
- 删除仅服务 replica 的模板、服务方法和测试；
- Search / Knowledge / Workspace list 收敛为单一 note 数据，不再要求前端传 allowedKinds。

数据兼容：

- `kind` 可以暂时作为原始旧数据的清理判据存在于反序列化层；
- 公共创建 API、前端类型和业务分支不得继续暴露 replica；
- 不得把旧 replica 自动转换成 note。

建议 commit：

```text
refactor(product): remove replica workflows
```

### Phase 5：删除提示词生产，保留视觉理解

目标：模型和页面继续理解画面，但不再生产 MJ / SD / 视频生成提示词。

前端删除：

- `frontend/src/pages/SettingPage/PromptFormatPage.tsx`；
- `frontend/src/services/promptFormats.ts`；
- `PromptVersionStack.tsx`、`VersionDiffView.tsx` 及只被它们使用的样式；
- ImageResultPage 的 prompt format tabs、picker、copy prompt、Prompt 版本；
- VideoResultPage 的 prompt format tabs、picker、导出提示词；
- Workspaces service 中 prompt version 与 reproduce API；
- `prompt_mj/prompt_sd/prompt_video/prompts` 的前端结果类型。

图片结果页保留并重新组织：

- 图片预览；
- 内容描述；
- OCR；
- EXIF（若已有）；
- 标签；
- 总结与笔记入口；
- 下载原图、收藏和图片对比等与提示词无关的能力。

视频结果页保留：

- 播放、关键帧、画面描述、字幕 / 转写；
- 章节、总结、笔记入口；
- 与笔记相关的帧内嵌能力。

后端删除：

- `/prompt_formats_config` router 及 main 注册；
- `shared/prompt_format_defaults.py`；
- settings_store 中 PromptFormat / PromptFormatsConfig 及 seed / save / reset；
- WorkspaceRecord / WorkspaceStore 的 PromptVersion 存储与 API；
- 图片分析提示词 schema 中的 `prompts` 要求；
- 视频结果 materialize 中从 `image_prompt_en` 生成 prompt 字段的逻辑；
- demo fixture 中的 prompt 字段；
- chat context 对 frame prompts 的依赖；如需要视觉上下文，改读 description / OCR / tags；
- export 包中的 `prompts.json` 与复刻说明。

导出特别约束：

- 不删除整个 `backend/app/routes/export.py`；
- 保留音频转写、字幕、LN、AV synthesis、文字笔记、Obsidian、HTML/PDF/DOCX 等现有导出；
- 通用 item zip 若继续保留，必须改成笔记素材导出，删除 `prompts.json`、复刻命名和生成工具使用说明；
- batch export 若只剩复刻工作包语义则删除；若仍服务笔记，需改成纯笔记素材包并补测试。

模型输出验证：

- 新图片分析结果仍有 description / OCR / tags；
- 新视频关键帧仍有 description / tags / image_path / timestamp；
- 不再要求模型返回 MJ / SD / camera motion prompt；
- 视频和图片总结质量不能因为字段删除而变成空白。

建议 commit：

```text
refactor(analysis): keep visual understanding and remove prompt production
```

### Phase 6：删除残留、更新文档与最终验证

目标：删除死代码、过期测试和文档入口，同时证明 NoteBi 核心链没有回退。

静态检查：

```bash
rg -n -i "replicabi|showReplica|showStoryboard|showDirector|showPromptFormat|replica_kind|reproduce/export|prompt_formats_config" frontend/src backend/app shared scripts
rg -n -i "task_type.*storyboard|register\(\"storyboard\"|run_storyboard_generation" frontend/src backend/app shared
rg -n -i "prompt_mj|prompt_sd|prompt_video" frontend/src backend/app shared
```

允许残留仅限：

- 永久删除迁移中严格识别 `kind == "replica"` 的代码与测试；
- 历史归档文档；
- 用户内容本身出现“复刻 / 分镜”等普通文字。

不允许用注释、永远为 false 的 flag、未注册路由或未引用文件伪装“已删除”。

文档更新：

- README / README_NOTEBI；
- 安装文档和 Windows 离线包文档；
- `docs/AI_HANDOFF.md`；
- 开源发布说明；
- 删除或标记旧三产品计划已被本计划取代。

## 7. 测试策略

### 7.1 必须新增或改写的定向测试

1. 单产品配置与 NoteBi 导航测试；
2. 添加素材不出现 replica / storyboard / prompt production；
3. `/replicas`、`/storyboard`、`/prompt_formats_config`、`/reproduce/export` 不再提供业务能力；
4. legacy replica 永久清理的安全与幂等测试；
5. note workspace、task、资产不被清理；
6. 图片结果页保留 description / OCR / summary，不含 prompt tabs；
7. 视频结果页保留关键帧 / 转写 / summary，不含 replica mode；
8. 音频、字幕、LN、Obsidian 等导出回归；
9. Windows portable build marker 与 preflight 回归；
10. Search / Knowledge 只读取 note 数据。

### 7.2 最终自动化验证

在任务分支完成并 commit 后，从该 commit 建立干净 worktree 验证：

```bash
.venv/bin/pytest backend/tests tests/backend -q
cd frontend && pnpm test --run
cd frontend && pnpm build
.venv/bin/python -m compileall backend shared scripts
git diff --check main...HEAD
```

如果全量 pytest 的目录收集方式造成重复或历史冲突，必须报告具体原因，并分别运行仓库当前认可的后端测试集合；不得只报一个较小的定向集合就宣称全量通过。

### 7.3 浏览器验收

使用 NoteBi 端口 `5181/8001`：

1. 首页、笔记列表、知识库、搜索、设置正常打开；
2. 侧栏没有复刻、分镜、AI 导演；
3. 设置没有提示词格式；
4. `/replicas`、`/storyboard` 不再进入旧页面；
5. 添加链接和本地素材只有笔记流程；
6. 视频笔记保留关键帧、转写、总结、笔记；
7. 图片笔记保留描述、OCR、标签、总结，不显示生成提示词；
8. 音频的播放器、波形、字幕、说话人、总结版本和导出正常；
9. 知识库与搜索能读取现有 29 个 note workspace；
10. 控制台无 404 轮询旧 prompt format API、无旧 feature chunk 加载错误。

### 7.4 Windows 发布回归

至少验证：

- `build-notebi.sh` 生成固定 NoteBi build marker；
- portable preflight 拒绝缺少标记的 dist；
- Windows 离线包构建器继续保留 runtime / models / manifest / SHA256 检查；
- `start-notebi.bat` 不再依赖多产品模式，但仍只启动 NoteBi。

真实 Windows `.bat` 未执行时必须明确写“未完成 Windows 实机验证”。

## 8. 强制停点

出现以下任一情况，Claude 必须停止并用中文询问用户：

1. 为删除旧功能需要修改数据库 schema 或引入迁移框架；
2. 发现当前真实数据存在 replica 记录，且严格 ID 删除无法覆盖关联资产；
3. 发现提示词字段是当前画面描述、总结或笔记配图的唯一数据源；
4. 删除 prompt format 会导致图片 / 视频结果页无法展示任何理解型内容；
5. 需要安装新依赖；
6. 需要改端口、provider、模型、ASR、说话人或总结模板；
7. Windows 离线包只能通过取消构建标记检查才能继续；
8. 实际调用链超出本计划，或存在同主题未提交改动 / worktree。

以下事项已经由用户确认，不需要再次询问：

- 单一 NoteBi；
- 删除复刻、AI 分镜、AI 导演和提示词生产；
- 保留画面理解；
- 旧 replica 数据永久删除且不备份。

## 9. 禁止事项

- 不修改音频业务语义；
- 不删除笔记总结版本；
- 不删除普通视频 / 图片分析；
- 不把旧 replica 转成 note；
- 不保留可重新启用旧功能的环境变量或 hidden flag；
- 不全局机械替换用户内容中的“复刻 / 分镜”；
- 不删除整个 export router；
- 不改 `.env` 密钥；
- 不新增依赖；
- 不 push；
- 不直接在 `main` 提交业务改动；
- 不在脏工作树上给出 commit 级通过结论。

## 10. 完成定义

只有同时满足以下条件才算完成：

1. 产品运行与构建不再依赖多产品模式；
2. 复刻、AI 分镜、AI 导演没有 UI、路由、API 或 pipeline 执行链；
3. 提示词格式、生成提示词、Prompt 版本和复刻包已删除；
4. 新视觉分析只产出理解型字段；
5. legacy replica 清理有严格、安全、幂等的自动化测试；
6. 现有 note 数据和核心笔记流程未损坏；
7. 音频和笔记导出未回退；
8. Windows build marker / portable preflight 未回退；
9. 前后端测试、build、compileall、browser smoke 均有结果；
10. 最终 commit 在干净 worktree 独立验证；
11. `docs/AI_HANDOFF.md` 更新为最新 commit 和未验证项；
12. 工作区干净，无主动 push。

## 11. 给 Claude Code 的执行提示词

```text
你是本任务的执行者。请严格按：
docs/plans/notebi-single-product-cleanup-2026-07-20.md
执行 NoteBi 单产品化清理。

不要重新规划，不要开 subagent，不要全项目漫扫，不要恢复隐藏功能。
启动只跑：
git status --short --branch
git log --oneline -5
git branch --show-current

确认工作区干净后，从当前计划分支创建独立执行分支；不要直接在 main 提交。

用户已确认：
1. 只保留 NoteBi，删除 nibi/replicabi 多产品模式；
2. 保留画面识别、关键帧、OCR、描述、标签、总结和笔记配图；
3. 删除复刻、AI 分镜、AI 导演、提示词格式、生成提示词、Prompt 版本和复刻包；
4. 旧 kind=replica 数据永久删除，不进回收站、不转换、不备份；
5. Git 不 push。

严格按 Phase 0-6 分阶段做，每阶段先写/改测试，再实现，再跑定向验证，并形成小而可审查的 commit。
超过 300 行的文件先 rg 定位再 sed 片段读取。
不要删除整个 backend/app/routes/export.py；必须保留音频、字幕、LN、Obsidian、文字笔记等正常导出。
删除多产品模式时，把 Windows 的动态 product-mode 校验替换成固定 NoteBi build marker，不能取消 portable preflight 防错。

若实际代码、数据、接口、依赖或产品行为与计划不一致，立即停止，用中文列出事实、影响和选项，等待用户确认。

完成后：
- 在干净 worktree 验证最终 commit；
- 更新 docs/AI_HANDOFF.md；
- 回复每个 commit hash、git show --stat 对应文件、测试结果、浏览器验证和未验证项；
- 给出可复制给 Codex 的审查提示词；
- 不 push。
```
