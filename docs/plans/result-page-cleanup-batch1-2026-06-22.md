# ② 结果页编辑器 · 第一批（明确项）修复计划（2026-06-22）

> 来源：手测 19 条第 ②「结果页编辑器」组。用户定：**先做明确无争议的（13 / 7b / 7c）**，
> 「总结/版本/原文对照」重组（10/11/12）单独深入讨论后再做。
> 本计划由 Claude 跑代码调研后产出，含一处避坑约束。

---

## 一、本批范围
- **13**：删顶栏 NoteShell 徽章（无功能）。
- **7b**：删「md格式」tab —— ⚠️ **仅视频笔记**，图文笔记暂留（见下避坑说明）。
- **7c**：文本编辑器 —— **已是 Milkdown WYSIWYG，无需新装**（仅确认，不改代码）。

---

## 二、逐条

### 13 · 删 NoteShell 徽章（简单）
- 位置：`frontend/src/pages/result/NoteShell/index.tsx:1121-1123`
  ```tsx
  <Badge variant="outline" style={{ fontSize: 10 }}>
    <FileText size={10} /> NoteShell
  </Badge>
  ```
- 静态 Badge，**无 onClick、无功能** → 整段删除。
- 注意：删后检查该 `Badge` import 若无其它引用一并清理；顶栏右侧间距正常。

### 7b · 删「md格式」tab（仅视频笔记）
**现状（调研结论）**——中列正文按 `viewMode` 三态渲染（`index.tsx:906-914`）：
- `compare` → `CompareView`（对照，可编辑左栏）
- `wysiwyg` → **视频**：`MilkdownEditor`（可编辑）／**图文**：`ReadView`（**只读** ReactMarkdown）
- `edit` → `NoteEditor`（CodeMirror 源码编辑）

tab 渲染两处：视频 `:1227`、图文 `:1366`，都是 `['wysiwyg','edit']`。`viewMode` 是视频/图文**共享**的 localStorage 状态（`:592`）。

**⚠️ 避坑**：图文笔记 wysiwyg 是**只读**、edit 是其**唯一可编辑入口** → 图文删 md格式会丢编辑能力。**故本批只删视频笔记的 md格式 tab，图文保留**，待后续「图文编辑器升级为可编辑」时再统一删。

**做法（仅视频）**：
1. 视频 tab（`:1227`）：`['wysiwyg','edit']` → 去掉 `'edit'`；只剩一个 tab 时按用户意图**去掉整个 tab 切换栏**（中列直接 Milkdown），保存状态（`:1243`）移到合适位置（如顶栏或编辑器角）。
2. 因 `viewMode` 共享：视频布局下若 `viewMode==='edit'`（从图文切来/localStorage 残留），**fallback 当 wysiwyg 渲染 Milkdown**——即视频正文分支用 `viewMode==='compare' ? Compare : Milkdown`（非 compare 一律 Milkdown），不再走 `NoteEditor`。
3. 图文 tab（`:1366`）、`NoteEditor`（`:913`）、`edit` 相关代码、`videoViewModeLabels/imageNoteViewModeLabels` 的 `edit` 项**保留**（图文仍用）。
4. 保留 `compare`（对照）入口与功能不动。

### 7c · 编辑器（无需改代码）
- 已是 `MilkdownEditor`（`./MilkdownEditor`，所见即所得可编辑）。
- 本批仅在交付说明里写明「编辑器已具备，用户无需安装」。不改代码。

---

## 三、涉及文件
- `frontend/src/pages/result/NoteShell/index.tsx`（13 删 Badge、7b 视频 tab + 正文分支 + 保存状态位置）
- 关联测试：`frontend/src/__tests__/NoteShell*.test.*`（跑通，必要时更新）

## 四、验收
- **13**：结果页顶栏不再有 NoteShell 徽章，布局正常。
- **7b**：视频笔记结果页**无 md格式 tab**，所见即所得（Milkdown）仍可编辑、可保存；「对照」仍可用；**图文笔记不受影响**（仍有 md格式可编辑）。
- 前端 `npm test`（NoteShell 相关）+ `npm run build` 全绿。

## 五、给小米的红线
- 不动 10/11/12（总结/版本/原文对照重组）——不在本批。
- 7b **只删视频**，**严禁删图文的 md格式**（会丢图文编辑能力，调研已确认）。
- 删 edit 渲染分支时确认视频在 `viewMode==='edit'` 残留态下 fallback 到 Milkdown，别白屏/报错。
- 保留 `compare`（对照）入口与功能。
- 自验：`npm test` + `npm run build` 跑数字；UI 改动用 ./dev.sh 实跑确认（视频删 tab 后能编辑保存、图文仍能编辑）。
- 干净 worktree 核对 commit；不 git push。
