# 产品设计到生产实现映射

本表以仓库中的设计系统、实现与测试为准。Open Design MCP 在本轮验收环境中返回
`Transport closed`，因此没有把不可读取的远端项目当作新的事实源；视觉继续遵循
[`DESIGN.md`](DESIGN.md) 和既有 token 合同。

| 设计区域 | 生产实现 | 验收状态 |
|---|---|---|
| BrandMark / Lockup / 动态标题与浏览器图标 | `frontend/src/components/brand/Brand.tsx`、`PageTitle.tsx`、`frontend/public/` | 已实现 |
| 设置统一壳与六组 IA | `frontend/src/layouts/SettingsShell.tsx`、`frontend/src/pages/SettingPage/` | 已实现 |
| 首页最近笔记与活动层 | `frontend/src/pages/WorkbenchPage/RecentTasks.tsx` | 已实现；按 `content_id` 去重，共享笔记不重复占位 |
| 笔记索引与长选择器 | `frontend/src/pages/LibraryPage/` | 已实现；底部多选、搜索、分页、合集选择器加载更多 |
| 合集一级入口和共享归类 | `frontend/src/router.tsx`、`WorkspaceList.tsx`、`backend/app/services/workspace_store.py` | 已实现；`/collections` 是一级入口，成员关系不复制笔记 |
| 合集删除安全性 | `backend/app/routes/workspaces.py`、`tests/backend/test_workspaces_trash.py` | 已实现；删除/永久删除转移 canonical 所有权并只解除归类 |
| 任务中心与批次透明度 | `frontend/src/pages/TaskCenterPage/`、`backend/app/routes/task_batches.py` | 已实现；批次详情显示阶段、可见处理记录、总结预览、失败原因和笔记入口 |
| 监控的公开阶段 | `backend/app/services/task_runner.py`、`pipeline_tasks.py`、`DeployMonitorPage.tsx` | 已实现；说话人阶段不再被误标为泛转录 |
| NoteShell 导出与编辑 | `frontend/src/pages/result/NoteShell/`、`backend/app/routes/workspaces.py` | 已实现；来源/格式分层、总结正文持久化、导出使用当前说话人映射 |
| AI 工具和问 AI | `AiArtifactPanel.tsx`、`FloatingAskAi.tsx`、`NoteChatDrawer.tsx` | 已实现；结构化工具独立于总结，桌面右侧可调宽，停靠面板无重复标题 |
| 说话人、身份化总结、时间轴 | `pipeline_tasks.py`、`task_runner.py`、`NoteShell/` | 已实现；音视频共享标签，旧视频可只补做说话人识别 |
| 思考/非思考模型协议 | `shared/sf_client.py` | 已实现；可见正文与私有推理分离，网关拒绝可选采样/思考参数时安全重试 |
| 本地模型中心 | `LocalModelsPanel.tsx`、`transcriber_config.py` | 已实现范围为下载、进度、状态与切换；没有声称未实现的暂停或删除 |

## 共享笔记不复制的边界

- `WorkspaceRecord.items` 只保存 canonical 笔记；`_memberships.json` 保存“目标合集 → canonical 笔记”关系。
- 所有 NoteShell 读、写、转写编辑和导出先解析 canonical 所有者；所以先归入、后首次编辑也不会产生副本。
- 移出合集只删除成员关系。删除合集时，仍归属其中的 canonical 笔记会保留到收纳箱；永久删除还会重写其它合集关系，而不会删除媒体、转写或总结。
- 旧数据若存在同一 `item_id` 指向不同 canonical 内容，系统返回明确冲突，不会静默覆盖。
