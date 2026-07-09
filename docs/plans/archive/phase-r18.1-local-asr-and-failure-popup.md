---
phase: R18.1
title: 本地 ASR（fast-whisper + mlx-whisper）+ 任务失败弹窗 + 模型下载进度
status: ready
owner: xiaomi mimo v2.5-pro
estimated_hours: 8
depends_on:
  - 与 R18 / R19 文件无冲突；建议排在 R18 完工后、R19 启动前执行
decisions:
  - ASR 顺序：本地优先（mlx-whisper on Apple Silicon → fast-whisper → 远端 OpenAI 兼容 HTTP）
  - 全部失败 → 任务标 FAILED + error_message，前端弹窗；不再静默 SUCCESS + demo 兜底
  - 新增依赖 `mlx_whisper`（仅 macOS arm64），用户已授权
  - fast-whisper 模型首次自动下载（≈140MB base），用户已授权
  - 模型下载必须在 ProcessingPage 显示进度条
related_spec:
  - docs/spec/04-pipeline-tasks.md
  - docs/spec/05-result-pages.md
references:
  - /Users/conan/Desktop/BiliNote/backend/app/transcriber/transcriber_provider.py
  - /Users/conan/Desktop/BiliNote/backend/app/transcriber/mlx_whisper_transcriber.py
  - backend/app/services/asr_fast_whisper.py（nibi 已有，video 任务在用）
trigger_case:
  - 工作空间 bf3722e0-896f-4b2e-9e8e-58953fc5d31d / item 8b212ef8-63f8-4c7d-a4cf-d9e39b47cd72
    跑完后 transcript="" 但 status=done，前端回落到 demo_fixture
---

## 背景

用户反馈：音频 item 跑完结果页是 DEMO 不是真实数据。定位结论：

- `handle_audio_task` TRANSCRIBE 段（[pipeline_tasks.py:2293](../../backend/app/services/pipeline_tasks.py)）只走远端 OpenAI 兼容 HTTP，缺 api_key 时只 log 一行「⚠️ 未提供 api_key，跳过转写」然后继续 SUCCESS。
- video 任务（同文件 line 474-504）已经用本地 `asr_fast_whisper.py`，audio 路径忘了接。
- 后端 `/audio_result` 检测到 transcript 空 → 静默回落 demo，前端只挂了不显眼的 DEMO 角标。

修复方向：audio 任务接本地 ASR（fast-whisper + 新增 mlx-whisper），全失败显式 FAILED，前端弹窗 + Overview 报错 + 模型下载进度条。

## 修改清单（操作步骤详见给 mimo 的初始提示词）

### 后端
1. 新建 `backend/app/services/asr_mlx_whisper.py`（仿 BiliNote mlx_whisper_transcriber，签名对齐 asr_fast_whisper；模型下载用 hf_hub snapshot_download + progress_callback）
2. 新建 `backend/app/services/asr_router.py`（select_asr_engine + run_local_asr_with_fallback；本地优先级 mlx > fast > remote）
3. 改 `backend/app/services/pipeline_tasks.py` handle_audio_task TRANSCRIBE 段（2281-2330）接入 asr_router；全失败 raise → task FAILED
4. 改 `backend/app/routes/workspaces.py` /audio_result（1889-1933）+ /result + /image_result + /text_result：item.status=failed 时返回 `{"source": "task_failed", "error": ...}`，不再回落 demo
5. 新建 `backend/tests/services/test_asr_router.py`（平台分支 + 降级 + 全失败 3~5 个用例，monkeypatch 不真下模型）

### 前端
6. `frontend/src/pages/result/ResultsOverview/index.tsx`：source=task_failed → ErrorState 卡 + 重试按钮；source=demo_fixture → 顶部 yellow callout
7. `frontend/src/pages/result/ProcessingPage/*`：ASR 模型下载进度条 + task.status=failed 时弹 Modal（复用现有 Modal 组件）

### 不要做
- 不要重构 audio 任务其它步骤（VAD / diarization / music / srt / summary）
- 不要 rename settings.transcriber 现有字段；加字段 OK（如 `engine`）
- 不要动 video 任务的 ASR 调用（保持现状，除非用户授权统一）
- 不要 git push

## 验收

1. 用户 Mac（Apple Silicon）重跑 item 8b212ef8-... 不配 api_key：
   - 日志出现「🔍 选用 ASR 引擎：mlx-whisper」
   - ProcessingPage 显示「📥 下载 ASR 模型 ... K/N files」进度条
   - 转写完成、Overview 显示真实数据、无 DEMO 角标
2. 故意全断（mlx + fast + key）→ task FAILED、Modal 弹错误、Overview ErrorState
3. `pytest backend/tests/services/test_asr_router.py -v` 全绿
4. `cd frontend && npm run build` 不报新 TS 错

## 执行节奏

按 CLAUDE.md §5「一会话一子任务」，每完成一项 commit + 停下等用户确认：

- [ ] R18.1.1 `asr_mlx_whisper.py` + `asr_router.py` + 单测
- [ ] R18.1.2 `pipeline_tasks.py` audio TRANSCRIBE 改造 + `workspaces.py` failed 分支
- [x] R18.1.3 前端 ErrorState + 失败 Modal
- [x] R18.1.4 前端模型下载进度条

完工后：①EXECUTION_PLAN.md 打勾 ② 本文件 frontmatter status=done + 填 commits ③ COMPLETED_WORK.md 追加一段。
