---
phase: R22
title: Pipeline 并行调度 · 截帧 + 转写同时跑
status: pending
owner: TBD（建议 Opus 4.7，涉及调度器改造）
estimated_hours: 6-10
depends_on:
  - R21 状态同步 bug 已修（不然并行后状态会更乱）
user_source: 2026-05-27 用户反馈 issue 6
---

## 背景

R19 av_synthesis 流程串行执行 DOWNLOAD → PROBE → ASR → FRAMES → VLM → SUM。ASR 和 FRAMES + VLM 在依赖图上其实只都依赖 DOWNLOAD 产物（音频流 / 视频流），用户在多核电脑上希望两者并行节省时间。

## TODO（进入此 phase 时再展开）

- 看 `backend/app/services/task_runner.py` 当前 stage 调度是怎么排的
- 画 av_synthesis 的依赖 DAG（哪些 stage 真的彼此独立）
- 决定并发模型：asyncio.gather？多进程？池大小由谁定（接 R23）
- 资源争用风险：ASR 和 FRAMES 同时跑会不会爆 RAM / CPU
- 进度上报：两路并行时左侧步骤页 UI 怎么显示（并行 stages 同时高亮 running？）
- 单测 + 端到端冒烟

**不在此 phase 展开操作步骤，开工时停下来问用户。**
