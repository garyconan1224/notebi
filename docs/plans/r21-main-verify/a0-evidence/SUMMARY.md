# A0 端到端复现证据

**复现时间**：2026-05-28 16:33-16:35
**测试 URL**：`https://www.bilibili.com/video/BV1LSRhBQErk`（用 Codex+Remotion，生成百万博主同款动画）
**提交方式**：首页输入 URL → AddMaterialModal → 音视频综合 → 一键解析
**生成 task**：`download-610d60ccb9cd`（download）+ `analyze-fb68a63b39a4`（analyze）

---

## Bug A1 证据：步骤全部 DONE bug

**截图**：
- `06-download-done-but-frontend-lagging.png` — 后端 download 已 SUCCESS，前端仍在 5%
- `05-processing-page-initial.png` — 初始 ProcessingPage，所有步骤显示 `—`

**API 快照**：
- `download-task-detail.json` — download task 详情：`status=SUCCESS, progress=1.0`
- `api-snapshot-all-tasks.json` — 全量 task 列表

**现象**：
1. 下载完成后，ProcessingPage 标题仍显示 "PROCESSING · download"
2. 页面头部状态显示「成功 · 100%」但步骤区先全部 `—`，后来全部 ✓ DONE
3. 根因：`deriveSteps` 在 `currentIdx < 0 && progress >= 1` 时无条件标全 done

## Bug A2 证据：任务面板重复行

**现象**：同一 URL 生成 download + analyze 两个独立 task_id，在 FloatingTaskQueue 各占一行
**证据**：`api-snapshot-all-tasks.json` 中可看到同一 source_url 对应多个 task

## Bug A3 证据：SSE 与轮询数据源不一致

**现象**：
- 底部浮窗显示「任务 · 3 项进行中」
- 后端实际 0 个 RUNNING 任务（全部 SUCCESS）
- ProcessingPage 右侧 TaskList 显示「2 个活跃」

**根因**：`useTaskSse`（实时）和 `usePipelineTasks`（5s 轮询）写同一个 store，无时间戳比较

## Bug A4 证据：截帧进度跳变

**现象**：任务从提交到完成约 2 分钟，前端进度显示从 5% 直接跳到 100%，中间无平滑过渡

## Bug A5 证据：查看结果按钮

**现象**：下载完成后「查看结果」按钮已可点（cursor=pointer），但此时 analyze 任务可能还在进行中
