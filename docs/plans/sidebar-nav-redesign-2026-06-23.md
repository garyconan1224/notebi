# ④15 左侧导航视觉重塑 + 占位收敛（2026-06-23）

> 来源：手测 19 条 ④15。设计参考 `docs/design/assets/bilinote-video-note/sidebar-nav.png` + `docs/design/bilinote-video-note-flow-review.html`「页面 1：左侧导航」。
> 产品方向已由用户逐项拍板（见 §三），勿改。范围：**纯前端导航 UI 重塑，不动后端、不迁移数据**。

---

## 一、背景

左侧导航当前是 **72px 窄图标条**（只有图标 + 悬停 tooltip），且 8 个主入口里 **5 个是点不动的 disabled 死链**（path 在 router 根本不存在）。手测要求按设计稿做成**宽展开式**（图标 + 文字 + 徽章），并让「合集」成为核心入口；规划红线：底层不做大迁移，workspace/item 不变。

## 二、现状（代码事实，全部在 `frontend/src/layouts/AppShell.tsx`）

- nav 容器：`w-[72px] flex-col items-center gap-1.5`（行 105-107）
- Logo slot：violet 方块 + `Sparkles` 图标，`title="VidMirror"`（行 110-117）
- `NAV_ITEMS`（行 30-39）8 项：工作台 ✓ / 任务中心 ✗disabled / 处理中 ✗disabled / 结果 ✗disabled / 分镜 ✓ / 合集（→`/library`）✓ / AI 导演 ✗disabled(Phase C) / 12 屏概览 ✗disabled
- `BOTTOM_ITEMS`（行 41-44）：搜索 ✓ / 设置 ✓
- `SidebarBtn`（行 55-76）：`size-11` 图标按钮，`title=label+tooltip`，三态（disabled / active / 默认），active 左侧 3px 竖条
- `isActive`（行 97-100）：home 精确匹配 `'/'`，其余 `startsWith(item.path)`
- router 已注册且可用：`/`(WorkbenchPage) `/library`(合集) `/storyboard`(分镜) `/favorites`(收藏夹) `/search` `/settings`

## 三、用户拍板的最终方案（产品决策已定）

**范围**：视觉重塑。不动 router 路径结构、不动后端、不迁移 workspace/item。

**形态**：72px 窄图标条 → 宽展开式（图标 + 文字常显 + 右侧徽章），观感对齐 `sidebar-nav.png`。

**可折叠（用户追加需求 2026-06-23）**：顶部 logo 旁加折叠按钮，在 宽展开式 ↔ 窄图标条 间切换；**收起态即原 72px 窄条形态**（只图标、悬停 tooltip）。默认展开，localStorage 记住上次选择。

**最终入口**：

| # | 名称 | path | icon | 状态 | 徽章 |
|---|---|---|---|---|---|
| 1 | 新建笔记 | `/` | FilePlus(或保留 Home) | 可用 | — |
| 2 | 合集 | `/library` | Library | 可用 | Beta |
| 3 | 知识库 | `#`(占位) | BookOpen | 占位 | — |
| 4 | 分镜 | `/storyboard` | Film | 可用 | — |
| 5 | 收藏夹 | `/favorites` | Star | 可用 | — |
| 6 | AI 导演 | `#`(占位) | Wand2 | 占位 | Phase C |
| 底 | 搜索 | `/search` | Search | 可用 | — |
| 底 | 设置 | `/settings` | Settings | 可用 | — |

- **删除**：任务中心 / 处理中 / 结果 / 12 屏概览（4 个 disabled 死链）。
- **不做**：批量任务、任务列表（工作台 + 右下角浮动任务队列已覆盖）。
- **不单列**：风格模板、接入 AI 工具（留在【设置】里，不进左侧导航）。
- **徽章**：合集 Beta、AI 导演 Phase C；去掉设计稿里的 Pro / 账单 / 推荐码（本地工具无付费）。
- **占位点击**：方案 A —— 点击占位项弹 toast「该功能即将上线」，**不跳转**（复用项目现有 toast，参考 `NoteShell/index.tsx` 里 `toast.xxx` 用法）。

## 四、改造点（逐条，均在 `AppShell.tsx`）

1. **NavItem 类型**（行 21-28）：新增 `badge?: string`、`placeholder?: boolean`。
2. **NAV_ITEMS**（行 30-39）重写为主组 6 项，按上表顺序：
   - home：`label '工作台' → '新建笔记'`（icon 可换 `FilePlus` 或保留 `Home`）
   - library：`label '合集'`，加 `badge: 'Beta'`
   - 新增 knowledge：`{ id:'knowledge', path:'#', icon: BookOpen, label:'知识库', placeholder:true }`
   - storyboard：保留 `分镜`
   - 新增 favorites：`{ id:'favorites', path:'/favorites', icon: Star, label:'收藏夹' }`（从 BOTTOM 提到主组）
   - director：`disabled → placeholder:true`，`tooltipExtra` 改为 `badge:'Phase C'`
   - **删除** taskboard / processing / results / overview
3. **BOTTOM_ITEMS**（行 41-44）：保留 搜索 / 设置（收藏夹已移走）。
4. **import**（行 3-15）：新增 `Star`、`BookOpen`（如用则加 `FilePlus`）、折叠用 `PanelLeftClose` / `PanelLeftOpen`；**删除不再使用的** `Layers` / `Clapperboard` / `LayoutGrid`（避免未用 import lint 报错——参见过往 lint 清理教训）。
5. **SidebarBtn**（行 55-76）改造为展开式行按钮：
   - 容器：`flex w-full items-center gap-3 px-3 py-2 rounded-[12px]` 左对齐（替换 `size-11 justify-center`）
   - 内容：`<Icon size={18}/>` + `<span>{label}</span>` + 徽章/状态（`ml-auto` 推到右侧）
   - 徽章小药丸：Beta 用 info 蓝、Phase C 用中性灰（Tailwind 现有 token，对齐草案配色）
   - 三态：
     - placeholder：灰（`text-muted-foreground/50`），`cursor-default`
     - active：`bg-accent text-foreground`（左 3px 条可保留或改整行高亮）
     - 默认：`text-muted-foreground hover:bg-accent hover:text-foreground`
   - onClick：placeholder 项 → `toast('该功能即将上线')` 且 **不** navigate；其余 `navigate(path)`
6. **nav 容器**（行 105-107）：`w-[72px] ... items-center` → `w-[216px] ... items-stretch px-2`（宽度微调对齐设计稿）。
7. **Logo slot**（行 110-117）：改成展开式（图标 + 产品名文字）。产品名建议 `Nibi`（与设计稿一致）；**注**：代码现 `title="VidMirror"`，产品名以用户最终确认为准，有疑问就只保留图标。
8. `isActive` 对 placeholder 项恒为 false（占位 path `'#'` 自然不会 startsWith 命中正常路由）。
9. **折叠 / 展开（用户追加需求，按钮放顶部 logo 旁）**：
   - 状态：`const [collapsed, setCollapsed] = useState<boolean>(() => localStorage.getItem('nibi-sidebar-collapsed') === '1')`（默认展开 = false）；toggle 时写回 localStorage。
   - nav 容器宽度随状态：`collapsed ? 'w-[64px] items-center' : 'w-[216px] items-stretch'`，加 `transition-[width] duration-200`。
   - 折叠按钮放 **logo 区**：展开态 logo 行 = 图标 + 「Nibi」+ 右侧折叠键（`PanelLeftClose` «）；收起态 logo 图标居中，展开键（`PanelLeftOpen` »）放 logo 正下方单独一行居中。点击 `setCollapsed(v => !v)`。
   - `SidebarBtn` 加 `collapsed` prop：collapsed 时回到 `size-11 justify-center`、**只显图标、隐藏 label 与 badge**、`title` 含「label · badge」作 tooltip；展开时图标 + 文字 + 徽章（见 §四.5）。
   - 占位项收起态：只灰图标，悬停 tooltip「知识库 · 即将上线」，点击仍 toast。
   - active 高亮在两种宽度下都要正确。

## 五、涉及文件

- `frontend/src/layouts/AppShell.tsx`（唯一主改文件）
- toast：复用项目现有（见 `NoteShell/index.tsx` 调用），**不新增依赖**
- 优先 Tailwind inline；如必须可加同目录小 css

## 六、验收

- 导航为宽展开式（图标 + 文字 + 徽章），宽度/观感对齐设计稿。
- 6 个可用项点击正常跳转；处于对应页面时 active 高亮正确。
- 2 个占位项灰显，点击弹「该功能即将上线」toast，**不跳转、不报错**。
- 「工作台」显示为「新建笔记」；合集带 Beta；AI 导演带 Phase C。
- 无 任务中心/处理中/结果/12 屏概览 残留；无 disabled 死链。
- 收藏夹在导航中且可用。
- **无未使用 import**（lint 干净）；`npm run build` + `npm test` 全绿。
- 折叠按钮（顶部 logo 旁）可在 宽展开式 ↔ 窄图标条 间切换；收起态只图标、悬停有 tooltip；刷新后保持上次状态（localStorage）。
- `./dev.sh` 实跑：逐个点击 6 可用 + 2 占位确认行为；折叠 / 展开切换 + 刷新保持；窄屏 & 打印（`print:hidden`）不破。

## 七、给小米的执行须知与红线

- **只做 `AppShell.tsx` 导航 UI**：不改 router 路由表（路径全不变）、不动后端、不动任何目标页面内容。
- **不做数据迁移**：workspace/item 模型不动；「合集」只是 UI 叫法，底层仍 `/library`。
- **占位项必须 toast 提示**，不是 disabled 死链、不是路由报错。
- **风格模板 / 接入 AI 工具 不要加进左侧导航**（它们在设置里）。
- **清理本次删掉的图标 import**，别留 lint 报错。
- 必须自己 `npm run build` + `npm test` 跑绿、`./dev.sh` 实跑点过每个入口再 commit（代码级验证自己跑，别让用户帮看）。
- 不 `git push`；干净工作树；commit 信息写清「④15 左侧导航重塑」。
- 可一个 commit 完成（改动集中在 AppShell），或拆「结构重塑」+「占位 toast 机制」两步，自行把握。
- 遇到与本计划不符 / 需判断处（如 logo 产品名、徽章配色细节），**回报 Claude，别自己拍产品决策**。
