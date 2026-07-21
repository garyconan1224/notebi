# NoteBi 项目记忆

## 项目概况
- NoteBi：本地优先 AI 多媒体笔记工具（视频/音频/图片/文字 → 转写/总结/导出）
- 后端：Python 3.11 + FastAPI + SQLAlchemy + SQLite，端口 8001
- 前端：React 19 + TypeScript + Vite 6 + Tailwind 4，端口 5181
- 从 `/Users/conan/Desktop/nibi` 拆分而来，固定 NoteBi 单产品模式
- 无 remote，不 push

## 协作规则
- 三角色：Claude 桌面（计划）/ Claude Code + 小米（执行）/ Codex（审查）
- 改代码前先说明改什么、为什么改
- 风险求证 6+2 条：新依赖、超范围、代码与计划不符、DB schema、安全、跨 5+ 文件、worktree 冲突、计划外行为
- 红线：不 rm -rf / reset --hard / push --force / clean -fd；不提交密钥
- 启动必做：git status + git log + git branch

## 当前进度（2026-07-21）
- 分支：codex/exec-notebi-cleanup
- 任务：NoteBi 单产品化清理（删除复刻/分镜/导演/提示词能力）
- 计划文件：docs/plans/notebi-single-product-cleanup-2026-07-20.md
- 未提交改动：4 个后端文件（templates.py, workspaces.py, pipeline_tasks.py, summary_templates.py），共删除 159 行、新增 10 行
- 稳定基线：main @ c676a7f

## 启动命令
- 用户双击：启动 NoteBi.command
- 终端完整：./start-notebi.command
- 快速开发：./dev-notebi.sh
- 停止：停止 NoteBi.command 或 ./stop-notebi.command
