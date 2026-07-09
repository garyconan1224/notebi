# 详细计划：导航调整 + 全局知识库问答页 + 嵌入/重排模型可配置

> 日期：2026-07-02　分支：建议新切 `feat/global-knowledge`
> 作者：Claude（终端，已实测调研）　执行：小米　审查：Codex
> 用户已拍板：
> - 知识库定位：**全局问答（跨所有笔记/合集）**，本轮不做「导入外部 PDF/论文」。
> - 嵌入+重排：**本轮只做「设置页可配置」，以 API 为主**；本地离线模型以后再说。
> - 导航：删「资料库」，把「知识库」提到顶部主导航。
> - 复刻：**本轮不动**。

三个任务：A(导航) → C(模型可配置，B 的前置) → B(全局知识库页)。建议 C 在 B 前做，因为 B 依赖可配置的嵌入/重排。

---

## 调研结论（现状，Claude 已核实代码）

- RAG 能力**已完整存在**，只是没独立页、不可配置：
  - `shared/knowledge_base.py`：faiss(IndexFlatIP) 向量索引 + 嵌入 + 重排两段式检索。
  - `shared/sf_client.py`：`create_embeddings` / `rerank_documents`，走 `get_openai_compat_base_url()`（OpenAI 兼容接口，当前硅基流动）。
  - `backend/app/services/workspace_knowledge.py`：**按 workspace** 建 FAISS 索引，缓存到 `data/.local/embeddings/`，按 `workspace_id + items_hash` 命中缓存。
  - 合集详情的「知识库 Tab」(`KnowledgeQATab`) 就是调它做**单合集**问答。
- 模型解析（`shared/runtime_llm_config.py`）：
  - `embedding_model` 设置字段 + 解析**已存在**（`get_embedding_model_for_rag`，回落常量 `EMBEDDING_MODEL`）。
  - `Capability` 已声明 `"rerank"`，但 `cap_map` / `get_default_model_for` **只处理 chat/vision/embedding**，**rerank 未接线**；重排模型目前写死常量 `RERANKER_MODEL = "BAAI/bge-reranker-v2-m3"`（`shared/config.py`）。
- 侧栏（`frontend/src/layouts/AppShell.tsx`）：
  - `NAV_ITEMS`(顶部)：home / notes / replicas / **library**。
  - `BOTTOM_ITEMS`(底部)：storyboard / favorites / **knowledge(`path:'#'`, placeholder:true)** / director(placeholder) / search / settings。
  - 即「知识库」现在是**空占位**，无页面。

> 你现用的 BGE-M3 + bge-reranker-v2-m3 正是 2026 业界主流 RAG 组合，选型没问题；本轮补「可配置 + 全局页」。

---

## 任务 A：导航调整——删「资料库」，「知识库」提到顶部主导航

文件 `frontend/src/layouts/AppShell.tsx` + `frontend/src/router.tsx`。

1. `NAV_ITEMS`（顶部）：
   - **删除 `library` 项**（`{ id:'library', path:'/library', ... }`）。
   - **新增 `knowledge` 项**到顶部：`{ id:'knowledge', path:'/knowledge', icon: BookOpen, label:'知识库' }`（放在 replicas 之后）。
2. `BOTTOM_ITEMS`（底部）：**删除原 `knowledge` 占位项**（`path:'#'`, placeholder）。
3. `isActive`：给 knowledge 加激活判断（`location.pathname.startsWith('/knowledge')`）。
4. `router.tsx`：
   - 新增路由 `{ path: 'knowledge', element: withSuspense(<KnowledgePage />) }`（KnowledgePage 见任务 B）。
   - `/library` 路由**保留**（LibraryPage kind=undefined 仍可直达，只是不在导航里；避免有旧链接/入口 404）。若确认无其它入口引用，可后续再删。
5. 核对：其它地方跳 `/library` 的入口（如结果页「返回资料库」）——保留能用即可，本任务不改它们。

### 验收
- 侧栏顶部：首页/笔记/复刻/**知识库**；底部不再有知识库占位；无「资料库」入口。
- 点知识库进 `/knowledge`（任务 B 页面）；`cd frontend && npm run build` 通过。

---

## 任务 C：嵌入 + 重排模型设置页可配置（API 为主，B 的前置）

### C-1 后端：把 rerank 接进模型解析
文件 `shared/runtime_llm_config.py` + `shared/settings_store.py`(AppSettings) + `shared/config.py`。
- `AppSettings` 增加 `rerank_model: str = ""` 字段（对齐现有 `embedding_model` 字段）。
- `runtime_llm_config.py`：
  - `_profile_for_capability` 的能力优先链、`cap_map`、`get_default_model_for` 都补上 `"rerank"` 分支。
  - 新增 `get_reranker_model_for_rag(settings)`：返回 `settings.rerank_model` 非空则用之，否则回落 `RERANKER_MODEL` 常量（与 embedding 的写法完全对称）。
- `shared/knowledge_base.py` / 调用 `rerank_documents` 的地方：把写死的 `RERANKER_MODEL` 改成读 `get_reranker_model_for_rag()`；嵌入同理确认走 `get_embedding_model_for_rag()`（若还有写死处）。

### C-2 后端：设置读写支持这两个字段
- `backend/app/routes/` 里读写 AppSettings 的设置接口（models 相关）确保 `embedding_model` / `rerank_model` 可读可写（对齐 chat/vision 模型的读写路径）。

### C-3 前端：设置→模型管理 暴露选择入口
文件 `frontend/src/pages/SettingPage/ProvidersAndModelsPage.tsx`（「模型管理」Tab）。
- 在模型管理里新增两个选择项：**嵌入模型**、**重排模型**（与 chat/vision 模型选择同一套 UI/交互）。
- 数据源：可选模型来自已启用的 openai_compatible provider（与现有模型下拉一致）；保存写入 `embedding_model` / `rerank_model`。
- 加一句说明文案：「用于知识库/合集问答的向量检索与重排；留空则用默认 BGE-M3 / bge-reranker-v2-m3」。

### 红线
- 不改 `sf_client` 的接口签名，只把「用哪个 model」从常量改成读配置。
- 留空必须回落默认常量，**不能因为没配置就报错/检索失效**（回归现有合集知识库 Tab）。

### 验收
1. 设置→模型管理能看到并保存 嵌入/重排 模型；`curl` 设置接口能读到新字段。
2. 合集知识库 Tab 问答仍正常（回归）；改成别的嵌入/重排模型后，问答走新模型（看后端日志 model 名）。
3. 留空时回落默认、功能不受影响。

---

## 任务 B：全局知识库问答页（跨所有笔记/合集）

### 目标
`/knowledge` 页：把**所有非 trashed 工作空间的 items 分析产物**索引成一个全局向量库，在这里跨合集提问，答案带来源（属于哪个合集/素材，可点跳）。

### B-1 后端：全局知识服务 + 路由
- 新增 `backend/app/services/global_knowledge.py`（**复用** `shared/knowledge_base.py` 的 chunk/embed/faiss/rerank，不重造）：
  - `collect_all_json_paths()`：遍历 `workspace_store.list_all(include_trashed=False)`，汇总每个 workspace 的 item 分析 JSON（复用 `workspace_knowledge.collect_workspace_json_paths` 的逻辑，聚合所有）。
  - 建全局 FAISS 索引，缓存到 `data/.local/embeddings/__global__`，缓存键 = 所有 items_hash 的聚合 hash（任一合集变动即失效重建）。
  - `ask_global(question, ...)`：向量检索 + 重排 + LLM 合成，返回 `{answer, sources:[{workspace_id, workspace_name, item_id, item_name, snippet, score}]}`。
- 新增路由（建议 `backend/app/routes/knowledge.py`）：
  - `POST /knowledge/ask` → `ask_global`。
  - `GET /knowledge/status` → 索引是否已建、覆盖多少 items/合集、上次构建时间。
  - `POST /knowledge/rebuild` → 强制重建（可选，给「刷新索引」按钮）。
- **性能红线**：全局索引可能覆盖很多 items，首次构建要调大量嵌入 API → 必须：
  - 增量缓存（已嵌入的 chunk 不重复嵌入）；构建放后台任务或带进度，不要阻塞请求线程（参考现有 pipeline task / 或流式返回）。
  - `/knowledge/ask` 命中缓存索引时应快速返回；索引未就绪时返回明确状态让前端提示「正在建立索引」。

### B-2 前端：`/knowledge` 页面
- 新增 `frontend/src/pages/KnowledgePage/`：
  - 顶部：标题 + 索引状态（覆盖 N 个合集 / M 个素材 · 上次更新）+「刷新索引」按钮。
  - 主体：问答对话 UI（**复用 `KnowledgeQATab` 的交互/样式**，改成调 `/knowledge/ask`）。
  - 答案下方展示**来源卡**：合集名 + 素材名 + 片段，点击跳对应结果页。
  - 空态：无任何笔记时提示「先去做几篇笔记，知识库会自动收录」。
- 服务层 `frontend/src/services/knowledge.ts`：`askGlobal` / `getStatus` / `rebuild`，超时给足（问答/重排慢，参考 summaries 的 180s）。

### 红线
- 复用现有 RAG 组件（knowledge_base / sf_client / KnowledgeQATab UI），不重写检索。
- 全局索引构建**不可阻塞事件循环 / 不可每次提问全量重嵌入**；必须缓存 + 增量。
- 嵌入/重排模型走任务 C 的配置解析（不写死）。

### 验收
1. `/knowledge` 能提问，答案跨多个合集，带来源卡且点击可跳。
2. 首次构建有进度/状态提示，不卡死；第二次提问秒回（命中缓存）。
3. 新增一篇笔记后，索引状态能反映变化（或点「刷新索引」后纳入）。
4. `cd frontend && npm run build` 通过；后端 `pytest`（若加了测试）通过。

---

## 给小米的红线（通用）
- 后端验证前确认**新进程**；前端一律 `npm run build` 核对。
- 任务 C 留空必须回落默认常量，不能让现有合集知识库 Tab 挂掉（重点回归）。
- 任务 B 严禁「每次提问全量重嵌入」或阻塞请求线程；必须增量缓存 + 后台/流式构建。
- 复用现有 RAG 代码，不重造检索管线。
- 每个任务独立 commit（A / C / B 分开），写清任务号 + 附实测证据（问答截图/日志 model 名/构建耗时）。
- 不装新依赖（本轮不做本地离线模型，无需 FlagEmbedding/sentence-transformers）；如发现必须装，停下问用户。
- 不改 `.env`、不 `git push`。
