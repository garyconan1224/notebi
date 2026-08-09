# NoteBi 测试体系全面审查报告

> 调查日期：2026-08-03
> 调查方式：只读调查，未修改任何代码
> 当前分支：`codex/continue-product-redesign`（181 commits，无远程仓库）
> 启动检查：git 状态干净（仅 6 个未跟踪的前端测试文件，属当前 redesign 工作）

---

## 测试执行实测结果（本次调查实际运行）

| 套件 | 命令 | 结果 | 耗时 |
|------|------|------|------|
| 后端（tests/backend + backend/tests + 根目录 10 个文件） | `pytest -m "not integration"` | **1410 通过 / 2 跳过 / 0 失败** | 74 秒 |
| 前端 | `vitest run` | **497 通过 / 0 失败** | 12.9 秒 |
| 遗留 e2e 脚本 | `python tests/e2e_qa.py` | **崩溃**：`ModuleNotFoundError: No module named 'cv2'` | - |

结论：活跃测试套件全绿、速度快，基本盘健康。问题集中在**覆盖盲区、CI 覆盖不全、遗留资产失效、上游修复未同步**四个方面。

---

## 第一部分：测试问题排查（按功能模块分类）

### 1.1 后端服务层（backend/app/services/）

| 编号 | 问题 | 位置 | 严重程度 | 原因与影响 |
|------|------|------|----------|-----------|
| B-1 | **local_model_manager.py 零测试** | `backend/app/services/local_model_manager.py` | **P1** | 本地模型下载/状态管理是核心功能，无任何测试；且其代码仍在用已被 HuggingFace 下架的 `Systran/faster-whisper-large-v3-turbo`（见第三部分），下载该模型必然失败，无测试兜底 |
| B-2 | **web_search.py 零测试** | `backend/app/services/web_search.py` | P1 | 联网检索服务（DuckDuckGo）无测试，网络异常/超时/空结果路径无验证 |
| B-3 | **subtitle_fetcher.py 零测试** | `backend/app/services/subtitle_fetcher.py` | P1 | 字幕获取是内容管线入口，平台接口变更（如 B 站风控）时无法回归 |
| B-4 | **asr_groq.py 零测试** | `backend/app/services/asr_groq.py` | P2 | Groq 转写后端无测试（对比：asr_fast_whisper / asr_mlx_whisper / asr_hardware / asr_router 均有测试，ASR 家族覆盖不一致） |
| B-5 | **search_index_store.py 零测试** | `backend/app/services/search_index_store.py` | P2 | 检索索引存储无直接测试（部分被 retrieval 相关测试间接覆盖） |
| B-6 | **batch_source_resolver.py 零测试** | `backend/app/services/batch_source_resolver.py` | P2 | 批量素材来源解析无测试 |
| B-7 | demo 模块无测试 | `audio_result_demo.py` / `video_result_demo.py` | P2 | 演示数据模块，影响小 |

注：routes 层 20 个路由模块全部有测试引用，downloaders 3 个模块全部有测试引用，API 层覆盖完整，这是做得好的地方。

### 1.2 后端 API/集成层（tests/backend/）

| 编号 | 问题 | 位置 | 严重程度 | 原因与影响 |
|------|------|------|----------|-----------|
| B-8 | **超大测试文件职责过重** | `tests/backend/test_pipeline_tasks.py`（2445 行）、`test_workspaces_api.py`（1606 行） | P2 | 单文件过大导致定位失败慢、并行度受限、review 困难；建议按子功能拆分 |
| B-9 | 正路径弱断言（仅断言状态码不验内容） | `test_video_templates.py::test_duplicate_custom_template`、`test_task_batches.py::test_delete_terminal_batch`、`test_settings_fonts.py::test_upload_other_allowed_formats`、`test_generate_note.py::test_localhost_with_port_passes`、`test_generate_note.py::test_ip_address_passes` | P2 | 共 5 处（全库扫描结果：61 个纯状态码断言中 56 个属负路径校验 4xx/5xx，做法合理）。正路径只验 200/201 不验响应体，接口返回结构变更时测试仍绿 |
| B-10 | 测试命名使用内部代号 | `test_r3_11_embed_frames_bridge.py`、`test_n7b_path3_gemini_skeleton.py`、`test_audio_a3.py`、`test_r3_1_media_note.py`、`test_q5_batch_type_writeback.py` | P2 | "r3_11"/"n7b"/"a3"/"q5" 等代号无语义，半年后无人能懂测试意图；建议重命名为功能描述式 |

### 1.3 前端（frontend/src/__tests__/）

| 编号 | 问题 | 位置 | 严重程度 | 原因与影响 |
|------|------|------|----------|-----------|
| F-1 | **页面级覆盖缺口大** | `frontend/src/pages/` 下 98 个页面/子组件文件中 **64 个无直接测试** | **P1** | 重点缺口：`WorkbenchPage`（首页 Composer/Hero）、`LibraryPage` 大部分子组件、`TaskboardPage` 9 个 Tab 子组件、`SearchPage` 4 个子组件、`SettingPage` 7 个子页面、`result/TextResultPage`、`result/ImageResultPage`。NoteShell 系列覆盖最充分（9 个测试文件），形成鲜明对比 |
| F-2 | **前端 services 层几乎零测试** | `frontend/src/services/` 25 个 API 客户端模块，仅 `knowledgeStream.ts` 有直接测试 | P1 | `client.ts`（请求基座）、`pipeline.ts`、`workspaces.ts`、`upload.ts` 等核心请求层无测试，请求参数拼装/错误归一化逻辑无保护 |
| F-3 | 关键 hooks 无测试 | `useBackendHealth.ts`、`useHealthPulse.ts`、`useTaskSse.ts`、`useDirtyGuard.ts`、`useSystemStats.ts` | P2 | SSE 事件流与健康检查是实时任务面板的命脉，无测试；对比 `usePipelineTasks`/`useGlobalEta` 已有测试 |
| F-4 | 弱断言模式 | `AddMaterialModal.test.tsx` L218/294-298 等，27 个文件使用 `toBeTruthy()` | P2 | `expect(screen.getByText(...)).toBeTruthy()` 中 getByText 找不到元素本身就会抛错，toBeTruthy 属冗余断言；应改用 `toBeInTheDocument()` 并补充交互/状态断言 |
| F-5 | React act() 警告 | vitest 运行输出中存在 "state updates should be wrapped into act(...)" 警告 | P2 | 存在未包裹的状态更新，可能导致测试偶发不稳定（flaky） |

### 1.4 测试基建

| 编号 | 问题 | 位置 | 严重程度 | 原因与影响 |
|------|------|------|----------|-----------|
| T-1 | **CI 后端覆盖不全** | `.github/workflows/backend-tests.yml` 只执行 `pytest tests/backend` | **P1** | `backend/tests/` 下 51 个服务级测试文件 + 根目录 11 个测试文件**不在 CI 中运行**，本地绿 ≠ CI 覆盖 |
| T-2 | **CI 前端不跑测试** | `.github/workflows/frontend-build.yml` 只执行 `pnpm build` | **P1** | 497 个 vitest 测试完全不在 CI 中，前端回归零保护 |
| T-3 | **遗留 e2e 脚本已失效** | `tests/e2e_qa.py` + `tests/README_QA.md` + `.github/workflows/qa-e2e.yml` | **P1** | 脚本检查 `app.py`/`pages/*.py` 等旧架构（Nibi 时代），当前直接崩溃（缺 cv2）；CI qa-e2e 工作流手动触发后必然失败，属"看起来有 e2e 实际没有"的假资产 |
| T-4 | pytest.ini 配置过薄 | `pytest.ini` | P2 | 仅定义 `integration` marker，无覆盖率阈值（--cov）、无超时控制（pytest-timeout）、无 addopts；覆盖率不可度量 |
| T-5 | e2e 脚本游离于 pytest 之外 | `tests/test_douyin_e2e.py`（main() 脚本，pytest 收集为 0）、`tests/test_xiaohongshu_share.py` | P2 | 以 `test_` 命名却不是 pytest 测试，易误导；真实网络依赖部分应打 `integration` marker 并纳入统一管理 |
| T-6 | 双测试目录组织分裂 | `tests/backend/`（API 级）与 `backend/tests/`（服务级）并存 | P2 | 新人不知道该往哪写；fixture 无法共享（`tests/backend/conftest.py` 的 retrieval_store 无法被 backend/tests 复用） |

---

## 第二部分：优化机会分析

### 2.1 代码结构 / 测试结构

| 建议 | 具体措施 | 预期收益 |
|------|----------|----------|
| 统一测试目录 | 将 `backend/tests/` 合并入 `tests/backend/`（或反向），统一 conftest | fixture 复用、消除组织分裂；预计合并 2 个 conftest、迁移 51 个文件，一次性成本 |
| 拆分超大测试文件 | `test_pipeline_tasks.py`（2445 行）按 pipeline 阶段拆分；`test_workspaces_api.py`（1606 行）按 CRUD/搜索/回收站拆分 | 失败定位时间下降，支持 pytest-xdist 并行（当前 74s 可进一步压缩） |
| 补齐服务层测试 | 优先补 `local_model_manager`（含 HF 模型源回归测试）、`subtitle_fetcher`、`web_search`（mock 网络层） | 消除最大覆盖盲区；模型下载失败态（上游 v2.4.3 新增的 failed 状态透传）可直接以测试驱动对齐 |
| 前端 services 层测试 | 用 msw 或 vi.mock 为 `client.ts`/`pipeline.ts`/`workspaces.ts` 建立请求层测试 | 前后端契约变更时前端可独立回归，减少联调返工 |

### 2.2 性能

| 建议 | 具体措施 | 预期收益 |
|------|----------|----------|
| 测试并行化 | 后端引入 `pytest-xdist`（当前单进程 74s），前端 vitest 已并行 | 后端套件预计压缩至 20-30s，CI 反馈更快 |
| TestClient 复用 | 多个测试文件每个函数都 `TestClient(app)` 新建实例（如 `test_system_stats.py`），可改为模块级 fixture | 减少 app 初始化重复开销 |
| CI 分层 | CI 拆"快速门禁（单元）+ 定时全量（含 integration）"两级 | PR 反馈快，平台依赖类测试（B 站/抖音）定时跑不阻塞 |

### 2.3 可维护性

| 建议 | 具体措施 | 预期收益 |
|------|----------|----------|
| 覆盖率度量 | `pytest.ini` 增加 `--cov=backend --cov=shared` + coverage 报告；前端 vitest 开 coverage | 覆盖缺口从"靠人工盘点"变为"数字看板"，本次发现的 8 个零测试服务可长期监控 |
| 清除/重写遗留资产 | `tests/e2e_qa.py` 要么按新架构（backend/app）重写，要么连同 `qa-e2e.yml` 一起移除 | 消除"假 e2e"误导；CI 不再有必然失败的工作流 |
| 真实 e2e 补位 | 核心链路（导入链接→转写→总结→导出）用 Playwright 建 1-2 条冒烟 e2e | 目前项目无真正端到端测试，跨层回归靠人工 |
| 命名治理 | 代号式测试名（r3_11/n7b/a3/q5）重命名为功能描述式 | 降低认知负担 |

---

## 第三部分：GitHub 更新调研

### 3.1 仓库关系确认

- 本地仓库**无远程**（`git remote -v` 为空），是 **JefferyHcool/BiliNote** 的本地衍生版（证据：`docs/design/bilinote-redesign-notes.md`、`backend/app/routes/notes.py` 中保留 BiliNote 引用）。
- 上游仓库：`github.com/JefferyHcool/BiliNote`，MIT 协议，约 7000 star，最后推送 2026-06-29，开放 issues 186 个。

### 3.2 上游近期版本动态（v2.4.0 → v2.4.4，2026-06 月）

| 版本 | 日期 | 关键更新 | 类型 |
|------|------|----------|------|
| **v2.4.4** | 06-23 | **安全修复：starlette 0.46.1→0.47.2 修复 CVE-2025-54121**（multipart 大文件 rollover 阻塞事件循环可致 DoS），连带 FastAPI 升至 0.116.2 | 安全 |
| v2.4.3 | 06-23 | 新增 Claude Code Review / PR Assistant 两个 GitHub Actions 工作流；**转写模型下载失败态透传**（新增 model_download_state 模块，前端显示"下载失败"红色徽标+重试按钮） | CI + 功能 |
| v2.4.2 | 06-17 | Docker nginx 配置拆分（compose 版与单镜像版分离，修复 80 端口被 nginx 欢迎页劫持） | 部署修复 |
| **v2.4.1** | 06-17 | **B 站 wbi/playurl 412 风控修复**（注入 dm_img 哑值参数）；**分 P 视频字幕未传 p 参数取错集修复**；YouTube Shorts 链接支持 | 平台适配 |
| **（未发版提交）** | 06-23 | **large-v3-turbo 模型源切换**：`Systran/faster-whisper-large-v3-turbo` 已从 HuggingFace 下架（404），改用 `deepdml/faster-whisper-large-v3-turbo-ct2` | 依赖修复 |
| v2.4.0 | 06-06 | 浏览器扩展任务标题展示 + 思维导图高清导出改进 | 功能 |

### 3.3 对本项目的影响评估（逐项核对本地代码）

| 上游更新 | 本地现状 | 影响判定 |
|----------|----------|----------|
| CVE-2025-54121（starlette） | 本地 starlette **1.3.1** / FastAPI **0.139.0**，远超修复版本 | **不受影响**（本地依赖领先上游） |
| large-v3-turbo 模型源下架 | `local_model_manager.py:252` 仍写死 `Systran/faster-whisper-{variant}`，`asr_fast_whisper.py:80` 仍按 Systran 仓库计算大小 | **P1 受影响**：用户下载 large-v3-turbo 必然 404 失败，且无失败态提示（本地无上游的 model_download_state） |
| B 站 dm_img 风控参数 | `backend/app/downloaders/bilibili_nocookie.py` 的 wbi 签名逻辑中**未发现 dm_img 注入** | **P1 潜在受影响**：B 站 wbi/playurl 网关新增风控后，缺失 dm_img 参数会返回 HTTP 412，下载链路可能已失效或随时失效 |
| 分 P 视频字幕 p 参数 | 未核对到本地的 `extract_bilibili_p_number` 等价实现 | **待验证**：建议实测分 P 链接（?p=N）字幕是否取对集 |
| Docker nginx 修复 | 本地无 Dockerfile/nginx 配置（本地优先，源码模式运行） | 不适用 |
| YouTube Shorts 支持 | 未核对 | 待验证（低优先级） |
| Claude Actions CI | 本地 `.github/workflows/` 有 4 个工作流但无 AI review 类 | 可选项，可借鉴上游的 PR review 工作流 |

**结论**：本地依赖版本领先上游（无 CVE 风险），但**两处平台适配修复（模型源、B 站风控）未同步**，都是用户会真实踩到的功能故障。

---

## 第四部分：综合改进建议（按优先级排序）

### P1 — 建议尽快处理

1. **同步上游两处平台修复**
   - `local_model_manager.py` 模型源切换为 `deepdml/faster-whisper-large-v3-turbo-ct2`（或允许用户配置 HF 镜像），并为模型下载失败态补错误透传；
   - `bilibili_nocookie.py` wbi 签名前注入 dm_img 哑值参数，实测验证 B 站下载链路是否已受 412 影响。
2. **修复 CI 覆盖缺口**（`.github/workflows/`）
   - `backend-tests.yml`：`pytest tests/backend` → `pytest tests/backend backend/tests tests/test_*.py -m "not integration"`；
   - `frontend-build.yml`：增加 `pnpm test`（vitest）步骤；
   - `qa-e2e.yml`：移除或先禁用（其执行的 `tests/e2e_qa.py` 已崩溃）。
3. **补齐三大覆盖盲区测试**
   - 后端：`local_model_manager`、`subtitle_fetcher`、`web_search`（8 个零测试服务中的前三）；
   - 前端：`services/client.ts` 请求基座 + WorkbenchPage/LibraryPage 主流程页面。

### P2 — 中期规划

4. **依赖管理规范化**：`requirements.txt` 目前 40 个 `>=`、仅 1 个 `==`，无任何锁定文件 → 引入 `pip-compile`（pip-tools）或 `uv` 生成 lock 文件，保证可复现构建；上游就是因为依赖未锁而在 CVE 修复时需要同步升 FastAPI。
5. **测试基建升级**：pytest.ini 增加覆盖率（--cov=backend --cov=shared --cov-report）+ pytest-timeout；引入 pytest-xdist 并行；统一 tests 双目录。
6. **建立真实 e2e 冒烟**：用 Playwright 覆盖"导入→转写→总结→导出"一条主链路，替代已失效的 `e2e_qa.py`。
7. **建立上游同步机制**：添加 upstream remote，定期 `git fetch upstream && git log HEAD..upstream/master` diff 平台适配类提交（downloaders/transcriber 目录），避免再次漏同步。

### P3 — 锦上添花

8. **测试命名治理**：代号式测试（r3_11/n7b/a3/q5）重命名为功能描述式。
9. **前端弱断言清理**：`toBeTruthy()` 冗余断言改为 `toBeInTheDocument()` + 行为断言；处理 act() 警告防 flaky。
10. **配置规范**：根目录 conftest 用 tempfile 隔离 `NOTEBI_DATA_DIR` 的做法正确，建议补一份 `.env.example` 明确所有可配置项（模型服务、数据目录、端口），与 `local_settings.example.py` 统一。

---

## 附：调查方法与数据来源

- 后端测试：`pytest tests/backend backend/tests tests/test_*.py -m "not integration"` 实测 1410 通过
- 前端测试：`vitest run` 实测 497 通过
- 覆盖映射：源码模块名 ↔ 测试文件内容引用的脚本化比对 + 人工复核间接覆盖
- 弱断言扫描：按测试函数切分后分析断言构成，区分正/负路径
- GitHub 调研：上游仓库 API（releases/commits）+ 本地代码逐项 grep 核对
- 全程未修改任何代码文件
