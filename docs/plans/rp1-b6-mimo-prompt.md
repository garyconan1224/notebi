---
phase: RP1-B · B-6 笔记 TOC 当前章节高亮 + 时间戳锚点 chip
status: ready
owner: xiaomi-mimo-2.5pro
parent: docs/plans/result-pages-redesign-v1.md § RP1-B · B-6
companion: docs/plans/rp1-execution-handoff.md § 3.3 提示词 B-6
prerequisite:
  - B-3 已完工（HtmlView 渲染 markdown；TOC 提取逻辑已从只读版迁到 HtmlView）
  - B-2 已完工（videoPanelRef.seekTo 可用——chip 点击跳转复用它）
estimated_hours: 2
deps_redline: false   # IntersectionObserver 原生，无新依赖
---

## 0. 前置说明（mimo 必读）

B-6 给 HTML 视图笔记加两个导航增强：
1. **TOC 当前章节高亮**：滚动时高亮当前所在的 h2/h3（用 IntersectionObserver）。
2. **时间戳锚点 chip**：把笔记正文里的 `[00:12]`、`[01:30~05:00]` 解析成可点击 chip，点击 → 视频 seek 到该时刻。

TOC 提取逻辑（h2/h3）在 B-1 的只读 LNNotesPanel 里就有（`extractToc`），B-3 重写时应已迁到 HtmlView。B-6 在此基础上加"当前高亮"和"时间戳 chip"。**先确认 TOC 提取代码现在在哪个文件**（`rg -n "toc|extractToc|h2|h3" frontend/src/pages/results/LearningNotesPage/`）。

---

## 1. mimo 启动提示词（直接复制到 ccswitch CC 终端）

```
RP1-B · B-6 笔记 TOC 当前章节高亮 + 时间戳锚点 chip。
实测 URL: http://localhost:5177/workspaces/{有 ln.md 的 ws}/ln

详细规格: docs/plans/result-pages-redesign-v1.md § RP1-B · B-6
本任务计划: docs/plans/rp1-b6-mimo-prompt.md

【任务 1: TOC 当前章节高亮】
  - 先 rg 确认 TOC 提取逻辑现在所在文件（B-3 后应在 HtmlView 或 panel）。
  - 给渲染出的 h2/h3 加 id（B-1 已有 slug 逻辑，复用）。
  - IntersectionObserver 观察所有 h2/h3，最靠上的可见标题 = 当前章节 → TOC 对应项加 data-active。
  - 注意 observer 的 root 是笔记滚动容器，不是 window。

【任务 2: 时间戳 chip】
  - 正则解析正文里 [mm:ss] 和 [mm:ss~mm:ss] / [hh:mm:ss] 模式。
  - 用 react-markdown 的 components 钩子（如 text/p 渲染时）把匹配片段替换成 <button class="ln-ts-chip">[00:12]</button>。
    （或写一个轻量 rehype/remark 处理；优先用 react-markdown components，别引新插件）
  - chip 点击 → 调 videoPanelRef.seekTo(秒)（B-2 已暴露）；区间取起点秒。
  - 解析秒数：mm:ss → mm*60+ss；hh:mm:ss → hh*3600+mm*60+ss。

【任务 3: CSS】
  - .ln-toc-item[data-active]（左高亮条 + var(--ink) 加重）
  - .ln-ts-chip（inline、var(--mono)、var(--accent-pink) 文字、小圆角、hover 背景）

【范围限制】
- 只在 HTML 视图做 chip（MD 源码视图保持纯文本，不替换）。
- 不碰双向同步 / 保存 / 截图逻辑。不装新依赖。不留 debug 脚本。

【验证】
- vitest（新写：时间戳正则把 "[01:30~05:00]" 解析出起点 90 秒）→ 自己跑过
- pnpm build + tsc EXIT=0
- 手测：滚动笔记 TOC 高亮跟随；点正文里的 [00:12] chip → 视频跳到 12 秒
- playwright 归档 2 张: docs/e2e-test/screenshots/rp1b-b6-{toc-active,ts-chip}.png
- git commit: feat(rp1-b): B-6 TOC 当前章节高亮 + 时间戳锚点 chip
  Co-Authored-By: xiaomi-mimo-2.5pro <noreply@xiaomi.com>
- 更新 COMPLETED_WORK + EXECUTION_PLAN（加 B-6 条）
- 不要 push
```

## 2. 技术参考

```bash
# TOC 提取当前在哪（B-3 后位置可能变）
rg -n "toc|extractToc|slug|scrollIntoView" frontend/src/pages/results/LearningNotesPage/
# seekTo 暴露方式（B-2 的 videoPanelRef）
rg -n "seekTo|useImperativeHandle|videoPanelRef" frontend/src/pages/results/LearningNotesPage/
```

## 3. 风险预案

| 风险 | 应对 |
|---|---|
| IntersectionObserver root 选错（用了 window）导致高亮不动 | root 设为笔记滚动容器 ref；rootMargin 调成 "0px 0px -70% 0px" 让"靠上"判定更准 |
| chip 替换破坏 markdown 其它渲染 | 只在 text 节点做正则替换，避免吃掉代码块/链接里的方括号；代码块内不替换 |
| 时间戳格式多样 | 正则覆盖 mm:ss / hh:mm:ss / 区间；解析失败的原样保留文本 |

## 4. 验收清单

- [ ] TOC 当前章节高亮（IntersectionObserver，容器为 root）
- [ ] 时间戳 chip 解析 + 渲染（仅 HTML 视图）
- [ ] chip 点击 seek 视频（复用 B-2 seekTo）
- [ ] vitest 正则用例通过 + pnpm build + tsc EXIT=0
- [ ] 不碰保存/截图/同步、无新依赖、无 debug 脚本
- [ ] 截图 + COMPLETED_WORK + EXECUTION_PLAN、没 push
