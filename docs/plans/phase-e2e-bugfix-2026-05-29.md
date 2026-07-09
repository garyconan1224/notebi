---
name: phase-e2e-bugfix-2026-05-29
title: E2E 测试发现的 7 问题修复 — P1 数据串扰必修 + P2/P3 体验优化
status: done
owner: xiaomi mimo 2.5pro（ccswitch 中转）
estimated_hours: 6-8（P1+P2 必修 ~3h；P3 全选 ~3-5h）
depends_on:
  - main HEAD = `267d426`（E2E 报告已 commit）
  - 根因分析已写入 docs/e2e-test/E2E_TEST_REPORT.md（Opus 4.7 用 codegraph 定位）
created_date: 2026-05-29
references:
  - docs/e2e-test/E2E_TEST_REPORT.md（测试报告 + 根因 + 修复优先级表）
  - docs/rules/mimo-onboarding.md（启动必读）
  - docs/plans/phase-handoff-mimo-2026-05-29.md（后续 S1-S6 总计划）
priority: 🔴 紧急 — 本计划必须先于 S1-S6 执行（音视频闭环的实际数据基线）
commits:
  - S0.1: e6e2173 fix(e2e.p1): /subtitles 端口删 demo fixture 兜底，无 transcript 返回空 SRT
  - S0.2: b94f6c7 fix(e2e.p1): audio_result has_real 认 transcript_segments，修复 demo 兜底误触发
  - S0.3: a368370 fix(e2e.p1+): VideoResultPage visual_only 模式禁用字幕导出按钮
  - S0.4: 9cefd2a fix(e2e.p2): ResultsOverview 补 unique key + AppShell stats 防御
  - S0.5: 78c107c fix(e2e.p3): visual_only 隐藏播放器，改显仅画面分析模式提示
  - S0.6: 272610e fix(e2e.p3): B站 yt-dlp format 前置，减少412重试
  - S0.7: 849571d fix(e2e.p3): VLM 进度每5%上报，消除"卡住后秒满"假象
completed_date: 2026-05-29（S0.1-S0.7 全部完成；S0.8 跳过）
---

# E2E Bugfix 计划（2026-05-29 Opus 4.7 拆解）

> **本计划插队执行**：必须在 [`phase-handoff-mimo-2026-05-29.md`](phase-handoff-mimo-2026-05-29.md) 的 S1-S6 之前完成。原因：S4 N7b Gemini 骨架要建立在「真实数据正确返回到结果页」基础上，否则等于在 demo fixture 上加新功能。
>
> P1 两个串扰问题 = 后端 demo fixture 兜底过宽（不是任务间数据污染），根因报告见 [`docs/e2e-test/E2E_TEST_REPORT.md`](../e2e-test/E2E_TEST_REPORT.md)「🔬 P1 根因分析」段。

---

## 0. 启动 60 秒（mimo 每次新会话）

按 [`docs/rules/mimo-onboarding.md`](../rules/mimo-onboarding.md) 走启动协议：

```bash
git status --short --branch && git log --oneline -10
sed -n '1,30p' docs/AI_HANDOFF.md
sed -n '1,80p' docs/e2e-test/E2E_TEST_REPORT.md   # 看测试结果 + 根因
# 然后打开本文件，确认要做哪个 Bug
```

**红线**（重复 CLAUDE.md §4，违反就出事故）：

- ❌ `git push origin` / `rm -rf` / `git reset --hard` / `git clean -fd`
- ❌ amend / rebase 主线 commit
- ❌ 装新依赖 / 改 `.env`
- ❌ 在 `docs/archive/` 里搜索

---

## 1. 修复总览

| Bug | 优先级 | 修复点 | 文件:行 | 工时 | 推荐分支 |
|---|:-:|---|---|:-:|---|
| #1 SRT 串扰 | 🔴 P1 | `/subtitles` 端口删 demo 兜底 | `backend/app/routes/export.py:451` (`export_subtitles`) + 文件顶部 `build_demo_*` import | 1-2h | `fix/e2e-p1-subtitles-no-demo` |
| #7 音频 DEMO | 🔴 P1 | `get_audio_result` 的 `has_real` 认 `transcript_segments` | `backend/app/routes/workspaces.py:2061` | 0.5h | `fix/e2e-p1-audio-result-has-real` |
| #1 加固 | 🟡 P1+ | 前端 visual_only 模式禁用 SRT 导出按钮 | `frontend/src/pages/result/VideoResultPage.tsx`（找 `handleExportSubtitles` 上方按钮） | 0.5h | `fix/e2e-p1-visual-only-srt-disabled` |
| #3 React key | 🟠 P2 | ResultsOverview 列表加 unique key | `frontend/src/pages/result/ResultsOverview/index.tsx`（找 `.map(` 缺 key 处） | 0.5h | `fix/e2e-p2-results-overview-key` |
| #2 播放器 00:00 | 🟢 P3 | visual_only 隐藏播放器 + 文案 | `frontend/src/pages/result/VideoResultPage.tsx`（顶部播放器 region，按 `summary_path === 'visual_only'` 切换） | 0.5h | `fix/e2e-p3-visual-only-no-player` |
| #6 yt-dlp 412 | 🟢 P3 | B 站下载策略前置（优先用已知可行的 format） | `backend/app/services/`（找 `yt_dlp` / `bilibili` 调用） | 1h | `fix/e2e-p3-bilibili-format-precedence` |
| #5 VLM 慢 | 🟢 P3 | 进度粒度细化（5% 一报） | `shared/video_analyzer.py:extract_frames` 附近 + handler 调用方 | 0.5h | `fix/e2e-p3-vlm-progress-granular` |
| #4 URL hack | 🟢 P3 | Composer URL input 支持 dispatchEvent | `frontend/src/pages/WorkbenchPage/Composer.tsx` URL input controlled state | 0.5h | `fix/e2e-p3-composer-native-input` |

**建议执行顺序**：S0.1 → S0.2 → S0.3（P1 三件一组）→ S0.4（P2）→ 根据用户优先级选 P3。

---

## 2. Step S0.1：删 /subtitles 端口的 demo fixture 兜底（P1）

### 目标

`backend/app/routes/export.py:451 export_subtitles` 端口当前在 transcript 为空时**回落到 demo fixture**，导致 visual_only 路径用户点 SRT 拿到「大家好...大疆 Pocket 4」demo 字符串。本 Step 去掉 demo 兜底，无 transcript 时返回 **空文件 + 警告 header**（不报 500，避免前端报错弹窗）。

### 背景速查

```bash
# 看 export_subtitles 完整 + demo 兜底
sed -n '450,510p' backend/app/routes/export.py

# 看顶部 import（demo 导入位置）
sed -n '24,32p' backend/app/routes/export.py
```

### 操作

1. **export_subtitles 函数内**：找到 `transcript = ...` 拿 transcript 的逻辑，在它**为空 list 或 None** 时，直接返回空 SRT（一行 `1\n00:00:00,000 --> 00:00:00,000\n\n`）而不是走 demo
2. **不要** import `build_demo_video_result` / `build_demo_audio_result`（如果 export_subtitles 内部用到了，改为本地空 transcript fallback）
3. 加 response header `X-Subtitle-Status: empty`（前端可读，但不必处理）

### 验收

- `.venv/bin/python -m pytest tests/backend -q -k "subtitle"` 全绿（如有现有测试，行为可能变，需更新断言）
- 启动后端，用 curl 调 `/workspaces/<ws>/items/<item>/subtitles?format=srt`，对一个 visual_only 任务返回**空 SRT 内容**而不是 demo 字符串
- 前端 visual_only 任务点 SRT 导出，下载的文件**不是「大家好...大疆 Pocket 4」**（手动看一眼即可）

### Commit

```
fix(e2e.p1): /subtitles 端口删 demo fixture 兜底，无 transcript 返回空 SRT

E2E 测试 P1 问题 1 根因修复：visual_only 路径 transcript=[] 时 /subtitles
端口回落到 demo fixture，导致用户拿到错误字幕。本次改为返回空 SRT，前
端在 visual_only 模式应禁用导出按钮（见后续 S0.3）。

Co-Authored-By: xiaomi mimo 2.5pro
```

---

## 3. Step S0.2：audio_result 的 has_real 认 transcript_segments（P1）

### 目标

`backend/app/routes/workspaces.py:2061` 当前 `has_real = isinstance(results, dict) and results.get("transcript")`，但 whisper / faster-whisper 把转写写到 `results.transcript_segments`（看 `AudioResult` interface line 400），导致音频任务跑完了 transcript 字段空 → fall through 到 demo。

### 背景速查

```bash
sed -n '2037,2095p' backend/app/routes/workspaces.py   # get_audio_result 全函数
rg -n "transcript_segments" backend/ shared/ | head    # 后端哪里写 transcript_segments
```

### 操作

1. **修 line 2061**：
   ```python
   # 旧
   has_real = isinstance(results, dict) and results.get("transcript")
   # 新
   has_real = isinstance(results, dict) and (
       results.get("transcript") or results.get("transcript_segments")
   )
   ```

2. **同步修 line 2080 附近** `tracks_meta.transcript_count`，让它在 transcript 为空但 transcript_segments 存在时算 segments 长度：
   ```python
   transcript_count = len(results.get("transcript") or results.get("transcript_segments") or [])
   ```

3. **可选加固**：在 results 里**只有 transcript_segments** 没有 `transcript` 时，主动把 segments 映射成 transcript 数组兜底（前端 `AudioResultPage` 已有 `transcriptSegments` useMemo，但其他消费方可能没 fallback）。

### 验收

- `pytest tests/backend -q -k "audio_result"` 全绿
- 跑一个真实音频任务（mimo 自己用 31 秒 B 站歌曲跑），AudioResultPage transcript tab 显示**真实转写**而不是「大疆 Pocket 4」
- 截图新结果，更新 `docs/e2e-test/E2E_TEST_REPORT.md` 问题 7 状态为 ✅ Fixed

### Commit

```
fix(e2e.p1): audio_result has_real 认 transcript_segments，修复 demo 兜底误触发

whisper 把转写写到 transcript_segments 而非 transcript，旧判断只看
transcript 导致 fall through 到 demo fixture（显示「大疆 Pocket 4」）。
本次 has_real 同时认两个字段，tracks_meta.transcript_count 也兜底用
segments 长度。

Co-Authored-By: xiaomi mimo 2.5pro
```

---

## 4. Step S0.3：visual_only 前端禁用 SRT 按钮（P1+ 加固）

### 目标

S0.1 让端口返回空 SRT 不出错，但 visual_only 模式下用户根本不该看到 SRT 导出入口。本 Step 在 VideoResultPage 把字幕导出按钮在 visual_only 时禁用 + tooltip 提示「仅画面分析模式无字幕」。

### 背景速查

```bash
# 找字幕导出按钮 + summary_path 读取
rg -n "exportOpen|handleExportSubtitles|summary_path" frontend/src/pages/result/VideoResultPage.tsx | head
```

### 操作

1. 找到 `handleExportSubtitles` 函数声明附近的导出按钮 / 下拉
2. 加判断：
   ```tsx
   const isVisualOnly = result?.summary_path === 'visual_only'
   ```
3. 按钮 `disabled={isVisualOnly}`，加 `title="仅画面分析模式无字幕数据"`（CSS 鼠标悬停提示）
4. 如果是下拉菜单整体（exportOpen 切换），改为按钮本身 disabled 不打开下拉

### 验收

- 跑 visual_only 任务，VideoResultPage 字幕导出按钮**灰显不可点**，鼠标悬停显示提示
- 跑 av_combined / subtitle 任务，按钮正常可点
- 前端 `npx tsc --noEmit` EXIT=0

### Commit

```
fix(e2e.p1+): VideoResultPage visual_only 模式禁用字幕导出按钮

S0.1 端口已返回空 SRT，前端再加 UI 兜底：visual_only 路径不允许触发
字幕导出（用户根本没让转写），按钮 disabled + 提示「仅画面分析模式」。

Co-Authored-By: xiaomi mimo 2.5pro
```

---

## 5. Step S0.4：ResultsOverview React key 警告（P2）

### 目标

E2E 截图 `1.8-results-overview.png` 控制台报 "Each child in a list should have a unique 'key' prop"。本 Step 找到缺 key 的 `.map(` 加上。

### 背景速查

```bash
# 找 ResultsOverview 里所有 .map(
rg -n "\.map\(" frontend/src/pages/result/ResultsOverview/index.tsx
# 找 JSX 中 <X key={...}> 哪里漏了
```

### 操作

逐个 `.map(` 检查 JSX 元素是否有 `key={}`：
- 如果 item 有 `id` / `item_id` / `t_sec` → 用它
- 兜底用 index（不推荐但可），如 `key={`${prefix}-${idx}`}`

### 验收

- 前端 dev console 不再报 React key 警告
- `npx tsc --noEmit` EXIT=0

### 实际执行（2026-05-29）

**真凶**：`ResultsOverview/index.tsx:441` 的 `frames.slice(0,10).map((f) => <div key={f.idx}>` —— 当 frames 数据中 `idx` 字段未定义时，`key={undefined}` 导致 React 报警。

**修复**：
- `key={f.idx}` → `key={f.idx ?? \`frame-${idx}\`}`（兜底 index）
- 附带修复：AppShell.tsx `stats &&` → `stats?.cpu && stats?.memory &&`（防御 stats 结构异常）
- 附带修复：vite.config.ts proxy 加 `/admin`（dev 模式下系统指标走代理）

### Commit

```
fix(e2e.p2): ResultsOverview 补 unique key + AppShell stats 防御

Co-Authored-By: xiaomi mimo 2.5pro
```

---

## 6. Step S0.5：visual_only 隐藏播放器（P3）

### 目标

visual_only 路径不下载/不 probe 音频流，播放器 duration_sec=0、URL 缺失是设计预期。本 Step 在 visual_only 模式下**隐藏整个播放器区域**，改显 placeholder：「📽️ 仅画面分析模式 · 不含视频播放」。

### 背景速查

```bash
# 找视频播放器组件 / region
rg -n "video.*ref|<video|VideoPlayer|controls" frontend/src/pages/result/VideoResultPage.tsx | head -10
```

### 操作

1. 在 player region 外层加：`{!isVisualOnly && <player...>}` 或 `summary_path === 'visual_only' ? <placeholder> : <player>`
2. placeholder 设计参考 `docs/design/components/`（如有 frame_only.jsx，先 `ls docs/design/components/ | rg -i visual` 看）

### 验收

- visual_only 任务结果页**看不到播放器**，看到 placeholder
- av_combined / subtitle 任务结果页播放器正常显示 + 时长正确

### Commit

```
fix(e2e.p3): visual_only 路径隐藏视频播放器，改显「仅画面分析模式」提示

Co-Authored-By: xiaomi mimo 2.5pro
```

---

## 7. Step S0.6：B 站 yt-dlp 412 重试策略前置（P3）

### 目标

E2E 报告问题 6：B 站首次下载 HTTP 412（反爬），现在靠重试机制兜回来。本 Step 把已知可行的 format 列表前置，避免一次 412 + 重试的浪费。

### 背景速查

```bash
rg -n "yt_dlp|YDL_OPTS|bilibili|412" backend/app/services/ shared/ | head -15
```

### 操作

mimo 需要先调查 B 站当前 yt-dlp 调用的具体 format string，结合 yt-dlp 最近的 B 站策略（context7 查 yt-dlp B 站 best practices）选一个低风险 format 顺序。

**有疑问停下问用户**（这步需要外网知识，mimo 自己拿不准就停）。

### 验收

- 跑 3 个 B 站 URL（短/中/长），观察 download 阶段无 412 retry
- 全套 pytest 全绿

### Commit

```
fix(e2e.p3): B 站 yt-dlp format 前置策略，减少 412 重试

Co-Authored-By: xiaomi mimo 2.5pro
```

---

## 8. Step S0.7：VLM 进度上报粒度（P3）

### 目标

E2E 报告问题 5：31 秒视频 VLM 阶段 10%→100% 用 10 分钟，进度刷新太疏。本 Step 在 VLM 逐帧调用循环里加 **每 5% 一报** 进度。

### 背景速查

```bash
rg -n "set_progress|progress|VLM|frame.*describe" shared/video_analyzer.py | head -10
```

### 操作

找到 VLM 循环（每帧 LLM 调用），按当前帧 index / total 计算百分比，相邻报告差 ≥ 5% 才推。

### 验收

- 跑 av_combined 任务，ProcessingPage 看到 VLM 阶段每 5% 一次进度更新
- 截图 `docs/e2e-test/screenshots/post-fix-vlm-progress.png` 留档

### Commit

```
fix(e2e.p3): VLM 进度上报每 5% 一次，消除"卡 30% 然后秒 100%"假象

Co-Authored-By: xiaomi mimo 2.5pro
```

---

## 9. Step S0.8：Composer URL input nativeInputValueSetter（P3，可选）

### 目标

E2E 报告问题 4：自动化测试时 `evaluate` 设置 input.value + dispatchEvent 触发不了 React controlled input。这只影响**自动化测试便利性**，不影响用户手动操作。

**优先级最低**——如时间紧可跳过，留给后续测试基础设施 phase 一起做。

### 操作

如果要做：在 Composer URL input 加 dev-only 的 `data-testid` 属性 + 暴露 setter helper，方便 playwright/automation 注入。

### Commit（如做）

```
fix(e2e.p3): Composer URL input 加 testid + nativeSetter helper（自动化测试用）

Co-Authored-By: xiaomi mimo 2.5pro
```

---

## 10. 收尾（每个 Step 完成后）

1. 跑 `pytest tests/backend -q` + `pnpm build` 全绿（针对 backend 改动跑 pytest，针对 frontend 改动跑 build）
2. `git checkout main && git merge --no-ff <step-branch> -m "Merge branch '<step-branch>'"`（local merge，不 push）
3. **更新 E2E 报告**：在对应问题段末尾加 `**状态**：✅ Fixed at <commit-hash>` 一行
4. **更新 AI_HANDOFF.md / EXECUTION_PLAN.md** 当前状态
5. **本 Step 完工提醒用户**：建议开新会话做下一个 Step

---

## 11. 完成所有 Step 后

- 所有 P1 + P2 修完后，建议用户**再跑一次 E2E 测试**（同一 31 秒 B 站视频），确认 visual_only / 音频 结果页**不再出现 demo 字符串**
- 通过后才能进入 `phase-handoff-mimo-2026-05-29.md` 的 S1 清理 → S2 → ... → S6 流程
- P3 全做完是 nice-to-have，可以分插到 S1-S6 期间做（每个 P3 都很小，不阻塞主线）

---

## 12. 预防性建议（写入开源准备 [D] 阶段待办）

E2E 测试暴露的根本问题：**demo fixture 兜底逻辑过宽**，遮蔽真实数据缺失。开源前 [D] 阶段建议：

- 加全局开关 `ENABLE_DEMO_FIXTURE`（默认 false），prod 永不返回 demo
- 所有 `build_demo_*` 函数改为只在 `os.environ.get("ENABLE_DEMO_FIXTURE") == "true"` 时调用
- demo fixture 改为独立 `/demo/*` 端口，只有显式访问才返回

本 phase **不做**这个全局改造（涉及多 endpoint，工时大），仅在 OUTSTANDING_TASKS.md 加一条待办。

---

## 附录：关键文件 / 行号速查（可能漂移）

| 作用 | 文件:行 | 关键字 |
|---|---|---|
| `/subtitles` 端口（S0.1） | `backend/app/routes/export.py:451` | `def export_subtitles` |
| demo import（S0.1 删） | `backend/app/routes/export.py:27-28` | `build_demo_audio_result` / `build_demo_video_result` |
| `get_audio_result` has_real（S0.2） | `backend/app/routes/workspaces.py:2061` | `has_real = isinstance` |
| `_video_result_has_real_data`（参考） | `backend/app/routes/workspaces.py:1517` | `def _video_result_has_real_data` |
| `AudioResult.transcript_segments`（S0.2 类型） | `frontend/src/services/workspaces.ts:400` | `transcript_segments` |
| VideoResultPage 字幕按钮（S0.3） | `frontend/src/pages/result/VideoResultPage.tsx` | `handleExportSubtitles` |
| ResultsOverview map（S0.4） | `frontend/src/pages/result/ResultsOverview/index.tsx` | `.map(` |
| 视频 demo fixture | `backend/app/services/video_result_demo.py:213` | `"大家好，今天我们来看大疆 Pocket 4"` |
| 音频 demo fixture | `backend/app/services/audio_result_demo.py:16` | 同上 |
| 报告 + 截图 | `docs/e2e-test/` | `E2E_TEST_REPORT.md` |
