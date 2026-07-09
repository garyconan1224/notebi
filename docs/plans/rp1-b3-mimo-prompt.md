---
phase: RP1-B · B-3 学习笔记页 HTML/MD 视图切换 + 双向同步
status: done
owner: xiaomi-mimo-2.5pro
completed_commit: cdb5a37   # 2026-05-30 mimo 在并行终端完成，产出与本计划吻合（CodeMirror/HtmlView/MdView 均按计划）
parent: docs/plans/result-pages-redesign-v1.md § RP1-B · B-3
tech_spec: docs/plans/rp1-b3-html-md-sync.md   # ← 技术方案唯一标准（Opus 4.7 产出），mimo 必读 §0/§3/§4
companion: docs/plans/rp1-execution-handoff.md § 3.3 提示词 B-3 + § 7 中场修订
prerequisite:
  - B-2 已完工（字幕轨 LNTranscriptPanel + LNVideoPanel.seekTo + index.tsx 取 transcript）
estimated_hours: 4-5
deps_redline: true   # ⚠️ B-3 要装 8-9 个新依赖，属 CLAUDE.md §4 红线，执行前必须有用户授权
decisions:
  - 已决议（result-pages-redesign-v1.md §333）：HTML/MD **直接做双向同步**，不走"HTML 只读"简化方案。
  - B-3 **不做**自动保存（B-4）/ 截图（B-5）/ 工具栏按钮：markdown 改动只在前端内存，刷新会丢（这是预期，不是 bug）。
---

## 0. 前置说明（mimo 必读）

B-3 把右栏笔记面板从"只读 markdown"升级成 **HTML 视图 / MD 视图可切换 + 双向同步**：
- 单一 source of truth = `markdown: string`，两个视图都是它的投影。
- **MD 视图** = CodeMirror 6（即时回写 markdown）。
- **HTML 视图** = react-markdown 渲染 + contentEditable 包装 + DOMPurify 净化粘贴，**blur 时**用 turndown 转回 markdown。
- 视图偏好存 localStorage。

### 技术方案以 `rp1-b3-html-md-sync.md` 为准，不要重新设计

`docs/plans/rp1-b3-html-md-sync.md` 是 Opus 4.7 提前产出的完整技术分析，**含 HtmlView / MdView 的可直接抄的代码骨架**（§3.3 / §3.4）、同步铁律（§2）、5 个边界 case（§4）。**先读它**，B-3 的实现细节全在里面。

本提示词只补它**没覆盖的一层**：它写于 B-2 之前，§3.1 的容器示意是"B-1 视角"，**没有 B-2 的字幕轨**。下面 §1/§2 就是确保你不要照搬把 B-2 冲掉。

### ⚠️ 最大的坑：不要照搬分析文档 §3.1 的 index.tsx

分析文档 §3.1 的容器是简化示意（`<LNVideoPanel/>` 无 props、没有字幕轨）。**B-2 完成后的真实 index.tsx 长这样，必须在它基础上增量改**：
- 有 `pageState` 状态机（loading / error / ready）
- ready 里有 `workspace` / `videoItem` / `markdown` / `transcript`
- 有 `currentTime` state + `videoPanelRef`（B-2 的 seekTo）
- 左栏渲染 `<LNVideoPanel ref={videoPanelRef} .../>` + `<LNTranscriptPanel transcript currentTime onSeek/>`（**B-2 成果，B-3 一行都不能动**）
- 右栏渲染 `<LNNotesPanel/>`（B-3 改造目标）

B-3 对 index.tsx 的改动**只有**：① 把 ready 里的 `markdown` 提成独立可编辑 state（`const [markdown, setMarkdown] = useState('')`，初值在 ln.md 加载完后 set）；② 加 `view: 'html'|'md'` state + `switchView` + localStorage；③ 把 LNNotesPanel 的 props 从 `{ markdown, currentTime }` 换成 `{ markdown, onMarkdownChange, view, onSwitchView }`。**左栏视频 + 字幕轨保持原样。**

---

## 1. mimo 启动提示词（直接复制到 ccswitch CC 终端）

```
RP1-B · B-3 学习笔记页 HTML/MD 视图切换 + 双向同步。
实测 URL: http://localhost:5177/workspaces/{有 ln.md 的 ws}/ln

技术方案唯一标准: docs/plans/rp1-b3-html-md-sync.md（必读 §0 核心结论 / §2 同步铁律 / §3.3 HtmlView / §3.4 MdView / §4 边界 case）
执行编排 + 衔接 B-2: docs/plans/rp1-b3-mimo-prompt.md（必读 §0 那个"最大的坑"）

【依赖（已获用户授权，见本会话）】
pnpm add codemirror @codemirror/lang-markdown @codemirror/state @codemirror/view @codemirror/commands dompurify @types/dompurify turndown @types/turndown
（如 §4 边界 case 需要：可选 turndown-plugin-gfm、rehype-raw —— 也在授权范围内）

【任务 1: 整个重写 LNNotesPanel.tsx（中场修订强制）】
  现有 84 行只读版**整个删除**，按分析文档 §3.2 重写为：
    顶部 toolbar（HTML / MD 源码 两个 data-active 按钮）+ 根据 view 分发 <HtmlView/> 或 <MdView/>。
  - 保持 default export（index.tsx 用 import LNNotesPanel from './LNNotesPanel'）。
  - 现有 TOC（h2/h3 提取）逻辑不要丢 —— 挪进 HtmlView 顶部或 panel 内保留（B-6 还要用）。

【任务 2: 新建 HtmlView.tsx】
  照抄分析文档 §3.3：react-markdown 渲染 + contentEditable div 包装 + onPaste 用 DOMPurify 净化
  + onBlur 时 innerHTML → turndown → onMarkdownChange。
  铁律（§2）：只在 blur 时 turndown 一次，不要在 onInput 实时转（会卡 + 光标乱跳）。

【任务 3: 新建 MdView.tsx】
  照抄分析文档 §3.4：CodeMirror 6 核心 API（EditorState/EditorView + lang-markdown + history），
  内容变更即时 onMarkdownChange。不要用 @uiw/react-codemirror wrapper，直接用核心 API。

【任务 4: index.tsx 增量改（不要照搬分析文档 §3.1！）】
  在 B-2 后的真实 index.tsx 上只做三件事（详见 rp1-b3-mimo-prompt.md §0）：
  a) ready 的 markdown 提成 const [markdown, setMarkdown] = useState('')，ln.md 加载完后 setMarkdown。
  b) 加 view state（localStorage 'ln-view' 初值，默认 'html'）+ switchView（切走前 (document.activeElement)?.blur() flush HTML 视图）。
  c) <LNNotesPanel markdown={markdown} onMarkdownChange={setMarkdown} view={view} onSwitchView={switchView} />
  ⚠️ 左栏 <LNVideoPanel ref=.../> + <LNTranscriptPanel .../> 是 B-2 成果，一行都不要动。

【任务 5: learning-notes.css 加视图切换 + 编辑器样式】
  - .ln-toolbar / .ln-toolbar button[data-active]（segmented control 风格，参考音频页 .ad-tab）
  - HtmlView 的 contentEditable 区 + MdView 的 CodeMirror 容器样式（字号/行高/padding）
  - 全部 nibi token（--bg-elev/--ink/--line/--accent-pink/--mono），light + dark 都可读。

【范围限制（红线）】
- 不做自动保存 / PATCH 后端（B-4）—— markdown 改动只在内存，刷新会丢，这是预期。
- 不做截图插入（B-5）、不做引用进笔记按钮（也在 B-5/编辑器就绪后）、不做工具栏加粗/标题按钮。
- 不碰 LNVideoPanel / LNTranscriptPanel（B-2 成果）、不碰后端、不碰别的结果页。
- 不留 debug 脚本。

【验证（对齐分析文档 §6）】
- pnpm build EXIT=0 + npx tsc --noEmit EXIT=0
- HTML 视图编辑 → blur → 切 MD 源码能看到对应 markdown 变化
- MD 视图输入 → 切 HTML 视图渲染一致
- 切换视图内容不丢；localStorage 记住偏好（刷新后还在同一视图）
- 分析文档 §4 的 5 个边界 case 至少手测 case 1（粘贴富文本净化）+ case 4（checkbox）
- playwright 归档 4 张:
  docs/e2e-test/screenshots/rp1b-b3-{light,dark}-{html,md}.png
- git commit 一个: feat(rp1-b): B-3 学习笔记页 HTML/MD 双向同步
  Co-Authored-By: xiaomi-mimo-2.5pro <noreply@xiaomi.com>
- 更新 docs/COMPLETED_WORK.md + EXECUTION_PLAN.md 在 B-2 子条下加 B-3 条（RP1-B 主行仍不打勾）
- package.json / pnpm-lock 的依赖改动一并 commit
- 不要 push
```

## 2. 衔接 B-2 的注意点（分析文档没写、容易踩的）

| 注意点 | 说明 |
|---|---|
| index.tsx 不能照搬 §3.1 | 分析文档容器是 B-1 视角，无字幕轨。只增量加 markdown state + view state + 换 LNNotesPanel props，左栏原样保留。 |
| export 风格统一 | 现有 LNNotesPanel / LNVideoPanel 都是 `export default`。重写后 LNNotesPanel 保持 default；新建 HtmlView / MdView 用 default 或 named 都行，但 import 要对应。 |
| markdown 加载时序 | B-1/B-2 里 markdown 在 pageState.ready 才有。B-3 改成独立 state 后，要在 getLnMarkdown 完成的那一步 setMarkdown，避免初始空白覆盖。 |
| TOC 不要丢 | 现有 LNNotesPanel 有 h2/h3 TOC 提取，B-6 要复用。重写时迁到 HtmlView 保留，别直接删。 |
| currentTime 还要传给字幕轨 | B-2 的 LNTranscriptPanel 依赖 currentTime，B-3 不要因为重构把这条线断了。 |
| 不 PATCH 后端 | §2 数据流图里的 "debounce → PATCH /ln" 是 B-4 的，B-3 只到 setMarkdown 为止。 |

## 3. ⚠️ 依赖红线（CLAUDE.md §4 第 1 条）

B-3 必装新依赖，**这是本任务和 B-1/B-2 最大的不同**（B-2 明确不装依赖）：

```
codemirror @codemirror/lang-markdown @codemirror/state @codemirror/view @codemirror/commands
dompurify @types/dompurify
turndown @types/turndown
（可选）turndown-plugin-gfm  rehype-raw
```

- 总体积 ~120 KB gzip（分析文档 §1 评估，可接受）。
- 这些是 B-3 完整双向同步方案的硬依赖，无法绕开（已决议不走简化方案）。
- **mimo 执行前，提示词里"已获用户授权"这句必须为真** —— 由用户在发提示词前确认。

## 4. 验收清单

- [ ] 8-9 个依赖装好，pnpm-lock 一并提交
- [ ] LNNotesPanel.tsx 整个重写为 toolbar + HtmlView/MdView 分发（不是在只读版上增量加）
- [ ] HtmlView：渲染 + contentEditable + DOMPurify 净化 + blur turndown
- [ ] MdView：CodeMirror 6 核心 API，即时回写
- [ ] index.tsx 只增量改（markdown state + view + 换 props），**B-2 字幕轨/视频 ref 原样**
- [ ] 双向同步：HTML↔MD 切换内容一致
- [ ] localStorage 记住视图偏好
- [ ] §4 边界 case 1 + 4 手测通过
- [ ] CSS 用 nibi token，light + dark 可读
- [ ] **没做** 保存 / 截图 / 工具栏（留 B-4/B-5）
- [ ] pnpm build + tsc EXIT=0
- [ ] 4 张截图归档 + COMPLETED_WORK + EXECUTION_PLAN 更新
- [ ] 没留 debug 脚本、没 push
