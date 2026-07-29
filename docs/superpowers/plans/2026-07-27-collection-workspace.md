# Collection Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将合集列表和详情整理成紧凑、可操作的知识工作区，保留独立副本/同源比较，加入一等融合笔记版本，并让删除合集默认保留内容。

**Architecture:** 继续以 WorkspaceRecord JSON 为事实源；复制时创建独立 `content_id` 并保留 `lineage_id`；融合笔记在 workspace 内保存版本和来源快照；删除合集时把仅存在于该合集的内容转移到收纳箱，再软删除合集。

**Tech Stack:** FastAPI、Pydantic、WorkspaceStore、React、TypeScript、Vitest、Pytest、Playwright。

---

## Task 1: 固化副本身份契约

**Files:**
- Modify: `backend/app/models/workspace.py`
- Modify: `backend/app/services/workspace_store.py`
- Modify: `backend/app/routes/workspaces.py`
- Test: `tests/backend/test_workspaces_api.py`
- Test: `tests/backend/test_workspace_lineage.py`

- [ ] 写失败测试：复制到两个合集得到不同 `content_id`/`item_id`、相同 `lineage_id`，修改一个副本不改变另一个。

```python
def test_copies_are_independent_and_share_lineage(client, source_item, two_workspaces):
    copies = copy_to_workspaces(client, source_item, two_workspaces)
    assert copies[0]["content_id"] != copies[1]["content_id"]
    assert copies[0]["lineage_id"] == copies[1]["lineage_id"]
    update_note(client, copies[0], "changed")
    assert get_note(client, copies[1]) != "changed"
```

- [ ] 现有缺失身份的旧记录在读取/保存时补稳定值，不在每次读取随机生成。
- [ ] 复制 API 返回 created/skipped/failed 明细；同一目标已有相同 lineage 时默认 skip。
- [ ] 用户可显式选 `reprocess`，但普通“复制到合集”不得重新分析。
- [ ] 前端和 API 文案统一为“复制到合集”，不再用可能暗示移动的“加入合集”。
- [ ] 运行测试并提交：`fix(collections): enforce independent lineage copies`

## Task 2: 同源版本比较和采用

**Files:**
- Modify: `backend/app/routes/workspaces.py`
- Modify: `frontend/src/services/workspaces.ts`
- Create: `frontend/src/pages/WorkspacePage/components/LineageVersionsPanel.tsx`
- Test: `tests/backend/test_workspace_lineage.py`
- Test: `frontend/src/__tests__/LineageVersionsPanel.test.tsx`

- [ ] 写失败测试：列出同 lineage 的其他副本，只返回非垃圾桶合集；当前副本明确标记。
- [ ] 写失败测试：“采用该版本”创建当前副本的新 note version，不覆盖/删除旧版本，也不反向写兄弟副本。
- [ ] 比较面板显示合集名、更新时间、摘要差异和“打开来源合集”。
- [ ] 采用前二次确认：“只更新当前合集中的副本”。
- [ ] 不提供自动同步、自动合并或全局覆盖。
- [ ] 运行测试并提交：`feat(collections): compare and adopt lineage versions`

## Task 3: 融合笔记升级为版本模型

**Files:**
- Modify: `backend/app/models/workspace.py`
- Modify: `backend/app/services/workspace_store.py`
- Modify: `backend/app/routes/workspaces.py`
- Test: `tests/backend/test_workspace_merged_notes.py`

- [ ] 写旧模型迁移失败测试：原 `content_md` 自动成为 version 1，读取后内容不丢失。
- [ ] 定义：

```python
class MergedNoteVersion(BaseModel):
    version_id: str
    content_md: str
    item_ids: list[str]
    source_snapshot: list[dict[str, str]]
    created_at: datetime
    created_by: Literal["ai", "user", "restore"]

class MergedNote(BaseModel):
    merged_id: str
    title: str
    current_version_id: str
    versions: list[MergedNoteVersion]
    created_at: datetime
    updated_at: datetime
```

- [ ] 新生成、手工保存、恢复旧版本都 append version，不覆盖旧 version。
- [ ] 来源快照至少保存 `item_id`、`content_id`、`lineage_id`、标题和摘要 hash。
- [ ] 删除融合笔记只软删除该笔记，不删除素材。
- [ ] 运行测试并提交：`feat(collections): version merged notes`

## Task 4: 融合笔记 API 和知识索引入口

**Files:**
- Modify: `backend/app/routes/workspaces.py`
- Modify: `backend/app/services/global_knowledge.py`
- Modify: `backend/app/services/workspace_search_service.py`
- Test: `tests/backend/test_workspace_merged_notes.py`
- Test: `tests/backend/test_knowledge_api.py`

- [ ] 写失败测试覆盖 list/get/create version/update/versions/restore/delete。
- [ ] 路由契约：

```text
GET    /workspaces/{id}/merged-notes
POST   /workspaces/{id}/merged-notes
GET    /workspaces/{id}/merged-notes/{merged_id}
PATCH  /workspaces/{id}/merged-notes/{merged_id}
GET    /workspaces/{id}/merged-notes/{merged_id}/versions
POST   /workspaces/{id}/merged-notes/{merged_id}/versions/{version_id}/restore
DELETE /workspaces/{id}/merged-notes/{merged_id}
```

- [ ] 知识索引纳入当前版本，`source_type="merged_note"`；旧版本不进入默认检索，但可在版本页查看。
- [ ] 每次 current version 改变只重建对应 workspace 的可重建索引。
- [ ] 运行测试并提交：`feat(collections): expose and index merged notes`

## Task 5: 删除合集默认保留唯一内容

**Files:**
- Modify: `backend/app/routes/workspaces.py`
- Modify: `backend/app/services/workspace_store.py`
- Test: `tests/backend/test_workspaces_trash.py`

- [ ] 写失败测试：
  - 默认 `content_policy=keep`；
  - 只存在于被删合集的 lineage 复制到“收纳箱”；
  - 已在其他非垃圾合集存在的 lineage 不重复复制；
  - `content_policy=trash` 不转移内容；
  - 恢复合集不产生双份。

```python
def test_delete_collection_keeps_unique_items_in_inbox(client, workspace):
    response = client.delete(f"/workspaces/{workspace.id}?content_policy=keep")
    assert response.status_code == 200
    inbox = find_inbox(client)
    assert lineage_ids(inbox) == lineage_ids(workspace)
```

- [ ] 收纳箱使用稳定系统 workspace identity，不按每次删除新建同名合集。
- [ ] 删除响应返回 `moved_to_inbox`、`already_elsewhere`、`trashed` 计数。
- [ ] `trash` 只在用户明确选择“合集及其中内容移入垃圾桶”时使用。
- [ ] 运行测试并提交：`feat(collections): keep content when deleting collections`

## Task 6: 紧凑合集列表和批量栏

**Files:**
- Modify: `frontend/src/pages/WorkspacePage/WorkspaceList.tsx`
- Modify: related `frontend/src/pages/LibraryPage/*`
- Test: `frontend/src/__tests__/WorkspaceList.test.tsx`
- Test: `frontend/src/__tests__/LibraryPage.test.tsx`

- [ ] 写失败测试：首页/笔记页头不会因新建合集或选择内容变高；批量栏仅在选中至少一项时出现并 sticky。
- [ ] 删除新建文件夹、移动文件夹、整理、列表批量标签、合集类型选择。
- [ ] 常驻动作只保留搜索、筛选、排序、视图切换、新建合集、批量复制、删除。
- [ ] 新建合集 modal 只要求名称，可选描述/封面；不要求类型。
- [ ] 合集卡显示封面、名称、内容数、更新时间、最多 3 个摘要标签和状态；不把整段摘要塞进卡片。
- [ ] 在 1280x720 首屏至少看见标题栏、过滤栏和一整行合集/内容卡。
- [ ] 运行前端测试并提交：`feat(collections-ui): compact collection library`

## Task 7: 合集详情三分区

**Files:**
- Modify: `frontend/src/pages/WorkspacePage/TaskboardPage/index.tsx`
- Modify: `frontend/src/pages/WorkspacePage/TaskboardPage/TaskboardHead.tsx`
- Modify: `frontend/src/pages/WorkspacePage/TaskboardPage/TabsNav.tsx`
- Modify: `frontend/src/pages/WorkspacePage/TaskboardPage/MaterialsTab.tsx`
- Create: `frontend/src/pages/WorkspacePage/TaskboardPage/MergedNotesTab.tsx`
- Create: `frontend/src/pages/WorkspacePage/TaskboardPage/BatchesTab.tsx`
- Modify: corresponding CSS
- Test: `frontend/src/__tests__/TaskboardPage.test.tsx`

- [ ] 写失败测试：详情只有“内容/融合笔记/批次”主分区；旧 Chat、KnowledgeQA、Tags 不作为平行主 tab。
- [ ] 页头包含合集名、统计、添加素材、批量任务、问这个合集。
- [ ] “问这个合集”路由为 `/knowledge?workspace_ids=<id>&new=1`。
- [ ] 内容 tab 支持选择和复制到一个或多个合集；不显示移动/整理动作。
- [ ] 融合笔记 tab 支持创建、编辑、版本历史、恢复和来源跳转。
- [ ] 批次 tab 使用 S3 batch API，点击进入 `/tasks/batches/:batch_id`。
- [ ] 运行测试并提交：`feat(collections-ui): focus collection workspace`

## Task 8: 响应式、可访问性和删除确认

**Files:**
- Modify: collection/workspace CSS files touched above
- Modify: delete confirmation component used by WorkspaceList/Taskboard
- Test: `frontend/src/__tests__/WorkspaceAccessibility.test.tsx`

- [ ] 所有 icon-only button 有可读 `aria-label`，键盘可选择卡片和操作菜单。
- [ ] 删除确认默认勾选/选中“删除合集，内容保留在收纳箱”；危险选项明确红色且需二次确认。
- [ ] 360px 不出现横向溢出；批量栏可换行但不覆盖首个内容卡。
- [ ] 新建 modal 内容区内部滚动，页面主体不被撑高。
- [ ] 运行测试并提交：`fix(collections-ui): make collection actions accessible`

## Task 9: 阶段验收

- [ ] 运行 workspace、trash、lineage、merged-note、knowledge index 定向后端测试。
- [ ] 运行 WorkspaceList、LibraryPage、Taskboard、LineageVersions 前端测试和 build。
- [ ] 浏览器验证：复制到两合集、分别修改、查看同源版本、采用版本、融合笔记生成两版并恢复第一版。
- [ ] 删除含唯一内容的合集，确认内容进入收纳箱；删除含共享内容的合集，确认不重复。
- [ ] 五视口无横向溢出；新建/批量状态不把首屏拉空。
- [ ] 验收提交：`test(acceptance): verify collection workspace semantics`
