---
phase: R21.P3.S2
title: 结果页「总结」tab + WorkspaceItem.summaries 字段 + 多版本 CRUD
status: done
owner: mimo
estimated_hours: 8-12
actual_hours: 2
depends_on:
  - r21-p3-s1（必须先合 main）
user_source: 2026-05-28 用户第三轮反馈
completed_date: 2026-05-28
commits:
  - 8feeebb Step 1 — ItemSummary dataclass + WorkspaceItem.summaries + 老数据迁移
  - b569899 Step 2 — summary_generator + workspace_store summary helpers
  - 4f5f2df Step 3 — 4 个 summary API endpoint
  - 80dc470 Step 4 — 前端 SummariesTab + service + 集成到 AudioResultPage
---

## 目标（一句话）

把「总结模板 + 总结用背景」从添加素材页彻底移到结果页，支持同一素材生成多模板、同模板多版本，全部并存可对比可删除。

## 关键设计（已锁定，不要改）

### 1. 数据模型 —— 不建 SQL 表，扩展 dataclass + JSON

⚠️ **本项目存储是 JSON 文件**（`data/workspaces/<workspace_id>.json`），不是 SQL。不要用 alembic / SQLAlchemy。

在 [backend/app/models/workspace.py](backend/app/models/workspace.py) 新增 dataclass：

```python
@dataclass
class ItemSummary:
    """单份总结产物（多模板、多版本并存）。"""
    summary_id: str                              # uuid4
    template: str                                # 简洁摘要 / 详细要点 / 金句提取 ...
    version: int                                 # 同 template 自增，1, 2, 3 ...
    background_for_summary: str = ""             # 这次生成用的「总结用背景」
    content_md: str = ""                         # LLM 产出的 markdown
    model_used: str = ""                         # 用了哪个 provider/model（审计用）
    created_at: str = field(default_factory=_now_iso)

    def to_dict(self) -> Dict[str, Any]: ...
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ItemSummary": ...
```

在 `WorkspaceItem` 上新增字段：
```python
summaries: List[ItemSummary] = field(default_factory=list)
```

`to_dict` / `from_dict` 同步更新（注意 list 嵌套 dataclass 的序列化）。

### 2. 老数据迁移（轻量，运行时迁移，不写脚本）

`WorkspaceItem.from_dict` 里：如果 `data` 中 **没有 `summaries` 字段但 `results.summary` 或 `results.note_md` 有内容** → 自动构造一份 `ItemSummary(template="legacy", version=1, content_md=<老内容>)` 放进 `summaries`。

**不动 `results` 原字段**，保持向后兼容（仅作为只读历史保留）。先 grep 确认 `results` 里"总结"叫什么 key（看 av_synthesis 写入逻辑）。

### 3. API（在 routes/workspaces.py 加，不新建 router）

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/workspaces/{ws}/items/{item}/summaries` | 列出该 item 所有总结（按 template 分组，按 version 排序） |
| POST | `/api/workspaces/{ws}/items/{item}/summaries` | body: `{ template, background_for_summary }`，**同步调 LLM** 生成并落盘，返回新 summary |
| DELETE | `/api/workspaces/{ws}/items/{item}/summaries/{summary_id}` | 硬删 |
| GET | `/api/workspaces/{ws}/items/{item}/summaries/{summary_id}` | 取单份详情（前端列表已有元数据，详情主要拿 markdown） |

**POST 同步执行不开新任务**：单次 LLM 调用一般 5-15s，前端 loading 即可。如果未来要做异步队列推到 S3+。

### 4. LLM 调用方式（复用现有模式）

参考 [backend/app/services/av_synthesis/llm.py:11](backend/app/services/av_synthesis/llm.py:11) 的 `_call_llm` 写法：

```python
from src.vidmirror.core.providers import ChatRequest
from src.vidmirror.core.providers.registry import create_default_registry
from shared.settings_store import load_settings

def _generate_summary(prompt: str) -> tuple[str, str]:
    """返回 (content_md, model_used)"""
    settings = load_settings()
    registry = create_default_registry()
    profile = registry.resolve_default_profile(settings, "chat")
    provider = registry.build(profile)
    chat_model = str(getattr(profile.default_models, "chat", None) or "").strip()
    if not chat_model:
        raise RuntimeError("未配置 chat model")
    text = provider.chat(ChatRequest(
        model=chat_model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=4000,
    ))
    return text, f"{profile.id}/{chat_model}"
```

新建文件 `backend/app/services/summary_generator.py` 封装：
- `build_prompt(item: WorkspaceItem, template_id: str, background: str) -> tuple[str, str]` 返回 (system_prompt, user_prompt)
- `generate_summary(item, template_id, background) -> ItemSummary`

**prompt 模板**：✅ **直接复用 [backend/app/services/summary_templates.py](backend/app/services/summary_templates.py)**！9 个模板已实现（R18 时代留下的）：

```python
from backend.app.services.summary_templates import get_template, list_template_ids
# template = get_template("xhs")  # → SummaryTemplate(system_prompt, user_prompt, ...)
# user_prompt 已含 {transcript} 占位符，build_prompt 时 .format(transcript=...) 注入即可
```

**不要重新写 9 个 prompt。** 如果发现需要在 user_prompt 注入「总结用背景」（现有模板没这个占位符），有两种选择：
- (a) 把背景拼到 user_prompt 前面作为前置上下文（推荐，零侵入）
- (b) 改 summary_templates.py 给每个模板加 `{background}` 占位符（要改 9 个模板，要回归测试）

**默认走 (a)**。如果用户要 (b)，停下确认。

### 5. UI 布局（结果页）

结果页顶部 tab：`[原始产出] [总结 (N)]`
进入「总结」tab 后：

```
┌──────────┬─────────────────────────────────┐
│ 总结列表  │  主显示区                       │
│          │                                  │
│ ▸简洁摘要 │  # 简洁摘要 v1                  │
│  v1 ✓    │  生成于 2026-05-28 15:30        │
│  v2      │  模型: openai/gpt-4o            │
│ ▸教学笔记 │  ───────                        │
│  v1      │  ...markdown 渲染...            │
│          │                                  │
│ [+ 新建]  │  [删除] [复制 markdown]        │
└──────────┴─────────────────────────────────┘
```

「+ 新建」点击 → 弹出面板：选模板 → 填总结用背景（textarea，可选）→ 「生成」→ loading 5-15s → 完成后刷新列表自动选中新版本。

对比模式 **本期不做**（属于 S3）。

## 文件改动清单

| 文件 | 改动 |
|---|---|
| `backend/app/models/workspace.py` | 新增 `ItemSummary` dataclass + `WorkspaceItem.summaries` 字段 + 迁移逻辑 |
| `backend/app/services/workspace_store.py` | 增 helper：`add_item_summary`, `delete_item_summary`, `next_version_for_template`（操作 summaries 列表并落盘） |
| `backend/app/services/summary_generator.py` | 新文件：prompt 构造 + LLM 调用 + ItemSummary 生成 |
| `backend/app/routes/workspaces.py` | 加 4 个 endpoint（GET 列表 / POST 生成 / GET 详情 / DELETE） |
| `backend/tests/test_summaries.py` | 新增：mock LLM 测 CRUD + 迁移 + 版本自增 |
| `frontend/src/services/summaries.ts` | 新增：4 个 fetcher 包 API |
| `frontend/src/pages/result/ResultPage/SummariesTab.tsx`（或现有结果页对应文件） | 新增：列表 + 主显示 + 新建面板 |
| `frontend/src/pages/result/ResultPage/index.tsx` | 顶部 tab 切换 |
| `frontend/src/__tests__/SummariesTab.test.tsx` | 新增：列表渲染 / 新建调用 / 删除调用 |

## 实施步骤

### Step 1：后端数据模型 + 迁移（独立 commit）

1. 在 `backend/app/models/workspace.py` 加 `ItemSummary` dataclass 和 `WorkspaceItem.summaries` 字段
2. `WorkspaceItem.from_dict` 加运行时迁移逻辑（详见 §2）
3. `to_dict` 同步序列化 summaries
4. 写一个最小测试：构造一个含 `results.summary="..."` 的旧 dict → from_dict → 验证 summaries[0] 是 legacy v1
5. `pytest backend/tests/test_workspace_model.py`（如已有）或新建 `test_item_summary.py` 通过
6. commit

### Step 2：summary_generator.py + workspace_store helpers（独立 commit）

1. 新建 `summary_generator.py`：硬编码 9 个 template 的 prompt dict（参考 av_synthesis/templates/*.j2 翻译过来），实现 `build_prompt` + `generate_summary`
2. `workspace_store.py` 加 helpers：`get_item`, `add_item_summary`, `delete_item_summary`, `get_next_version`
3. `test_summary_generator.py`：mock provider.chat 返回固定 markdown，测 prompt 构造正确、ItemSummary 字段齐全、version 自增
4. commit

### Step 3：4 个 API endpoint（独立 commit）

1. `routes/workspaces.py` 加 GET 列表 / POST 生成 / GET 详情 / DELETE
2. POST 同步调 `summary_generator.generate_summary` —— 注意 LLM 调用是阻塞的，**用 `run_in_threadpool` 包装**避免阻塞 event loop（FastAPI 自带）
3. `test_summaries.py` 测 4 个 endpoint：mock LLM 测 happy path + 404 + 删除后列表少一项
4. commit

### Step 4：前端 SummariesTab + service（独立 commit）

1. 新建 `services/summaries.ts`：listSummaries / createSummary / deleteSummary / getSummary
2. 新建 `SummariesTab.tsx`：左列表（按 template 分组，嵌套 v1/v2）+ 右主显示（react-markdown 渲染，看现有结果页用什么）+ 新建面板（modal 或 inline 都行）
3. 结果页 index.tsx 加顶部 tab 切换：`[原始产出] [总结 (N)]`，N 从 list API 拿
4. `SummariesTab.test.tsx`：测列表渲染 / 新建按钮触发 createSummary / 删除按钮触发 deleteSummary
5. commit

### Step 5：单测全过 + 端到端自查（独立 commit，仅文档）

1. `cd backend && pytest tests/test_item_summary.py tests/test_summary_generator.py tests/test_summaries.py -v` 全过
2. `cd frontend && npx vitest run src/__tests__/SummariesTab.test.tsx` 全过
3. 启服务跑：
   - 选一个已有 item 进结果页 → 看到「总结」tab，旧 item 有 legacy v1
   - 点「+ 新建」选「教学笔记」生成 → 几秒后看到新 v1
   - 再生成一次同模板 → 看到 v2，v1 仍在
   - 切「简洁摘要」生成 → 看到独立列
   - 删除 v2 → 列表只剩 v1
4. 截图存 `docs/plans/r21-p3-s2-verify/`
5. 更新 plan 文件 status: done + 验收勾上

## 验收标准

- [x] `WorkspaceItem` 新增 `summaries` 字段，老数据自动迁移成 legacy v1
- [x] 4 个 API endpoint 工作正常，单测通过
- [x] 结果页能看到「总结」tab（AudioResultPage 已集成）
- [x] 能新建多模板多版本，全部并存
- [x] 能删除单份总结（硬删，立即生效）
- [x] POST 生成总结时前端有 loading 状态（"生成中…" 按钮 disabled）
- [x] 老 item 打开结果页能看到 legacy v1，markdown 正确渲染
- [x] 所有新增/改动单测通过（71 后端 + 6 前端 = 77 个测试）

## 不在本期范围（明确推到 S3）

- 总结对比模式（左侧勾选多份 → 右侧 split view）
- 学习视频转录正文按需补图（用户选时间轴帧）
- 异步生成队列（如果 LLM 调用超时变成问题，再推 S3+）
- 软删 + 撤销（本期硬删）

## 风险点

1. **`results` 老字段叫什么 key**：Step 1 写迁移前必须 grep 确认（可能是 `results.summary` / `results.note_md` / `results.av_synthesis_md`），不要瞎猜
2. **WorkspaceItem.to_dict 嵌套 dataclass 序列化**：`asdict()` 会递归处理，但要测一遍写出来的 JSON 能再 `from_dict` 回去（roundtrip 测试）
3. **LLM 调用同步阻塞**：必须 `run_in_threadpool` 包装，否则一个请求阻塞整个 FastAPI worker
4. **prompt 模板硬编码 vs 模板文件**：本期硬编码省事；如果 9 个模板太长（>200 行），考虑放 `backend/app/services/summary_templates/*.txt` 文件读
5. **前端结果页文件位置**：写代码前先找清楚结果页主文件是哪个（rg "ResultPage|result/.*Page" frontend/src/pages/）

---

## 附录 A：mimo 执行预备信息（2026-05-28 Opus 预扫产物）

### A.1 ⚠️ 项目存储是 JSON 不是 SQL

- 数据在 `data/workspaces/<workspace_id>.json`
- 模型是 `backend/app/models/workspace.py` 里的 dataclass（`WorkspaceItem`, `WorkspaceRecord` 等）
- 存取接口在 `backend/app/services/workspace_store.py`
- **不要用 alembic / SQLAlchemy / sqlite / 任何数据库**
- **不要建 migration 脚本**，迁移逻辑直接写在 `from_dict` 里运行时处理

### A.2 LLM 调用复用 av_synthesis 模式

参考文件：[backend/app/services/av_synthesis/llm.py:11-30](backend/app/services/av_synthesis/llm.py:11)

```python
from src.vidmirror.core.providers import ChatRequest
from src.vidmirror.core.providers.registry import create_default_registry
from shared.settings_store import load_settings
```

**不要自己写 provider 调用，不要直接调 openai SDK。** 必须走 registry，不然不支持用户配的多 provider。

### A.3 items API 在 workspaces.py 不新建文件

`backend/app/routes/workspaces.py` 已经有 item 相关 CRUD，新增 4 个 summary 端点加在同一个 router 下，路径 `/api/workspaces/{ws}/items/{item}/summaries/...`。

**不要新建 `routes/summaries.py`**。

### A.4 9 个总结模板已存在，直接复用

文件：[backend/app/services/summary_templates.py](backend/app/services/summary_templates.py)（R18 时代留下）

```python
from backend.app.services.summary_templates import TEMPLATES, get_template, list_template_ids
```

9 个 template_id（key）：
- `concise` 简洁摘要 / `detailed` 详细要点 / `quotes` 金句提取
- `meeting` 会议纪要 / `xhs` 小红书风格 / `longform` 公众号长文
- `lecture` 教学笔记 / `interview` 访谈整理 / `podcast` 播客 shownotes

每个 `SummaryTemplate` 有 `system_prompt`、`user_prompt`（含 `{transcript}` 占位符）、`output_format` 字段。

**不要重新写 prompt。** 测试已有：`backend/tests/services/test_summary_templates.py`，跑一下确认能 import + get_template + 9 个 id 都在。

「总结用背景」字段在原模板没占位符，**默认把背景拼到 user_prompt 前面**（不要改 summary_templates.py）。要改告诉用户。

### A.5 边界条件（必须停下问用户）

CLAUDE.md §4 6 种通用 +：
1. 如果发现 `results` 里"总结"字段的 key 不是 `summary` / `note_md` / `av_synthesis_md` 中的任何一个，且无法判断哪个是历史总结
2. 如果发现 `WorkspaceItem.to_dict` 嵌套序列化有问题（roundtrip 测试失败）
3. 如果需要修改 LLM 调用 registry / provider 接口（**本期只调，不改**）
4. 如果发现结果页主文件位置和文件清单写的不一致（前端项目结构可能与 plan 假设不同）
5. 如果 9 个模板的 prompt 你不知道怎么写，**停下问用户**给样例
