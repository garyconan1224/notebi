# AI Handoff

## 当前执行指针（2026-07-29，S0 已完成）

- **当前任务**：S0 已在 `codex/s0-contract-style-cleanup` 的 `ad29776` 完成；下一步按 [`plans/2026-07-29-feature-completion-short-term.md`](plans/2026-07-29-feature-completion-short-term.md) 执行 S1 批次生命周期闭环。
- **长期路线**：见 [`plans/2026-07-29-product-roadmap.md`](plans/2026-07-29-product-roadmap.md)；Windows 实机适配和整合包必须等待 macOS/Linux 功能完成门槛。
- **Git 基线**：清理和音乐分析退役提交为 `4bbe6a8`，已快进合入 `main`；最终恢复点为 `checkpoint/project-clean-final-20260729`。
- **未完成功能**：批量添加来源、Cookie 和任务中心相关改动保存在 `codex/wip-batch-settings-cleanup` 的 `e90785b`，没有合入 `main`。
- **已知阻断问题**：批次记录可能一直停在 `running 0/2`，子任务缺少 `batch_id` / `batch_item_id` 关联；修复前不能把 WIP 合入主线。
- **已确认交互**：
  - 任务浮窗只在有运行中任务时显示；排队、失败和完成状态不单独常驻浮窗。
  - 代理设置只保留在“网络设置”页，下载设置页不再维护第二份代理入口。
- **产品边界**：见 [`PRODUCT_DECISIONS.md`](PRODUCT_DECISIONS.md)。
- **新增确认**：删除“风格报告”；实现无音乐项的任务默认勾选；实现文本编辑器加粗、斜体、标题和列表工具栏。
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
- **S0 验证结果**：前端 `55` 个测试文件、`297` 项测试和生产构建通过；退役能力扫描与 `git diff --check` 通过。
- **清理基线历史验证**：后端 `1215 passed, 2 skipped`；Python 编译和 `pip check` 通过。本次 S0 未改后端，未重复运行后端全套测试。
- **已知质量债**：前端完整 lint 当前为 `101` 个错误、`8` 个警告，广泛存在于本轮未修改文件；不要当作本次清理回归，也不要在功能提交中顺手批量修复。

## 当前执行顺序

1. S0 已完成：规则契约已修正，“风格报告”入口与类型分支已删除。
2. 当前执行 S1：重新实现批次生命周期；不得合并或 cherry-pick 整个 WIP 分支。
3. S2–S5 依次完成批量导出、任务默认勾选、文本编辑器工具栏和可见占位清零。
4. S6 收敛前端质量债并完成 macOS/Linux 真实验收。
5. 达到长期路线图 Gate B 后，再单独启动 Windows 与整合包阶段。

## 启动检查

```bash
git status --short --branch
git log --oneline -5
git branch --show-current
```

Git 与运行结果优先于本文档；若指针漂移，先报告再继续。
