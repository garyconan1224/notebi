---
phase: R22 单素材任务并行 + R23 性能档位（体验优化，对应 2026-05-27 反馈 issue 6/9）
status: done
completed_date: 2026-06-01
owner: xiaomi-mimo-2.5pro（执行）/ opus（规划+对账）
parent: docs/ROADMAP.md §11（R22/R23 体验优化）
estimated_hours: R22 5-8h / R23 5-7h
note: 2026-06-01 用户明确需求。Track I·I2 已验收通过。这两条是 5/27 11 条反馈剩的 2 条（9 条已做 R21）。
decisions:
  - 执行顺序 R22 → R23（R22 是直接性能痛点；都后端为主）。
  - R22 = 同一视频素材内「音频转录」与「视频截帧」并行（现 steps 串行）。
  - R23 = 按电脑内存档位，自动调 Whisper 模型大小 + 截帧密度。
---

## 0. 对账结论（2026-06-01，mimo 必读）

**R22 现状**：视频复合笔记任务按 `payload.steps` **串行**编排（`pipeline_tasks.py:1133-1145`：download → transcribe → analyze → note）。`transcribe`=音频转录（:590 fast_whisper），`analyze` 含截帧+视觉分析（:948 截帧进度）。转录(音频轨)与截帧(视频帧)本质独立，可并行。

**R23 现状**：Whisper 模型在 `settings.transcriber`（:599 `load_settings().transcriber`）；截帧密度参数在 analyze 视觉处理里；设置页只有截图/下载设置，**无统一性能档位**。

## 1. 计划

| 项 | 内容 | 现状 |
|---|---|---|
| **R22** | 视频「音频转录 ‖ 截帧」并行，note/synthesis 等两者完成 | steps 串行，待并行化 |
| **R23** | 性能档位（内存→Whisper 模型 + 截帧密度），设置页可选/自动探测 | 无档位，参数散在 settings/analyze |

## 2. R22 mimo 提示词（直接复制）

```
R22 单素材任务并行：视频「音频转录」与「视频截帧」并行执行。
背景必读: docs/plans/r22-r23-perf-mimo-prompt.md §0
现状: 视频 pipeline 按 steps 串行(pipeline_tasks.py:1133-1145 download→transcribe→analyze→note)。

【任务0: 确认依赖（决定能否并行）】
  sed -n '1133,1220p' backend/app/services/pipeline_tasks.py  # steps 串行编排
  确认: 截帧/视觉分析(analyze) 依不依赖 transcribe 结果？(截帧从视频抽帧、VLM 描述帧，本质不依赖音频转录)
  → 独立则可并行: transcribe(音频) ‖ 截帧(视频)，note/synthesis 等二者。

【任务1: 并行编排】
  - 把 transcribe 与 截帧 改为并行(pipeline 内起两 future / 复用 task_runner 的 ThreadPoolExecutor)，二者都完成后再跑依赖步骤(synthesis 用 转录+视觉)。
  - 进度反馈: 两轨进度合并(转录% + 截帧%)，别互相覆盖。
  - 失败处理: 一轨失败不拖死另一轨，明确报哪轨失败。

【验证】
  - 后端 pytest: 并行后结果完整(转录+帧+synthesis 都在、不丢不乱序)。
  - 手动: 跑一个视频，日志/进度能看到转录与截帧同时进行(非先转录完才截帧)。
  - git commit: feat(r22): 视频音频转录与截帧并行; 不要 push。
【红线】任务0 确认独立再并行(若截帧依赖转录则不能并行,如实说明); 并行不丢结果/乱依赖; 不装新依赖; 不留 debug 脚本。
```

## 3. R23 mimo 提示词（直接复制）

```
R23 性能档位：按电脑内存调 Whisper 模型大小 + 截帧密度。
背景必读: docs/plans/r22-r23-perf-mimo-prompt.md §0
现状: whisper model 在 settings.transcriber; 截帧密度在 analyze; 无统一档位。

【任务0: 对账参数位置】
  rg -n "transcriber|model_name|model_size|base|small|medium|large" backend/app/config*.py backend/app/services/asr_*.py
  rg -n "frame_interval|num_frames|fps|截帧|帧密度|every.*sec|max.*frame" backend/app/services/pipeline_tasks.py
  确认: whisper model 配置字段名/取值; 截帧密度参数(间隔/每秒/上限)在哪、怎么传。

【任务1: 性能档位定义 + 配置入口】
  - 定义档位(如 低配≤4G / 中配 8G / 高配 16G+)，每档映射: whisper model(base/small/medium/large) + 截帧密度(间隔或上限)。
  - 设置页(SettingPage)加「性能档位」选择；可选自动探测内存推荐默认档(psutil 已有则用，没有别新装)。
  - 存后端 settings(config) 或前端 localStorage(择一，与现有配置体系一致)。

【任务2: pipeline 应用档位】
  - transcribe 用档位的 whisper model; 截帧用档位的密度参数。默认中配，用户可改。

【验证】
  - 后端 pytest(档位→参数映射); 前端 tsc+build。
  - 手动: 切低配→whisper base + 截帧稀疏; 切高配→large + 密集。
  - git commit: feat(r23): 性能档位(内存→模型大小+截帧密度); 不要 push。
【红线】先对账参数位置再改; 档位默认安全(中配); 不装新依赖(psutil 没有就手动选档,别装); 不留 debug 脚本。
```

## 4. 进度

- [x] R22 视频转录‖截帧并行（2026-06-01；进度倒退已修）
- [x] **R22-fix 失败中断另一轨**（2026-06-01）：`threading.Event` 协作取消，analyze 截帧循环每轮检查，秒级响应
- [ ] R23 性能档位（内存→模型+截帧密度）
- [ ] R 收尾（完成后 5/27 11 条反馈全清）
