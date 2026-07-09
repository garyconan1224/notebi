# Nibi 视频笔记体验改造 · 信息架构与数据结构设计（2026-06-24）

> 用户接手指令：参考原型 `docs/design/bilinote-video-note-flow-review.html` + BiliNote 实际产品，**先设计结构、不写代码，具体功能后续详细做**。
> 关联：`collection-typing-2026-06-23.md`（kind 已做）、`replica-full-line-2026-06-23.md`、`replica-known-issues-2026-06-23.md`。

---

## 一、目标信息架构（IA）—— 用户定稿版（2026-06-24）

> 用户拍板：**不照搬 BiliNote 的「工作台 + 合集」并列**，改成更扁平的「笔记 / 复刻」顶层；「合集」降为笔记页内一个分类标签。

**顶层只有三个入口：笔记 ｜ 复刻 ｜ 资料库（高级）。**

进入「笔记」（或「复刻」）后，是一排**分类标签**：

```
[ 全部 ] [ 视频 ] [ 音频 ] [ 图片 ] [ 文字 ] ｜ [ 合集 ]
   └──────── 平铺单条笔记（散任务）────────┘    └ 文件夹网格 → 合集详情
```

- 选 **全部 / 视频 / 音频 / 图片 / 文字** → 按素材类型**平铺单条笔记**（散任务）。
- 选 **合集** → 整页切成**文件夹网格**，点一个文件夹 → 合集详情。
- 「复刻」与「笔记」**完全同构**，只是 `kind=replica`。

| 层级 | 入口 | 内容 | kind |
|---|---|---|---|
| 顶层 | **笔记** | 标签 [全部/视频/音频/图片/文字/合集]；前 5 个平铺单条笔记，合集=文件夹网格 | note |
| 顶层 | **复刻** | 同构 | replica |
| 顶层 | **资料库**（高级） | 横跨笔记+复刻的全局检索池（保留为 power 视图） | 不分 |
| 二级 | **合集详情** | 头部 + 操作区（融合/导出/分享）+ 合集内网格 + 加入素材（P2 对齐 BiliNote） | 随合集 |

**相对文档原方案的 3 个改动**（已与用户确认）：
1. 原独立「**工作台**」页**取消** → 散任务直接在「笔记 › 全部/各类型」平铺；新建入口移到笔记页顶部。
2. 「**合集**」从顶层并列页 **降为笔记页内一个分类标签**。
3. 底层**不改数据模型** → 散任务挂用户不感知的**隐藏收纳箱**（默认 workspace），命名合集仍是 workspace（「方案 A」，不做大迁移）。

**关键改动**：取消 `autoCreateWorkspace` 每次硬建命名合集 → 散任务落隐藏收纳箱；选/新建合集才归入命名合集。

---

## 二、数据结构（model）

### 合集（workspace）扩展
- `kind: 'note' | 'replica'`（✅ 已做，feat/collection-typing）。
- `source: 'manual' | 'bilibili_favorites' | 'bilibili_multipart' | 'bilibili_uploader'`（**新增**，默认 `manual`）——区分「来源合集 vs 手动创建」。
- `source_meta`（**新增**，仅来源合集）：
  - favorites：`{ fav_id, fav_title, owner_uid }`
  - multipart：`{ bvid, part_count }`
  - uploader：`{ uid, uploader_name }`
- 用途：合集页「来源合集/手动创建」筛选 + 来源合集「同步来源」增量补抓。

### 单任务（loose item）
- 不再硬建命名合集。单任务 = 内部挂一个默认/未归类 workspace（或 item 标 `uncategorized`）——**不动 item 必属 workspace 的模型**。
- 工作台直接平铺单任务卡片（不显示成「未归类」文件夹）。
- 「存入合集」时再归入命名合集（或新建）。

---

## 三、B站批量导入「埋点」（本期不做功能，结构先留好）

用户需求：一键导入 B站 **收藏夹 / 视频分P / UP主主页全部视频** → 批量生成笔记 → 落一个「来源合集」。这是 BiliNote 的核心卖点，结构要能无缝接：

- **数据已预留**：合集 `source` + `source_meta`（§二）覆盖三种来源。
- **入口埋点**：
  - 新建合集弹窗预留「从 B站 导入」分支（粘收藏夹链接 / UP主主页 / 分P视频）。
  - 后端预留契约 `POST /workspaces/import-bilibili`：解析收藏夹/分P/UP主 → 批量建 item + note task → 归入新建的来源合集。**本期可只留接口 stub + 数据模型**，不实现解析。
- **复用现有**：侧栏已有「批量任务」概念——来源合集 = 一次批量导入的结果容器；下载/分P 解析可复用 yt-dlp/sniff 能力。
- **同步刷新**：来源合集「同步来源」（UP主出新视频/收藏夹新增 → 增量补抓）——`source_meta` 存够定位信息即可，功能后做。

> 设计原则：本期所有结构改动（合集 source 字段、新建合集弹窗分支位、import 接口契约）都要为批量导入留好挂点，避免 P4 再返工。

---

## 四、待用户拍板 —— ✅ 已定稿（2026-06-24）

1. **资料库去留**：✅ **保留**为高级视图（横跨笔记+复刻的全局检索池）。与笔记页类型筛选有重叠，定位为 power 用户的跨 kind 检索 + 批量操作。
2. **单任务落点**：✅ **方案 A —— 共享隐藏收纳箱**，不改数据模型、不迁移老数据。取消 `autoCreateWorkspace` 自动起名硬建；散任务统一进 1 个隐藏默认 workspace，工作台并入「笔记 › 全部」平铺，合集视图不显示该收纳箱。
3. **命名 + 结构**：✅ 顶层叫「**笔记 / 复刻**」；「合集」**降为笔记页内一个分类标签**；用户可见的「工作空间」全量改名「合集」（范围见 §四-bis）。

> 关键事实（调研确认）：**item 是 workspace 的内嵌子对象**（`WorkspaceRecord.items: List[WorkspaceItem]`，无独立 item 表/外键）。故「item 脱离 workspace」=大迁移；方案 A 零模型改动。

---

## 四-bis、现状代码 → 目标映射（调研 2026-06-24）

| 目标 | 现状代码（file:line） | 改动方向 |
|---|---|---|
| 侧栏顶层「笔记/复刻/资料库」 | `frontend/src/layouts/AppShell.tsx:33-43`（navItems：新建笔记`/`、合集`→/library`、知识库、分镜、收藏、AI导演、搜索、设置） | 顶层重排为 笔记 / 复刻 / 资料库；新建独立成按钮 |
| 笔记页主体（类型横切 + 合集标签） | `frontend/src/pages/LibraryPage/index.tsx`（517 行；已有 `typeFilters`、`filteredWorkspaces` 横切池） | 以 LibraryPage 为骨架；加标签 [全部/视频/音频/图片/文字/合集] + `kind=note` |
| 合集标签内容（文件夹网格） | `frontend/src/pages/WorkspacePage/WorkspaceList.tsx`（已改名「合集」、已有 `kindFilter` all/note/replica） | 作为笔记页「合集」标签复用；kind 升到顶层 |
| 取消独立工作台首页 | `frontend/src/pages/WorkbenchPage/index.tsx`（16 行，仅包 `Composer`） | Composer 移到笔记页顶部「新建」；`/` 重定向到笔记页 |
| 取消 autoCreateWorkspace 硬建 | 前端 `Composer.tsx:149`（本地文件）、`AddMaterialModal.tsx:376`（URL）；后端 `routes/workspaces.py:1104`（`POST /auto-create`） | 改落隐藏收纳箱（默认 workspace），不再 LLM 起名建合集 |
| workspace 加 `source` 字段 | 后端 `models/workspace.py:260 WorkspaceRecord`（dataclass）；前端 `types/workspace.ts:73` | 加 `source`+`source_meta`，默认 `manual`（§二） |
| 「工作空间」改名「合集」 | ~12 处：`SearchPage.tsx`、`WorkspaceList.tsx`、`TaskboardPage/TaskboardHead.tsx`、`TaskChatPanel.tsx`、`libraryStore.ts` 等 | 用户可见文案全量改「合集」，内部 symbol 不动 |

---

## 五、分期建议（按新 IA，功能后做）

- **P1 结构骨架** ✅ **已完成**（feat/exp-redesign-p1：`af28e5c` source 字段 / `34a9a64` 收纳箱+取消硬建 / `61a007e` 侧栏重排 / `5e41c97` 笔记复刻页 / `dbe9029` 改名）。完成记录见 `exp-redesign-p1-skeleton-2026-06-24.md`。
- **P2 合集详情** 🔨 **进行中**——对齐 BiliNote：激进收敛 9 tab + 操作区 + 素材网格 + 加入素材 + 融合🆕 + 分享🆕（复制 md + 自包含 HTML）。执行计划见 `exp-redesign-p2-collection-detail-2026-06-24.md`。
- **P3 新建弹窗三段式**（原型页面2：视频源/生成设置/输出与归类「存入合集」）+ 识别卡（页面3，复用 sniff 修复 #3）。
- **P4 B站批量导入**（来源合集，用 §三 埋点）。
- 横切：简洁进度页（页面4）、结果页工具栏（页面5）已部分在做，按原型补齐。

---

## 六、逐页详细设计（P1 范围详写，P2+ 给框架）

### 6.1 侧栏（AppShell）

```
┌──────────┐
│ ＋ 新建   │  ← 主操作按钮（原工作台 Composer 入口；弹「新建笔记」）
├──────────┤
│ 📝 笔记    │  ← /notes（默认首页）
│ 🎬 复刻    │  ← /replicas
│ 📚 资料库  │  ← /library（高级）
├──────────┤
│ 🎞 分镜    │
│ ⭐ 收藏夹  │
│ 🔍 搜索    │
│ ⚙ 设置    │
└──────────┘
```

- 顶层主入口收敛为 **笔记 / 复刻 / 资料库**；知识库 / AI 导演占位项保留在下方。
- 「＋ 新建」独立置顶按钮，替代原 `home`「新建笔记」导航项。

### 6.2 笔记页（/notes，复刻页 /replicas 同构）

```
┌───────────────────────────────────────────────┐
│  笔记                                   ＋ 新建  │
│  [全部] [视频] [音频] [图片] [文字] ｜ [📁 合集] │  ← 分类标签
│  ─────────────────────────────────────────────│
│ （选类型）  ┌────┐┌────┐┌────┐┌────┐            │
│            │笔记││笔记││笔记││笔记│  …          │  ← 单条笔记网格（散任务）
│            └────┘└────┘└────┘└────┘            │
│ （选合集）  ┌────┐┌────┐┌────┐                  │
│            │📁  ││📁  ││📁  │  …               │  ← 合集文件夹网格
│            └────┘└────┘└────┘                  │
└───────────────────────────────────────────────┘
```

- **数据范围**：仅 `kind=note`。散任务（隐藏收纳箱里的 item）按类型平铺；「合集」标签 = `kind=note` 的命名 workspace 网格。
- **复用**：类型平铺复用 `LibraryPage` 的 `typeFilters` 横切逻辑；合集网格复用 `WorkspaceList` 卡片 + `kindFilter`。
- **合集标签内子筛选**：来源合集 / 手动创建（按 `workspace.source`）—— P1 占位，P4 启用。
- 复刻页 = 同组件，`kind=replica`，路由 `/replicas`。

### 6.3 资料库（/library，高级）

- 保留现有横切池，但**澄清定位**：明确为「**跨笔记+复刻**的全局检索 + 批量操作」power 视图（现有批量分析 / 批量删除留这）。
- 入口可加「高级」标记，避免新手与笔记页混淆。

### 6.4 合集详情（TaskboardPage，P2 详做）

- 对齐 BiliNote：头部（名称 / 封面 / 计数）+ 操作区（融合 / 导出ZIP / Obsidian / 分享 / 更多）+ 合集内素材网格 + 「加入素材」。
- P1 仅保证从笔记页「合集」标签能进入；布局对齐留 P2。

### 6.5 新建入口（P3 详做）

- P1：「＋ 新建」先复用现有 `Composer` / `AddMaterialModal`，但**改掉 autoCreateWorkspace**（落隐藏收纳箱）。
- P3：升级为三段式弹窗（视频源 / 生成设置 / 输出与归类「存入合集」）+ 识别卡。
