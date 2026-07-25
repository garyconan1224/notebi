# 知识库与检索全量验收证据（2026-07-25）

## 交付范围

- 基线、P0–P7、Phase A–E / PE 均已在独立的本地可回退分支提交。
- 当前收口分支：`codex/knowledge-final-validation`。
- 搜索页保持两种用户视图：`智能回答`与`精确查找`；智能回答引用和精确结果都可跳回原文。

## 自动化验证

- 后端全量：`1007 passed, 2 skipped`。
- 前端全量：`35 files passed, 214 tests passed`。
- 前端生产构建：通过。
- Python 编译：`python -m compileall -q backend shared scripts` 通过。
- 启动脚本语法：`bash -n dev-notebi.sh start-notebi.command stop-notebi.command` 通过。
- 补丁格式：`git diff --check` 通过。

## 真实数据安全

- pytest 进程通过 `NOTEBI_DATA_DIR` 使用会话级临时数据目录。
- 全量后端测试前后对 `data/workspaces/**` 与 `data/.local/metadata.sqlite3`
  做 SHA-256 对比，结果完全一致。
- 迁移幂等检查：44 个合集、61 个内容实例、61 个独立 `content_id`、
  60 条同源谱系，`changed_item_count = 0`。
- 最近一次迁移备份：
  `data/backups/content-identity-20260725T194538Z`。
- 测试污染清理前备份：
  `data/backups/test-pollution-20260725T194500Z`。

## 搜索与页面烟测

- 精确索引：34,211 个片段，FTS5 可用，数据库 24,764,416 bytes。
- 本地查询基准：4/4 成功，P50 39.429 ms，最大 183.844 ms。
- Playwright 真实页面验证：
  - `/search` 可在 `智能回答`和`精确查找`之间切换；
  - `产品`精确查询返回 10 条原文结果；
  - 精确模式不渲染 AI 回答区；
  - 原文定位信息可展开；
  - 引用链接使用正式路由并保留 `start_ms`与`field`；
  - 点击后 URL 保留时间定位参数；
  - 浏览器 console error 与 page error 均为 0。

## 已知非阻塞边界

- Vite 构建仍提示 `NoteShell` 单块约 517 KB，未影响构建和运行。
- 当前环境不是 Windows x64，无法在真实 Windows 机器上执行 `.bat`与离线包；
  Windows 回退逻辑已有自动化测试，脚本语法与生产构建已通过。
- 智能/混合检索的真实外部模型调用依赖用户配置的模型服务；本轮完成了契约、
  单元和集成测试，真实浏览器烟测使用不产生模型费用的精确模式。
