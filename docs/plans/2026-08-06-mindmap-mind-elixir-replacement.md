# 思维导图替换为 mind-elixir（2026-08-06）

## 背景

AI 产物中的思维导图目前是自有 SVG 树渲染（`ArtifactRenderers.tsx` mindmap 部分约 510 行），
功能太少且不好看。用户已确认五项决策：

1. 选型 **mind-elixir**（对比过 simple-mind-map、markmap）。
2. **保留**现有编辑 + PATCH 持久化语义。
3. 导出 PNG/SVG **都支持**，并解决「插入笔记后保持格式」。
4. AI 生成 4 层深度限制**保持**（后端不动）。
5. 按 NoteBi 主题**定制** mind-elixir 外观。

## 根因 / 现状问题

- 自研布局：节点固定宽 168px、按 10 字符硬换行（`estimateNodeLines`），长文本排版差。
- 交互：加节点用 `window.prompt`、删除用 `window.confirm`；无快捷键、无节点拖拽、无撤销重做。
- 视觉：仅单向右树；根节点橙 + 其余米色的单一配色，无层级渐变、无主题。
- 缩放 0.6–1.6 手动档，无自动适配视口。

## 修复方案

用 npm 包 `mind-elixir`（v5.15.x，MIT，零依赖，框架无关）替换渲染与交互层；
图片导出/插入截图用 `@zumer/snapdom`（零依赖，mind-elixir 官方推荐的 v5 导出方式）。
后端 content_json schema、校验、PATCH、4 层深度限制**全部不动**。

### 批次 1：依赖与渲染替换

- `pnpm add mind-elixir @zumer/snapdom`。
- 新增包装组件（`frontend/src/pages/result/NoteShell/MindMapView.tsx`）：
  - `useEffect` 内 `new MindElixir({ el, ... })` + 卸载时销毁，兼容 React StrictMode 双挂载。
  - 数据转换：NoteBi `{id, text, children}` ↔ mind-elixir `{id, topic, children}`（字段映射，双向工具函数）。
  - 容器给固定高度（面板 viewport 目前 min-height 仅 180px）。
  - 开启内置 toolBar、keypress、contextMenu（locale 用内置 `zh_CN`）。
- `AiArtifactPanel.tsx` 的 `ArtifactContentView` 改挂新组件，`MindMapTree` 旧组件移除。

### 批次 2：编辑持久化链路

- 监听 `mind.bus` 的 `operation` 事件（insertSibling/addChild/removeNode/finishEdit/moveNode 等），
  变更后 `mind.getData()` → 转回 NoteBi 格式 → 复用现有 `onMindMapUpdated` → PATCH。
- 保存提示沿用现有 `mindmap.saved / saveFailed` i18n。

### 批次 3：主题定制

- 用 mind-elixir 主题机制 + CSS 变量，映射 `nibi-tokens.css` 现有色板：
  橙色强调（根节点）、层级渐变连线/节点色、明暗四主题跟随。
- 旧 `.mindmap-*` 画布 CSS 删除，仅保留容器与工具栏所需样式。

### 批次 4：导出与「插入笔记保持格式」

- 工具栏导出：**PNG / SVG / HTML**（PNG/SVG 走 snapdom 渲染导出，HTML 用 mind-elixir 导出）。
  保留现有 `导出 PNG / 导出 SVG` i18n，新增 HTML 文案。
- 「插入笔记」升级为两种方式（`AiArtifactPanel.tsx:311` 处）：
  - **插入为图片**（默认，保格式）：当前 mind-elixir 实例 snapdom → PNG blob →
    上传**复用现有** `POST /{workspace_id}/ln/screenshots` 端点 → `insertAtCursor('![标题](url)')`
    （编辑器已支持 markdown 图片语法转 image 节点，`MilkdownEditor.tsx:135`）。
  - **插入为大纲**（保留现状语义）：数据转 markdown 嵌套列表后插入。
- 复用 `ln-screenshots` 目录的原因：Obsidian 导出的图片收集正则（`export.py:1169`）
  只认该目录，复用即免费获得 Obsidian 导出兼容。若用户偏好语义更清晰，
  可另建 `artifact-images/`，但需同步改导出正则与收集逻辑（+测试）。

### 批次 5：清理与测试

- 删除旧自研布局/导出代码（`layoutMindMap`、`mindMapToSvg`、`exportMindMapPng/Svg` 等）
  与对应 CSS；重写 `AiArtifactRenderers.test.tsx` 中 mindmap 用例（改为转换函数 + 包装组件测试）。
- 全量回归。

## 涉及文件（预估 8 个，后端 0 改动）

| 文件 | 改动 |
|---|---|
| `frontend/package.json`、`pnpm-lock.yaml` | 新增 2 个依赖 |
| `frontend/src/pages/result/NoteShell/MindMapView.tsx` | 新增包装组件 + 数据转换 |
| `frontend/src/pages/result/NoteShell/ArtifactRenderers.tsx` | 删除旧 mindmap 代码，导出改指向新组件 |
| `frontend/src/pages/result/NoteShell/AiArtifactPanel.tsx` | 挂载新组件；插入笔记双入口 |
| `frontend/src/pages/result/NoteShell/ai-artifact-panel.css` | 删旧画布样式，加容器/主题变量 |
| `frontend/src/__tests__/AiArtifactRenderers.test.tsx` | 重写 mindmap 用例 |
| `frontend/src/locales/zh-CN/note.json`、`en-US/note.json` | 新增插入/导出文案 |

## 验收标准

- `pnpm test`、`pnpm build` 退出码 0；后端 pytest（同 AI_HANDOFF 口径）退出码 0。
- Playwright 实测：渲染、双击改名、快捷键增删节点、拖拽移动、撤销重做、
  编辑后 PATCH 200 且刷新后保留。
- 导出 PNG/SVG/HTML 三个文件均可下载且内容正确。
- 「插入为图片」后编辑器出现 image 节点；Obsidian 导出 zip 内含该图片。
- 明暗主题切换下思维导图配色跟随。
- 4 层深度限制行为不变（后端未动）。

## 执行红线

- 不改后端 content_json schema、校验与 `MAX_MIND_MAP_DEPTH`。
- 不动其他产物渲染器（action_items / key_cards / flashcards / glossary / timeline）。
- 不扩大 `ln-screenshots` 端点的行为（不改签名、不改大小限制）。
- 不改 `.env`；不主动 push。
- 依赖安装本身是风险确认项：以用户批准本计划为授权。

## 待确认（开工前）

1. 图片存放：复用 `ln-screenshots`（推荐，零后端/导出改动）还是新建 `artifact-images`？
2. 当前分支 `codex/fix-bilibili-cover-and-overflow` 有未提交改动（上一轮编辑器/导出工作），
   开工前先确认这些改动的处理（提交 / 保留），再从合适基线切新分支。
