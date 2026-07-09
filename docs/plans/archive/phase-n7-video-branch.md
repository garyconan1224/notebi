---
phase: N7
title: 视频分支补全（PySceneDetect AI 镜头分析）
status: done
priority: P2
estimate_hours: 8-10
actual_hours: ~2
model: Opus 4.7
branch: feat/phase-n7-video-branch
worktree: 是（/Users/conan/Desktop/nibi-n7）
depends_on: [N5, N6]
commits: [7457d02]
completed_date: 2026-05-19
scope_decision: 范围收缩——只做 AI 镜头分析，路径 1 & 3 拆出 N7b
spec_ref: docs/SPEC.md §4
---

## 范围决策（重要 — 已收缩）

原 EXECUTION_PLAN 写的 N7 范围是「PySceneDetect AI 镜头分析 / 总结路径 1 & 3 / 视频运镜延后」。
**经过实际代码调研，本 phase 只做 AI 镜头分析**：

| 范围项 | N7 是否做 | 理由 |
|---|---|---|
| AI 镜头分析（scenedetect） | ✅ 做 | 用户已授权装 `scenedetect` 依赖 |
| 视频运镜提示词 | ❌ 延后 | spec 本就标注「AI 导演阶段做」 |
| 总结路径 1（字幕直接） | ❌ 拆出 N7b | 当前 item pipeline **没有字幕提取**这一步，要做需先在 item 维度建 ASR/subtitle 抽取——属于 N8 音频管线范围 |
| 总结路径 3（视频模型直接） | ❌ 拆出 N7b | 需要新增视频大模型 API 客户端（Gemini 1.5 Pro / Qwen-VL-Max-Video），是 P2 新集成，需用户单独决定接哪家 |

**N7 实际产出**：AI 镜头分析端到端打通——前端 Preflight 抽屉的 `capture_mode='scene'` 选择能真正生效，按检测出的镜头切换点 + 每镜头取 2 或 3 帧抽样。

---

## 现状

- `shared/video_analyzer.py::extract_frames(video_path, interval_sec)` 是按秒均匀抽帧的生成器
- `process_video → extract_frames` 硬编码用按秒模式
- `handle_analyze_task` 收到 payload 后调 `run_batch_analysis`，**未读取 preflight.tasks 的截帧子参数**
- `_bridge_to_pipeline_payload` 把 item.preflight.models 透传，**未透传 tasks 子参数**

## 子任务拆分

- [ ] **N7.1** 装 scenedetect 依赖
  - `requirements.txt` 追加 `scenedetect>=0.6.4`（核心 + opencv backend，cv2 已在依赖里）
  - `pip install -e .` 或 `pip install scenedetect`

- [ ] **N7.2** 新增 `extract_frames_by_scenes(video_path, frames_per_shot=3)` 生成器
  - 用 `scenedetect.detect(video_path, ContentDetector())` 拿镜头列表
  - 每镜头按 `frames_per_shot` 取帧：2=首尾，3=首中尾
  - yield (sec, frame) 与 `extract_frames` 同形状
  - 镜头列表为空（视频太短/单镜头）时 fallback 到首帧

- [ ] **N7.3** `process_video` / `run_batch_analysis` 接入 `capture_params`
  - 新增 `CaptureParams` dataclass：`mode` / `interval_sec` / `max_frames` / `frames_per_shot`
  - `process_video` 根据 mode 调对应 extractor
  - `run_batch_analysis` 增加 `capture_params: CaptureParams | None = None` 参数，None = 旧 interval 行为（向后兼容）

- [ ] **N7.4** 路由层 → handler 透传
  - `_bridge_to_pipeline_payload` 读 `item.preflight.tasks.get('frame_prompts')`，把 `capture_mode` / `interval_sec` / `max_frames` / `scene_frames_per_shot` 写进 payload
  - `handle_analyze_task` 从 payload 读这些字段，构造 CaptureParams 传给 `run_batch_analysis`
  - **兼容 N5 之前的老 boolean 形状**：若 tasks.frame_prompts 是 bool 或缺失，全部走默认（scene + 3 帧）

- [ ] **N7.5** 测试
  - `test_extract_frames_by_scenes.py`：用小测试视频（fixtures 里能凑就用，不能凑就用 `cv2` 生成的合成视频）验证返回 (sec, frame) 形状
  - `test_bridge_payload_frame_prompts.py`：N5 新形状 + 老 boolean 形状两条路径

- [ ] **N7.6** 收尾
  - `pytest tests/backend -q`：所有通过
  - 更新 EXECUTION_PLAN（N7 打勾 + 新增 N7b 项「视频总结路径 1 & 3」）/ AI_HANDOFF / COMPLETED_WORK / plan frontmatter

---

## 不要做的事

- ❌ 不要做总结路径 1（字幕直接）—— 需先在 item pipeline 加字幕提取
- ❌ 不要做总结路径 3（视频模型直接）—— 需新视频大模型 API 集成
- ❌ 不要碰 `streamlit` legacy 入口（app.py / pages/）
- ❌ 不要重构现有 `extract_frames` 函数签名（兼容老调用方）

## 风险点

1. **scenedetect 在长视频上慢**：300+ MB 视频检测可能要 30~60 秒。本 phase 不做异步进度上报，照用户已有的「任务运行中」状态即可
2. **空镜头 fallback**：极短视频可能检测不到任何 scene boundary，必须 fallback 到首帧避免空 frames 数组
3. **测试视频 fixture**：仓库现有 tests 是否有小视频 fixture 需要查；没有就用 cv2 在 tmp_path 合成一个几秒的纯色视频
