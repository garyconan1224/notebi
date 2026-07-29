# 项目地图：架构 + 常用命令 + 端口 + MCP

> 本文件由 `CLAUDE.md` §7 索引指向。**新人入门、改路由、找模块入口时必读。**

---

## 1. 常用命令

### 1.1 首次安装（只需一次）

```bash
./start-notebi.command
```

自动检测/安装 brew、Python 3.10+、ffmpeg、Node、pnpm，创建 `.venv`，装依赖，清端口，并行起后端 + 前端。日志写到 `.local/backend.log` 与 `.local/frontend.log`。

### 1.2 日常快速启动 ← AI 测试用这个

```bash
./dev-notebi.sh      # 跳过安装；自动读 .env 端口、杀旧进程、起前后端、轮询健康检查
./stop-notebi.command # 停止所有服务
```

`dev-notebi.sh` 会先准备 NoteBi 环境，再交给 `dev.sh` 做健康探测（轮询 `/health` + 前端 200）。  
**端口**从 `.env` 读取（NoteBi 默认 `BACKEND_PORT=8001`，`VITE_PORT=5181`）——**不要在命令里硬编码端口**。

验证服务已就绪（在 `dev.sh` 已确认的前提下也可手动再查）：

```bash
# 一行读 .env 端口 + 同时探两端
BPORT=$(grep -E '^BACKEND_PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '"' | tr -d "'"); BPORT=${BPORT:-8001}
FPORT=$(grep -E '^VITE_PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '"' | tr -d "'"); FPORT=${FPORT:-5181}
curl -s "http://localhost:$BPORT/health"
curl -so /dev/null -w "%{http_code}" "http://localhost:$FPORT/"
```

### 1.3 单独启动（调试时用）

```bash
# 后端（端口看 .env BACKEND_PORT，默认 8001）
.venv/bin/uvicorn backend.app.main:app --reload --port "${BACKEND_PORT:-8001}"

# 前端（端口看 .env VITE_PORT，默认 5181）
cd frontend && pnpm dev
```

### 1.4 测试 / 检查

```bash
# 后端测试（CI 用同样命令）
.venv/bin/python -m pytest tests/backend -q
# 单文件 / 单用例
.venv/bin/python -m pytest tests/backend/test_xxx.py -q
.venv/bin/python -m pytest tests/backend/test_xxx.py::test_foo -q

# 前端
cd frontend && pnpm lint        # ESLint
cd frontend && pnpm test        # vitest
cd frontend && pnpm build       # tsc -b && vite build

# 启动前自检（端口、依赖、.env）
.venv/bin/python scripts/preflight_check.py

# 端到端验收
.venv/bin/python tests/e2e_qa.py

# 浏览器结构化冒烟（优先于读取截图）
.venv/bin/python scripts/browser_smoke.py --url http://localhost:${VITE_PORT:-5181}/library --library --screenshot /tmp/notebi-library.png
.venv/bin/python scripts/browser_smoke.py --url http://localhost:${VITE_PORT:-5181}/taskboard --taskboard
.venv/bin/python scripts/browser_smoke.py --url http://localhost:${VITE_PORT:-5181}/processing/<task_id> --processing
```

> 注：本仓库使用项目内 `.venv` 作为标准 Python 入口。新增后端测试时遵循「每个端点 1 个 happy path + 1 个错误路径」。

---

## 2. 高层架构

### 2.1 后端（`backend/app/`）

- 入口 `backend/app/main.py`：模块顶层就 `load_dotenv` 根目录 `.env`（保证 router 模块导入时也能读到环境变量），挂 9 个 router：
  - `/providers`（providers.py，模型供应商配置）
  - `/pipeline`（pipeline.py，任务中心；含 SSE `…/events` 和 `…/ws`）
  - `/transcript`（transcript.py，字幕/转写）
  - `/rag`（rag.py，向量检索问答）
  - `/workspaces`（workspaces.py，工作区/项目）
  - `/admin`（admin.py）
  - `/api`（notes.py，bilinote 兼容接口）
  - 无前缀：`download_config.py`、`transcriber_config.py`
- `lifespan` 钩子在启动时把 `.env` 里的 `SILICONFLOW_API_KEY` 自动 seed 成一个 ProviderProfile（写进 `shared/settings_store`）。
- CORS 白名单通过 `_build_cors_origins()` 动态生成，优先级：`CORS_ALLOW_ORIGINS` > `VITE_PORT` 推导 > 5177 兜底。
- **任务执行**：`backend/app/services/task_runner.py` 是基于 `ThreadPoolExecutor` 的后台执行器，task 记录写 `task_store`；同 project + 同 URL 的下载任务做幂等去重；状态变化通过 SSE / WebSocket 推给前端。

### 2.2 前后端共享层（`shared/`）

- 这是 **FastAPI 后端 + React 前端 + Streamlit 旧前端 + 命令行脚本共用的代码**。
- **改 `shared/` 里的东西会同时影响多个入口，先评估影响面**。
- 关键模块：
  - `settings_store.py`（providers/global settings 持久化）
  - `api_key_resolver.py`（多源 API Key 优先级）
  - `knowledge_base.py`（RAG 索引）
  - `video_analyzer.py`（视频分析编排）
  - `video_download_ytdlp.py`（yt-dlp 封装）
  - `web_enrich.py`

### 2.3 前端（`frontend/src/`）

- **路由**：`router.tsx` 用 React Router v7 Data Router，**所有页面级组件都走 `React.lazy` 代码分割**（动手加新页面时记得也包一层 `withSuspense`）。
- **状态**：zustand，`store/` 下有 6 个 store：`configStore` / `modelStore` / `projectStore` / `providerStore` / `settingsShellStore` / `taskStore`。
- **服务层**：`services/client.ts` 封装 axios；`services/events.ts` 处理 SSE；其它对应后端各 router。
- **Vite 代理**：`/api` 与 `/pipeline` 都被代理到后端（看 `vite.config.ts`），所以前端代码里写相对路径就行，不用拼 base URL。
- **构建**：`vite.config.ts` 用 rolldown `codeSplitting.groups` 手动拆 vendor chunk（react / radix / markmap / markdown 等），改依赖时如果引入了大包，考虑加进对应 group。
- **i18n**：`locales/i18n.ts` + `i18next-parser.config.js`，文案改动后跑 `i18next-parser` 抽 key。

### 2.4 运行时数据（`data/`，默认不应新增入库）

- `cookies/`（B 站 cookies）、`videos/`（下载产物）、`json_data/`（分析结果）、`projects/` 和 `workspaces/`（工作区数据）。
- **不要把这里的新文件 commit 进 git**，也不要假设它在新机器上存在。
- 已有 tracked 工作区 JSON 如需清理，应单独确认范围。

### 2.5 双前端并存（legacy 兼容期）

- `frontend/`（React，推荐 / 默认入口）
- `app.py` + `pages/`（Streamlit，legacy 入口，**新功能不要往这边加**）

---

## 3. 端口与环境变量（关键约定）

- 单一来源 `.env`，前后端都读它：
  - `BACKEND_PORT`（NoteBi 默认 8001）
  - `VITE_PORT`（NoteBi 默认 5181）
- 前端编译时通过 `VITE_BACKEND_BASE_URL` 知道后端地址（`start.sh` 启前端前会注入）。
- README_NOTEBI、`start-notebi.command` 和 `start.sh` 应保持同一默认端口；如本机 `.env` 覆盖端口，**以 `.env` 实际值为准**。

---

## 4. CodeGraph 语义检索（MCP）

本项目已初始化本地代码知识图谱 CodeGraph（已配置 `.gitignore` 过滤 `.codegraph/` 缓存）。

### 4.1 Claude Code 终端版接入步骤

1. **添加 MCP 服务**：在终端运行以下命令，将 CodeGraph 注册到 Claude Code：

   ```bash
   claude mcp add codegraph npx -- -y @colbymchenry/codegraph serve --mcp
   ```

2. **验证状态**：运行以下命令确认已成功添加并处于可用状态：

   ```bash
   claude mcp list
   ```

### 4.2 日常使用建议

- 寻找函数调用关系或评估改动影响时，鼓励**优先使用** `codegraph_callers`、`codegraph_callees` 和 `codegraph_impact`，代替昂贵的全项目 grep 搜索与大文件 view 动作。
- 每次代码改动后，在终端运行 `npx @colbymchenry/codegraph sync`（或依靠其内置的文件监听器）以保持图谱数据最新。
