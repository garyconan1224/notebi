# NoteBi 文档与代码入口

## 当前文档

| 目的 | 入口 |
|---|---|
| 当前状态与下一步 | `docs/AI_HANDOFF.md` |
| 已确认产品边界 | `docs/PRODUCT_DECISIONS.md` |
| 开发流程 | `docs/WORKFLOW.md` |
| 当前可执行计划 | `docs/plans/` |
| 项目协作规则 | `CLAUDE.md`、`AGENTS.md`、`docs/rules/` |
| macOS / Windows 安装 | `docs/INSTALL_MACOS.md`、`docs/INSTALL_WINDOWS.md` |
| 开源发布 | `docs/OPEN_SOURCE_RELEASE.md`、`docs/GITHUB_RELEASE_CHECKLIST.md` |
| 模型与 Provider | `docs/THIRD_PARTY_MODELS.md`、`docs/openai-compatible-providers.md` |

## 代码入口

| 范围 | 目录 |
|---|---|
| 后端 API | `backend/app/routes/` |
| 后端服务 | `backend/app/services/` |
| 前端页面 | `frontend/src/pages/` |
| 前端组件 | `frontend/src/components/` |
| 前端服务 | `frontend/src/services/` |
| 共享下载与模型逻辑 | `shared/` |
| 后端测试 | `tests/backend/`、`backend/tests/` |
| 前端测试 | `frontend/src/**/*.test.*` |
| 验收脚本 | `scripts/knowledge_acceptance/` |

不要从旧计划猜测代码入口；先用 CodeGraph 或精确搜索确认当前调用关系。
