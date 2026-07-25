# 智能检索、内容库与收藏夹总体执行计划

> 日期：2026-07-25
> 状态：总体计划（待按阶段分别授权执行）
> 决策来源：`knowledge-favorites-search-research-2026-07-23.md`
> 执行原则：单 Agent 串行；每阶段独立测试、独立 commit、独立 Codex 复审；不主动 push

---

## 0. 计划结论

这项工作不应作为一次“大重构”执行。推荐拆成四个可独立交付的里程碑、八个串行阶段：

| 里程碑 | 阶段 | 用户可见结果 |
|---|---|---|
| M1：统一检索体验 | Phase 0–2 | 侧栏只剩“智能检索”；AI 回答、引用原文、跳转和收藏形成闭环 |
| M2：精确查找 | Phase 3 | 可搜索准确人名、术语、型号和原句，不调用 AI 回答 |
| M3：内容身份与管理 | Phase 4–5 | 复制内容可独立修改；可查看同源副本；标签/文件夹/收藏关系不串数据 |
| M4：正文历史与发布收口 | Phase 6–7 | 用户笔记正文可回看/恢复；完成混合检索、性能、Windows 和浏览器验收 |

推荐优先完成 M1 和 M2。它们能先解决当前最明显的入口重复和关键词不可用问题，而且不要求立即迁移全部用户元数据。

M3 涉及内容身份和数据迁移，必须等 M1/M2 稳定后单独确认、备份和执行。M4 的正文版本策略也需要在 Phase 6 开始前再确认一次版本生成时机。

---

## 1. 总目标与完成定义

### 1.1 总目标

1. 将当前“知识库”和“搜索”收敛为一个“智能检索”入口；
2. 默认输出 AI 综合回答和可核验、可定位、可收藏的来源；
3. 增加不调用 AI 的本地精确查找；
4. 让内容复制到其他合集后拥有独立副本，同时保留同源关系；
5. 让内容库承担标签、文件夹、同源副本和笔记正文版本管理；
6. 保留现有 AI 总结版本、音视频/图片/文本笔记、导出和本地优先能力。

### 1.2 最终完成定义

- 侧栏不再同时出现“知识库”和“搜索”；
- `/search` 是“智能检索”主入口；
- `/knowledge` 在兼容期内跳转到 `/search`，旧书签不报错；
- 智能检索回答中的 `[1]`、`[2]` 能定位唯一来源卡片；
- 来源能展开上下文并跳到正确内容；具备时间信息时可定位媒体时间点；
- 来源可一键收藏，收藏夹立即回显；
- 精确查找不调用 LLM，能处理约定的中英文、数字和型号样例；
- 内容复制后拥有独立身份，一个副本的修改不覆盖其他副本；
- 同源副本可查看、打开和手动采用，但不自动合并；
- 用户笔记正文可回看与恢复，恢复操作本身生成新版本；
- AI 总结继续使用现有 `item.summaries` 版本，不迁入第二套版本系统；
- SQLite 索引损坏后可从权威数据重建；
- macOS 开发环境和 Windows 离线运行时均验证 SQLite/FTS 能力；
- 所有迁移均有 dry-run、备份、校验、幂等和回滚边界。

---

## 2. 已确认产品决策

以下内容已确认，执行阶段不再重复讨论：

1. 一个智能检索页面；
2. 默认显示“AI 综合回答 + 可跳转原文来源”；
3. “精确查找”是另一种检索方式，不是另一个结果标签页；
4. 回答引用可定位来源，来源可展开上下文、跳转和收藏；
5. 复制到其他合集后可以独立修改；
6. 可查看其他合集中的同源副本和版本；
7. 同源副本不自动互相覆盖；
8. 新增版本控制先覆盖用户手工编辑的笔记正文；
9. AI 总结继续使用现有版本机制。

---

## 3. 当前事实与计划约束

### 3.1 当前数据

2026-07-25 只读统计：

- 44 个 workspace JSON；
- 61 条“合集—素材”记录；
- 60 个唯一 `item_id`；
- 已有 1 个 `item_id` 跨两个合集复用；
- 17 条素材已有自动标签；
- 41 个 AI 总结版本；
- 9 条素材已有多个 AI 总结版本；
- 当前收藏记录为 0。

### 3.2 当前存储

- Workspace 和 Item 的权威存储是 JSON；
- 当前没有业务 SQLite / SQLAlchemy 数据层；
- 旧 `docs/EXECUTION_PLAN.md` 的 Phase 2D 结论是“暂不把整体存储切到 SQLite”；
- 本计划与该结论兼容：Phase 3 只把 SQLite 用作可重建搜索索引；
- Phase 5 若要把标签/文件夹/收藏改为 SQLite 权威元数据，必须再次获得用户确认。

### 3.3 当前检索

- 知识库问答和搜索都已使用向量检索与 reranker；
- 跨合集搜索还会在候选汇总后做一次二次精排；
- 知识库使用全局/范围缓存和显式状态/刷新；
- 搜索使用分合集索引、并行召回和跨合集合并；
- 需要统一的是查询契约、索引生命周期和排序策略，不是简单“给知识库加 reranker”。

### 3.4 当前测试

已有基础后端测试：

- `tests/backend/test_knowledge_api.py`
- `tests/backend/test_global_search.py`
- `tests/backend/test_workspaces_search.py`
- `tests/backend/test_workspace_knowledge.py`
- `tests/backend/test_favorites_api.py`

主要缺口：

- SearchPage / KnowledgePage / FavoritesPage 前端行为；
- 回答引用与来源编号映射；
- `/knowledge` 兼容跳转；
- 来源展开、媒体定位与收藏闭环；
- 智能/精确模式切换；
- 数据身份迁移、同源副本和正文版本；
- Windows FTS 能力与索引重建。

---

## 4. 总体架构决策

### 4.1 检索编排：统一 service，保留兼容 API

推荐新增统一检索编排层，主契约使用：

```text
POST /search
mode = smart | exact
```

兼容期内：

- `/knowledge/ask` 作为适配器调用统一编排层；
- `/knowledge/status` 和 `/knowledge/rebuild` 暂时保留；
- `/knowledge` 前端路由跳转 `/search`；
- 稳定一个发布周期后，再单独决定是否删除旧后端 API。

### 4.2 向量索引：以 workspace 为缓存单元

推荐方向：

- 每个 workspace 独立构建/缓存索引；
- 查询多个 workspace 时并行召回；
- 汇总候选后只做一次跨合集 rerank；
- 全局状态由各 workspace 索引状态聚合；
- 内容变化时只重建受影响 workspace；
- 不再为任意 workspace 组合生成大量独立“范围子缓存”。

原因：

- 与合集范围筛选天然一致；
- 避免所选合集组合变化导致缓存数量膨胀；
- 单个合集更新时不必重建全部内容；
- 更容易与 FTS 的 workspace/content filter 对齐。

Phase 0 必须先用现有 44 个合集做小型基准。如果全局缓存明显更快或分合集索引存在无法接受的资源开销，应停下报告，不得为了符合计划强行替换。

### 4.3 SQLite：先派生索引，后权威元数据

第一步：

- JSON 仍是内容权威来源；
- SQLite 仅存放可删除、可重建的 FTS 索引与索引元数据；
- 不要求 SQLAlchemy，优先使用 Python 标准库 `sqlite3`。

第二步：

- 内容身份稳定后，才评估将标签、文件夹、收藏分组、正文版本迁入 SQLite；
- 每个字段只能有一个权威来源；
- JSON 若保留对应字段，只能作为导入导出或兼容快照，不能双向写入。

### 4.4 内容身份：独立副本 + 同源谱系

现有 `(workspace_id, item_id)` 可定位一条合集内记录，但 `item_id` 不是全局唯一。计划引入：

```text
content_id：每个独立副本的稳定身份
lineage_id：同源副本共享的谱系身份
legacy_item_id：兼容旧路由和旧文件路径
```

迁移原则：

- 不直接批量重命名旧媒体、笔记目录或任务 ID；
- 每个现有 `(workspace_id, item_id)` 生成唯一 `content_id`；
- 旧 `item_id` 相同的记录归到同一个 `lineage_id`；
- 新复制行为创建新的 `content_id` 和副本数据，沿用 `lineage_id`；
- 一个副本删除、编辑、收藏或恢复，不影响其他副本。

### 4.5 正文版本：会话级完整快照

推荐默认策略：

- 现有自动保存继续更新当前正文；
- 编辑会话第一次修改前保存“修改前”快照；
- 内容稳定一段时间或离开页面时保存“本次编辑后”快照；
- 按内容 hash 去重，相同正文不重复生成版本；
- 恢复旧版本时不覆盖历史，而是生成一个新的当前版本；
- 第一版不自动清理旧版本，避免未确认的数据删除。

Phase 6 开始前需要让用户确认“版本生成时机”；不得在每次编辑器 debounce 自动保存时都创建版本。

---

## 5. 阶段依赖

```text
Phase 0 现状契约与基准
   ↓
Phase 1 统一后端检索编排
   ↓
Phase 2 统一智能检索页面与收藏闭环
   ↓
Phase 3 FTS5 精确查找
   ↓
Phase 4 内容身份与同源谱系
   ↓
Phase 5 标签/文件夹/收藏权威元数据
   ↓
Phase 6 正文版本与同源副本查看
   ↓
Phase 7 混合检索、性能与发布验收
```

项目遵守单 Agent 串行原则，不安排并行实现。每个阶段完成并复审后再进入下一阶段。

---

## 6. 分阶段执行计划

## Phase 0：锁定现状契约与性能基准

### 目标

先证明当前行为是什么，并确定统一检索编排采用哪种索引策略。本阶段不改变用户可见行为。

### 要做的调整

1. 保留并补强现有知识库、全局搜索、工作区搜索和收藏 API 测试；
2. 新增统一的测试数据 fixture，包含：
   - 多合集；
   - 相同关键词；
   - 相同 `item_id` 跨合集；
   - 有/无转写、总结、笔记正文；
   - 收藏与未收藏；
3. 记录全局缓存与分 workspace 缓存的：
   - 首次构建时间；
   - 缓存命中查询时间；
   - 选定 1/5/全部合集时的查询时间；
   - reranker 调用次数；
   - 缓存文件大小；
4. 固化当前 `/knowledge/ask`、`/search` 响应字段；
5. 明确来源中的时间信息目前是什么格式，以及能否转为 `start_ms/end_ms`；
6. 写出统一请求/响应契约的失败测试。

### 主要文件

- `tests/backend/test_knowledge_api.py`
- `tests/backend/test_global_search.py`
- `tests/backend/test_workspaces_search.py`
- `tests/backend/test_workspace_knowledge.py`
- `tests/backend/test_favorites_api.py`
- 建议新增 `tests/backend/test_retrieval_contract.py`
- 建议新增只读 benchmark 脚本，放入 `scripts/`

### 完成条件

- 现有测试基线通过；
- 有可复现的性能数据，不凭代码猜索引策略；
- 统一契约的失败测试已建立；
- 明确选择“workspace 缓存单元”或保留全局缓存，并记录理由。

### 强制停点

- 实测显示推荐索引策略明显更慢或更耗内存；
- 来源数据无法稳定定位到素材/片段；
- 测试必须访问真实外部模型且无法隔离；
- 发现新的同主题未提交实现。

---

## Phase 1：建立统一后端检索编排

### 目标

统一智能检索请求、来源结构、索引状态和错误行为，但暂不删除旧 API。

### 要做的调整

1. 新增统一 `RetrievalService` 或等价编排层；
2. 支持：
   - `mode=smart`
   - `workspace_ids`
   - `top_k`
   - 后续可扩展的类型/标签/时间筛选；
3. 统一来源字段：
   - 稳定 `source_id`
   - `workspace_id`
   - 当前阶段使用 `(workspace_id, item_id)` 作为 legacy source key
   - `item_type`
   - `item_title`
   - `excerpt`
   - `field`
   - `segment_id`
   - `start_ms/end_ms`
   - `jump_url`
4. 汇总候选后只执行一次最终 rerank；
5. 建立统一的聚合索引状态；
6. `/search` 调用新编排层；
7. `/knowledge/ask` 作为兼容适配器；
8. 保留 `/knowledge/status` 和 `/knowledge/rebuild`，但状态必须对应实际查询使用的索引。

### 主要文件

- `backend/app/routes/search.py`
- `backend/app/routes/knowledge.py`
- `backend/app/services/workspace_search_service.py`
- `backend/app/services/global_knowledge.py`
- `backend/app/services/workspace_knowledge.py`
- `shared/knowledge_base.py`
- 建议新增 `backend/app/services/retrieval_service.py`
- `frontend/src/services/search.ts`
- `frontend/src/services/knowledge.ts`

### 测试

- 现有 5 组后端测试不得回退；
- 新增统一契约测试；
- 覆盖空库、未知合集、索引未就绪、reranker 降级、无模型配置；
- 验证同一查询不会重复做不必要的最终 rerank；
- 验证旧 `/knowledge/ask` 与新 `/search` 的兼容字段。

### 完成条件

- 后端已有一个权威检索编排入口；
- 旧 API 只是适配层；
- 状态、查询和重建指向同一套索引事实；
- 前端尚未切换时旧页面仍能工作。

---

## Phase 2：统一智能检索页面与收藏闭环

### 目标

交付第一个用户可见里程碑：一个入口、AI 回答、可核验来源、跳转和收藏。

### 要做的调整

1. 侧栏“搜索”改名“智能检索”；
2. 移除独立“知识库”导航项；
3. `/search` 页面整合：
   - 搜索输入；
   - 合集范围；
   - AI 综合回答；
   - 来源卡片；
   - 索引状态和刷新；
4. 引用编号：
   - 只给合法来源编号加交互；
   - 点击滚动并高亮来源卡片；
   - LLM 引用了不存在的编号时不产生错误链接；
5. 来源卡片：
   - 原文片段；
   - 合集/标题/类型；
   - 展开前后文；
   - 内容或时间点跳转；
   - 收藏/取消收藏；
6. Phase 2 先根据已经加载的 workspace `favorites` 计算收藏状态，复用现有收藏 API；
7. `/knowledge` 改为兼容跳转；
8. 搜索历史暂时继续保存在本地浏览器，不迁入 SQLite；
9. “精确查找”控件可先显示为“即将支持”，但不能伪装成可用功能。

### 主要文件

- `frontend/src/layouts/AppShell.tsx`
- `frontend/src/router.tsx`
- `frontend/src/pages/SearchPage/SearchPage.tsx`
- `frontend/src/pages/SearchPage/search.css`
- `frontend/src/pages/KnowledgePage/index.tsx`
- `frontend/src/pages/FavoritesPage/FavoritesPage.tsx`
- `frontend/src/services/search.ts`
- `frontend/src/services/knowledge.ts`
- `frontend/src/services/workspaces.ts`

### 建议新增前端测试

- `frontend/src/__tests__/SearchPage.test.tsx`
- `frontend/src/__tests__/SearchCitationSources.test.tsx`
- `frontend/src/__tests__/SearchFavoriteFlow.test.tsx`
- `frontend/src/__tests__/KnowledgeRouteRedirect.test.tsx`

### 浏览器验收

1. 侧栏只有一个“智能检索”；
2. `/knowledge` 自动到 `/search`；
3. AI 回答与来源同时显示；
4. `[1]` 能定位第一条来源；
5. 来源可展开、跳转；
6. 收藏后收藏夹立即出现；
7. 取消收藏后状态同步；
8. 空库、索引未就绪、模型未配置和请求失败都有清楚提示；
9. 控制台无旧页面 chunk/API 的异常轮询。

### 完成条件

- M1 可以独立发布；
- 不依赖 SQLite；
- 不修改 Workspace 数据 schema；
- 旧链接可用。

---

## Phase 3：建立 FTS5 精确查找

### 目标

交付不调用 LLM 的本地原文检索，并把 SQLite 限定为可重建索引。

### 要做的调整

1. 新建 SQLite 索引文件和 `schema_meta`；
2. 每条索引按内容块保存，不按整个素材保存一大行；
3. 索引字段：
   - 标题；
   - 转写片段；
   - AI 总结；
   - 用户笔记正文；
   - 标签；
4. Phase 4 前使用 `(workspace_id, item_id)` 作为不会串数据的 source key；
5. 中文检索先做技术验证：
   - `trigram` 处理三个字以上子串；
   - 为两个字中文词评估应用层 bigram 辅助索引；
   - 英文按词、数字/型号按标准化文本；
6. 新增：
   - 全量重建；
   - 单 workspace 重建；
   - 内容更新增量索引；
   - 删除/垃圾桶恢复同步；
   - 索引损坏修复；
7. `/search mode=exact` 只返回来源，不调用 embedding、reranker 或 LLM；
8. 前端启用“精确查找”模式；
9. 记录查询耗时、数据库大小和重建时间。

### 主要文件

- 建议新增 `backend/app/services/search_index_store.py`
- 建议新增 `backend/app/services/exact_search_service.py`
- `backend/app/services/retrieval_service.py`
- `backend/app/routes/search.py`
- `backend/app/routes/workspaces.py`
- `frontend/src/pages/SearchPage/SearchPage.tsx`
- `frontend/src/services/search.ts`
- 建议新增 `scripts/rebuild_search_index.py`

### 测试

- 中文：发布会、产品特性、产品；
- 英文：OpenAI、API；
- 数字/型号：32B、2026、03:24；
- 标题、转写、总结、正文、标签分别命中；
- 合集/类型过滤；
- 删除后不再命中；
- 恢复后重新命中；
- 重建幂等；
- 数据库损坏后可修复；
- exact 模式断言不调用模型。

### Windows 停点

必须核对 Windows 离线包内置 Python 的：

- SQLite 版本；
- FTS5 是否启用；
- 选定 tokenizer 是否可用。

如果 Windows runtime 不支持，必须停下选择：

1. 调整内置 runtime；
2. 使用兼容的应用层索引；
3. 降级精确查找能力。

不得只在 macOS `.venv` 验证后宣称跨平台可用。

### 完成条件

- M2 可独立发布；
- 精确查找完全本地；
- SQLite 文件可删后重建；
- JSON 仍是内容权威来源。

---

## Phase 4：内容身份与同源谱系迁移

### 目标

修正当前“复制记录仍沿用同一 `item_id`”的身份问题，为独立修改和同源查看建立稳定基础。

### 执行前必须确认

- 当前用户数据完整备份位置；
- dry-run 统计与 2026-07-25 基线差异；
- `content_id/lineage_id` 最终字段位置；
- 旧路由和旧文件路径兼容策略；
- 任务、导出、收藏和搜索如何引用新身份。

### 要做的调整

1. 为每个现有 `(workspace_id, item_id)` 分配唯一 `content_id`；
2. 旧 `item_id` 相同的记录归入同一 `lineage_id`；
3. `WorkspaceItem` 增加身份字段和向后兼容读取；
4. “加入合集”改为：
   - 新建独立副本；
   - 新 `content_id`；
   - 沿用 `lineage_id`；
   - 复制当前内容快照；
   - 不共享可变字段；
5. 明确媒体文件是否只读共享、笔记/结果是否物理复制；
6. 调整搜索 source key、收藏、删除、导出、任务关联和跳转；
7. FTS 索引全量重建并切到 `content_id`；
8. 提供 dry-run、执行、校验和回滚脚本。

### 高影响文件

- `backend/app/models/workspace.py`
- `backend/app/services/workspace_store.py`
- `backend/app/routes/workspaces.py`
- `backend/app/services/workspace_search_service.py`
- `backend/app/services/global_knowledge.py`
- `backend/app/services/note_assembler.py`
- `backend/app/services/note_exporter.py`
- `frontend/src/types/workspace.ts`
- `frontend/src/services/library.ts`
- `frontend/src/pages/LibraryPage/`
- 所有以 `workspace_id/item_id` 组织路径或关联任务的代码

### 数据验收

- dry-run 不写数据；
- 迁移前自动备份；
- 迁移后 workspace/item 数量不减少；
- 每个合集内副本有唯一 `content_id`；
- 同源副本共享 `lineage_id`；
- 重复执行迁移不新增重复身份；
- 回滚能恢复原 JSON；
- 原媒体、笔记、总结、任务和导出仍可访问；
- 修改副本 A 不改变副本 B；
- 删除副本 A 不删除副本 B。

### 强制停点

- 无法可靠判断同源关系；
- 需要批量移动/重命名原媒体；
- 相关任务或导出只能依赖旧 `item_id` 且无法兼容；
- 备份或回滚验证失败；
- 迁移统计与只读基线不一致。

### 完成条件

- M3 的身份基础完成；
- 新旧数据均可读取；
- 独立副本行为有端到端测试；
- 未开始迁移标签/文件夹等元数据。

---

## Phase 5：标签、文件夹与收藏权威元数据

### 目标

在身份稳定后，把需要跨合集查询和管理的关系型元数据实体化。

### 决策门

Phase 5 开始前必须再次确认：

> 是否正式把标签、文件夹、收藏分组改为 SQLite 权威来源？

确认前不得改变旧 Phase 2D“整体存储暂不切 SQLite”的边界。

### 推荐拆分顺序

1. 标签：
   - `tags`
   - `content_tags`
   - AUTO/MANUAL 来源；
   - 自动重跑不删除手工标签；
2. 文件夹：
   - workspace 内层级；
   - 移动不改变 `content_id/lineage_id`；
3. 收藏：
   - 现有收藏迁入默认组；
   - 再增加收藏分组；
4. 检索筛选：
   - 标签；
   - 文件夹；
   - 收藏范围。

### 主要文件

- 建议新增 `backend/app/services/metadata_store.py`
- `backend/app/models/workspace.py`
- `backend/app/services/workspace_store.py`
- `backend/app/routes/workspaces.py`
- `frontend/src/pages/LibraryPage/`
- `frontend/src/pages/FavoritesPage/`
- `frontend/src/services/library.ts`
- `frontend/src/services/workspaces.ts`
- `frontend/src/types/workspace.ts`

### 验收

- 自动标签和手工标签不互相覆盖；
- 标签重名、大小写、空白有唯一性规则；
- 文件夹只能在所属 workspace 内引用；
- 删除文件夹不删除内容；
- 收藏迁移幂等；
- 收藏分组为空时仍兼容当前收藏夹；
- JSON 与 SQLite 对同一字段不会同时作为写入权威；
- 智能/精确检索的筛选结果一致。

---

## Phase 6：用户笔记正文版本与同源副本查看

### 目标

让用户能安全查看/恢复自己编辑的正文，并查看其他合集中的同源副本。

### 要做的调整

1. 在现有 NoteShell 自动保存链路前后建立版本 checkpoint；
2. 保存完整 Markdown 快照、内容 hash、创建时间和来源；
3. 版本来源至少区分：
   - USER_EDIT
   - RESTORE
   - ADOPT_FROM_SIBLING
4. 新增正文版本 API：
   - 列表；
   - 查看；
   - 恢复；
5. 恢复旧版本时创建新版本，不删除后续历史；
6. 新增同源副本 API：
   - 按 `lineage_id` 查询；
   - 显示所属合集、更新时间和摘要；
7. 前端提供：
   - “版本历史”；
   - “其他合集版本”；
   - 打开同源副本；
   - “采用为当前副本的新版本”；
8. 第一版不做自动同步、不做三方合并、不自动清理历史。

### 主要文件

- `frontend/src/pages/result/NoteShell/index.tsx`
- NoteShell 当前笔记读写 service
- `backend/app/routes/workspaces.py` 或独立 note-version route
- 建议新增 `backend/app/services/note_version_store.py`
- SQLite metadata schema

### 验收

- 相同内容不会重复生成版本；
- 编辑器高频自动保存不会生成大量无意义版本；
- 页面离开前已保存必要 checkpoint；
- 恢复后正文正确且旧历史仍在；
- 同源列表不包含当前副本；
- 采用同源内容只修改当前副本；
- AI 总结版本数量和行为不受影响；
- 音频说话人改名等既有历史总结逻辑不被混入正文版本。

---

## Phase 7：混合检索、性能与发布收口

### 目标

在语义检索和精确查找分别稳定后再做融合，不提前优化。

### 要做的调整

1. 评估 RRF 或等价融合排序；
2. 记录语义、精确、混合三种模式的质量样例；
3. 保持默认智能检索：
   - 语义召回；
   - 可选关键词补召回；
   - 一次最终 rerank；
   - AI 回答；
4. 保持精确查找：
   - 仅 FTS；
   - 不调用 AI；
5. 完成：
   - 空态/错误/降级；
   - 索引重建进度；
   - 大内容和批量数据性能；
   - Windows 离线包；
   - 浏览器可访问性；
   - 旧路由兼容期结束评估；
6. 搜索建议、收藏导入导出等仅在有真实需求时加入。

### 完成条件

- M4 完成；
- 所有必选能力达到最终完成定义；
- 可选增强不会阻塞核心发布；
- 未验证的 Windows 或大规模结论明确标注。

---

## 7. 总体验证策略

### 7.1 每阶段最低检查

```bash
git status --short --branch
git diff --check

./.venv/bin/pytest -q \
  tests/backend/test_knowledge_api.py \
  tests/backend/test_global_search.py \
  tests/backend/test_workspaces_search.py \
  tests/backend/test_workspace_knowledge.py \
  tests/backend/test_favorites_api.py

cd frontend
pnpm test --run <本阶段相关测试>
pnpm build
```

数据库/身份阶段还必须运行：

```bash
./.venv/bin/python <migration-or-index-script> --dry-run
./.venv/bin/python -m compileall backend shared scripts
```

具体脚本名以实现后的真实文件为准，执行记录必须写清替代命令和原因。

### 7.2 里程碑级验证

每个里程碑完成后，在该 commit 的干净 checkout/worktree 中运行：

```bash
.venv/bin/pytest backend/tests tests/backend -q
cd frontend && pnpm test --run
cd frontend && pnpm build
.venv/bin/python -m compileall backend shared scripts
git diff --check main...HEAD
```

如全量测试因外部模型、历史目录收集或环境原因无法完成，必须报告具体停点；不得把较小定向集合描述为“全量通过”。

### 7.3 浏览器验收主线

1. 智能检索默认回答与来源；
2. 引用定位和来源高亮；
3. 内容/时间点跳转；
4. 收藏/取消收藏；
5. 精确查找不调用 AI；
6. 合集、标签、类型和时间筛选；
7. 内容复制与独立修改；
8. 同源副本查看；
9. 正文版本查看和恢复；
10. 删除、垃圾桶恢复、索引重建；
11. 页面刷新后状态仍正确；
12. 控制台无异常请求和死链接。

---

## 8. 提交、复审与发布节奏

### 8.1 推荐提交边界

每个 Phase 至少一个独立本地 commit；Phase 4、5 过大时继续拆分。禁止把以下内容放进同一个提交：

- UI 合并 + SQLite；
- FTS + 内容身份迁移；
- 内容身份迁移 + 文件夹/标签；
- 正文版本 + 混合检索。

### 8.2 接力方式

1. 每个 Phase 开始前，由计划方把该阶段单独展开为执行提示词；
2. 小米/终端执行者只做该阶段；
3. 完成后本地 commit；
4. Codex 在干净 worktree 复审；
5. 通过后用户决定是否进入下一阶段；
6. 不主动 push。

### 8.3 推荐发布顺序

- Release 1：Phase 0–2，统一智能检索体验；
- Release 2：Phase 3，精确查找；
- Release 3：Phase 4，独立副本与同源谱系；
- Release 4：Phase 5–6，内容管理与正文历史；
- Release 5：Phase 7，混合检索和发布收口。

---

## 9. 全局强制停点

出现以下任一情况必须停止并询问用户：

1. 需要新增 pip/npm/全局依赖；
2. 需要更改已确认的产品语义；
3. 实际索引、来源、笔记保存或复制行为与计划不一致；
4. 需要修改数据库 schema 或执行用户数据迁移；
5. Windows 内置 SQLite 不支持选定 FTS 能力；
6. 无法可靠建立同源关系；
7. 需要移动、重命名或删除原媒体；
8. 迁移 dry-run、备份、幂等或回滚失败；
9. 需要跨 5 个以上文件且没有当前阶段的明确文件边界；
10. 出现同主题 worktree、冲突分支或新的未提交实现；
11. 为通过测试必须改变 AI 总结、音频、导出、任务或删除语义；
12. 相关测试需要真实外部 API key 且无法安全隔离。

停点报告格式：

> 我在执行【Phase X】时发现：实际情况是 A，计划假定是 B。
> 方案 1：……（影响）
> 方案 2：……（影响）
> 我建议方案 X，因为……。请确认后再继续。

---

## 10. 禁止事项

- 不一次性实施所有 Phase；
- 不在页面合并阶段顺便迁移数据；
- 不长期双写 JSON 与 SQLite 的同一权威字段；
- 不把 SQLite FTS 当作不可恢复的唯一内容存储；
- 不在每次编辑器 debounce 时创建正文版本；
- 不自动覆盖或自动合并同源副本；
- 不新建第二套 AI 总结版本系统；
- 不隐藏或吞掉索引/迁移错误；
- 不在脏工作树上给出单个 commit 的通过结论；
- 不清理 `.workbuddy` 或其他用户未提交文件；
- 不主动 push。

---

## 11. 用户接下来怎么推进

推荐按以下顺序逐项发起任务：

1. **先执行 Phase 0**：建立当前检索契约和性能基准；
2. Phase 0 通过后，确认统一索引策略；
3. 执行 Phase 1：统一后端检索编排；
4. 执行 Phase 2：交付一个智能检索页面；
5. 用户先体验 M1，再决定是否调整 UI；
6. 执行 Phase 3：交付精确查找；
7. 用户验收 M2 后，再授权数据身份迁移；
8. 执行 Phase 4，并在迁移前确认备份/dry-run；
9. Phase 5 开始前再次确认 SQLite 权威元数据；
10. Phase 6 开始前确认正文版本生成时机；
11. 最后执行 Phase 7 做融合和发布收口。

当前最小下一步是：**只展开并执行 Phase 0，不直接开始改 SearchPage 或数据库。**
