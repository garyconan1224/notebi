# Nibi 体验改造 P2 · 合集详情对齐 BiliNote（2026-06-24）

> ✅ **已完成（2026-06-24 核对 git log）**：本计划 4 个 commit 已全部实现——
> - `f658c1e` 布局重组（BiliNote 式头部+素材网格主体+Modal 弹层）→ **Commit 1** ✅
> - `51ccbbe` 分享菜单 + 复制 Markdown → **Commit 2** ✅
> - `a9590a7` 导出自包含 HTML（后端+前端）→ **Commit 3** ✅
> - `a02b568` 融合 — 多素材笔记 LLM 合成综合笔记 → **Commit 4** ✅
>
> 本文件保留作**完成记录**。下一步见 `exp-redesign-p3-new-material-modal-2026-06-24.md`。

---

> 给小米执行。背景 / IA 见 `nibi-experience-redesign-structure-2026-06-24.md`（§六 6.4）。前置 **P1 已完成**（feat/exp-redesign-p1）。
> 用户已拍板：**激进贴 BiliNote** + **布局 + 融合 + 分享（复制 md + 自包含 HTML）全做**。

---

## 一、目标

把合集详情 `TaskboardPage`（现状 9 Tab 重型工作台）重组成 BiliNote 式：**头部 + 操作区 + 素材网格主体 + 加入素材**；并补两个新功能：**融合**（多素材笔记合一篇）、**分享**（复制 md / 导出自包含 HTML）。

---

## 二、现状（已调研，file:line）

| 能力 | 现状 |
|---|---|
| 素材网格 | ✅ `MaterialsTab`（`tb-mat-grid` + `MaterialCard`，已多选） |
| 导出 ZIP | ✅ `ExportTab`；后端 `_item_note(format="obsidian")` / `_reproduce_package`（item 粒度） |
| 对比 | ✅ `CompareTab`（同类素材**对比**，非合并） |
| 队列/收藏/版本/标签库/对话/知识库 | ✅ 各 tab（`QueueTab`/`FavoritesTab`/`VersionsTab`/`TagsTab`/`ChatTab`/`KnowledgeQATab`） |
| 头部 | `TaskboardHead`（69 行，仅 标题 + 编辑背景 + 加入素材） |
| **融合** | ❌ 无（后端无 `/merge`） |
| **分享** | ❌ 无 |
| **合集级文档载体** | ❌ `WorkspaceRecord` 只有 items/favorites/prompt_versions/background → 融合输出要新增 |
| LLM 合成基建 | ✅ `services/av_synthesis/llm.py`（章节拆分/全局摘要/最终ln，**融合可复用**） |
| HTML 渲染基建 | ✅ `services/av_synthesis/templates/lecture.html.j2`（**分享 HTML 可复用**） |

入口：`TaskboardPage`（`/workspaces/:id`）；9 Tab 定义在 `TabsNav.tsx:17-26`。

---

## 三、拆分（4 commit，由轻到重）

### Commit 1 — 布局重组（激进收敛，前端纯重排，不删功能）
- `TaskboardHead` 扩成：**名称 + 素材计数 + 操作区一排按钮**：加入素材 · 导出 · 对比 · 融合 · 分享 · 编辑背景 · 更多。
- 素材网格 `MaterialsTab` 设为**默认主体**（进合集详情先看网格）。
- **导出 / 对比** 从 tab → 操作区按钮，点开 **Modal / 抽屉**（复用现有 `ExportTab` / `CompareTab` 组件，外面包一层弹层）。
- **「更多」下拉**收纳低频：队列 / 版本 / 标签库 / AI对话 / 知识库QA / 收藏夹（保留组件，仅改入口）。
- **验收**：合集详情=头部+操作区+网格；6 个降级功能都能从「更多」打开；导出/对比能从操作区打开；`npm run build` 通过。
- 红线：**不删任何功能组件**，只改入口位置。

### Commit 2 — 分享·复制 Markdown（前端，零后端）
- 操作区「分享」→ 菜单项「复制 Markdown」：取合集内（或选中）素材的笔记 md 拼接 → `navigator.clipboard.writeText`。
- **验收**：点击后剪贴板拿到拼好的 md；toast 成功；空合集给空态提示。

### Commit 3 — 分享·导出自包含 HTML（后端 + 前端）
- 后端新接口（如 `GET /workspaces/{id}/export-html`）：把合集/笔记渲染成**自包含单文件 HTML**——内联 CSS + 图片内嵌（base64 / data-uri）。**复用** `av_synthesis/templates/lecture.html.j2` 渲染路径；下载用 `StreamingResponse`（参考现有 `_item_note` 导出）。
- 前端：操作区「分享」→「导出 HTML」→ 触发下载。
- **验收**：导出的 `.html` 双击在浏览器能看，带样式、图片显示正常。

### Commit 4 — 融合（后端 + 前端，最重）⚠️ 碰数据结构
- **数据（先调研确认再动）**：`WorkspaceRecord` 新增合集级综合笔记载体。推荐 `merged_notes: List[MergedNote]`（或落文件 + 路径字段），**不新增 item**（避免污染素材网格）。同步 `to_dict`/`from_dict` + 老数据兜底。
- 后端 `POST /workspaces/{id}/merge`：body `{ item_ids: [...] }` → 取选中 item 的笔记 → **复用** `av_synthesis/llm.py` 合成一篇综合笔记 → 存合集级载体。
- 前端：素材网格多选 →「融合」→ loading/进度 → 展示综合笔记（Modal 或合集详情内一块「综合笔记」区）。
- **验收**：选 ≥2 素材融合，生成一篇综合笔记并可查看；再次融合可覆盖/出新版本。
- 红线：**改 `WorkspaceRecord` 结构前停下回报**（数据结构改动）；LLM 合成**复用现成**，别新造。

---

## 四、给小米的执行须知 & 红线

1. 自验后再 commit：后端 `pytest`（`.venv` + `KMP_DUPLICATE_LIB_OK`），前端 `npm run build`（非只 `tsc`）。
2. **Commit 4 改 `WorkspaceRecord` 结构前必须停下回报**（触发数据结构红线）。
3. 融合复用 `av_synthesis/llm.py`、分享 HTML 复用 `lecture.html.j2`，别重造轮子。
4. 激进收敛**只改入口位置，不删功能组件**。
5. 每个 commit 独立可过审；顺序：1 布局 → 2 复制 md → 3 导出 html → 4 融合。
6. 调研结论附自己跑的证据（命令 + 输出），不许只看代码猜；遇与计划不符停下回报。

---

## 五、不在 P2 范围

- 新建三段式弹窗 + 识别卡 → P3。
- B站批量导入 → P4。
- 头部封面图（cover）：P2 先放计数 + 标题，封面图非必须，按需再加。
