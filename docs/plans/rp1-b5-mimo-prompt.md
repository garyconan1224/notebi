---
phase: RP1-B · B-5 视频暂停截图 → 插入笔记光标位置（+ 收纳 B-2 字幕引用按钮）
status: ready
owner: xiaomi-mimo-2.5pro
parent: docs/plans/result-pages-redesign-v1.md § RP1-B · B-5
tech_spec: docs/plans/rp1-b5-screenshot-flow.md   # ← 技术方案唯一标准（Opus 4.7 产出），mimo 必读
companion: docs/plans/rp1-execution-handoff.md § 3.3 提示词 B-5 + § 7 中场修订
prerequisite:
  - B-2 已完工（LNVideoPanel 有 videoRef/seekTo、LNTranscriptPanel 字幕轨）
  - B-3 已完工（MdView 用 CodeMirror 6 —— insertAtCursor 要 dispatch 到它的 EditorView）
  - 建议排在 B-4 之后（插入后复用 B-4 的自动保存落盘）
estimated_hours: 6-8
deps_redline: false   # zustand 项目已有、canvas 原生、无新依赖
decisions:
  - 已决议（result-pages-redesign-v1.md §333-2）：直接做"光标位置插入"，不做"插到末尾"过渡版。
  - 跨组件通信用 zustand lnEditorStore（分析文档 §1 已对比选定，不用 ref forwarding）。
  - B-2 推迟来的「字幕单段引用进笔记」按钮，在本期落地（与截图共用 lnEditorStore.insertAtCursor）。
---

## 0. 前置说明（mimo 必读）

B-5 是 RP1-B 最难、最有差异化价值的功能：**视频暂停 → 截当前帧 → 上传 → 把 `![截图@03:42](url)` 插入 MD 编辑器当前光标位置**。

### 技术方案以 `rp1-b5-screenshot-flow.md` 为准

`docs/plans/rp1-b5-screenshot-flow.md`（Opus 4.7 产出）含：精确数据流图、跨组件通信决策（§1 选 zustand）、`lnEditorStore` 完整代码（§3.1）、`LNVideoPanel` 扩展代码（§3.3）、6 项错误处理。**先读它**，B-5 实现细节全在里面。本提示词只补它没覆盖的衔接点。

### 本提示词补的两层（分析文档写于 B-2/B-3 之前）

1. **insertAtCursor 的接收端是 B-3 的 CodeMirror EditorView**：lnEditorStore 要在 MdView 挂载时 `setEditorView(view)`，卸载时清空。截图/引用插入时调 `view.dispatch({ changes: { from: view.state.selection.main.head, insert: md } })`。若当前在 HTML 视图（没有 CodeMirror），insertAtCursor 返回 false → UI 提示"请切到 MD 视图后插入"（或自动切到 MD 视图再插）。
2. **顺手收纳 B-2 推迟的「字幕引用进笔记」**：B-2 的 LNTranscriptPanel 每行加一个"引用"按钮，点它 → `insertAtCursor('> [' + line.t_str + '] ' + line.text + '\n')`。和截图共用同一个 store 方法。

---

## 1. mimo 启动提示词（直接复制到 ccswitch CC 终端）

```
RP1-B · B-5 视频暂停截图 → 插入笔记光标位置（+ 收纳 B-2 字幕引用按钮）。
实测 URL: http://localhost:5177/workspaces/{有 ln.md + 有视频的 ws}/ln

技术方案唯一标准: docs/plans/rp1-b5-screenshot-flow.md（必读 §0/§1/§3.1 store/§3.3 LNVideoPanel/§错误处理）
衔接 B-2/B-3: docs/plans/rp1-b5-mimo-prompt.md（必读 §0 两个衔接点）

【任务 1: 新建 lnEditorStore（zustand）】
  照分析文档 §3.1：frontend/src/store/lnEditorStore.ts
  - state: editorView: EditorView | null
  - setEditorView(view) / clearEditorView()
  - insertAtCursor(text): boolean —— 有 view 就 dispatch insert 到 selection.main.head，无 view 返回 false

【任务 2: MdView 注册 EditorView 到 store】
  B-3 的 MdView.tsx 创建 EditorView 后调 lnEditorStore.setEditorView(view)，卸载 clearEditorView()。

【任务 3: 后端截图上传端点】
  backend/app/routes/export.py 学习笔记区（570 行附近）加：
    @router.post("/{workspace_id}/ln/screenshots")
    - 接 multipart/form-data 的 file
    - 存 get_workspace_root(ws)/ln-screenshots/{timestamp}.png（目录不存在则建）
    - 返回 { url: "/static/workspaces/{ws}/ln-screenshots/{ts}.png" }
    （/static 挂载见 backend/app/main.py；URL 拼法对齐 B-1 视频 URL 本地化的做法）

【任务 4: LNVideoPanel 加截图按钮】
  照分析文档 §3.3 扩展 LNVideoPanel.tsx：
  - 加隐藏 <canvas>，"📷 截图"按钮：canvas 抓 videoRef 当前帧 → toBlob
    → POST /ln/screenshots → 拿 url → insertAtCursor(`![截图@${t_str}](${url})\n`)
  - 6 项错误处理照分析文档（跨域抓帧失败 / 上传失败 / 无 editorView 等）

【任务 5: 收纳 B-2 字幕引用按钮】
  LNTranscriptPanel.tsx 每行加"引用"小按钮（不要和点击行 seek 冲突，stopPropagation）：
    onClick → insertAtCursor('> [' + line.t_str + '] ' + line.text + '\n')
  insertAtCursor 返回 false 时 toast 提示"请先切到 MD 视图"。

【任务 6: 前端 service】
  uploadLnScreenshot(ws, blob): Promise<{ url: string }>（multipart）。

【范围限制】
- 不做"插到末尾"过渡版（直接光标插入）。
- 不做 AI 问答（B-8）。不碰 HtmlView 双向同步逻辑。
- 不装新依赖（zustand 已有）。不留 debug 脚本。

【验证】
- pytest（POST /ln/screenshots：存文件 + 返回 url）→ 自己跑过
- pnpm build + tsc EXIT=0
- 手测完整链路：MD 视图放光标 → 切视频面板暂停 → 截图 → MD 光标处出现 ![截图@..](..)
  → HTML 视图能看到图；字幕"引用"按钮插入引用块
- playwright 归档 3 张: docs/e2e-test/screenshots/rp1b-b5-{shot-btn,inserted,quote}.png
- git commit: feat(rp1-b): B-5 截图插光标 + 字幕引用进笔记
  Co-Authored-By: xiaomi-mimo-2.5pro <noreply@xiaomi.com>
- 更新 COMPLETED_WORK + EXECUTION_PLAN（加 B-5 条）
- 不要 push
```

## 2. 衔接注意点（分析文档没写）

| 注意点 | 说明 |
|---|---|
| insertAtCursor 接 B-3 的 CodeMirror | store 的 editorView 由 MdView 注册；HTML 视图态下返回 false 并提示/自动切 MD |
| 字幕引用按钮归属 | B-2 推迟到此，和截图共用 insertAtCursor；别让"引用"按钮触发行级 seek（stopPropagation） |
| 插入后自动保存 | 若 B-4 已完成，插入改了 markdown state 会自动触发 PATCH /ln，无需额外处理 |
| 截图目录 | data/workspaces/{ws}/ln-screenshots/，确保 /static 能映射到（同视频/音频静态资源） |

## 3. 风险预案

| 风险 | 应对 |
|---|---|
| 视频跨域导致 canvas.toBlob 抛 SecurityError | B-1 已把视频本地化为 /static 同源；若仍跨域，分析文档有兜底；记录到 COMPLETED_WORK |
| 当前在 HTML 视图、无 CodeMirror | insertAtCursor 返回 false → 自动 switchView('md') 再插，或 toast 提示 |
| 截图时机（视频未 loadedmetadata） | 按钮在视频可播放后才启用 |

## 4. 验收清单

- [ ] lnEditorStore（setEditorView/insertAtCursor）
- [ ] MdView 注册/注销 EditorView
- [ ] 后端 POST /ln/screenshots 存文件 + 返回 url（pytest 过）
- [ ] LNVideoPanel canvas 抓帧 + 上传 + 光标插入 + 6 项错误处理
- [ ] LNTranscriptPanel 字幕"引用"按钮（B-2 收纳）
- [ ] 完整链路手测通过（截图 / 引用都落到光标处）
- [ ] pnpm build + tsc + pytest EXIT=0
- [ ] 无新依赖、无 debug 脚本
- [ ] 截图 + COMPLETED_WORK + EXECUTION_PLAN、没 push
