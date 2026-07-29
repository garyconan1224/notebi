# 知识库、收藏夹、布局、添加素材与监控修复执行计划

> 日期：2026-07-26  
> 状态：只读调查完成，产品决策已冻结，待其他执行工具按阶段实施  
> 基线：`codex/knowledge-final-validation`，当前提交 `b19d05c`  
> 前置成果：原总体计划 P0–P7、PE 已落到 `be08176`–`2ded510`，本计划只做增量修复，不重做既有迁移  
> 参考：`overview.md`、`knowledge-favorites-search-research-2026-07-23.md`、`knowledge-favorites-search-master-execution-plan-2026-07-25.md`
> 小米执行：见 `knowledge-favorites-layout-entry-monitor-xiaomi-runbook-2026-07-26.md`；每次只交付其中一个 R 阶段

---

## 0. 执行结论

本轮应拆成 8 个串行阶段，并在最前面保存一次用户确认的新 UI 基线：

| 阶段 | 结果 | 风险级别 |
|---|---|---|
| R0 | 只保存当前已确认的未提交前端基线，并记录复现证据 | 中 |
| R1 | `/knowledge` 成为唯一“知识库”入口，支持全部、单个或多个合集 | 中 |
| R2 | AI 回答的真实引用与原文一一对应，音视频跳到时间点并自动播放 | 高 |
| R3 | 修复收纳箱收藏不显示，并补齐收藏夹的直接取消收藏与正确排序 | 中 |
| R4 | 修复资料库头部撑高，移除无用批量整理控件，并做同类页面防回归 | 中 |
| R5 | “添加素材”固定为笔记流程，常用选项在一屏内常驻 | 中 |
| R6 | 监控页接入任务活动与经过脱敏的应用日志 | 高 |
| R7 | 全量自动测试、浏览器验收与独立复审 | 中 |

必须严格串行。每个阶段从前一阶段已验收的提交继续开新分支，测试通过后立刻提交；不得把多个阶段堆成一个大提交，不主动 push，不自行合并到 `main`。

---

## 1. 已冻结的产品决策

以下内容不再由执行工具自行改写：

1. 导航和页面名称统一为“知识库”。
2. `/knowledge` 是正式地址；旧 `/search` 只做兼容重定向，并保留查询参数。
3. 知识库默认是“问知识库”：先给 AI 综合回答，再在下方给可核验的引用来源。
4. “查找原文”保留为第二种模式，只列匹配原文，不让 AI 总结。
5. 范围支持：
   - 全部合集；
   - 单个合集；
   - 多个合集。
6. “全部合集”和具体合集互斥，不能出现“全部 + 3 个合集”这种含义冲突。
7. 点击回答中的引用编号，定位并高亮对应来源卡片。
8. 点击音频或视频来源，跳到对应字幕时间点并尝试自动播放。
9. 浏览器阻止自动播放时，仍必须完成跳转和 seek，并显示明确的“点击播放”提示，不能回到 0 秒。
10. 收藏是副本级状态；同源内容的不同副本可以独立收藏或取消收藏。
11. “添加素材”默认且固定生成笔记，不再让用户先选择“学习笔记”。
12. 笔记风格、区分说话人、画面分析是高频设置，必须常驻；不能放进“高级设置”。
13. 资料库第一层只保留真正可用的操作。新建文件夹、移动文件夹、标签、整理从资料库批量栏移除。
14. 监控页显示任务活动和经过脱敏的应用日志；不得展示 API Key、Authorization、完整提示词、完整字幕或用户本地绝对路径。

### 1.1 本计划覆盖旧计划的地方

旧调研把 `/search` 作为主入口、`/knowledge` 作为兼容地址。最新用户决定相反，因此实施时以本计划为准：

```text
/knowledge  -> 正式知识库页面
/search     -> replace 重定向到 /knowledge
```

旧计划中的 SQLite、FTS5、内容身份、同源谱系、正文版本和元数据迁移已经完成，不得借本轮修复再次改 schema 或重跑迁移。

---

## 2. 只读调查结论与根因

### 2.1 知识库入口和引用闭环

当前事实：

- `frontend/src/router.tsx` 仍由 `/knowledge` 跳到 `/search`。
- `frontend/src/layouts/AppShell.tsx` 侧栏仍显示“智能检索”。
- `SearchPage` 的合集范围是原生单选框，只能全部或单个合集。
- AI 回答是普通文本；页面把所有召回来源都渲染为引用，而不是只展示回答真正引用的来源。
- 后端提示模型使用 `[1]`、`[2]`，但没有把“回答实际用了哪些编号”整理成稳定契约。
- 精确检索已经生成 `start_ms`、`end_ms`、`field=transcript`，但结果页没有消费这些 URL 参数。
- 视频详情已有真实 `<video>`、`seekTo` 和字幕联动；`NoteShell` 已有视频、音频 ref 和 `seekTo`，所以不需要另造播放器。

结论：问题不是检索引擎缺失，而是入口语义、范围选择、引用映射和结果页 deep-link 消费没有收口。

### 2.2 收藏夹空白

当前本地运行数据已证明：

- SQLite 收藏元数据中有 3 条收藏；
- 3 条均来自隐藏收纳箱 `__inbox__`；
- `/workspaces/library` 能看到这 3 条的 `favorite=true`；
- 普通 `GET /workspaces` 明确过滤 `source == "inbox"`；
- `FavoritesPage` 却通过 `listWorkspaces()` 汇总 `workspace.favorites`。

根因：收藏写入成功，但收藏夹从一个会隐藏收纳箱的数据源读取，所以收纳箱收藏永远无法显示。不能用“把收纳箱重新显示在合集列表”修补；收藏夹需要自己的已解析收藏查询。

### 2.3 资料库头部撑高

`LibraryPage` 把以下内容全部塞进 `.lib-page-header` 的右侧 `auto` 列：

- 选择、全选、取消、删除；
- 目标合集选择和加入合集；
- `BatchOrganizeControl` 的标签、文件夹、新文件夹、整理；
- 排序和视图切换。

`.lib-page-header` 使用 `grid-template-columns: 1fr auto`，右列按最大内容宽度增长，左侧标题被压缩到逐字换行；右列又允许换行，最终把整个 Hero 撑得很高。`ViewToggle` 同时在 Hero 和下方工具栏重复出现。

横向检查结果：

- `FavoritesPage` 复用 `.lib-page-header` 和 `.lib-actions`，存在同源风险，但当前按钮较少。
- `TaskboardPage` 也是左右双列头部，右侧有固定宽度封面和多操作按钮；中等宽度下会挤压标题，需要响应式防回归。
- `WorkspaceList` 的标题与按钮在窄宽度下缺少换行/堆叠规则，但不是当前截图中的严重故障。
- `LearningNotesPage` 顶部导航工具较多，窄屏存在横向溢出风险，但不会把标题压成竖排。
- `SearchPage` 和设置页没有同样的“`auto` 操作列挤压标题”结构，本轮只加入视觉回归，不做无关重构。

### 2.4 添加素材弹窗过长

当前 `AddMaterialModal`：

- `selectedAction` 默认是 `note`，界面也只展示“学习笔记”，这一步没有实际选择价值；
- 素材类型、风格、说话人、画面分析在同一条很长的纵向流程中；
- 弹窗常规宽度只有 560px，导致每组卡片占用大量垂直空间；
- 常用设置虽然大多已存在，但需要滚动后才能看到；
- “高级设置”目前主要包含补充说明，但命名让用户误以为关键能力也被藏起来；
- 合集选择、创建合集和批量来源展开后还会继续拉长页面。

结论：保留业务能力，重做信息层级与响应式布局；不能把高频设置简单挪进另一个折叠区。

### 2.5 监控没有日志

`DeployMonitorPage` 当前把日志初始化为空数组，并明确写着等待 SSE。系统资源与健康检查已接入：

- `/health`
- `/admin/system/stats`

任务系统已有：

- `/pipeline/tasks`
- `include_logs`
- 任务状态、进度、错误、时间和每任务最多 200 条日志

但没有应用级日志查询接口，也没有统一的安全日志缓冲区。因此监控应分成两类数据：

1. 任务活动：复用真实任务接口；
2. 应用日志：新增有界、脱敏、只读的日志缓冲与查询接口。

---

## 3. 目标交互

### 3.1 知识库

```text
知识库
┌──────────────────────────────────────────────────────────┐
│ [问知识库] [查找原文]   范围：[全部合集 ▾]               │
│ 询问合集中的内容……                              [提问]   │
└──────────────────────────────────────────────────────────┘

AI 回答
关键结论……[1]，另一项结论……[2]

引用来源 2
[1] 合集 / 标题 / 00:12–00:25 / 原文片段       [打开原文]
[2] 合集 / 标题 / 13:08–13:29 / 原文片段       [打开原文]

相关原文 3  [展开]
```

范围选择器使用弹出面板而不是把所有已选合集展开成一排 chip：

- 默认摘要为“全部合集”；
- 单选后显示合集名；
- 多选后显示“已选 3 个合集”；
- 面板内支持搜索、全选、清空和复选框；
- 关闭后不增加 Hero 高度；
- 最近一次选择保存在产品隔离的 localStorage 中。

### 3.2 引用跳转

```text
点击 [2]
  -> 滚动并高亮来源 2

点击“打开原文”
  -> /workspaces/:workspaceId/items/:itemId/<正式路由>
     ?start_ms=788000&end_ms=809000&field=transcript&from=knowledge
  -> 结果数据与媒体 metadata 都就绪
  -> seekTo(788)
  -> 滚动并高亮当前字幕
  -> play()
  -> 自动播放被拒绝时，保留 788 秒并显示播放提示
```

### 3.3 资料库

```text
静态 Hero：标题、说明、导入内容、新建合集

普通工具栏：筛选 | 搜索 | 排序 | 选择 | 视图

进入选择模式后，普通工具栏替换为一行批量栏：
已选 3 项 | 全选 | 取消 | [目标合集 ▾] [加入合集] | [删除]
```

不再出现：

- 新建文件夹；
- 移动文件夹；
- 标签输入；
- 整理按钮；
- 重复的视图切换。

后端文件夹/标签 API 暂时保留兼容，本轮只撤掉资料库里无用的入口，不做破坏性数据清理。

### 3.4 添加素材

桌面端使用较宽的双栏弹窗：

```text
┌──────────────── 添加素材 ────────────────┐
│ 左栏：素材与归属       │ 右栏：笔记设置   │
│ 链接/本地上传/预览     │ 素材类型          │
│ 选择或新建合集         │ 笔记风格          │
│ 批量来源入口           │ 区分说话人        │
│                        │ 画面分析          │
│                        │ 补充说明          │
├──────────────────────────────────────────┤
│ 已识别：视频 · 标准总结            开始生成 │
└──────────────────────────────────────────┘
```

桌面 1366×768 及以上必须做到：

- 来源输入、合集归属、素材类型、笔记风格、说话人、画面分析和开始生成同时可见；
- 基础流程不滚动；
- 批量结果列表和“从已有内容添加”可以在各自区域内部滚动；
- 页脚固定，不随主体滚走。

1024×768 及更小宽度允许弹窗主体内部滚动，但不允许弹窗超出视口；移动端切换为单栏。

### 3.5 监控

保留健康与 CPU/内存/磁盘，再增加：

- 任务概览：排队、运行、失败、最近成功；
- 任务活动：时间、任务类型、素材/合集、状态、进度、最后一条安全日志；
- 应用日志：时间、级别、类别、简短消息；
- 过滤：级别、任务类型、关键词；
- 自动刷新/暂停；
- 自动跟随最新日志；
- 点击任务回到对应处理页或内容页。

不做：

- 在线修改服务配置；
- 清空后端真实日志；
- 展示密钥、完整请求体或用户内容；
- 把系统终端的任意 stdout 原样暴露到浏览器。

---

## 4. 分支、提交与回档策略

### 4.1 启动检查

每个执行工具开始前必须运行：

```bash
git status --short --branch
git log --oneline -5
git branch --show-current
```

当前已知未提交基线包括以下前端文件：

```text
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
```

这些改动已被用户确认是新基线。以下路径属于用户或其他工具，绝对不能修改、清理或暂存：

```text
.workbuddy/
.qoder/
data/
```

如果启动时出现除此之外的新改动、当前提交不是 `b19d05c` 的后继，或已有同主题分支正在工作，立即停止并报告。

### 4.2 串行分支链

建议分支：

```text
feat/r0-save-ui-baseline
  └─ feat/r1-knowledge-entry-scope
       └─ feat/r2-citation-media-deeplink
            └─ feat/r3-favorites-resolved-feed
                 └─ feat/r4-library-layout
                      └─ feat/r5-add-material-one-screen
                           └─ feat/r6-monitor-logs
                                └─ feat/r7-final-acceptance
```

每个分支从前一阶段已通过的提交创建。阶段完成后：

1. `git diff --check`；
2. 跑本阶段测试；
3. 只暂存本阶段文件；
4. 提交；
5. 记录提交号和测试结果；
6. 不 merge、不 rebase、不 push；
7. 用户验收后再开始下一分支。

建议提交：

```text
chore(baseline): R0 保存 2026-07-26 UI 基线
feat(knowledge): R1 统一知识库入口与多合集范围
fix(knowledge): R2 收口引用与音视频时间点跳转
fix(favorites): R3 显示收纳箱收藏并支持即时取消
fix(library): R4 收口批量栏与页面头部布局
refactor(entry): R5 将添加素材收口为一屏笔记设置
feat(monitor): R6 接入任务活动与脱敏应用日志
test(validation): R7 完成跨模块浏览器与全量验收
```

需要回档时，直接切回对应阶段提交；不要用 `git reset --hard` 覆盖用户工作区。Phase 完成后只提醒用户可打 tag，不自动打 tag。

---

## 5. R0：保存基线并记录复现证据

### 目标

保护用户确认的 UI 改动，记录本轮问题的现状证据。失败测试在各修复阶段内按“先红后绿”完成，不把一批必然失败的测试留在基线提交中。

### 操作

1. 创建 `feat/r0-save-ui-baseline`。
2. 使用显式文件白名单暂存上面的 12 个前端文件、本计划文档和对应的小米作业书。
3. 再运行 `git diff --cached --name-only`，确认没有 `.workbuddy`、`.qoder`、`data`。
4. 提交基线。
5. 用现有页面、只读 API 和截图记录以下复现证据：
   - `/search` 和 `/knowledge` 路由方向；
   - 当前范围只能单选，不能发出多合集请求；
   - 当前把全部召回来源当成引用，未按真实 `[n]` 映射；
   - 收纳箱已有收藏但收藏夹看不到；
   - Library 选择模式仍渲染 `BatchOrganizeControl` 并撑高头部；
   - AddMaterial 仍出现无意义的“你要做什么 / 学习笔记”；
   - Monitor 仍固定传入空日志数组。
6. 运行现有定向测试和前端 build，记录基线是否已经存在与本轮无关的失败；R0 不新增测试或生产代码。

### 完成条件

- 基线提交只含白名单文件；
- 复现证据能对应到本计划第 2 节的根因；
- 现有基线测试结果已记录；
- 没有生产代码修复混入 R0。

---

## 6. R1：知识库入口与多合集范围

### 目标

把现有搜索页收口为正式知识库工作台，不改底层 FTS/向量检索算法。

### 前端调整

1. `frontend/src/router.tsx`
   - `/knowledge` 渲染现有 `SearchPage`；
   - `/search` 使用 replace 重定向到 `/knowledge`；
   - 保留旧 URL 的 query string；
   - 不删除旧组件文件，先保证兼容。
2. `frontend/src/layouts/AppShell.tsx`
   - 侧栏名称改为“知识库”；
   - 链接指向 `/knowledge`；
   - 搜索图标可保留，但 aria-label 同步。
3. `frontend/src/pages/SearchPage/SearchPage.tsx`
   - 标题和文案全部改为知识库语义；
   - 默认模式文案改为“问知识库”；
   - 第二模式改为“查找原文”；
   - `scope: string` 改为明确的范围状态：

```ts
type KnowledgeScope =
  | { kind: 'all' }
  | { kind: 'selected'; workspaceIds: string[] }
```

4. 新建小型范围选择组件，例如：
   - `frontend/src/pages/SearchPage/KnowledgeScopePicker.tsx`
   - 复选合集；
   - 搜索合集；
   - 全部、清空；
   - 用一句摘要显示选择结果；
   - Esc 和点击外部关闭；
   - 完整键盘与 aria 支持。
5. 继续调用已有 `searchGlobal`：
   - 全部：不传 `workspaceIds`；
   - 具体范围：传去重后的数组；
   - 选择为空时不发送模糊请求，提示“请至少选择一个合集”。
6. 使用产品隔离存储键保存最后范围，例如 `knowledge_scope`；读取时删除已不存在的 workspace ID。
7. 搜索历史继续保持本地，不迁移。

### 布局

- 范围选择器必须是弹出层；
- Hero 上只显示一句摘要，不能把全部已选合集展开成多行；
- 结果出来后范围仍可修改并重新提问；
- 索引状态和刷新入口保留，但放到次要位置。

### 测试

- `/search?q=x` 重定向为 `/knowledge?q=x`；
- 侧栏只显示“知识库”；
- 全部合集时 request 不带 `workspace_ids`；
- 单个和多个合集按原顺序去重传递；
- “全部合集”和具体合集互斥；
- 已删除合集不会污染恢复状态；
- 选择为空、索引未就绪、模型未配置、请求失败都有明确提示。

### 主要文件

- `frontend/src/router.tsx`
- `frontend/src/layouts/AppShell.tsx`
- `frontend/src/pages/SearchPage/SearchPage.tsx`
- `frontend/src/pages/SearchPage/search.css`
- `frontend/src/services/search.ts`
- `frontend/src/__tests__/SearchPage.test.tsx`
- `frontend/src/__tests__/KnowledgeRouteRedirect.test.tsx`

### 完成条件

- 地址、侧栏、标题统一为知识库；
- 全部、单个、多个合集真实生效；
- 不改搜索索引和数据库 schema；
- R1 前端测试与 build 通过。

---

## 7. R2：真实引用、原文来源与媒体时间点

### 目标

让“回答—引用—原文—媒体时间点”成为可验证闭环。

### 后端响应契约

不要让前端自行猜“所有召回结果都是引用”。在统一搜索响应中增加稳定的引用映射，字段名可按现有模型风格调整，但语义必须等价：

```json
{
  "answer": "……[1]……[3]",
  "citations": [
    { "number": 1, "source_id": "..." },
    { "number": 3, "source_id": "..." }
  ],
  "sources": [
    {
      "source_id": "...",
      "workspace_id": "...",
      "item_id": "...",
      "content_type": "audio",
      "title": "...",
      "snippet": "...",
      "start_ms": 12000,
      "end_ms": 25000,
      "field": "transcript",
      "jump_url": "..."
    }
  ]
}
```

规则：

1. `source_id` 在一次响应内唯一且稳定；
2. 后端从答案提取 `[n]`，只保留合法且存在的编号；
3. 重复引用只在 `citations` 中出现一次；
4. 越界编号不生成链接；
5. 没有合法引用时返回空 `citations`，前端明确提示；
6. `sources` 仍可包含未被回答引用的相关原文；
7. exact 模式没有 AI 回答，直接把命中项作为原文结果；
8. 不让模型输出或决定跳转 URL，URL 由服务端可信字段构造。

### 前端回答与来源

1. `SearchResultView` 使用安全 Markdown 渲染回答。
2. 将合法 `[n]` 替换为可访问的按钮/链接：
   - 点击滚动到来源；
   - 来源卡片高亮 2 秒；
   - `aria-label="查看引用 2"`。
3. 来源分两组：
   - “引用来源”：只显示 `citations` 实际使用的来源；
   - “相关原文”：其余召回结果，默认折叠。
4. 来源卡片展示：
   - 编号；
   - 合集；
   - 素材标题；
   - 类型；
   - 时间范围或正文位置；
   - 原文片段；
   - 展开上下文；
   - 打开原文；
   - 收藏/取消收藏。
5. 不向普通用户展示原始向量分数。

### 时间点 deep-link

统一参数：

```text
start_ms
end_ms
field=transcript|summary|title|note
from=knowledge
```

1. 后端为有时间信息的来源生成这些参数。
2. `VideoResultPage`
   - 使用 `useSearchParams`；
   - 数据和 `<video>` metadata 都 ready 后只消费一次 `start_ms`；
   - 调已有 `seekTo(startSec)`；
   - 依靠 `currentSec` 高亮字幕；
   - 调 `video.play()`；
   - 捕获 `NotAllowedError`，显示非阻塞播放提示。
3. `NoteShell`
   - 音频走 `audioRef.current.seekTo()`；
   - 视频走 `videoRef.current.seekTo()`；
   - 需要时使用现有 `mediaCompanionRef`；
   - 自动播放接口应放在播放器 handle 上，例如 `play(): Promise<void>`，不要模拟点击 DOM；
   - 激活并滚动对应字幕；
   - 参数只消费一次，避免每次渲染把用户拉回起点。
4. 文本、图片或无时间来源：
   - 打开正式详情路由；
   - 按 `field` 滚动并短暂高亮相应区块；
   - 找不到区块时停在页面顶部并给出温和提示，不报错白屏。
5. 从来源页返回后，知识库应保留本次 query、mode、scope 和结果；优先使用路由 state/sessionStorage，不把大结果对象写进 URL。

### 测试

后端：

- 引用子集；
- 重复编号；
- 越界编号；
- 无引用；
- 空来源；
- 音视频来源包含毫秒定位；
- URL 参数编码正确。

前端：

- 点击 `[2]` 高亮第二条来源；
- 未引用的召回项只出现在“相关原文”；
- 视频 seek 秒数正确并调用 play；
- 音频 seek 秒数正确并调用 play；
- 自动播放拒绝后仍停在目标时间；
- 参数不重复消费；
- exact 模式不出现伪 AI 回答。

### 主要文件

- `backend/app/services/workspace_search_service.py`
- `backend/app/services/exact_search_service.py`
- `backend/app/routes/search.py`
- `backend/app/models/` 中现有搜索响应模型
- `frontend/src/pages/SearchPage/SearchResultView.tsx`
- `frontend/src/pages/SearchPage/search.css`
- `frontend/src/services/search.ts`
- `frontend/src/pages/result/VideoResultPage.tsx`
- `frontend/src/pages/result/NoteShell/index.tsx`
- 视频/音频播放器 handle 类型文件
- `tests/backend/test_global_search.py`
- `tests/backend/test_exact_search.py`
- `frontend/src/__tests__/SearchCitationSources.test.tsx`
- 新增媒体 deep-link 测试

### 完成条件

- 每个可点击引用都唯一对应一条来源；
- 每条引用来源都能打开正确副本；
- 有时间点的音视频会 seek 并尝试自动播放；
- 浏览器阻止播放时没有丢失定位；
- 不改媒体文件、不复制字幕、不新增依赖。

---

## 8. R3：收藏夹已解析数据源

### 目标

收藏成功后，无论内容位于普通合集还是隐藏收纳箱，都能立即、刷新后持续出现在收藏夹。

### 后端设计

新增只读的已解析收藏端点，建议：

```text
GET /workspaces/metadata/favorites/resolved
GET /workspaces/metadata/favorites/resolved?group_id=<id>
```

响应项：

```json
{
  "workspace_id": "__inbox__",
  "workspace_name": "收纳箱",
  "content_id": "...",
  "group_ids": ["default"],
  "favorited_at": "2026-07-26T...",
  "item": { "...现有 WorkspaceItem 展示字段..." },
  "jump_url": "/workspaces/__inbox__/items/.../note"
}
```

实现规则：

1. SQLite `MetadataStore` 继续是收藏关系权威来源；
2. 解析时遍历所有未软删除 workspace，包含 `source=inbox`；
3. 不修改普通 `GET /workspaces` 隐藏收纳箱的规则；
4. 用 `(workspace_id, content_id)` 或等价副本键解析，不得只按 `content_id` 合并；
5. 同一收藏加入多个分组时返回一张卡和多个 `group_ids`；
6. 丢失、已删除或已软删除内容不展示；
7. 本轮不自动清除丢失关系，避免读取接口产生破坏性副作用；
8. 按 `favorited_at` 倒序，不按素材更新时间排序；
9. 返回前复用现有安全的详情路由解析。

### 前端调整

1. `FavoritesPage` 不再通过 `listWorkspaces()` 聚合收藏；
2. 改为直接加载 resolved favorites 和 group 列表；
3. 分组切换可把 `group_id` 交给服务端，或对一次 resolved 响应按 `group_ids` 过滤；只能选一种，不双重过滤；
4. `FavoriteCard` 增加直接取消收藏：
   - 阻止冒泡，不能先打开详情；
   - 成功后立即从本地列表移除；
   - 失败时保留卡片并 toast；
5. 卡片展示来源合集、类型和收藏时间；
6. 搜索覆盖标题和合集名；
7. 类型筛选和空态继续保留；
8. 已有导入、导出和分组功能不删除。

### 本轮收藏夹增强边界

必须做：

- 直接取消收藏；
- 按收藏时间排序；
- 展示来源合集；
- 搜索、类型和分组组合过滤；
- 收藏后刷新仍在。

暂不做：

- 置顶；
- 最近访问统计；
- AI 自动收藏；
- 跨设备同步；
- 收藏内容二次复制。

### 测试

- 收纳箱收藏出现在 resolved endpoint；
- 普通合集收藏出现；
- 软删除内容不出现；
- 丢失内容不导致接口 500；
- 两个同源副本的收藏互不串联；
- 分组过滤不因相同 `content_id` 串副本；
- 取消收藏后页面立即更新，刷新后仍正确；
- 失败时不误删本地卡片；
- 导入导出回归。

### 主要文件

- `backend/app/routes/workspaces.py`
- `backend/app/services/metadata_store.py`
- 搜索/收藏响应模型
- `frontend/src/services/workspaces.ts`
- `frontend/src/pages/FavoritesPage/FavoritesPage.tsx`
- `frontend/src/pages/FavoritesPage/FavoriteCard.tsx`
- `frontend/src/pages/FavoritesPage/FavoriteOrganizer.tsx`
- `frontend/src/pages/FavoritesPage/favorites.css`
- `tests/backend/test_favorites_api.py`
- `tests/backend/test_metadata_store.py`
- `frontend/src/__tests__/FavoritesPage.test.tsx`

### 完成条件

- 截图中已收藏的 3 个收纳箱内容能够显示；
- 收藏、取消、刷新、分组和副本隔离全部通过；
- 不把收纳箱暴露到普通合集列表；
- 不改数据库 schema。

---

## 9. R4：资料库头部与同类布局收口

### 目标

选择、新建合集和加入合集不再改变 Hero 高度，不让内容区被推到首屏之外。

### LibraryPage 必须调整

1. Hero 只保留：
   - 标题；
   - 描述；
   - 导入内容；
   - 新建合集。
2. 把选择、排序、视图全部移到独立工具栏。
3. 进入选择模式后，用一条批量栏替换普通工具栏，不在 Hero 追加控件。
4. 删除 `LibraryPage` 对 `BatchOrganizeControl` 的渲染和 import。
5. 不删除其后端 API、SQLite 表或其他页面调用。
6. `ViewToggle` 只保留一个。
7. 目标合集选择器使用有界宽度，长名称省略并用 title/tooltip 展示全名。
8. 批量栏在内容滚动时可 sticky，但不能遮挡卡片。
9. 选择计数按实际展开后的素材数显示，选择合集时不能只显示“1”却操作多个素材。
10. 加入合集成功后退出选择模式；部分失败时保留失败项选择。

### CSS 修复

建议用：

```css
.lib-page-header {
  grid-template-columns: minmax(0, 1fr) auto;
}
```

但不能只靠这一行掩盖结构问题；动态批量操作必须移出 Hero。新增/调整选择器时全部限定在 `.lib-page` 下，避免 `FavoritesPage` 因复用类名被意外改变。

### 横向防回归

1. `FavoritesPage`
   - 不再依赖 Library 的动态 action 布局；
   - Hero 只保留标题和简短动作；
   - 导入/导出、刷新可放独立工具栏；
   - 1024px 不得挤压标题。
2. `TaskboardPage`
   - `.tb-head-l { min-width: 0; }`；
   - 中等宽度把右侧封面置于标题下方或缩小；
   - 操作按钮有稳定的折行区域；
   - 不改合集业务。
3. `WorkspaceList`
   - 窄屏标题和“新建合集”上下堆叠；
   - 不让说明文字与按钮互相覆盖。
4. `LearningNotesPage`
   - 顶部工具允许受控滚动/折行；
   - 保存状态和主要返回动作不能被挤掉。
5. `SearchPage`、设置页
   - 只做截图/DOM 回归；
   - 没有问题就不改代码。

### OpenDesign 使用建议

如果执行工具可以调用 OpenDesign，先生成两个只读设计参考：

1. Library 普通态和选择态；
2. AddMaterial 1366×768 双栏态。

提示词必须要求沿用：

- `docs/DESIGN_TOKENS.md`
- `frontend/src/styles/nibi-tokens.css`
- `frontend/src/styles/nibi-components.css`
- 当前截图和组件

OpenDesign 输出只作为布局参考，不得直接覆盖现有业务组件。

### 自动与视觉测试

- 组件测试确认选择态没有 `BatchOrganizeControl`；
- 确认只渲染一个 ViewToggle；
- 选择合集后 Hero DOM 高度不变；
- Playwright 在 1440×900、1366×768、1024×768、768×1024、375×812 截图；
- 检查 `document.documentElement.scrollWidth === clientWidth`；
- 1366×768 下第一行内容卡片可见；
- 标题不逐字换行；
- console 无 error。

### 主要文件

- `frontend/src/pages/LibraryPage/index.tsx`
- `frontend/src/pages/LibraryPage/library.css`
- `frontend/src/pages/LibraryPage/BatchOrganizeControl.tsx`（只移除本页引用，是否保留文件由其他调用决定）
- `frontend/src/pages/FavoritesPage/FavoritesPage.tsx`
- `frontend/src/pages/FavoritesPage/favorites.css`
- `frontend/src/pages/WorkspacePage/TaskboardPage/TaskboardHead.tsx`
- `frontend/src/pages/WorkspacePage/TaskboardPage/taskboard.css`
- `frontend/src/pages/WorkspacePage/WorkspaceList.tsx`
- `frontend/src/pages/results/LearningNotesPage/learning-notes.css`
- `frontend/src/__tests__/LibraryPageLayout.test.tsx`

### 完成条件

- 新建合集、进入选择、选择多项、加入合集都不会撑高 Hero；
- 无用整理控件全部从资料库第一层消失；
- 其他页面没有引入新的标题挤压；
- 不删除后端元数据能力。

---

## 10. R5：添加素材一屏化

### 目标

去掉没有意义的“选择学习笔记”，让常用设置同时可见，同时保持现有链接、本地、批量和已有内容流程。

### 状态与业务收口

1. 删除前端 `ActionType`、`selectedAction` 及只展示“学习笔记”的卡片。
2. 生成请求仍明确传 `intent/action = note`，不改变后端兼容字段。
3. 保留 `selectedNoteType`：
   - 自动识别；
   - 视频；
   - 图文；
   - 音频；
   - 混合。
4. 自动识别必须在探测后显示“识别为视频/音频/图文”，用户仍可手动覆盖。
5. Mixed 继续自动开启说话人能力的现有规则；不能因 UI 改版改变任务 payload。

### 桌面布局

1. 常规弹窗宽度从 560px 调整为约 920–1040px，最大不超过 `calc(100vw - 32px)`。
2. 高度限制为 `calc(100dvh - 24px)`。
3. `m-body` 使用双栏：

```css
grid-template-columns: minmax(280px, .85fr) minmax(360px, 1.15fr);
```

4. 左栏：
   - 素材来源；
   - 嗅探/本地预览；
   - 合集归属；
   - 单个/批量切换；
   - “从已有内容添加”入口。
5. 右栏按固定顺序：
   - 素材类型：紧凑分段卡；
   - 笔记风格：常驻；
   - 区分说话人：音频/视频/混合时常驻；
   - 说话人数：开启后内联显示；
   - 画面分析：视频/混合时常驻；
   - 取画面模式、间隔、视觉模型：画面分析开启后内联显示；
   - 补充说明：常驻两行文本框。
6. 删除“高级设置”折叠器；没有折叠器后也不要把稀有技术参数散落成一长列。
7. 页脚固定，显示：
   - 识别类型；
   - 风格；
   - 说话人/画面分析状态摘要；
   - 开始生成。

### 弹出层与长内容

- 合集选择器用 popover，内部滚动，不增加 modal 高度；
- 新建/重命名合集在 popover 内完成；
- 批量来源结果使用固定高度列表；
- “从已有内容添加”使用独立面板或固定高度列表；
- 小屏转单栏，页脚继续 sticky；
- 不用绝对定位硬塞控件。

### 组件拆分

`AddMaterialModal.tsx` 已明显超过项目单文件建议，应在不改变业务的前提下拆出聚焦组件，例如：

- `MaterialSourcePanel.tsx`
- `WorkspacePicker.tsx`
- `NoteSettingsPanel.tsx`
- `BatchSourcePanel.tsx`

状态仍由 Modal 统一持有，避免新增全局 store 或 effect-heavy 双向同步。

### Payload 一对一验证

每个 UI 选项都必须跟踪到请求：

```text
前端 state
 -> generateNote/importBatchSource 请求参数
 -> 后端 request model
 -> TaskRecord payload
 -> 实际 pipeline consumer
```

必须特别验证：

- `summary_template`
- `diarize`
- `speaker_count`
- `summary_mode`
- `note_media_kind`
- `embed_frames`
- `frame_interval`
- `vision_model`
- `user_notes`

### 测试

- 打开时不再出现“你要做什么 / 学习笔记”；
- 常用设置在 DOM 中常驻；
- 自动、视频、音频、图文、混合切换；
- 说话人开关和人数；
- 画面分析开关、间隔和模型；
- 风格选择；
- 链接、本地文件、批量 URL、已有内容；
- 选择/新建/重命名合集；
- 提交 payload 与改版前业务含义相同；
- loading、失败、成功和重复点击；
- 1366×768 基础流程无需滚动；
- 键盘焦点不跑出 Dialog。

### 主要文件

- `frontend/src/components/workspace/AddMaterialModal.tsx`
- 新拆出的面板组件
- `frontend/src/styles/nibi-components.css`
- `frontend/src/services/workspaces.ts`
- `frontend/src/__tests__/AddMaterialModal.test.tsx`
- `frontend/src/__tests__/AddMaterialModal.local.test.tsx`
- 新增 batch/payload 测试

### 完成条件

- 高频设置一屏可见；
- 没有无意义的学习笔记选择；
- 现有四类来源流程没有回归；
- 所有设置真实传到后端 consumer；
- 不新增 UI 框架或依赖。

---

## 11. R6：任务活动与脱敏应用日志

### 目标

监控页显示真实、可排障、不会泄密的信息。

### 11.1 任务活动

优先复用：

```text
GET /pipeline/tasks?include_logs=true&limit=50
```

前端把任务转换为统一活动项：

```ts
type MonitorTaskActivity = {
  taskId: string
  workspaceId?: string
  itemId?: string
  taskType: string
  status: string
  progress?: number
  summary: string
  timestamp: string
  jumpUrl?: string
}
```

即使任务没有日志，也要从 created/running/success/failed 状态生成一条生命周期活动，不能继续显示“暂无日志”。

### 11.2 应用日志缓冲

新增独立服务，例如：

```text
backend/app/services/runtime_log_buffer.py
```

设计：

- 基于 `collections.deque(maxlen=5000)`；
- 自定义 `logging.Handler`；
- 每条有单调递增 ID、时间、level、logger/category、message；
- 线程安全；
- FastAPI lifespan 中只挂载一次；
- shutdown 时移除 handler；
- 测试和热重载不能重复挂载。

只读接口建议：

```text
GET /admin/logs?after_id=123&level=WARNING&category=pipeline&limit=200
```

响应：

```json
{
  "lines": [
    {
      "id": 124,
      "timestamp": "...",
      "level": "ERROR",
      "category": "pipeline",
      "message": "audio_summary task failed",
      "task_id": "...",
      "workspace_id": "..."
    }
  ],
  "latest_id": 124,
  "truncated": false
}
```

第一版用 2 秒增量轮询即可；不要为了 SSE 引入新依赖。只有轮询通过并确认有性能问题后，才单独设计 SSE。

### 11.3 脱敏与内容边界

在进入 buffer 前统一脱敏：

- `Authorization: Bearer ...`
- `api_key`、`apikey`、`token`、`secret`
- provider credential
- URL query 中的密钥
- macOS/Windows 用户绝对路径只保留文件名或逻辑位置

结构化日志只记录：

- 生命周期；
- route/status/duration；
- provider 名和 model 名；
- task/workspace/item ID；
- pipeline 阶段、进度、结果状态；
- 索引构建状态；
- 异常类型和安全摘要。

禁止记录：

- 完整提示词；
- 完整字幕、OCR 或笔记正文；
- 请求/响应 body；
- API Key；
- cookie；
- 用户完整本地路径。

测试失败信息也要经过同一脱敏函数。

### 11.4 前端

`DeployMonitorPage`：

1. 继续显示健康、版本、uptime、CPU、内存、磁盘；
2. 使用与侧栏一致的系统统计 hook/cache，减少同一时刻两个不同采样值造成的困惑；
3. 增加任务状态计数；
4. 增加“任务活动 / 应用日志”切换；
5. 支持级别、任务类型、关键词过滤；
6. 支持自动刷新、暂停、自动跟随；
7. 网络错误保留旧内容并显示状态，不清空屏幕；
8. 组件卸载时停止 timer；
9. 点击任务跳到对应页面；
10. “清空”只能清空当前浏览器视图，不能删除服务端缓冲。

### 测试

后端：

- ring buffer 上限；
- 单调 ID 与 `after_id`；
- level/category/limit；
- handler 不重复安装；
- secret、Bearer token、路径脱敏；
- 不返回 prompt/transcript/body；
- 422 和常见错误。

前端：

- 任务有日志；
- 任务无日志仍有生命周期活动；
- running/failed/success 计数；
- 应用日志增量追加；
- 暂停后不轮询；
- 恢复后从 latest_id 继续；
- 过滤与搜索；
- 网络失败保留旧内容；
- unmount 清 timer。

### 主要文件

- `backend/app/services/runtime_log_buffer.py`
- `backend/app/routes/admin.py`
- `backend/app/main.py`
- `backend/app/routes/pipeline.py`（仅在现有返回字段不足时做最小调整）
- `frontend/src/pages/SettingPage/DeployMonitorPage.tsx`
- `frontend/src/components/ui/log-console.tsx`
- `frontend/src/services/` 新增 monitor service
- `frontend/src/hooks/useSystemStats.ts` 或现有 hook
- `tests/backend/test_admin_logs.py`
- `frontend/src/__tests__/DeployMonitorPage.test.tsx`

### 完成条件

- 至少能看到真实任务活动；
- 应用触发安全日志后 2 秒内出现；
- 测试证明密钥和用户内容不泄漏；
- 没有无限内存增长；
- 监控接口只读，不改变任务状态。

---

## 12. R7：总体验证与交付

### 12.1 每阶段最低检查

后端阶段：

```bash
./.venv/bin/pytest -q <本阶段相关测试文件>
./.venv/bin/python -m compileall backend shared scripts
```

前端阶段：

```bash
cd frontend
pnpm test --run <本阶段相关测试文件>
pnpm build
```

每阶段都运行：

```bash
git diff --check
git status --short --branch
```

### 12.2 最终自动测试

在最终提交的干净 checkout/worktree 中运行：

```bash
./.venv/bin/pytest backend/tests tests/backend -q
cd frontend && pnpm test --run
cd frontend && pnpm build
./.venv/bin/python -m compileall backend shared scripts
git diff --check
```

如果仓库实际没有 `backend/tests`，必须写明实际命令；不得把定向测试说成全量测试。若使用临时 QA worktree，先获得用户同意，完成后报告路径，不自行破坏性清理。

### 12.3 浏览器手测主线

#### 知识库

1. 打开 `/knowledge`，侧栏和标题均为“知识库”。
2. 打开 `/search?x=1`，确认无闪烁地跳到 `/knowledge?x=1`。
3. 选择全部合集提问。
4. 选择一个合集提问。
5. 选择多个合集提问，并确认未选合集不出现在来源。
6. AI 回答、引用来源和相关原文同时正确。
7. 点击回答 `[1]`，第一条来源滚动高亮。
8. 打开视频来源，跳到目标时间并自动播放。
9. 打开音频来源，跳到目标时间并自动播放。
10. 手动阻止浏览器自动播放，确认仍停在目标时间且有播放提示。
11. 返回知识库，query、范围和结果仍在。
12. “查找原文”不显示 AI 回答。

#### 收藏夹

1. 在 `/notes` 收藏一个收纳箱素材。
2. 打开 `/favorites`，无需额外刷新即可看到；若产品当前只支持页面级刷新，至少刷新后必须看到。
3. 收藏普通合集副本。
4. 确认同源另一个副本不会自动收藏。
5. 在收藏夹直接取消收藏。
6. 刷新页面，状态仍正确。
7. 搜索、类型和分组组合过滤。

#### 资料库

1. 1366×768 打开 `/notes`，第一行卡片可见。
2. 新建合集，Hero 高度不变。
3. 进入选择模式，批量栏替换普通栏。
4. 多选、选择目标合集、加入合集，内容区仍可见。
5. 不再出现文件夹、移动、标签、整理。
6. 只有一个视图切换。
7. 1024、768、375 宽度无横向滚动和标题竖排。
8. 收藏夹、合集详情、合集列表、学习笔记顶部也无同类挤压。

#### 添加素材

1. 1366×768 打开弹窗，所有高频设置和提交按钮同屏。
2. 不出现“你要做什么 / 学习笔记”。
3. 分别检查自动、视频、音频、图文、混合。
4. 切换风格、说话人、人数、画面分析、间隔、模型、补充说明。
5. 链接、本地、批量 URL、已有内容都能提交。
6. 选择、新建、重命名合集不拉长弹窗。
7. 提交后在任务 payload 或后端测试中确认参数真实生效。

#### 监控

1. 打开 `/settings/monitor`，健康和资源指标正常。
2. 启动一项任务，看到排队、运行、成功/失败活动。
3. 触发一个安全的后端 warning/error，应用日志出现。
4. 暂停/恢复、过滤、搜索、自动跟随正常。
5. 检查页面中没有 API Key、Bearer token、完整字幕或绝对用户路径。
6. 控制台无 React error、重复 key、未清 timer 或死循环请求。

### 12.4 验收证据

最终执行工具提交：

- 各分支名与 commit hash；
- 每阶段测试命令、通过数量和耗时；
- 全量测试原始摘要；
- Playwright JSON：URL、viewport、关键 DOM、console error；
- 关键截图绝对路径；
- 未完成项和外部限制；
- 未触碰 `.workbuddy`、`.qoder`、`data` 的证明。

---

## 13. 强制停点

执行中出现以下任一情况必须停下来问用户：

1. 需要新增 npm/pip/系统依赖；
2. 需要数据库 schema 变更或数据迁移；
3. 需要删除、移动或重写用户媒体；
4. 实际收藏权威来源不是当前 `MetadataStore`；
5. 音视频播放器没有可调用的 seek/play 接口，必须大改播放器；
6. 浏览器自动播放策略要求改成默认静音；
7. 需要改变 AI 回答、FTS、reranker 或同源副本语义；
8. 需要把收纳箱重新暴露为普通合集；
9. 监控必须记录提示词、字幕或请求体才能实现；
10. 需要修改 5 个以上计划外文件；
11. 发现新的未提交改动或同主题工作分支；
12. 为通过测试必须清空用户数据或重建现有元数据；
13. 全量测试失败且原因与本阶段无关；
14. Windows 和 macOS 的日志来源必须采用互斥实现，无法安全统一。

停点报告：

```text
我在执行 R? 时发现：
计划假设：
实际代码/数据：
方案 A：
方案 B：
建议：
需要你确认：
```

---

## 14. 禁止事项

- 不重做已完成的 P0–P7、PE。
- 不修改 `.workbuddy/`、`.qoder/`、`data/`。
- 不在 `main` 直接开发。
- 不主动 merge、rebase、cherry-pick 或 push。
- 不用 `git reset --hard`、`git checkout --` 清理用户改动。
- 不为修收藏夹而取消普通列表的收纳箱隐藏规则。
- 不把全部召回来源伪装成 AI 真正引用。
- 不让前端信任模型生成的 URL。
- 不通过隐藏常用设置来实现“一屏”。
- 不删除文件夹/标签的后端能力或现有数据。
- 不把日志端点变成远程控制台。
- 不在日志里记录密钥、完整用户内容或完整路径。
- 不把未运行的全量测试描述为“全部通过”。

---

## 15. 可交给执行工具的启动提示词

> 小米 v2.5pro 不使用本节的总提示词；必须使用
> `knowledge-favorites-layout-entry-monitor-xiaomi-runbook-2026-07-26.md`
> 中按 R0–R7 拆开的单阶段提示词。本节只供具备完整上下文的其他执行工具备查。

```text
请在 /Users/conan/Desktop/notebi 严格执行：
docs/plans/knowledge-favorites-layout-entry-monitor-remediation-2026-07-26.md

先完整阅读 CLAUDE.md、docs/AI_HANDOFF.md 前 80 行、docs/rules/agent-roles.md、
docs/rules/code-style.md、docs/rules/git-workflow.md 和上述计划。

先运行：
git status --short --branch
git log --oneline -5
git branch --show-current

当前 b19d05c 后的已确认前端未提交改动是新基线；只允许在 R0 用计划中的显式
白名单保存。禁止修改或暂存 .workbuddy/、.qoder/、data/。

严格按 R0 -> R1 -> R2 -> R3 -> R4 -> R5 -> R6 -> R7 串行执行。
每阶段：
1. 从上一阶段已通过提交创建新 feat/r?-... 分支；
2. 先写会因当前缺陷失败的最窄测试并确认失败原因；
3. 只实现本阶段；
4. 跑定向测试、build/compileall 和 git diff --check；
5. 只提交本阶段文件；
6. 输出 commit hash 和证据；
7. 不 merge、不 push；
8. 遇到计划第 13 节任一停点立即用中文报告，不自行扩大范围。

UI 阶段可调用 OpenDesign，但只作为设计参考；必须沿用项目现有 token 和组件。
所有阶段完成后再做 R7 全量测试与浏览器验收，任何未通过项都不能说“全部完成”。
```

---

## 16. 外部产品参考

以下只用于验证交互方向，不引入依赖，也不照搬实现：

- [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm)：工作区问答与来源引用共存。
- [AnythingLLM cited-material pane discussion](https://github.com/Mintplex-Labs/anything-llm/issues/3738)：引用点击、来源片段和高亮定位的交互参考。
- [Khoj citation prompt](https://github.com/khoj-ai/khoj/blob/master/src/khoj/processor/conversation/prompts.py)：回答只基于检索资料并提供文档内联引用。

NoteBi 的关键差异是音视频来源必须定位到字幕时间点，因此不能只做普通文档来源卡片。
