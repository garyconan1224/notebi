# 小米 v2.5pro 串行执行作业书

> 日期：2026-07-26  
> 对应总体方案：`knowledge-favorites-layout-entry-monitor-remediation-2026-07-26.md`  
> 使用方式：每次只把一个 R 阶段交给小米；小米提交后先交 Codex 验收，通过后再进入下一阶段  
> 当前起点：分支 `codex/knowledge-final-validation`，提交 `b19d05c`

---

## 1. 用户如何使用这份作业书

不要把 R0–R7 一次性全部复制给小米。

正确顺序：

1. 先复制第 4 节 R0 提示词；
2. 小米完成并给出 commit；
3. 把小米生成的 Codex 审查提示词交给 Codex；
4. Codex 第一行回复“通过”后，再复制 R1；
5. 按同样方式执行到 R7。

如果 Codex 回答“不通过”，让小米只修该阶段，不开始下一阶段。修上一提交的小问题使用 `git commit --amend`，不要额外制造 `fixup` commit。

R2、R3、R5、R6 是跨层阶段，但已经拆成同一分支内的多个小任务。小米必须按 A、B、C 顺序逐个完成和提交，不能自行合并步骤、重新设计接口或扩大文件范围。

---

## 2. 全阶段共同约束

### 2.1 不得触碰

```text
.workbuddy/
.qoder/
data/
```

不得暂存、修改、清理、stash 或删除这些路径。

R0 提交后这些路径仍可能显示为 modified/untracked，这是预期的用户状态，不是后续阶段的阻断项；只要没有新的计划外代码文件，小米应继续执行，但始终把它们排除在 `git add` 和 commit 之外。

### 2.2 启动只运行

```bash
git status --short --branch
git log --oneline -5
git branch --show-current
```

如果出现以下情况，立即停止：

- 当前 HEAD 不是上阶段通过的 commit；
- 计划外代码文件发生变化；
- 目标分支已经存在但来源不明；
- 出现同主题 worktree；
- 需要新增 npm/pip/系统依赖；
- 需要数据库 schema 或数据迁移；
- 需要改变已冻结的产品语义。

### 2.3 阅读边界

小米只读当前阶段列出的文件。

超过 300 行的文件：

1. 先用 `rg -n` 定位符号或文案；
2. 再用 `sed -n '<start>,<end>p'` 读取局部；
3. 不通读全项目；
4. 不开 subagent；
5. 不搜索 GitHub 重新做产品调研。

### 2.4 开发纪律

每个小任务都必须：

1. 先写最窄回归测试；
2. 运行并确认它因目标缺陷失败；
3. 再写最小实现；
4. 跑定向测试；
5. `git diff --check`；
6. 只暂存允许文件；
7. 提交；
8. 用 `git show --stat --oneline HEAD` 核对实际文件。

测试失败时不能通过删测试、降低断言、加固定返回值或吞异常绕过。

### 2.5 Git

- 一阶段一个新分支；
- 复杂阶段在同一分支内按 A/B/C 产生多个小 commit；
- 不在 `main` 开发；
- 不 merge；
- 不 rebase；
- 不 cherry-pick；
- 不 push；
- 不打 tag；
- 不使用 `git reset --hard` 或 `git checkout --`。

---

## 3. 小米每阶段的统一回报格式

每个阶段结束时，小米必须按以下格式回复：

```text
阶段：R?
结果：完成 / 未完成 / 遇到停点

实际提交：
- <commit hash> <commit subject>

实际修改文件：
- <必须来自 git show --stat，不凭记忆>

测试：
- <命令>
- <通过数量、失败数量>

未验证：
- <没有就写“无”>

未触碰确认：
- .workbuddy/
- .qoder/
- data/

给 Codex 的审查提示词：

你只做验收审查，不写业务功能。
请在干净 checkout/worktree 检查下面 commit，必要时运行列出的测试。
第一行必须写：通过 / 不通过 / 需要补充验证。

任务目标：
<本阶段目标>

本次 commit：
<一个或多个 hash>

重点审查：
1. <验收点>
2. <验收点>
3. <验收点>

已跑验证：
<测试命令和结果>
```

小米不能宣称“干净 commit 全量通过”；最终 commit 是否能独立通过，由 Codex 在干净 checkout/worktree 复验。

---

## 4. R0：保存用户确认的新基线

### 给小米 v2.5pro 终端的执行提示词

```text
你是执行者，只执行 R0：保存用户确认的新 UI 基线。
不要重新规划，不要改业务代码，不要全项目调查，不要开 subagent。

工作目录：
/Users/conan/Desktop/notebi

预期起点：
branch = codex/knowledge-final-validation
HEAD = b19d05c

先运行：
git status --short --branch
git log --oneline -5
git branch --show-current

如果 HEAD、分支或未提交代码文件与本提示词不一致，立即停止报告。

创建分支：
git switch -c feat/r0-save-ui-baseline

只允许暂存以下文件：
frontend/src/pages/LibraryPage/WorkspaceCard.tsx
frontend/src/pages/LibraryPage/library.css
frontend/src/pages/SearchPage/SearchResultView.tsx
frontend/src/pages/SearchPage/search.css
frontend/src/pages/WorkspacePage/TaskboardPage/index.tsx
frontend/src/pages/WorkspacePage/TaskboardPage/taskboard.css
frontend/src/pages/WorkspacePage/WorkspaceList.tsx
frontend/src/pages/result/NoteShell/note-shell.css
frontend/src/pages/result/text-result.css
frontend/src/pages/results/LearningNotesPage/index.tsx
frontend/src/pages/results/LearningNotesPage/learning-notes.css
frontend/src/styles/nibi-components.css
docs/plans/knowledge-favorites-layout-entry-monitor-remediation-2026-07-26.md
docs/plans/knowledge-favorites-layout-entry-monitor-xiaomi-runbook-2026-07-26.md

使用显式 git add，不要 git add .：
git add -- <上面逐个文件>

检查：
git diff --cached --name-only
git diff --cached --check

如果 staged 列表包含 .workbuddy、.qoder、data 或任何计划外文件，立即停止，不要提交。

提交：
git commit -m "chore(baseline): R0 保存 2026-07-26 UI 基线"

提交后运行：
git show --stat --oneline HEAD
git status --short --branch

本阶段不要新增测试，不要修复任何 bug。
最后严格使用作业书第 3 节格式回复，并生成给 Codex 的审查提示词。
```

### Codex 验收重点

- commit 的父提交是 `b19d05c`；
- staged/commit 文件严格等于白名单；
- `.workbuddy`、`.qoder`、`data` 未进入 commit；
- 没有新增业务实现。

---

## 5. R1：知识库正式入口和多合集范围

### 分支目标

```text
feat/r1-knowledge-entry-scope
```

从 Codex 已通过的 R0 commit 创建。

### 给小米 v2.5pro 终端的执行提示词

```text
你是执行者，只执行 R1：知识库正式入口和多合集范围。
不要重新设计检索算法，不改后端，不改 SQLite，不开 subagent。

先运行：
git status --short --branch
git log --oneline -5
git branch --show-current

确认 HEAD 是已通过的 R0 commit 后创建：
git switch -c feat/r1-knowledge-entry-scope

先只读：
docs/plans/knowledge-favorites-layout-entry-monitor-remediation-2026-07-26.md 第 1、2.1、3.1、6 节

按下面 A、B 两个小任务顺序执行。

【R1-A：路由和导航】

允许修改：
frontend/src/router.tsx
frontend/src/layouts/AppShell.tsx
frontend/src/__tests__/KnowledgeRouteRedirect.test.tsx

要求：
1. /knowledge 正式渲染现有 SearchPage。
2. /search 使用 replace 重定向到 /knowledge。
3. 保留 /search 原有 query string。
4. 侧栏名称改成“知识库”，链接指向 /knowledge。
5. aria-label 和可见文案同步。

先写路由测试并确认失败，再实现。

测试：
cd frontend
pnpm test -- src/__tests__/KnowledgeRouteRedirect.test.tsx
cd ..

提交：
git add -- frontend/src/router.tsx frontend/src/layouts/AppShell.tsx frontend/src/__tests__/KnowledgeRouteRedirect.test.tsx
git diff --cached --check
git commit -m "feat(knowledge): R1-A 统一知识库路由与导航"

【R1-B：全部、单个和多个合集】

允许修改：
frontend/src/pages/SearchPage/SearchPage.tsx
frontend/src/pages/SearchPage/KnowledgeScopePicker.tsx
frontend/src/pages/SearchPage/search.css
frontend/src/__tests__/SearchPage.test.tsx

要求：
1. 页面标题、kicker、按钮和错误文案统一为知识库语义。
2. 默认模式名称“问知识库”，第二模式“查找原文”。
3. 范围类型必须明确区分 all 与 selected。
4. 全部合集时不传 workspaceIds。
5. 单个/多个合集时传去重数组。
6. 全部与具体合集互斥。
7. 范围选择使用 popover，不在 Hero 展开多行 chip。
8. 摘要显示“全部合集”/合集名/“已选 N 个合集”。
9. 支持搜索、全选、清空、Esc 和点击外部关闭。
10. localStorage 恢复时过滤已经不存在的 workspace ID。
11. 空选择不能发送请求，提示至少选择一个合集。
12. 不改 searchGlobal 的后端契约。

先扩展 SearchPage.test.tsx 并确认失败，再实现。

测试：
cd frontend
pnpm test -- src/__tests__/SearchPage.test.tsx src/__tests__/KnowledgeRouteRedirect.test.tsx
pnpm build
cd ..
git diff --check

提交：
git add -- frontend/src/pages/SearchPage/SearchPage.tsx frontend/src/pages/SearchPage/KnowledgeScopePicker.tsx frontend/src/pages/SearchPage/search.css frontend/src/__tests__/SearchPage.test.tsx
git diff --cached --check
git commit -m "feat(knowledge): R1-B 支持多合集知识库范围"

禁止：
- 修改检索 service 或后端；
- 修改 /workspaces 的收纳箱过滤；
- 新增 npm 依赖；
- 将已选合集全部铺在页面上；
- 顺手重构 SearchPage 以外页面。

最后运行：
git show --stat --oneline HEAD~1
git show --stat --oneline HEAD
git status --short --branch

严格按作业书第 3 节回复，并给 Codex 审查提示词。
```

### 完成定义

- `/knowledge` 是正式入口；
- `/search?x=1` 到 `/knowledge?x=1`；
- 全部、单个、多个范围请求正确；
- Hero 不因多选变高；
- 两个定向测试和 build 通过。

---

## 6. R2：引用与音视频时间点闭环

### 分支目标

```text
feat/r2-citation-media-deeplink
```

这是 RAG 相关阶段。技术方案已经冻结，小米不得修改召回、reranker、FTS、prompt 目标或索引结构。实际代码与计划不一致时立即升级给 Codex。

### 给小米 v2.5pro 终端的执行提示词

```text
你是执行者，只执行 R2：真实引用和媒体时间点闭环。
不要重新设计 RAG，不改索引，不改数据库，不新增依赖，不开 subagent。

先运行启动检查，确认 HEAD 是已通过的 R1 commit，然后创建：
git switch -c feat/r2-citation-media-deeplink

只读总体计划第 2.1、3.2、7 节。
严格按 A、B、C、D 执行；每个小任务独立测试和 commit。

【R2-A：后端引用映射契约】

允许修改：
backend/app/services/workspace_search_service.py
backend/app/services/exact_search_service.py
backend/app/routes/search.py
tests/backend/test_global_search.py
tests/backend/test_exact_search.py

要求：
1. 保留 answer 和 sources 兼容字段。
2. 增加 citations 映射：number -> source_id。
3. source_id 在单次响应内唯一。
4. 从答案提取合法 [n]；重复去重；越界丢弃。
5. 没有合法引用时 citations=[]。
6. 未被答案引用的 sources 仍保留为相关原文。
7. exact 模式不生成 AI 回答。
8. 时间来源保留 start_ms/end_ms/field/jump_url。
9. URL 由服务端构造，不信任模型文本。
10. 不改变 retrieve/rerank/index 的调用方式。

先补测试：引用子集、重复、越界、无引用、空来源、时间参数；确认失败后实现。

测试：
./.venv/bin/pytest -q tests/backend/test_global_search.py tests/backend/test_exact_search.py
./.venv/bin/python -m compileall backend

提交：
git add -- backend/app/services/workspace_search_service.py backend/app/services/exact_search_service.py backend/app/routes/search.py tests/backend/test_global_search.py tests/backend/test_exact_search.py
git diff --cached --check
git commit -m "fix(knowledge): R2-A 建立真实引用映射契约"

如果需要第 6 个生产文件或修改检索算法，立即停止。

【R2-B：回答引用和来源分组】

允许修改：
frontend/src/services/search.ts
frontend/src/pages/SearchPage/SearchResultView.tsx
frontend/src/pages/SearchPage/search.css
frontend/src/__tests__/SearchCitationSources.test.tsx

要求：
1. 只把 citations 中的合法 [n] 渲染成按钮。
2. 点击滚动并高亮唯一来源卡片。
3. “引用来源”只显示答案真正引用项。
4. 其他 sources 放“相关原文”，默认折叠。
5. 无合法引用时明确提示，不制造假链接。
6. 安全渲染 Markdown。
7. 来源卡保留展开上下文、打开原文、收藏。
8. 不展示向量分数。

先写测试并确认失败，再实现。

测试：
cd frontend
pnpm test -- src/__tests__/SearchCitationSources.test.tsx src/__tests__/SearchPage.test.tsx
pnpm build
cd ..

提交：
git add -- frontend/src/services/search.ts frontend/src/pages/SearchPage/SearchResultView.tsx frontend/src/pages/SearchPage/search.css frontend/src/__tests__/SearchCitationSources.test.tsx
git diff --cached --check
git commit -m "fix(knowledge): R2-B 区分引用来源与相关原文"

【R2-C：视频时间点】

允许修改：
frontend/src/pages/result/VideoResultPage.tsx
frontend/src/__tests__/VideoResultKnowledgeDeepLink.test.tsx

要求：
1. 读取 start_ms/end_ms/field/from。
2. 数据和 video metadata ready 后只消费一次 start_ms。
3. 调现有 seekTo，不复制播放器。
4. 尝试 play。
5. play 被浏览器拒绝时保留 seek 位置并显示“点击播放”提示。
6. currentSec 驱动字幕高亮。
7. 参数不能在 re-render 时把用户反复拉回。

先写测试并确认失败，再实现。

测试：
cd frontend
pnpm test -- src/__tests__/VideoResultKnowledgeDeepLink.test.tsx
pnpm build
cd ..

提交：
git add -- frontend/src/pages/result/VideoResultPage.tsx frontend/src/__tests__/VideoResultKnowledgeDeepLink.test.tsx
git diff --cached --check
git commit -m "fix(knowledge): R2-C 支持视频引用时间点播放"

【R2-D：音频和 NoteShell 时间点】

允许修改：
frontend/src/pages/result/NoteShell/index.tsx
frontend/src/pages/result/NoteShell/NoteMediaCompanion.tsx
frontend/src/pages/result/NoteShell/NoteAudioPanel.tsx
frontend/src/__tests__/NoteShellKnowledgeDeepLink.test.tsx

上述播放器文件路径已经过确认；如果代码引用发生变化，只允许用 rg 找到真实定义并在回报中说明。不得读全项目。

要求：
1. NoteShell 读取统一 deep-link 参数。
2. 音频调用 audioRef.seekTo + play。
3. 视频调用现有 videoRef.seekTo + play。
4. 需要时复用 mediaCompanionRef。
5. 滚动并高亮当前字幕。
6. 自动播放拒绝时保留目标时间和提示。
7. 只消费一次。
8. 不通过 querySelector 模拟点击。

先写测试并确认失败，再实现。

测试：
cd frontend
pnpm test -- src/__tests__/NoteShellKnowledgeDeepLink.test.tsx src/__tests__/VideoResultKnowledgeDeepLink.test.tsx
pnpm build
cd ..
git diff --check

提交时只暂存实际修改的上述允许文件：
git diff --name-only
git add -- <实际允许文件>
git diff --cached --check
git commit -m "fix(knowledge): R2-D 支持音频引用时间点播放"

禁止：
- 修改模型 prompt 目标；
- 修改召回数量或排序；
- 修改媒体文件；
- 新建播放器；
- 自动静音绕过浏览器策略；
- 修改计划外结果页。

最后按作业书第 3 节回复，列出 R2 的全部 commit，并给 Codex 审查提示词。
```

### 完成定义

- 回答只链接真实引用；
- 来源与编号一一对应；
- 视频和音频跳到正确时间并尝试播放；
- 自动播放失败仍保留定位；
- 后端定向测试、前端定向测试和 build 通过。

---

## 7. R3：收纳箱收藏在收藏夹显示

### 分支目标

```text
feat/r3-favorites-resolved-feed
```

本阶段不得变更 SQLite schema；只增加已解析读取接口和前端消费。

### 给小米 v2.5pro 终端的执行提示词

```text
你是执行者，只执行 R3：修复收藏夹读取数据源。
不要重做收藏系统，不迁移数据库，不显示收纳箱合集，不开 subagent。

确认 HEAD 是已通过的 R2 commit 后创建：
git switch -c feat/r3-favorites-resolved-feed

只读总体计划第 2.2、8 节。

【R3-A：resolved favorites 后端接口】

允许修改：
backend/app/routes/workspaces.py
backend/app/services/metadata_store.py
tests/backend/test_favorites_api.py
tests/backend/test_metadata_store.py

要求：
1. 新增 GET /workspaces/metadata/favorites/resolved。
2. 可选 group_id 过滤。
3. SQLite MetadataStore 仍是收藏权威。
4. 解析所有未软删除 workspace，包含 __inbox__。
5. 普通 GET /workspaces 继续隐藏 inbox。
6. 按副本键 (workspace_id, content_id) 解析，不只按 content_id。
7. 返回 workspace、item、group_ids、favorited_at、jump_url。
8. 丢失或已删除内容跳过，不在 GET 中清理数据。
9. favorited_at 倒序。
10. 不改 schema。

先补测试：inbox、普通合集、软删除、丢失项、同源副本、分组；确认失败后实现。

测试：
./.venv/bin/pytest -q tests/backend/test_favorites_api.py tests/backend/test_metadata_store.py
./.venv/bin/python -m compileall backend

提交：
git add -- backend/app/routes/workspaces.py backend/app/services/metadata_store.py tests/backend/test_favorites_api.py tests/backend/test_metadata_store.py
git diff --cached --check
git commit -m "fix(favorites): R3-A 提供已解析收藏数据源"

如果必须改 schema 或迁移现有数据，停止。

【R3-B：收藏夹前端】

允许修改：
frontend/src/services/workspaces.ts
frontend/src/pages/FavoritesPage/FavoritesPage.tsx
frontend/src/pages/FavoritesPage/FavoriteCard.tsx
frontend/src/pages/FavoritesPage/FavoriteOrganizer.tsx
frontend/src/__tests__/FavoritesPage.test.tsx

要求：
1. FavoritesPage 不再用 listWorkspaces 聚合收藏。
2. 改用 resolved favorites。
3. 支持分组、搜索、类型组合过滤。
4. 按 favorited_at 排序。
5. 卡片展示来源合集和收藏时间。
6. 卡片提供直接取消收藏，阻止冒泡。
7. 取消成功立即移除；失败保留并 toast。
8. 同源副本状态独立。
9. 已有收藏导入/导出和分组不能删除。

先写测试并确认失败，再实现。

测试：
cd frontend
pnpm test -- src/__tests__/FavoritesPage.test.tsx
pnpm build
cd ..
git diff --check

提交：
git add -- frontend/src/services/workspaces.ts frontend/src/pages/FavoritesPage/FavoritesPage.tsx frontend/src/pages/FavoritesPage/FavoriteCard.tsx frontend/src/pages/FavoritesPage/FavoriteOrganizer.tsx frontend/src/__tests__/FavoritesPage.test.tsx
git diff --cached --check
git commit -m "fix(favorites): R3-B 显示收纳箱收藏并支持即时取消"

禁止：
- 取消 /workspaces 对 inbox 的隐藏；
- 修改数据库 schema；
- 自动删除悬空元数据；
- 按 content_id 合并不同副本；
- 新增置顶、同步、AI 收藏。

最后按作业书第 3 节回复，并给 Codex 审查提示词。
```

### 完成定义

- 当前 3 条收纳箱收藏可显示；
- 普通合集收藏也显示；
- 取消、刷新、分组和副本隔离正确；
- 不暴露收纳箱合集；
- 后端与前端测试、build 通过。

---

## 8. R4：资料库头部与同类页面布局

### 分支目标

```text
feat/r4-library-layout
```

### 给小米 v2.5pro 终端的执行提示词

```text
你是执行者，只执行 R4：修复资料库头部撑高和同类响应式风险。
不要删除后端标签/文件夹能力，不改业务数据，不开 subagent。

确认 HEAD 是已通过的 R3 commit 后创建：
git switch -c feat/r4-library-layout

只读总体计划第 2.3、3.3、9 节和 docs/DESIGN_TOKENS.md 相关 token。

【R4-A：Library 主故障】

允许修改：
frontend/src/pages/LibraryPage/index.tsx
frontend/src/pages/LibraryPage/library.css
frontend/src/__tests__/LibraryPageLayout.test.tsx
frontend/src/__tests__/LibraryPageBatchDelete.test.tsx

要求：
1. Hero 只保留标题、说明、导入内容、新建合集。
2. 普通工具栏放筛选、搜索、排序、选择、唯一的 ViewToggle。
3. 选择模式用一行批量栏替换普通工具栏。
4. 移除 Library 对 BatchOrganizeControl 的 import 和渲染。
5. 不删除 BatchOrganizeControl 文件或后端 API。
6. 删除重复 ViewToggle。
7. 批量栏只保留计数、全选、取消、目标合集、加入合集、删除。
8. 长合集名有界省略。
9. 选择合集时计数按实际素材数。
10. 部分失败保留失败项选择。
11. Hero 高度不因选择状态改变。

先写布局测试并确认失败，再实现。

测试：
cd frontend
pnpm test -- src/__tests__/LibraryPageLayout.test.tsx src/__tests__/LibraryPageBatchDelete.test.tsx
pnpm build
cd ..

提交：
git add -- frontend/src/pages/LibraryPage/index.tsx frontend/src/pages/LibraryPage/library.css frontend/src/__tests__/LibraryPageLayout.test.tsx frontend/src/__tests__/LibraryPageBatchDelete.test.tsx
git diff --cached --check
git commit -m "fix(library): R4-A 收口资料库 Hero 与批量栏"

【R4-B：收藏夹头部隔离】

允许修改：
frontend/src/pages/FavoritesPage/FavoritesPage.tsx
frontend/src/pages/FavoritesPage/favorites.css
frontend/src/__tests__/FavoritesPage.test.tsx

要求：
1. Favorites 不再依赖会被 Library 动态操作影响的头部布局。
2. 标题保持稳定。
3. 导入/导出、刷新放在有界工具区。
4. 1024px 不挤压标题。
5. 不改收藏数据逻辑。

先补测试后实现。

测试：
cd frontend
pnpm test -- src/__tests__/FavoritesPage.test.tsx
cd ..

提交：
git add -- frontend/src/pages/FavoritesPage/FavoritesPage.tsx frontend/src/pages/FavoritesPage/favorites.css frontend/src/__tests__/FavoritesPage.test.tsx
git diff --cached --check
git commit -m "fix(library): R4-B 隔离收藏夹头部布局"

【R4-C：其他页面响应式防回归】

允许修改：
frontend/src/pages/WorkspacePage/TaskboardPage/taskboard.css
frontend/src/pages/WorkspacePage/WorkspaceList.tsx
frontend/src/pages/results/LearningNotesPage/learning-notes.css
frontend/src/__tests__/PageHeaderResponsive.test.tsx

要求：
1. Taskboard 左侧 min-width:0；中等宽度封面和操作区稳定换行/堆叠。
2. WorkspaceList 窄屏标题和新建按钮上下堆叠。
3. LearningNotes 顶栏受控换行或横向滚动，返回和保存状态保留。
4. 不改三个页面业务逻辑。
5. Search 和 Settings 只在最终浏览器验收，不要无问题改代码。

先写最窄响应式 DOM 测试后实现。

测试：
cd frontend
pnpm test -- src/__tests__/PageHeaderResponsive.test.tsx
pnpm build
cd ..
git diff --check

提交：
git add -- frontend/src/pages/WorkspacePage/TaskboardPage/taskboard.css frontend/src/pages/WorkspacePage/WorkspaceList.tsx frontend/src/pages/results/LearningNotesPage/learning-notes.css frontend/src/__tests__/PageHeaderResponsive.test.tsx
git diff --cached --check
git commit -m "fix(library): R4-C 补齐页面头部响应式边界"

禁止：
- 删除 MetadataStore 的标签/文件夹；
- 修改合集加入/删除语义；
- 创建全站新设计系统；
- 改 Search/Settings 业务代码；
- 用缩小字体掩盖挤压。

最后按作业书第 3 节回复，并给 Codex 审查提示词。
```

### 浏览器验收交给 Codex

- 1440×900、1366×768、1024×768、768×1024、375×812；
- 首行卡片可见；
- 无标题竖排；
- 无横向页面滚动；
- 选择状态不改变 Hero 高度。

---

## 9. R5：添加素材一屏笔记设置

### 分支目标

```text
feat/r5-add-material-one-screen
```

如果 OpenDesign 可用，只生成布局参考；不得让它直接覆盖业务文件。

### 给小米 v2.5pro 终端的执行提示词

```text
你是执行者，只执行 R5：把 AddMaterial 收口为一屏笔记设置。
不要改变 pipeline 语义，不改后端，不新增依赖，不开 subagent。

确认 HEAD 是已通过的 R4 commit 后创建：
git switch -c feat/r5-add-material-one-screen

只读：
总体计划第 2.4、3.4、10 节
docs/DESIGN_TOKENS.md 相关 modal/token
frontend/src/components/workspace/AddMaterialModal.tsx 只用 rg + sed 读相关片段

【R5-A：去掉无意义 action，锁定 payload】

允许修改：
frontend/src/components/workspace/AddMaterialModal.tsx
frontend/src/__tests__/AddMaterialModal.test.tsx
frontend/src/__tests__/AddMaterialModal.local.test.tsx

要求：
1. 删除前端 ActionType、selectedAction 和“你要做什么 / 学习笔记”卡。
2. 生成请求仍明确是 note。
3. selectedNoteType 的 auto/video/image_text/audio/mixed 保留。
4. 不改变 summary_template、diarize、speaker_count、summary_mode、
   note_media_kind、embed_frames、frame_interval、vision_model、user_notes。
5. mixed 现有规则保持。

先新增 payload 测试并确认失败，再改。

测试：
cd frontend
pnpm test -- src/__tests__/AddMaterialModal.test.tsx src/__tests__/AddMaterialModal.local.test.tsx
cd ..

提交：
git add -- frontend/src/components/workspace/AddMaterialModal.tsx frontend/src/__tests__/AddMaterialModal.test.tsx frontend/src/__tests__/AddMaterialModal.local.test.tsx
git diff --cached --check
git commit -m "refactor(entry): R5-A 固定添加素材为笔记流程"

【R5-B：拆分面板，不改变状态归属】

允许新增/修改：
frontend/src/components/workspace/AddMaterialModal.tsx
frontend/src/components/workspace/MaterialSourcePanel.tsx
frontend/src/components/workspace/WorkspacePicker.tsx
frontend/src/components/workspace/NoteSettingsPanel.tsx
frontend/src/__tests__/AddMaterialModal.test.tsx

要求：
1. Modal 保持统一状态和提交编排。
2. 拆出来源、合集、设置三个纯受控面板。
3. 不新增全局 store。
4. 不在子组件复制请求逻辑。
5. 不改变 batch/local/existing 的 service 调用。
6. props 严格类型，禁止 any。

先用现有测试保护行为，再做拆分；拆分后同一测试必须通过。

测试：
cd frontend
pnpm test -- src/__tests__/AddMaterialModal.test.tsx src/__tests__/AddMaterialModal.local.test.tsx
cd ..

提交：
git add -- frontend/src/components/workspace/AddMaterialModal.tsx frontend/src/components/workspace/MaterialSourcePanel.tsx frontend/src/components/workspace/WorkspacePicker.tsx frontend/src/components/workspace/NoteSettingsPanel.tsx frontend/src/__tests__/AddMaterialModal.test.tsx
git diff --cached --check
git commit -m "refactor(entry): R5-B 拆分添加素材受控面板"

如果实际组件耦合导致必须新增第 6 个生产文件，停止报告，不自行扩大。

【R5-C：双栏一屏布局】

允许修改：
frontend/src/components/workspace/AddMaterialModal.tsx
frontend/src/components/workspace/MaterialSourcePanel.tsx
frontend/src/components/workspace/NoteSettingsPanel.tsx
frontend/src/styles/nibi-components.css
frontend/src/__tests__/AddMaterialModal.test.tsx

要求：
1. 桌面宽度约 920–1040px，最大 calc(100vw - 32px)。
2. 最大高度 calc(100dvh - 24px)。
3. 左栏：来源、预览、合集、批量/已有内容入口。
4. 右栏：素材类型、笔记风格、说话人、人数、画面分析、
   画面参数、补充说明。
5. 删除“高级设置”折叠器。
6. 上述高频设置常驻；仅上下文不适用时隐藏。
7. 页脚固定，显示状态摘要和开始生成。
8. 合集 popover、批量结果、已有内容列表内部滚动，不拉高 modal。
9. 1366×768 基础流程无需滚动。
10. 1024 及以下转单栏并允许主体内部滚动。
11. 只用现有 token 和 Remix modal 结构。

先补 DOM 可见性测试，再实现。

测试：
cd frontend
pnpm test -- src/__tests__/AddMaterialModal.test.tsx src/__tests__/AddMaterialModal.local.test.tsx
pnpm build
cd ..
git diff --check

提交：
git add -- frontend/src/components/workspace/AddMaterialModal.tsx frontend/src/components/workspace/MaterialSourcePanel.tsx frontend/src/components/workspace/NoteSettingsPanel.tsx frontend/src/styles/nibi-components.css frontend/src/__tests__/AddMaterialModal.test.tsx
git diff --cached --check
git commit -m "refactor(entry): R5-C 完成一屏常用笔记设置"

禁止：
- 把笔记风格、说话人、画面分析放进折叠区；
- 改 generateNote/importBatchSource 契约；
- 删除本地、批量或已有内容流程；
- 新增 UI 框架；
- 用绝对定位强塞布局；
- 顺手改设置默认值。

最后按作业书第 3 节回复，并给 Codex 审查提示词。
```

### 完成定义

- 没有“学习笔记”选择；
- 高频设置一屏常驻；
- 五种笔记类型和四种来源流程不回归；
- payload 一对一测试通过；
- 1366×768 视觉验收通过。

---

## 10. R6：任务活动与脱敏日志

### 分支目标

```text
feat/r6-monitor-logs
```

本阶段第一版只轮询，不实现 SSE，不新增依赖。

### 给小米 v2.5pro 终端的执行提示词

```text
你是执行者，只执行 R6：监控任务活动和脱敏应用日志。
不要做 SSE，不做远程控制，不记录用户内容，不新增依赖，不开 subagent。

确认 HEAD 是已通过的 R5 commit 后创建：
git switch -c feat/r6-monitor-logs

只读总体计划第 2.5、3.5、11 节。

【R6-A：应用日志缓冲和只读 API】

允许修改/新增：
backend/app/services/runtime_log_buffer.py
backend/app/routes/admin.py
backend/app/main.py
tests/backend/test_admin_logs.py

要求：
1. deque(maxlen=5000)。
2. 自定义 logging.Handler。
3. 单调 ID、timestamp、level、category、message。
4. 线程安全。
5. lifespan 只挂载一次，shutdown 移除。
6. GET /admin/logs 支持 after_id、level、category、limit。
7. 接口只读。
8. 进入 buffer 前脱敏 Authorization/Bearer/api_key/token/secret/credential/URL key。
9. 绝对用户路径只保留文件名或逻辑位置。
10. 禁止 prompt、字幕、OCR、正文、请求/响应 body。
11. handler 在测试/热重载不重复安装。

先写：上限、after_id、过滤、重复 handler、脱敏、422 测试；确认失败后实现。

测试：
./.venv/bin/pytest -q tests/backend/test_admin_logs.py
./.venv/bin/python -m compileall backend

提交：
git add -- backend/app/services/runtime_log_buffer.py backend/app/routes/admin.py backend/app/main.py tests/backend/test_admin_logs.py
git diff --cached --check
git commit -m "feat(monitor): R6-A 增加脱敏运行日志缓冲"

如果只有记录完整请求体才能实现，停止。

【R6-B：任务活动和日志前端】

允许修改/新增：
frontend/src/services/monitor.ts
frontend/src/pages/SettingPage/DeployMonitorPage.tsx
frontend/src/components/ui/log-console.tsx
frontend/src/__tests__/DeployMonitorPage.test.tsx

要求：
1. 复用 /pipeline/tasks?include_logs=true&limit=50。
2. 没有 task logs 时也从生命周期生成活动项。
3. 显示 queued/running/failed/recent success 数量。
4. “任务活动 / 应用日志”切换。
5. 应用日志按 latest_id 每 2 秒增量轮询。
6. 支持暂停、恢复、自动跟随、level/type/关键词过滤。
7. 网络失败保留旧内容。
8. unmount 清 timer。
9. 点击任务进入已有处理页/内容页。
10. 清空只清浏览器视图，不调用后端删除。
11. 保留健康、版本、uptime、CPU、内存、磁盘。

先写前端测试并确认失败，再实现。

测试：
cd frontend
pnpm test -- src/__tests__/DeployMonitorPage.test.tsx
pnpm build
cd ..
git diff --check

提交：
git add -- frontend/src/services/monitor.ts frontend/src/pages/SettingPage/DeployMonitorPage.tsx frontend/src/components/ui/log-console.tsx frontend/src/__tests__/DeployMonitorPage.test.tsx
git diff --cached --check
git commit -m "feat(monitor): R6-B 展示任务活动与应用日志"

禁止：
- SSE/WebSocket；
- 清服务端日志；
- 修改任务状态；
- 显示密钥、prompt、字幕、正文、绝对路径；
- 把 stdout 任意内容直接返回；
- 新增依赖。

最后按作业书第 3 节回复，并给 Codex 审查提示词。
```

### 完成定义

- 空日志任务也有活动；
- 新安全日志 2 秒内出现；
- 暂停、恢复、过滤、自动跟随正确；
- 脱敏测试覆盖密钥和路径；
- 后端、前端测试和 build 通过。

---

## 11. R7：总体验收分支

### 分支目标

```text
feat/r7-final-acceptance
```

R7 原则上不写业务代码，只增加缺失的验收测试或文档。发现功能失败时回到对应 R 分支修复并 amend，不能在 R7 混入大修。

### 给小米 v2.5pro 终端的执行提示词

```text
你是执行者，只执行 R7：汇总自动测试和浏览器验收证据。
不要在 R7 顺手修业务功能，不开 subagent，不修改用户数据。

确认 HEAD 是已通过的 R6 commit 后创建：
git switch -c feat/r7-final-acceptance

只读总体计划第 12–14 节。

先运行：
git status --short --branch
git log --oneline -12

自动测试：
./.venv/bin/pytest backend/tests tests/backend -q
./.venv/bin/python -m compileall backend shared scripts
cd frontend
pnpm test --run
pnpm build
cd ..
git diff --check

如果 backend/tests 不存在，记录真实错误，改用：
./.venv/bin/pytest tests/backend -q
不能把替代命令隐瞒成原命令通过。

浏览器验收：
1. /knowledge 正式入口与 /search 兼容跳转。
2. 全部、单个、多个合集。
3. AI 回答、真实引用、相关原文。
4. 视频和音频时间点自动定位播放。
5. 自动播放被拒绝时仍保留位置。
6. inbox 和普通合集收藏、取消、刷新、分组、副本隔离。
7. /notes 新建、选择、加入合集不撑高 Hero。
8. 无文件夹、移动、标签、整理；只有一个 ViewToggle。
9. AddMaterial 高频设置同屏，五种类型和四种来源流程。
10. Monitor 任务活动、日志、暂停、过滤、脱敏。
11. 1440×900、1366×768、1024×768、768×1024、375×812 无横向溢出。
12. console error 为 0。

输出 Playwright JSON：
- URL
- viewport
- 关键 DOM 数量/文字
- console error
- 网络失败

保存关键截图并报告绝对路径。

如果任何验收失败：
- 不提交“全部通过”；
- 写明属于 R1–R6 哪一阶段；
- 停止并让用户把该问题退回对应分支；
- 不在 R7 大改。

只有所有自动和浏览器验收通过时，才允许提交验收测试/文档：
git add -- <仅验收测试或文档>
git diff --cached --check
git commit -m "test(validation): R7 完成知识库修复总体验收"

若无需新增文件，R7 可以不提交，只输出完整证据。

最后按作业书第 3 节回复，并给 Codex 最终审查提示词。
```

### 最终 Codex 审查重点

- 在最终提交的干净 checkout/worktree 运行完整测试；
- 逐一核对 R0–R6 commit 的独立边界；
- 确认当前工作树未替 commit 补代码；
- 第一行给出“通过 / 不通过 / 需要补充验证”；
- 有任何未验证项都不能判定全部完成。

---

## 12. 小米遇到停点时的固定回复

```text
阶段：R?
状态：停点，未继续修改

计划假设：
<原计划>

实际代码/数据：
<只写已验证事实>

已修改但未提交文件：
<git diff --name-only>

方案 A：
<影响>

方案 B：
<影响>

我的建议：
<只给一个建议和理由>

需要用户确认：
<具体问题>
```

停点时不要 commit 半成品，不要切下一分支，不要自行选择产品语义。
