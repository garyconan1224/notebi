# Knowledge Conversations and Traceable Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `/knowledge` 做成可选择一个、多个或全部合集的连续问答工作区，每轮重新检索，回答逐条引用，并能预览和跳回原音视频时间点。

**Architecture:** 会话和消息保存问答快照；检索层按 workspace 分配候选、合并 rerank 并生成稳定 chunk source ID；流式消息服务按“检索→生成→完成”输出 NDJSON 事件；前端左侧会话、中间回答、右侧来源预览，精确原文搜索仍使用现有 `/knowledge/search`。

**Tech Stack:** FastAPI StreamingResponse、Pydantic、JSON 原子持久化、现有 embedding/reranker/LLM、React、TypeScript、fetch stream、Vitest、Pytest、Playwright。

---

## Task 1: 稳定检索来源身份

**Files:**
- Modify: `backend/app/services/workspace_search_service.py`
- Modify: `backend/app/services/retrieval_service.py`
- Modify: `backend/app/routes/knowledge.py`
- Modify: `frontend/src/services/search.ts`
- Test: `tests/backend/test_retrieval_contract.py`

- [ ] 写失败测试：同一 item 的不同转写时间段/字段有不同 `source_id`；同一片段重建索引后 ID 不变。

```python
def test_source_id_is_chunk_stable():
    first = make_source(workspace_id="w1", item_id="i1", field="transcript", start_ms=30000)
    second = make_source(workspace_id="w1", item_id="i1", field="transcript", start_ms=60000)
    assert first.source_id != second.source_id
    assert first.source_id == make_source(
        workspace_id="w1", item_id="i1", field="transcript", start_ms=30000
    ).source_id
```

- [ ] source ID 由规范化的 workspace/item/field/segment/start/end 生成 SHA-256 短 ID，不使用 Python `hash()`。
- [ ] `KnowledgeSource` 固定包含 `source_id`、workspace/item/content/lineage、source_type、title、excerpt、field、segment、start/end、score、jump_url。
- [ ] `jump_url` 对音视频包含 `start_ms`，对文本定位到 section/segment。
- [ ] 前后端类型一一对应。
- [ ] 运行测试并提交：`fix(knowledge): stabilize chunk source identity`

## Task 2: 多合集平衡检索

**Files:**
- Modify: `backend/app/services/retrieval_service.py`
- Modify: `backend/app/services/workspace_search_service.py`
- Test: `tests/backend/test_multi_workspace_retrieval.py`
- Test: `tests/backend/test_retrieval_contract.py`

- [ ] 写失败测试：选择三个合集时每个合集都有候选机会，但无关合集不会被强行塞进最终来源。
- [ ] 写失败测试：同 lineage 的相似片段去重，保留分数更高/信息更完整者。
- [ ] 每个 workspace 先取 `per_scope_k=max(3, ceil(candidate_k/scope_count))`，合并后统一 rerank，再按 source/lineage 做轻度多样性约束。
- [ ] `workspace_ids=[]/None` 明确定义为全部非垃圾、非系统合集；未知 ID 返回 422，不静默变成全部。
- [ ] 每轮调用都接收当次 scope snapshot，不从上一轮缓存候选。
- [ ] 真实中文查询测试至少包含二字词和长问句；不得只用英文 token。
- [ ] 运行测试并提交：`feat(knowledge): balance retrieval across collections`

## Task 3: 证据阈值和引用约束

**Files:**
- Modify: `backend/app/services/retrieval_service.py`
- Test: `tests/backend/test_retrieval_contract.py`

- [ ] 写失败测试：低于阈值时返回证据不足，不调用会编造事实的普通回答路径。
- [ ] 写失败测试：LLM 输出未知 source ID 时剔除该引用并记录 warning；没有有效引用的事实句不标“有来源”。

```python
def test_unknown_citations_are_rejected(service, fake_llm):
    fake_llm.answer = "结论 [source:made-up]"
    result = service.answer("问题", workspace_ids=["w1"])
    assert result.citations == []
    assert result.status == "insufficient_evidence"
```

- [ ] 阈值以 reranker score/config 常量表示，并在响应返回 `evidence_status`；不可用魔法布尔值。
- [ ] prompt 只允许引用提供的 source IDs，引用格式在解析器和 prompt 中完全一致。
- [ ] 回答响应区分 `complete`、`insufficient_evidence`、`generation_failed`。
- [ ] 运行测试并提交：`fix(knowledge): enforce evidence-backed answers`

## Task 4: 会话持久模型

**Files:**
- Create: `backend/app/models/knowledge_conversation.py`
- Create: `backend/app/services/knowledge_conversation_store.py`
- Test: `tests/backend/test_knowledge_conversations.py`

- [ ] 写失败测试覆盖创建、标题、append、原子写、重启读回、删除和损坏文件隔离。

```python
class KnowledgeMessage(BaseModel):
    message_id: str
    role: Literal["user", "assistant"]
    status: Literal["retrieving", "generating", "complete", "failed", "insufficient_evidence"]
    content: str = ""
    scope_snapshot: list[str] = []
    query_text: str = ""
    answer_version: int = 1
    citations: list[str] = []
    sources: list[KnowledgeSource] = []
    timings_ms: dict[str, int] = {}
    created_at: datetime
```

- [ ] `KnowledgeConversation` 保存 `conversation_id`、title、default_scope、messages、created/updated。
- [ ] 每会话一个 JSON，临时文件 + `os.replace`。
- [ ] sources 存回答当时快照，后续索引变化不改历史回答证据。
- [ ] API 永不把完整模型 prompt/密钥写入会话。
- [ ] 运行测试并提交：`feat(knowledge): persist conversation evidence snapshots`

## Task 5: 会话 REST API

**Files:**
- Modify: `backend/app/routes/knowledge.py`
- Test: `tests/backend/test_knowledge_conversations.py`

- [ ] 实现并测试：

```text
GET    /knowledge/conversations
POST   /knowledge/conversations
GET    /knowledge/conversations/{conversation_id}
PATCH  /knowledge/conversations/{conversation_id}
DELETE /knowledge/conversations/{conversation_id}
POST   /knowledge/conversations/{conversation_id}/messages/{message_id}/regenerate
```

- [ ] 列表按 updated_at 倒序，支持分页和关键词。
- [ ] PATCH 只允许标题和 default_scope；default_scope ID 必须存在。
- [ ] regenerate 追加新 assistant answer version，保留旧回答，不覆盖。
- [ ] 删除只删会话，不删 workspace/item/index。
- [ ] 运行测试并提交：`feat(knowledge): expose conversation API`

## Task 6: 每轮重新检索的 NDJSON 流

**Files:**
- Create: `backend/app/services/knowledge_message_service.py`
- Modify: `backend/app/routes/knowledge.py`
- Test: `tests/backend/test_knowledge_stream.py`

- [ ] 写失败测试：每次消息都调用 retrieval；第二轮 scope 改变后只用新 scope。
- [ ] 流事件固定为：

```json
{"type":"status","stage":"retrieving","message_id":"m1"}
{"type":"sources","sources":[]}
{"type":"status","stage":"generating","message_id":"m1"}
{"type":"delta","text":"回答片段"}
{"type":"done","message":{}}
```

- [ ] 端点 `POST /knowledge/conversations/{id}/messages/stream` 返回 `application/x-ndjson`。
- [ ] 客户端断开时停止继续发送；已取回 sources 和当前状态持久化为 failed/cancelled-safe 状态，不能留下永远 generating。
- [ ] LLM 失败仍返回 sources 和可重试错误。
- [ ] 首包 status 在检索完成前发送；不得等完整回答后伪装流式。
- [ ] 运行测试并提交：`feat(knowledge): stream re-retrieved answers`

## Task 7: 精确原文搜索保持独立模式

**Files:**
- Modify: `backend/app/routes/knowledge.py`
- Modify: `backend/app/services/workspace_search_service.py`
- Test: `tests/backend/test_knowledge_api.py`

- [ ] 保留/整理 `GET /knowledge/search`，支持同一 workspace scope。
- [ ] 写测试：返回标题、总结、转写/OCR 片段和 jump_url，不调用 LLM。
- [ ] 精确模式按字段和匹配强度排序；两字中文查询有真实命中测试。
- [ ] AI 问答与精确搜索共用 source type，不共用 conversation message。
- [ ] 运行测试并提交：`feat(knowledge): preserve exact original search mode`

## Task 8: 前端会话服务和流解析

**Files:**
- Modify: `frontend/src/services/knowledge.ts`
- Create: `frontend/src/services/knowledgeStream.ts`
- Create: `frontend/src/types/knowledgeConversation.ts`
- Test: `frontend/src/__tests__/knowledgeStream.test.ts`

- [ ] 写失败测试：跨 chunk NDJSON、多个 delta、错误行、abort、done 均正确处理。
- [ ] `sendKnowledgeMessage` 接收 conversationId/question/workspaceIds/AbortSignal 和事件回调。
- [ ] HTTP 非 2xx、网络中断、后端 error event 统一成可恢复错误，不丢已收到 sources。
- [ ] 不把 API key、prompt 或 Cookie 记入 console。
- [ ] 运行测试并提交：`feat(knowledge-ui): parse streamed answer events`

## Task 9: 知识库三栏工作区

**Files:**
- Modify: `frontend/src/pages/SearchPage/SearchPage.tsx`
- Modify: `frontend/src/pages/SearchPage/search.css`
- Create: `frontend/src/pages/SearchPage/ConversationSidebar.tsx`
- Create: `frontend/src/pages/SearchPage/KnowledgeComposer.tsx`
- Create: `frontend/src/pages/SearchPage/SourcePreviewPanel.tsx`
- Modify: `frontend/src/pages/SearchPage/KnowledgeScopePicker.tsx`
- Test: `frontend/src/__tests__/SearchPage.test.tsx`
- Test: `frontend/src/__tests__/KnowledgeConversationPage.test.tsx`

- [ ] 写失败测试：左侧会话，中间消息，右侧来源；窄屏右侧变 drawer，不横向溢出。
- [ ] scope picker 支持一个、多个、全部；清空选择不静默变全部，必须显示“请选择合集”。
- [ ] URL `?workspace_ids=w1,w2&new=1` 建立新会话并预选合集。
- [ ] 提问后依次显示“正在检索/找到 N 个来源/正在生成”；失败可重试。
- [ ] 默认是“问知识库”，切换“找原文”后显示精确结果且不创建 assistant 回答。
- [ ] 输入框 Enter 发送、Shift+Enter 换行；生成中可停止。
- [ ] 运行测试并提交：`feat(knowledge-ui): build scoped conversation workspace`

## Task 10: 回答引用和来源预览

**Files:**
- Modify: `frontend/src/pages/SearchPage/SearchResultView.tsx`
- Modify: `frontend/src/pages/SearchPage/SourcePreviewPanel.tsx`
- Test: `frontend/src/__tests__/SearchCitationSources.test.tsx`
- Test: `frontend/src/__tests__/SourcePreviewPanel.test.tsx`

- [ ] 写失败测试：引用 chip 按 source_id 打开唯一来源；引用顺序按首次出现；相关但未引用来源单独列出。
- [ ] 来源卡显示合集、标题、类型、片段、时间、score/匹配说明；不把整篇原文塞进卡片。
- [ ] 预览支持上一个/下一个来源和“在笔记中打开”。
- [ ] evidence insufficient 时显示“现有合集中没有足够证据”，仍可展示检索片段供用户判断。
- [ ] 运行测试并提交：`feat(knowledge-ui): connect citations to source preview`

## Task 11: 音视频深链接真实验收

**Files:**
- Modify only if failing: `frontend/src/pages/result/NoteShell/index.tsx`
- Modify only if failing: `frontend/src/pages/result/NoteShell/NoteAudioPanel.tsx`
- Modify only if failing: `frontend/src/pages/result/NoteShell/LNVideoPanel.tsx`
- Test: `frontend/src/__tests__/NoteShellKnowledgeDeepLink.test.tsx`
- Create: `scripts/knowledge_acceptance/real-media.mjs`

- [ ] 保留并扩展现有测试：handle/metadata ready 后消费一次；seek 30 秒；await play；拒绝时停在 30 秒并显示 autoplay hint。
- [ ] 脚本用真实音频和视频，打开 Knowledge 来源 jump_url，断言 `currentTime` 在 28–32 秒。
- [ ] `addInitScript` 令 `play()` reject，断言仍 seek 成功且提示可见。
- [ ] 不能用固定 300ms 等待替代 player ready；duration 为 NaN/0 时不能把 seek 钳到 0。
- [ ] 运行：

```bash
cd frontend
pnpm test --run src/__tests__/NoteShellKnowledgeDeepLink.test.tsx
cd ..
node scripts/knowledge_acceptance/real-media.mjs
```

- [ ] 真实媒体缺失时本项标“需要补充验证”，不得判定知识库全部完成。
- [ ] 若无需业务修复，只提交脚本/测试；若发现缺陷，修复必须单独提交。

## Task 12: 阶段验收

- [ ] 运行 knowledge/conversation/retrieval 全部后端测试。
- [ ] 运行 SearchPage、conversation、citation、preview、deep-link 前端测试和 build。
- [ ] 冷启动与热启动各发一个真实 `/knowledge` 问题，记录 status、耗时、answer、citations、sources。
- [ ] 浏览器完成单合集、多合集、全部合集、scope 改变追问、证据不足、找原文、会话刷新恢复。
- [ ] 两种真实媒体来源跳转约 30 秒并尝试自动播放；拒绝提示可见。
- [ ] console error=0、五视口无横向溢出。
- [ ] 验收提交：`test(acceptance): verify traceable knowledge conversations`
