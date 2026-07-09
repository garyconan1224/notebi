# Nibi 体验改造 P1 · 结构骨架执行计划（2026-06-24）

> ⚠️ **已完成（2026-06-24 核对 git log）**：本计划 5 个 commit 在上一会话已全部实现于 `feat/exp-redesign-p1` 分支，方向与新 IA 一致——
> - `af28e5c` source/source_meta 字段 → **Commit 1** ✅
> - `34a9a64` 隐藏收纳箱 + 取消 autoCreateWorkspace 硬建 → **Commit 2** ✅
> - `61a007e` 侧栏重排 笔记/复刻/资料库 + ＋新建 → **Commit 3** ✅
> - `5e41c97` 笔记/复刻页骨架（LibraryPage + kind 过滤）→ **Commit 4** ✅
> - `dbe9029` 工作空间→合集 改名（8 文件 11 处）→ **Commit 5** ✅
>
> 本文件保留作**完成记录 + 验收清单**，不再作为待执行计划。下一步见 `exp-redesign-p2-collection-detail-2026-06-24.md`。

---

> 给小米执行。背景与逐页设计见 `docs/plans/nibi-experience-redesign-structure-2026-06-24.md`（§一 IA 定稿 / §四 决议 / §四-bis 现状映射 / §六 逐页设计）。
> **本期只做结构骨架，不碰功能**：B站批量导入、三段式新建弹窗、合集详情对齐 BiliNote 都留 P2–P4。

---

## 一、目标（一句话）

把现有 IA 改成用户定稿的扁平结构：**顶层 笔记 / 复刻 / 资料库**；笔记/复刻页内用标签 `[全部/视频/音频/图片/文字/合集]` 组织；散任务不再每次硬建命名合集，改落一个隐藏收纳箱。

---

## 二、根因 / 现状（已调研，file:line 可直接定位）

| 现象 | 现状代码 |
|---|---|
| 每加一个任务就生成一个 LLM 命名合集（用户嫌「合集太多」） | 前端 `frontend/src/pages/WorkbenchPage/Composer.tsx:149`、`frontend/src/components/workspace/AddMaterialModal.tsx:376` 调 `autoCreateWorkspace`；后端 `backend/app/routes/workspaces.py:1104` `POST /auto-create` 用 LLM 起名建 workspace |
| 顶层入口零散（新建笔记/合集/知识库/分镜…） | `frontend/src/layouts/AppShell.tsx:33-43` `navItems` |
| 「笔记页按类型横切」其实已存在 | `frontend/src/pages/LibraryPage/index.tsx`（517 行，已有 `typeFilters` + `filteredWorkspaces` 横切池） |
| 「合集网格 + note/replica 筛选」已存在 | `frontend/src/pages/WorkspacePage/WorkspaceList.tsx`（已改名「合集」、已有 `kindFilter`） |
| 工作台首页只是个新建框 | `frontend/src/pages/WorkbenchPage/index.tsx`（16 行，仅包 `Composer`） |

> **关键约束**：`item` 是 `WorkspaceRecord.items: List[WorkspaceItem]` 的**内嵌子对象**（`backend/app/models/workspace.py:260`），没有独立 item 表/外键。**P1 全程不许动这个内嵌模型**——收纳箱本身也是一个 workspace，零模型改动。

---

## 三、拆分（5 个 commit，从底层往上，建议串行）

### Commit 1 — workspace 加 `source` 字段（后端 + 前端类型）
- 后端 `backend/app/models/workspace.py`：`WorkspaceRecord` 加
  - `source: str = 'manual'`（取值 `manual | bilibili_favorites | bilibili_multipart | bilibili_uploader`）
  - `source_meta: dict = field(default_factory=dict)`
  - `to_dict` / `from_dict` 同步；`from_dict` 对老数据缺字段时默认 `manual` / `{}`（向后兼容）。
- 前端 `frontend/src/types/workspace.ts:73` `WorkspaceRecord` 加 `source` / `source_meta?`。
- **验收**：① 读一个已存在的旧 workspace，`source` 回落 `manual` 不报错；② 新建 workspace 默认 `source='manual'`；③ `cd backend && pytest`（相关用例）绿。

### Commit 2 — 隐藏收纳箱 + 取消 autoCreateWorkspace 硬建（后端 + 前端）
- 后端：约定一个固定 id 的默认 workspace（如 `__inbox__`），**懒创建**（首次散任务时建，不存在才建）；散任务的 item 落它。给它一个隐藏标记（可复用 `source` 或新增内部标记，不显示在合集列表）。
- 前端散任务入口改为落收纳箱、**不再调 `autoCreateWorkspace` 起名**：
  - `Composer.tsx:149`（本地文件上传）
  - `AddMaterialModal.tsx:376`（URL）
- 合集视图（WorkspaceList / 笔记页合集标签）**过滤掉收纳箱**，不展示。
- **验收**：① 上传本地文件 / 贴 URL 新建后，不再生成 LLM 命名的新合集；② item 进了收纳箱、能在「笔记 › 全部」看到；③ 合集列表里看不到收纳箱；④ 后端自测脚本或 pytest 绿。
- ⚠️ 动这块前先读这两个前端调用点的完整上下文 + 后端 item 添加流程，确认落点；与计划不符**停下问**。

### Commit 3 — 侧栏顶层重排（前端）
- `AppShell.tsx:33-43` `navItems` 改为：`＋新建`（独立按钮）/ 笔记 / 复刻 / 资料库；分镜 / 收藏 / 搜索 / 设置 下移；知识库 / AI 导演占位保留。
- `frontend/src/router.tsx` 加 `/notes`、`/replicas`（可复用同一组件 + `kind` prop/参数）；`/` 重定向到 `/notes`。
- **验收**：侧栏显示 笔记/复刻/资料库 + ＋新建；点击分别进对应页；`cd frontend && npm run build` 通过。

### Commit 4 — 笔记页 / 复刻页骨架（前端，核心）
- 以 `LibraryPage` 为骨架做笔记/复刻页：顶部标签 `[全部] [视频] [音频] [图片] [文字] ｜ [合集]`，按 `kind`（note / replica）过滤。
  - 选类型标签 → 复用 `LibraryPage` 的 `typeFilters` 平铺单条笔记。
  - 选「合集」标签 → 复用 `WorkspaceList` 的卡片网格（按 kind 过滤、排除收纳箱）。
- 复刻页 = 同组件，`kind=replica`。
- **验收**：① 笔记页类型标签能平铺单条笔记；② 合集标签显示 note 合集网格、点进合集详情正常；③ 复刻页同构；④ build 通过。

### Commit 5 — 「工作空间」改名「合集」（前端文案）
- 把用户可见的「工作空间」文案改「合集」，约 12 处：`SearchPage.tsx`、`WorkspaceList.tsx`、`TaskboardPage/TaskboardHead.tsx`、`TaskChatPanel.tsx`、`libraryStore.ts`、结果页若干。
- **只改用户可见字符串，不动内部 symbol / 变量名 / 类型名**（`workspace` 标识符保留）。
- **验收**：用户可见处 grep 不到「工作空间」；build 通过；点几个页面确认文案对。

---

## 四、给小米的执行须知 & 红线

1. **自验后再 commit**：后端跑 `pytest`（带 `.venv` + `KMP_DUPLICATE_LIB_OK`），前端跑 `npm run build`（不是只 `tsc`），报结果再提交。UI 动态流程才请用户帮看。
2. **不许动 item 内嵌 workspace 的模型**（红线）。收纳箱也是 workspace，零迁移。
3. **不改 `.env` / 不改其他 schema / 不批量 `sed` 改 symbol**（改名只改文案）。
4. 每个 commit **独立可过审**，按顺序来；先 1（数据）再 2（落点）再 3/4（UI）再 5（文案）。
5. 遇到与本计划不符、或需判断的交互细节，**停下回报 Claude**（尤其 Commit 2 的收纳箱落点 / 隐藏过滤）。
6. 调研结论要附**自己跑出的证据**（命令 + 输出），不许只看代码猜。

---

## 五、不在 P1 范围（别顺手做）

- 合集详情对齐 BiliNote（操作区/封面）→ P2。
- 新建三段式弹窗 + 识别卡 → P3。
- B站收藏夹/分P/UP主批量导入 → P4（`source` 字段本期只埋点，不实现解析）。
- 资料库内部重构 → 仅澄清定位，P1 不动逻辑。
