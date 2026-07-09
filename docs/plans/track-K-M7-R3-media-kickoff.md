---
title: Track K · M7 · R3 详细执行卡 —— 媒体伴随 + image/audio/video 三类型接入 NoteShell
status: ready
owner: 计划=Claude(CC) / 执行=xiaomi mimo v2.5-pro
created: 2026-06-06
parent: docs/plans/track-K-M7-noteshell-execution-plan.md
depends: R0/R1/R2（已 done：note 三层 + GET/PUT note + NoteShell 三视图）
scope: 只动笔记板块；把 image/audio/video 单素材接进 NoteShell（只接笔记向字段）；媒体走现有 /static；复用 /ln 播放器/转录轴；不碰复刻/AI导演/多素材
workflow: 一会话一子任务；分支 feat/k-r3-<n>-xxx；CC 验收后再下一子任务
---

# 0. R3 是什么（一句话）

> 让 NoteShell 支持带媒体的素材：**图片** inline 显示在笔记里、**音视频** 在伴随区放播放器 + 转录轴（与正文时间戳双向联动），把 **image / audio / video** 三类单素材接进统一笔记页。R1 只接了 text，R3 补齐另外三类。

# 1. 边界与关键约束

- ✅ **做**：note API 返回可访问媒体 URL + transcript；图片 inline；音视频 companion（播放器+转录轴）；image/audio/video 接入 + 各自结果页加「统一笔记(beta)」入口。
- ⛔ **不动**：复刻向字段（提示词/复刻包/帧提示词）——只接笔记向；后端分析逻辑；R0 落盘（媒体走 API 实时提取，不改 frontmatter 落盘）。
- 🟢 **复用优先**：直接 import `/ln` 的 `LNVideoPanel`/`LNTranscriptPanel`（R4 再统一归属，R3 先跨目录复用，不复制代码）。
- 🚫 **不装库**：音频播放器用原生 `<audio>` 自封装；不引第三方播放器/媒体库。

# 2. 已核实的代码事实

| 主题 | 事实（file:line） |
|---|---|
| **媒体可访问（关键）** | `app.mount("/static", StaticFiles(directory=data))` `main.py:108` → `data/` 下任意文件可经 `/static/<相对data路径>` 访问。媒体 URL = `/static/` + `路径.relative_to(DATA_DIR)`。**无需新建媒体接口** |
| ln 播放器 | `LearningNotesPage/LNVideoPanel.tsx`：props 含 `onTimeUpdate?(t)`；ref 暴露 `seekTo(sec)`（video.currentTime 跳转） |
| ln 转录轴 | `LNTranscriptPanel.tsx`：props `{ transcript, currentTime, onSeek(sec) }`；点击段落 `onSeek(line.t_sec)`，按 currentTime 高亮当前段 |
| transcript 格式 | `results.transcript` = `list[{ t_sec, t_str, text }]`（video/audio 通用，正好喂 LNTranscriptPanel） |
| **media 现状（要治）** | R0 `build_frontmatter` media 用 key `image_path`/`audio_path`/`frames[].frame_path`，但 results 实际 key 多为 `thumbnail`/`frame_image_path`/`frame_image`（workspaces.py:601-603），且存**绝对路径** → 现有 note.md 的 `media:` 基本为空。**R3 不依赖 frontmatter.media，改由 note API 实时从 results 提取** |
| note API | `GET …/note`（workspaces.py:2857）现返回 `{frontmatter, source_md, note_md, summaries, note_dir}`；**未返回 media/transcript** → R3.1 要补 |
| 前端类型 | `ItemNote`（types/workspace.ts:128）；NoteShell `pages/result/NoteShell/index.tsx`（R2 后 ~530 行，已三视图） |
| 入口现状 | 仅 `TextResultPage` 有「统一笔记(beta)」入口；image/audio/video 结果页**无** → R3 各自加 |
| 媒体 audio 播放器 | ln **只有** video panel，**无** audio 播放器 → R3.3 新建 `NoteAudioPanel`（<audio> 仿 LNVideoPanel 接口） |

# 3. 关键设计决策（CC 替你定）

1. **媒体走 note API 实时提取 + URL 化**（不改 R0 落盘、不重生成 note.md）：`GET …/note` 返回新增两字段——
   - `media`：按 `item.type` 从 `item.results` 取媒体文件路径 → 经 `to_static_url()` 转 `/static/...` URL。`{ images:[url], video:{url,duration}, frames:[{sec,url}], audio:url }`（按类型填）。
   - `transcript`：直接回 `results.transcript`（list[{t_sec,t_str,text}]，给转录轴）。
   - 新建后端 helper `to_static_url(path)`：绝对/相对路径 → `/static/` + `relative_to(DATA_DIR)`；非 data/ 下或缺失返回空串。
   - mimo 落地前**先核实各类型 results 里媒体真实 key**（image 图片、video 文件、audio 文件、frames），按真实 key 取，不臆造。
2. **伴随区独立组件**：新建 `NoteShell/NoteMediaCompanion.tsx`（不塞进已大的 index.tsx）；NoteShell 按 type 决定右侧/下方是否渲染它。
3. **复用 ln 组件**：`NoteMediaCompanion` 内 video 分支直接 `import LNVideoPanel/LNTranscriptPanel`；audio 分支用新建 `NoteAudioPanel + LNTranscriptPanel`。
4. **时间戳联动**：companion 内部维护 `currentTime` state；播放器 `onTimeUpdate→setCurrentTime`、转录轴 `onSeek→playerRef.seekTo`，与 ln 现有模式一致。
5. **入口**：image/audio/video 结果页各加「统一笔记(beta)」按钮跳 `…/note`（仿 R1 text）。

# 4. 子任务分解（一会话一子任务，分支 feat/k-r3-<n>-xxx）

### R3.1 — 媒体地基（note API 出 media+transcript）+ 图片 inline + image 接入
- 后端：`to_static_url()` helper；`get_item_note` 返回加 `media` + `transcript`（§3.1，先核实真实 key）。
- 前端：`ItemNote` 加 `media`/`transcript` 类型；NoteShell 在 `type==='image'` 时正文上方显示原图（`media.images[0]`）；`ImageResultPage` 加「统一笔记(beta)」入口。
- 测试：后端 `to_static_url` 单测（data 内→/static、data 外→空）；image item 的 `GET …/note` 返回 media.images 为 /static URL。
- **验收**：`./dev.sh` 真跑，image 素材进 NoteShell 看到原图 + OCR/描述正文 + 标签；`curl …/note` 的 media 是可访问 URL；`pnpm tsc` 绿、pytest 绿、回归 text NoteShell 正常。

### R3.2 — 音视频 companion：video 接入（复用 ln 播放器/转录轴）
- 新建 `NoteMediaCompanion.tsx`（video 分支）：`LNVideoPanel`(media.video.url) + `LNTranscriptPanel`(transcript)，内部 currentTime 双向联动。
- NoteShell 在 `type==='video'` 时渲染 companion（伴随区）；`VideoResultPage` 加入口。
- **验收**：video 素材进 NoteShell——播放器可放、转录轴随播放高亮、点转录跳播放、正文 note.md 正常；tsc/回归绿。

### R3.3 — audio companion：audio 接入（新建音频播放器）
- 新建 `NoteAudioPanel.tsx`：`<audio>` + ref 暴露 `seekTo` + `onTimeUpdate`（接口仿 LNVideoPanel）。
- `NoteMediaCompanion` 加 audio 分支：`NoteAudioPanel`(media.audio) + `LNTranscriptPanel`(transcript)。
- NoteShell 在 `type==='audio'` 时渲染 companion；`AudioResultPage` 加入口。
- **验收**：audio 素材进 NoteShell——音频可放、转录轴联动、正文正常；tsc/回归绿。

### R3.4 — 收口（四类型端到端 + 文档）
- 四类型（text/image/audio/video）端到端各跑一遍验收清单。
- 更新 `docs/EXECUTION_PLAN.md` 勾 R3、本文件标 done、`docs/COMPLETED_WORK.md` 追加。

# 5. R3 总验收（CC 据此验收，通过才展开 R4）
- 四类型素材都能进 NoteShell：image 看图、video/audio 播放器+转录轴联动、text 原样；都有总结风格/编辑/三视图（R1/R2 能力）。
- 媒体经 `/static` 正常加载；时间戳双向联动正常。
- **零回归**：复刻向、各原结果页、后端分析、导出、RAG 正常；未装新库；vitest 不新增 fail。

# 6. mimo 开工话术（R3.1，复制即用）
```
执行 Track K NoteShell · R3.1（note API 出 media+transcript + 图片 inline + image 接入）。开工前读 docs/plans/track-K-M7-R3-media-kickoff.md §2/§3/§4。

启动：git status（确认 main 干净）&& git log --oneline -8 对账；从 main 新建 feat/k-r3-1-media-base。

先核实（不臆造）：rg 看各类型 item.results 里媒体真实 key —— image 的图片路径键、audio 的音频路径键、video 文件与 frames 的键（候选 thumbnail/frame_image_path/frame_image），确认后再取。

任务：① 后端新增 helper to_static_url(path)：路径 relative_to(DATA_DIR) → '/static/'+rel；非 data 下或缺失返回 ''。② get_item_note（workspaces.py:2857）返回加 media（按 item.type 从 results 提取并 URL 化：image→images[url]，video→video{url,duration}+frames[{sec,url}]，audio→audio url）+ transcript（results.transcript 原样）。③ 前端 ItemNote 加 media/transcript 类型；NoteShell type==='image' 时正文上方显示 <img src={media.images[0]}>；ImageResultPage 加「统一笔记(beta)」入口跳 …/note。

测试：tests/backend 加 to_static_url 单测 + image item GET …/note 返回 media.images 为 /static URL。

红线：不依赖 frontmatter.media（改走 API 实时提取）；不改 R0 落盘/分析逻辑/复刻向；不装库；KMP_DUPLICATE_LIB_OK=TRUE .venv/bin/python -m pytest <新测试> 绿 + 前端 tsc 绿；./dev.sh 手测 image 进 NoteShell 看到图；不 push；key/路径不确定停下问。完成贴 pytest+tsc 结果 + git diff --stat。
```
