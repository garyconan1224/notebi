# Open Design 到生产实现映射

此表随 S1–S7 持续更新。

| 设计区域 | 生产实现 | 阶段 | 状态 |
|---|---|---|---|
| BrandMark / Lockup / 动态标题 | `frontend/src/components/brand/Brand.tsx`、`PageTitle.tsx` | S1 | 已实现 |
| favicon / Apple / maskable | `frontend/public/`、`frontend/index.html` | S1 | 已实现 |
| 六组设置壳 | `frontend/src/layouts/SettingsShell.tsx` | S1/S5 | 壳已实现，业务页待统一 |
| 首页持久笔记 + 活动层 | `frontend/src/pages/WorkbenchPage/RecentTasks.tsx` | S2 | 已实现 |
| Library 任务边界 | `backend/app/routes/workspaces.py` | S2 | 已实现 |
| 任务中心四统计卡与批次默认 | 待映射 | S2 | 待实现 |
| `/notes` 紧凑工具栏与固定多选栏 | 待映射 | S2 | 待实现 |
| `/collections` 一级路由 | 待映射 | S2 | 等待归属语义 |
| 两步导出 | 待映射 | S3 | 待实现 |
| AI 工具与问 AI | 待映射 | S3 | 待实现 |
| 说话人、语言、时间轴、推理协议 | 待映射 | S4 | 待实现 |
| 监控与本地模型中心 | 待映射 | S5 | 待实现 |
