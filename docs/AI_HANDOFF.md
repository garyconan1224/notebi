# AI Handoff

## 当前执行指针（2026-07-29）

- **当前任务**：项目清理已完成；下一步盘点未完成功能并制定短期计划和长期路线图，暂不做 Windows 实机适配或整合包。
- **Git 基线**：清理和音乐分析退役提交为 `4bbe6a8`，已快进合入 `main`；最终恢复点为 `checkpoint/project-clean-final-20260729`。
- **未完成功能**：批量添加来源、Cookie 和任务中心相关改动保存在 `codex/wip-batch-settings-cleanup` 的 `e90785b`，没有合入 `main`。
- **已知阻断问题**：批次记录可能一直停在 `running 0/2`，子任务缺少 `batch_id` / `batch_item_id` 关联；修复前不能把 WIP 合入主线。
- **已确认交互**：
  - 任务浮窗只在有运行中任务时显示；排队、失败和完成状态不单独常驻浮窗。
  - 代理设置只保留在“网络设置”页，下载设置页不再维护第二份代理入口。
- **产品边界**：见 [`PRODUCT_DECISIONS.md`](PRODUCT_DECISIONS.md)。
- **清理边界**：保留 `data/workspaces`、媒体、索引、设置、`.local`、`.venv` 和 `frontend/node_modules`；运行日志、批次记录和本地工具文件只做忽略，不纳入 Git。
- **兼容边界**：启动期旧 Replica 数据清理和旧接口拒绝属于升级安全代码，不能因为包含旧名称就直接删除。
- **历史恢复点**：
  - `checkpoint/pre-cleanup-20260729`
  - `checkpoint/main-sync-a-20260729`
  - `archive/complete-approved-plan-20260729`
  - `archive/pre-main-sync-user-work-20260729`
- **远程状态**：仓库没有配置 remote，不执行 push。
- **密钥决定**：历史提交 `33c5cf3` 中的 `SILICONFLOW_API_KEY` 按用户要求保留，不重写历史；当前跟踪文件仍只含占位符，本地 `.env` 继续承载开发配置且不纳入 Git。
- **音乐分析已退役**：视频预检入口、旧配置回写、BPM/风格/情绪等声学分析、音乐教学接口和 Suno / Udio 输出均已删除；旧 `confirm-music` 只保留 410 拒绝行为。
- **验证结果**：前端 `295` 项测试和生产构建通过；后端 `1215 passed, 2 skipped`；Python 编译、`pip check`、`git diff --check` 通过。
- **已知质量债**：前端完整 lint 当前为 `101` 个错误、`8` 个警告，广泛存在于本轮未修改文件；不要当作本次清理回归，也不要在功能提交中顺手批量修复。

## 清理后的执行顺序

1. 盘点当前功能、未完成占位、已知缺口和 WIP 的真实状态。
2. 完成产品访谈，形成新的短期计划和长期路线图。
3. 按确认后的短期计划修复批次生命周期，补接口、持久化和前端回归测试。
4. 先完成 macOS/Linux 功能和验收，再单独启动 Windows 与整合包阶段。

## 启动检查

```bash
git status --short --branch
git log --oneline -5
git branch --show-current
```

Git 与运行结果优先于本文档；若指针漂移，先报告再继续。
