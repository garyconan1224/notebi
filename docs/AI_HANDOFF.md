# AI Handoff

## 当前执行指针（2026-07-29，S0–S6 已完成）

- **当前任务**：短期计划 S0–S6 已全部完成；S6 代码提交为 `b9a53ea`、`c273094`。下一步由用户确认 macOS/Linux 是否达到可发布水平，再按 [`plans/2026-07-29-product-roadmap.md`](plans/2026-07-29-product-roadmap.md) 单独启动 Windows 实机适配；整合包仍需等待 Windows Gate D。
- **长期路线**：见 [`plans/2026-07-29-product-roadmap.md`](plans/2026-07-29-product-roadmap.md)；本轮未执行 Windows、安装包或整合包。
- **Git 基线**：清理和音乐分析退役提交为 `4bbe6a8`，已快进合入 `main`；最终恢复点为 `checkpoint/project-clean-final-20260729`。
- **未完成功能**：批量添加来源、Cookie 和任务中心相关改动保存在 `codex/wip-batch-settings-cleanup` 的 `e90785b`，没有合入 `main`。
- **S1 已关闭问题**：统一批次服务会在 worker 启动前持久化 `batch_id`、`batch_item_id`、`attempt_no` 和 workspace item 关联；快速任务竞态、部分成功、全跳过、暂停/恢复、取消、失败重试和重启恢复均有回归测试。
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
- **S1 验证结果**：后端批次窄回归 `94 passed`，后端全套 `814 passed, 2 skipped`；前端 `55` 个测试文件、`301` 项测试、类型检查和生产构建通过；真实浏览器确认任务中心过滤、批次详情 `2/2 completed`、真实任务 ID 和零 console error。
- **S2 验证结果**：批量导出 API `22 passed`，后端全套 `817 passed, 2 skipped`；前端 `56` 个测试文件、`305` 项测试、类型检查和生产构建通过。ZIP 已覆盖四种素材、manifest、重名安全目录、缺失/无结果跳过、失败计数和失败项原子写入。
- **S3 验证结果**：任务默认值相关后端 `60 passed`，仓库后端全套 `1301 passed, 2 skipped`；前端 `57` 个测试文件、`310` 项测试、类型检查和生产构建通过。真实浏览器确认设置保存后 GET 读回一致，刷新后值不丢失，`/tasks/new` 消费同一组默认值；单条与批量任务的显式字段继续优先于保存值。
- **S4 验证结果**：前端 `58` 个测试文件、`314` 项测试、类型检查和生产构建通过。真实 Chrome 验证中文选区加粗、空选区斜体输入、二级标题和无序列表均生成正确 Markdown；自动保存、刷新读回、版本历史创建与恢复一致，console error 为 `0`。
- **S5 验证结果**：删除无生产入口的旧任务看板、旧笔记页、旧批次页和无消费者设置，共净删除约 `2500` 行；前端 `58` 个测试文件、`315` 项测试、类型检查和生产构建通过，相关后端 `154 passed`。真实浏览器覆盖 `18` 个主路由、四类素材详情、统一笔记、批次详情、处理中页、兼容重定向和 404，修复监控日志重复 key 后有效路由 console error 为 `0`。
- **S6 验证结果**：前端 lint 从 `102 errors / 9 warnings` 收敛为 `0 / 0`，Vitest `58` 个文件、`315` 项测试、类型检查和生产构建通过；NoteShell 主 chunk 从 `522.72 kB` 降为 `105.26 kB`，编辑器依赖拆为 `241.92 kB` 和 `313.11 kB`，构建不再发出大 chunk 警告。后端全套 `1301 passed, 2 skipped` 且无 pytest/Starlette 警告；Python 编译、`pip check`、`git diff --check` 通过。真实浏览器复验主页、模型与渠道、监控、任务中心、知识库、本地合集、真实视频/音频统一笔记和新建素材弹窗，console error 为 `0`；S5 已覆盖图片、文本、批次、兼容重定向和 404。
- **清理基线历史验证**：后端 `1215 passed, 2 skipped`；Python 编译和 `pip check` 通过。本次 S0 未改后端，未重复运行后端全套测试。
- **质量门状态**：S6 范围内的 lint、测试警告、后端依赖警告和大 chunk 警告已清零。

## 当前执行顺序

1. S0 已完成：规则契约已修正，“风格报告”入口与类型分支已删除。
2. S1 已完成：所有批量入口统一到真实 `TaskBatchService` 生命周期。
3. S2 已完成：多选导出使用单个 ZIP，内容、清单和部分失败反馈准确。
4. S3 已完成：无音乐项的任务默认值可持久化、读回并由单条与批量入口实际消费。
5. S4 已完成：文本编辑器加粗、斜体、二级标题和无序列表使用真实 ProseMirror 命令。
6. S5 已完成：可见占位、无入口旧页面和无消费者设置已清零。
7. S6 已完成：质量债已收敛，macOS 本机自动与浏览器验收通过；Linux 本轮仅覆盖跨平台代码与自动化契约，未冒充 Linux 实机证据。
8. 当前停点：等待用户确认 Gate B；确认后单独启动 Windows Gate D，整合包 Gate E 继续后置。

## 启动检查

```bash
git status --short --branch
git log --oneline -5
git branch --show-current
```

Git 与运行结果优先于本文档；若指针漂移，先报告再继续。
