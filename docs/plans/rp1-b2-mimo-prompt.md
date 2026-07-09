---
phase: RP1-B · B-2 学习笔记页字幕轨跟随 + 点击 seek
status: done
owner: xiaomi-mimo-2.5pro
completed_commit: 73733b5   # 2026-05-30 mimo 在并行终端完成，产出与本计划吻合
parent: docs/plans/result-pages-redesign-v1.md § RP1-B · B-2
companion: docs/plans/rp1-execution-handoff.md § 3.3 提示词 B-2 + § 7 中场修订
prerequisite:
  - B-1 已完工（commit 8a5c57b，视频源接通 + ln.md 路径 + CSS 对齐设计稿）
  - LearningNotesPage 4 文件存在：index.tsx / LNVideoPanel.tsx / LNNotesPanel.tsx / learning-notes.css
estimated_hours: 3-4
decisions:
  - 2026-05-30 用户拍板：「字幕引用进笔记」按钮**推迟到 B-3**（当前笔记只读无光标，insertAtCursor 依赖 B-3 的 CodeMirror，提前做是空架子 / 技术债）。B-2 只做：字幕跟随高亮 + 点击 seek。
---

## 0. 前置说明（mimo 必读）

B-2 的目标：在学习笔记页**左栏视频下方**加一条**字幕轨**，实现三件事：
1. 当前播放句**高亮**；
2. 高亮句**自动滚动到字幕容器中央**；
3. **点击字幕句 → 视频 seek 到对应时刻**。

### 这不是从零写——有一个一模一样的现成样板

视频复刻页 `VideoResultPage.tsx` + 子组件 `TripleTrack.tsx` **已经完整实现了上面 1 + 3**，而且 transcript 数据结构和学习笔记页**完全相同**（`VideoResultTranscriptLine = { t_sec: number; t_str: string; text: string }`）。

**你的核心工作 = 把复刻页那套字幕轨逻辑移植到学习笔记页**，只需自己新加第 2 点（纵向自动滚动），因为复刻页的轨道是横向的、没有 `scrollIntoView` 居中跟随。

### 样板映射表（直接照抄，带行号）

| B-2 需要的能力 | 现成样板位置 | 说明 |
|---|---|---|
| 取完整 VideoResult（含 transcript） | `services/workspaces.ts` 的 `getItemResult(ws, itemId)` → `GET /workspaces/{ws}/items/{itemId}/result` | 复刻页 `VideoResultPage.tsx:135` 就是这么取的 |
| activeLineIdx 算法（最后一个 `t_sec ≤ 当前秒`） | `TripleTrack.tsx:24` 的 `activeTranscriptIdx(transcript, currentSec)` + `:47` 用法 | 直接抄函数 |
| 字幕行高亮 + 点击跳转 | `TripleTrack.tsx:194-195`：`data-active={i === trIdx}` + `onClick={() => onTranscriptClick(l)}` | UI 模式照抄 |
| seekTo(sec) | `VideoResultPage.tsx:303-312`：`videoRef.current.currentTime = clamped` | 学习笔记页的 video 在 LNVideoPanel 里，要用 forwardRef 暴露（见任务 2） |
| 点击接线 | `VideoResultPage.tsx:763`：`onTranscriptClick={(l) => seekTo(l.t_sec)}` | 照抄 |
| **scrollIntoView 居中跟随（样板没有，自己写）** | 参考 `pages/results/AVSynthesisResultPage.tsx` / `pages/result/TextResultPage.tsx` 里的 `.scrollIntoView({ behavior:'smooth', block:'center' })` | 在字幕容器内对 active 行 ref 调用 |

### 当前学习笔记页现状（B-1 后）

- `index.tsx`：容器，已 `getWorkspace` + `getLnMarkdown`，有 `currentTime` state + `handleTimeUpdate`。**还没取 transcript**；`currentTime` 目前只传给了右栏 `LNNotesPanel`（B-1 预埋，方向要调整）。
- `LNVideoPanel.tsx`：原生 `<video controls>` + Space/←/→ 快捷键 + `onTimeUpdate` 回调。**videoRef 是私有的，没暴露 seek**。
- `LNNotesPanel.tsx`：只读 react-markdown + TOC。**B-2 不要碰它**（B-3 会整个重写）。
- `learning-notes.css`：已有 `.ln-video-panel` / `.ln-notes-panel` 等 class，全部用 nibi token（`--bg-elev`/`--ink`/`--line`/`--accent-*`/`--radius-sm`/`--shadow-sm`）。

---

## 1. mimo 启动提示词（直接复制到 ccswitch CC 终端）

```
RP1-B · B-2 学习笔记页字幕轨跟随 + 点击 seek（移植视频复刻页的字幕轨）。
实测 URL: http://localhost:5177/workspaces/{需自己选一个有 video item + 有 transcript 的 ws}/ln

详细规格: docs/plans/result-pages-redesign-v1.md § RP1-B · B-2
本任务计划 + 样板映射表: docs/plans/rp1-b2-mimo-prompt.md（必读 §0 样板映射表）

【已定决策】
- 「字幕引用进笔记」按钮 → 本期不做，推迟 B-3（笔记还是只读、没有光标，insertAtCursor 要等 B-3 的 CodeMirror）。
- B-2 只做：字幕高亮跟随 + 自动滚动 + 点击 seek。

【核心思路：不要从零写，移植视频复刻页的现成实现】
VideoResultPage.tsx + TripleTrack.tsx 已实现高亮 + 点击 seek，且 transcript 结构完全相同
（VideoResultTranscriptLine = { t_sec, t_str, text }）。照抄，行号见 §0 样板映射表。

【任务 1: index.tsx 取 transcript + 接线】
  a) ready 状态拿到 videoItem 后，调 getItemResult(workspaceId, videoItem.id) 拿 VideoResult，
     取其中的 transcript（VideoResultTranscriptLine[]）。注意这是第三个请求，和现有
     getWorkspace / getLnMarkdown 并列；transcript 拿不到时给空数组兜底，不要让整页报错。
  b) 新建一个 videoPanelRef（指向 LNVideoPanel 暴露的 seekTo，见任务 2）。
  c) 左栏：在 <LNVideoPanel/> 下方渲染 <LNTranscriptPanel
        transcript={transcript}
        currentTime={currentTime}
        onSeek={(sec) => videoPanelRef.current?.seekTo(sec)} />
  d) currentTime 改为传给 LNTranscriptPanel（右栏 LNNotesPanel 的 currentTime prop 先留着不动，
     B-1 已预埋，B-2 不依赖它）。

【任务 2: LNVideoPanel.tsx 暴露 seekTo】
  - 改成 forwardRef + useImperativeHandle，对外暴露 seekTo(sec: number)：
      videoRef.current.currentTime = sec   // 可选：之后 videoRef.current.play()
    对齐 VideoResultPage.tsx:303-312 的 seekTo 写法（带 0 ~ duration 的 clamp）。
  - 其余（video 元素 / 快捷键 / onTimeUpdate / 空态）保持不动。

【任务 3: 新建 LNTranscriptPanel.tsx】
  props: { transcript: VideoResultTranscriptLine[]; currentTime: number; onSeek: (sec: number) => void }
  - activeIdx：抄 TripleTrack.tsx:24 的 activeTranscriptIdx(transcript, currentTime)。
  - 渲染字幕列表：每行 data-active={i === activeIdx}，onClick={() => onSeek(line.t_sec)}，
    左侧显示 line.t_str，右侧 line.text。
  - 自动滚动：给 active 行挂 ref，useEffect 监听 activeIdx 变化时
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })。
    ⚠️ 只滚字幕容器，别滚动整页 —— 容器要 overflow-y:auto + 固定/最大高度，
    scrollIntoView 会作用在最近的可滚动祖先上。
  - 空态：transcript 为空时显示"暂无字幕轨（该素材未生成转录）"，不要白屏。

【任务 4: learning-notes.css 加字幕轨样式】
  - 新 class：.ln-transcript-panel / .ln-tr-row / .ln-tr-row[data-active] / .ln-tr-time / .ln-tr-text
  - 全部用 nibi token（参考音频页 .ad-tr-* 或复刻页字幕轨）：
    * 容器：bg-elev + radius-sm + 顶部 1px var(--line) 分隔（接在视频面板下方）
    * 行：padding 8/10px，hover 背景 var(--line)，cursor pointer
    * data-active：左 2px var(--accent-pink) 高亮条 + 文字 var(--ink) 加重
    * 时间戳：var(--mono) + var(--ink-4)，文字 var(--ink-2)
  - 禁止硬编码颜色。light + dark 都要可读。

【范围限制（红线）】
- 不做「引用进笔记」按钮（推迟 B-3，用户已拍板）。
- 不碰 LNNotesPanel.tsx（B-3 整个重写，现在动它是浪费）。
- 不做 HTML/MD 切换（B-3）、不做截图（B-5）。
- 不新装依赖。不改后端（transcript 端点 /items/{id}/result 已存在，复刻页在用）。
- 不留 debug 脚本。

【验证】
- pnpm build EXIT=0 + npx tsc --noEmit EXIT=0
- 实测访问一个有 transcript 的 video item 的 /ln：
  * 播放视频，字幕行高亮随播放推进
  * 高亮行自动滚到字幕容器中央
  * 点任意字幕行 → 视频跳到该时刻
- playwright 归档 4 张:
  docs/e2e-test/screenshots/rp1b-b2-{light,dark}-{playing,clicked}.png
- git commit 一个: feat(rp1-b): B-2 学习笔记页字幕轨跟随 + 点击 seek
  Co-Authored-By: xiaomi-mimo-2.5pro <noreply@xiaomi.com>
- 更新 docs/COMPLETED_WORK.md 末尾追加一段
- docs/EXECUTION_PLAN.md 在 B-1 子条下方加一条：
    - [x] B-2 字幕轨跟随 + 点击 seek → `<hash>`（2026-05-30）
  （RP1-B 主行仍不打勾，B-3~B-8 还没做）
- 不要 push
```

## 2. 关键技术参考（mimo 自己 grep 确认）

```bash
# 取 VideoResult（含 transcript）的端点 + 复刻页用法
rg -n "getItemResult" frontend/src/services/workspaces.ts frontend/src/pages/result/VideoResultPage.tsx

# activeTranscriptIdx 算法 + 字幕行渲染（直接抄）
rg -n "activeTranscriptIdx|data-active|onTranscriptClick" frontend/src/pages/result/TripleTrack.tsx

# seekTo 写法（带 clamp）
sed -n '303,312p' frontend/src/pages/result/VideoResultPage.tsx

# scrollIntoView 居中跟随的现成写法（样板没有，参考这两处）
rg -n "scrollIntoView" frontend/src/pages/results/AVSynthesisResultPage.tsx frontend/src/pages/result/TextResultPage.tsx

# VideoResultTranscriptLine 类型定义
rg -n "VideoResultTranscriptLine" frontend/src/services/workspaces.ts
```

## 3. 风险预案

| 风险 | 应对 |
|---|---|
| 找不到带真实 transcript 的 video workspace | `find data/workspaces -name "*.json" \| xargs rg -l transcript` 定位；实测优先选 transcript 非空的 ws；复刻页能正常显示字幕的那个 ws 就能用 |
| `getItemResult` 对 video item 返回的 transcript 为空 | 字幕轨走空态文案，不报错；高亮/seek 逻辑对空数组要安全（activeIdx 返回 -1） |
| `scrollIntoView` 把整页也滚动了 | 字幕容器加 `overflow-y:auto` + 固定/最大高度，让它成为 active 行最近的可滚动祖先；必要时用 `block:'nearest'` 兜底 |
| seek 后视频不动 | 确认 `useImperativeHandle` 的 ref 真的传到了 `<LNVideoPanel ref={videoPanelRef}>`；forwardRef 包裹后默认导出别忘了改 |
| 字幕轨挤压视频区域 | 左栏用 flex column，视频固定比例、字幕轨 `flex:1 + min-height:0 + overflow:auto` |

## 4. 验收清单

- [ ] index.tsx 用 `getItemResult` 取到 transcript 并传给 LNTranscriptPanel
- [ ] LNVideoPanel 用 forwardRef + useImperativeHandle 暴露 `seekTo`
- [ ] 新建 LNTranscriptPanel：高亮跟随 + 自动滚动居中 + 点击 seek
- [ ] 字幕轨样式用 nibi token，light + dark 可读
- [ ] 点击字幕 → 视频确实跳转（实测）
- [ ] 高亮随播放推进 + 自动滚到中央（实测）
- [ ] **没做**引用进笔记按钮（推迟 B-3）
- [ ] **没碰** LNNotesPanel.tsx
- [ ] pnpm build + tsc EXIT=0
- [ ] 4 张截图归档 `docs/e2e-test/screenshots/rp1b-b2-*.png`
- [ ] commit 颗粒度清晰 + COMPLETED_WORK 追加 + EXECUTION_PLAN 加 B-2 子条
- [ ] 没留 debug 脚本、没 push
