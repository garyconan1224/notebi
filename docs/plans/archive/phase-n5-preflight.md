---
phase: N5
title: Preflight 抽屉细化（按素材类型展开所有子参数）
status: done
priority: P1
estimate_hours: 4-6
actual_hours: ~2
model: Opus 4.7
branch: feat/phase-n5-preflight
worktree: 是（/Users/conan/Desktop/nibi-n5）
depends_on: [N4]
commits: [02e8d7d, 644fae1]
completed_date: 2026-05-19
spec_ref: docs/SPEC.md §3.4 / §4.2 / §5 / §6 / §7
---

## 范围概述

把 `PreflightConfigPanel.tsx` 的「任务勾选」从「只有一级开关」升级为「一级开关 + 嵌套子参数」，按 4 种素材类型展开。**纯前端改动**，不动后端 pipeline / 任务运行器。

后端 `PreflightConfig.tasks` 类型已是 `Record<string, unknown>`（见 [workspace.ts:15](frontend/src/types/workspace.ts:15)），天然兼容嵌套对象，**无需 schema 迁移**。

---

## 现状 vs 目标差距

### 现状（PreflightConfigPanel.tsx 当前实现）

- ✅ 背景信息 5 字段、模型选择 3 类、一级任务勾选 4 类素材都有
- ❌ 子参数 **0 个**：所有素材类型的 Preflight 抽屉都只是一组 checkbox

### SPEC §3.4 要求的子参数

| 素材 | 一级勾选项（现状） | 待补子参数 |
|---|---|---|
| 视频 | frame_prompts / video_summary / subtitle_export / music_analysis ✓ | **截帧模式**（按秒/AI 镜头）+ 间隔秒数 + 最大帧数 + 镜头取帧数（2/3）/ **总结路径**（字幕直接/音视频合并/视频模型）+ 总结深度 / **提示词格式**（MJ/SD/JSON）+ **提示词语言**（中/英） |
| 音频 | asr / speaker_diarization / subtitle_file / music_analysis ✓ | Whisper 语言（auto/zh/en/...） / Suno-Udio 格式开关 |
| 图片 | content_describe / ocr / frame_prompts / association ✓（缺多图对比） | 提示词格式（MJ/SD/JSON） / 联想方向 4 维多选（用途/设计/竞品/情绪） / **+ 一级新增「多图对比」** |
| 文字 | summary / association / rewrite / translate ✓（缺多文对比） | 摘要长度（短/中/长） / 联想方向 4 维多选 / 改写风格（正式/口语/简洁/丰富） / 翻译目标语 / **+ 一级新增「多文对比」** |

### 数据形状决策

- 当前：`tasks: { frame_prompts: true, video_summary: true, ... }`
- N5：`tasks: { frame_prompts: { enabled: true, capture_mode: 'scene', interval_sec: 5, max_frames: 100, scene_frames_per_shot: 3, format: 'mj', lang: 'en' }, video_summary: { enabled: true, path: 'merged', depth: 'normal' }, ... }`
- 读老数据时把 `boolean` 视为 `{ enabled: <bool> }`，写新数据统一新形状
- `AddMaterialModal.tsx` 仍用旧 boolean 形状（粗粒度），打开 Preflight 抽屉时由读取兼容层自动升级

---

## 子任务拆分

- [ ] **N5.1** 类型与读写兼容层
  - 在 `frontend/src/types/workspace.ts` 新增 `TaskParams` 工会类型（按 task id 细分），`tasks` 字段仍是 `Record<string, unknown>` 不动
  - 写 `getTaskParams(tasks, id): TaskParams` / `setTaskParams(tasks, id, params)` 工具（兼容老 boolean）
  - 集中在 `frontend/src/lib/preflightTasks.ts`

- [ ] **N5.2** 视频子参数 UI
  - `frame_prompts` 子区：截帧模式（Radio）/ 间隔秒数（Input number，仅按秒模式可见）/ 最大帧数（仅按秒）/ 镜头取帧数 2 或 3（仅 AI 镜头模式）/ 提示词格式 / 提示词语言
  - `video_summary` 子区：总结路径（Radio 字幕直接/音视频合并/视频模型直接）/ 总结深度（简略/正常/深度）
  - 子参数仅在一级勾选 = true 时展开

- [ ] **N5.3** 音频子参数 UI
  - `asr` 子区：Whisper 语言（auto / zh / en / ja / ...）
  - `music_analysis` 子区：Suno 格式开关 / Udio 格式开关

- [ ] **N5.4** 图片子参数 + 一级补「多图对比」
  - `frame_prompts` 子区：提示词格式
  - `association` 子区：4 维方向 Checkbox 多选
  - 一级新增 `multi_compare`（默认关）

- [ ] **N5.5** 文字子参数 + 一级补「多文对比」
  - `summary` 子区：摘要长度
  - `association` 子区：4 维方向
  - `rewrite` 子区：改写风格
  - `translate` 子区：目标语
  - 一级新增 `multi_compare`（默认关）

- [ ] **N5.6** 收尾
  - `pnpm tsc -b --noEmit`：除 4 个 baseline 错误外不应新增
  - 在本地启动跑一遍，每种素材类型至少展开抽屉看一眼
  - 更新 `docs/EXECUTION_PLAN.md` 把 N5 打勾
  - 更新 `docs/AI_HANDOFF.md`：N5 完工小结 + 指向 N6
  - 追加 `docs/COMPLETED_WORK.md`

---

## 不要做的事

- ❌ 不要碰后端 pipeline / task_runner（后端读 `tasks[*]` 当 truthy 用，新形状下 `{enabled:true}` 也是 truthy；具体子参数消费由后续 N7~N10 各分支补全时再接）
- ❌ 不要顺手做 N6 任务级 LLM 对话
- ❌ 不要重构 `AddMaterialModal`（它写老形状是设计，粗粒度兜底）
- ❌ 不要 push origin（按 [D] 阶段统一推策略）

## 验证要点

- 老素材打开抽屉：boolean → `{enabled:true}` 自动升级，原勾选状态不丢
- 新建素材走完 AddMaterialModal 后再开抽屉：能正常读到一级勾选 + 默认子参数
- 切换一级开关：子参数区折叠 / 展开行为正确
- 切换截帧模式：相关子参数项条件可见
- 保存后重新打开抽屉：所有子参数能回填

## 风险点

1. **子参数对后端实际影响为 0**——视频截帧、Whisper 语言等参数后端目前是否真的读 `preflight.tasks[*].xxx`？大概率不读，仍走默认。如果用户期望「在抽屉里改了立刻生效」，需要在后端 pipeline 里也接这些字段——**这是 N7~N10 的范围**，N5 只把前端 UI 立起来 + 数据持久化，让后续阶段有处可读。
2. 老数据兼容层如果写错会让已存的 preflight 丢勾选——N5.1 必须先写好。
