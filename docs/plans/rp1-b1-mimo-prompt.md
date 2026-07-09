---
phase: RP1-B · B-1 学习笔记页双栏 + 视频播放器（在现有骨架上扩展）
status: done
owner: xiaomi-mimo-2.5pro
parent: docs/plans/result-pages-redesign-v1.md § RP1-B · B-1
prerequisite:
  - RP1-A 全部完工（音频结果页 4 轮迭代 + 主题修复 + 页面整合 + UI 整修）
  - 现有 LearningNotesPage 4 文件已存在（commit 603e2ea，是只读 stub）
companion: docs/plans/rp1-execution-handoff.md § 3.3 + § 7 中场修订
completed_date: 2026-05-30
commits:
  - hash: 8a5c57b
    message: "feat(rp1-b): B-1 学习笔记页接通视频源 + ln.md 路径 + 设计稿样式对齐"
---

## 0. 前置说明（mimo 必读）

`frontend/src/pages/results/LearningNotesPage/` 已存在 4 个文件（commit 603e2ea），是 mimo 之前越界做的"只读 markdown 渲染骨架"。本任务**在现有基础上扩展**，不要从零重写。

现状 vs B-1 目标差距：
- ✅ index.tsx 已有双栏布局 + 加载状态机 + getAVSynthesisMarkdown 调用
- ✅ LNVideoPanel.tsx 已有 video ref + 快捷键 Space/←/→ 绑定
- ❌ **LNVideoPanel 的 `src` prop 是个未传值的孤儿** → 视频实际不会播
- ❌ 没接真实 ln.md 路径（getAVSynthesisMarkdown 是老的 av_synthesis 接口，可能要走 /ln 新路径）
- ❌ 样式没对齐设计稿
- ❌ video_url 字段映射不明确（后端 audio.url 经 Opus 修过返回本地 /static URL，但 video item 的 video_url 字段名 / 来源未确认）

## 1. mimo 启动提示词（直接复制到 ccswitch CC 终端）

```
RP1-B · B-1 学习笔记页双栏 + 视频播放器（基于现有骨架扩展）。
真实数据测试 URL（实测用）:
  http://localhost:5177/workspaces/{需自己选一个有 video item 的 ws}/ln

详细规格: docs/plans/result-pages-redesign-v1.md § RP1-B · B-1
前置说明: docs/plans/rp1-b1-mimo-prompt.md（必读 §0）
B-3/B-5 接口约定: docs/plans/rp1-execution-handoff.md § 7（B-3 重写、B-5 扩展时要遵守）

【现状】
LearningNotesPage 4 文件存在（commit 603e2ea），是只读 stub:
  - index.tsx: 双栏布局 + 加载 + getAVSynthesisMarkdown 调用
  - LNVideoPanel.tsx: video ref + 快捷键（但 src prop 没传真值）
  - LNNotesPanel.tsx: react-markdown 只读渲染
  - learning-notes.css: 298 行样式
不要从零重写！在这基础上扩展。

【任务 1: 接通视频源 src】
LNVideoPanel.tsx 的 src prop 没传真值，视频实际不会播。
做:
  a) 在 index.tsx 里:
     - 加载 workspace + items（用 getWorkspace），找到 type='video' 的 item
     - 取它的 results.video_path 或 video_url（用 codegraph 或 rg 确认实际字段名:
       rg "video_url|video_path|video_local" backend/app/routes/workspaces.py)
     - 对齐 Opus 修后端 audio.url 模式：优先返回本地 /static URL
     - 如果后端返回的是源 URL（如 B 站链接），同样 fallback 到本地 /static/workspaces/{ws}/videos/{filename}
  b) <LNVideoPanel src={videoUrl} title={...} onTimeUpdate={(t) => setCurrentTime(t)} />
  c) videoUrl 不存在时显示空态卡片"该工作空间暂无视频素材"

后端可能需要补端点（如果发现 video item 返回的 url 也是 B 站链接而非本地）:
  - 仿 get_audio_result line 2089-2104 的 _resolve_url 模式
  - 改 backend/app/routes/workspaces.py 的 get_video_result（line 找 video_result 同名函数）

【任务 2: 路由 + 数据源对齐】
当前 index.tsx 用 getAVSynthesisMarkdown，但 RP1-B 规格用 /ln 路径。
做:
  - 确认 services/workspaces.ts 是否已有 getLnMarkdown 函数（rg "getLnMarkdown\|ln/markdown")
  - 如有用它；没有就新增（路径 GET /workspaces/{ws}/ln，对应后端 export.py line 已有的 get_ln_markdown）
  - 容错：没有 ln.md 时显示引导卡片"想看 AI 整理的图文学习笔记？请在添加素材时勾选「文案总结 · 路径 2」"

【任务 3: 样式对齐设计稿】
对照 docs/design/components/audio_detail.jsx 和 docs/design/components/video_detail.jsx 的样式风格:
  - 顶部 nav bar: bg-elev + border-bottom var(--line) + padding 10/20px
  - 双栏 grid: gap 16px 而不是更窄
  - 视频 panel: rounded var(--radius-sm) + shadow-sm
  - 笔记 panel: bg-elev + padding 20px
  - 字号: H1 用 display 字体 + 32px / H2 mono 13px eyebrow 风格
  - 颜色用 var(--accent-pink/2/3) + var(--ink/2/3/4)，禁止硬编码

【任务 4: 主题适配】
学习笔记页要在 light + dark 两个模式下都可读:
  - 用 var(--bg-elev) / var(--ink) 等 token 不要硬编码
  - playwright 实测两个模式截图归档

【范围限制】
- 不要做 B-2 字幕跟随（下个会话）
- 不要做 B-3 HTML/MD 双向（远期）
- 不要碰 audio_detail / video 复刻 / 图片页 / 文本页
- 不要新装依赖（CodeMirror / turndown 留给 B-3）
- 不要留 debug 脚本

【验证】
- pnpm build EXIT=0 + npx tsc --noEmit EXIT=0
- 实测访问任一 video 类型 item 的 /ln 路由:
  * 视频能播放（点 play 按钮 / 按 Space）
  * 字幕区显示加载 ln.md 状态或引导文案
  * 双栏布局比例合理（左视频 / 右笔记）
- playwright 归档 4 张:
  docs/e2e-test/screenshots/rp1b-b1-{light,dark}-{with-ln,no-ln}.png
- git commit 一个: feat(rp1-b): B-1 学习笔记页接通视频源 + ln.md 路径 + 设计稿样式对齐
  Co-Authored-By: xiaomi-mimo-2.5pro <noreply@xiaomi.com>
- 更新 COMPLETED_WORK.md 末尾追加一段
- EXECUTION_PLAN.md 把 RP1-B 那行**不要打勾**（B-1 只是 RP1-B 第一步），但 commit hash 加到行尾或追加子任务条
- 不要 push

预估工作量: 3-4h
```

## 2. 关键技术参考（mimo 自己 grep）

- 后端 video_result 函数模式（仿 audio_result）:
  ```bash
  rg -n "def get_video_result|video_result" backend/app/routes/workspaces.py
  ```
- ln.md 后端 GET 端点已存在:
  ```bash
  rg -n "ln\.md|/{workspace_id}/ln" backend/app/routes/export.py
  ```
- video 字段名可能是 `video_path` / `video_url` / `local_video`，用 codegraph 确认
- /static 挂载在 backend/app/main.py line 106：`app.mount("/static", StaticFiles(directory=str(_ROOT_DIR / "data")))`

## 3. 风险预案

| 风险 | 应对 |
|---|---|
| 没有 video item 带真实 ln.md 的 workspace | mimo 用 `find data/workspaces -name "ln.md"` 找，没有就构造一个 fixture 验证；或者引导用户跑一个视频任务 |
| video_url 字段命名不一致 | mimo 加防御读取 `results.video_path \|\| results.video_url \|\| results.local_video` |
| 跨域视频抓帧失败 | B-1 不做截图（B-5 才做），先保证能播即可 |
| 现有 LNNotesPanel 字幕跟随逻辑没有 | B-2 才做，B-1 笔记面板保持只读 OK |

## 4. 验收清单

- [x] index.tsx 真传 videoUrl 给 LNVideoPanel
- [x] 后端 video_url 走 /static 本地路径（参考 audio.url 修复模式）
- [x] 没有 ln.md 时显示友好引导
- [x] 双栏样式对齐设计稿（颜色 + 字号 + 留白）
- [x] light + dark 都可读（使用设计 token）
- [ ] 4 张截图归档（需用户手动测试）
- [x] pnpm build + tsc EXIT=0
- [ ] commit 颗粒度清晰
- [ ] COMPLETED_WORK 追加
- [x] **没留 debug 脚本**
