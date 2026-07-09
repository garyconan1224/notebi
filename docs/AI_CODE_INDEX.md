# AI Code Index

这是给 Claude Code 终端版用的低 token 代码入口索引。先用这里定位，再用 `rg -n` 和小片段读取实际代码；本文件不是实现真相源。

## 后端入口

| 主题 | 入口 | 常用关键词 |
|---|---|---|
| Pipeline API / SSE | `backend/app/routes/pipeline.py` | `create_task`, `events`, `task_id`, `TaskType` |
| 后台任务执行 | `backend/app/services/task_runner.py` | `submit_task`, `append_log`, `ThreadPoolExecutor`, `isTaskTerminal` |
| 四类分析任务 | `backend/app/services/pipeline_tasks.py` | `handle_analyze_task`, `handle_audio_task`, `handle_image_task`, `handle_text_task` |
| 视频分析 | `shared/video_analyzer.py` | `summary_path`, `transcript`, `frames`, `video_template` |
| 音频分析 | `shared/audio_analyzer.py` | `music`, `segments`, `features`, `duration` |
| 图片分析 | `shared/image_analyzer.py` | `ocr`, `prompt`, `exif`, `compare` |
| 文字分析 | `shared/text_analyzer.py` | `summary`, `quotes`, `source_excerpt`, `rewrite`, `translation` |
| 工作区 API | `backend/app/routes/workspaces.py` | `WorkspaceItem`, `results`, `tags`, `materials` |

## 前端入口

| 主题 | 入口 | 常用关键词 |
|---|---|---|
| 工作台提交 | `frontend/src/pages/WorkbenchPage/Composer.tsx` | `normalizeMediaUrl`, `onSubmit`, `preflight` |
| 前置配置抽屉 | `frontend/src/components/workspace/PreflightDrawer.tsx` | `tasks`, `audio`, `summary_path`, `payload` |
| 处理中页 | `frontend/src/pages/result/ProcessingPage/index.tsx` | `useTaskSse`, `StepProgress`, `LiveLog`, `terminal` |
| 结果总览 | `frontend/src/pages/result/ResultsOverview/index.tsx` | `items`, `task`, `navigate`, `result`, `processing` |
| 视频结果 | `frontend/src/pages/result/VideoResultPage.tsx` | `summary_path`, `transcript`, `timeline`, `template`, `inline_frames`, `FramePickerModal` |
| 音频结果 | `frontend/src/pages/result/AudioResultPage.tsx` | `speaker`, `music`, `subtitle`, `waveform`, `SummariesTab` |
| 图片结果 | `frontend/src/pages/result/ImageResultPage.tsx` | `ocr`, `prompt`, `exif`, `compare` |
| 文字结果 | `frontend/src/pages/result/TextResultPage.tsx` | `quote`, `source_excerpt`, `rewrite`, `translation` |
| 资料库 | `frontend/src/pages/LibraryPage/` | `LibraryPage`, `ItemCard`, `select`, `delete` |
| Taskboard | `frontend/src/pages/WorkspacePage/TaskboardPage/` | `tabs`, `materials`, `compare`, `favorites`, `QueueTab` |
| 添加素材模态 | `frontend/src/components/workspace/AddMaterialModal.tsx` | `intent`, `tasks`, `preflight`, `link-preview`, `4-step` |
| 前置配置抽屉 | `frontend/src/components/workspace/PreflightDrawer.tsx` | `media tabs`, `cascading lock`, `background`, `tasks payload` |
| 任务队列浮窗 | `frontend/src/components/FloatingTaskQueue.tsx` | `groupKey`, `getTaskTitle`, `video_title`, `source_url` |
| 多版本总结 Tab | `frontend/src/components/summaries/SummariesTab.tsx` | `ItemSummary`, `summary_templates`, `versions` |
| 帧选择弹窗 | `frontend/src/pages/result/VideoResultPage.tsx`（FramePickerModal） | `inline_frames`, `segment_idx`, `suggested` |

## 文档入口

| 主题 | 入口 |
|---|---|
| 长期路线 | `docs/ROADMAP.md` |
| 当前接力 | `docs/AI_HANDOFF.md` |
| 产品规范 | `docs/SPEC.md` 入口索引 + `docs/spec/*.md` 模块 |
| 流程图文本镜像 | `docs/flows/README.md` |
| 短期 phase | `docs/plans/` |

## 读取规则

1. 先从本文件拿入口和关键词。
2. 用 `rg -n "关键词" <入口文件>` 定位。
3. 只读目标函数/组件附近片段。
4. 如果索引和代码冲突，以代码为准，并顺手修正本文件。
