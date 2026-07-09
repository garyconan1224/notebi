# 合集分型（笔记合集 / 复刻合集）执行计划（给小米 · 2026-06-23）

> 用户拍板：合集本身要分型、**硬区分**笔记合集 vs 复刻合集（不是只在素材层贴标签）。
> 背景：现状 `intent` 只挂在【单条素材】上（`item.preflight.intent`），合集（workspace）没有类型、可混装。本计划给合集加类型并贯穿建合集 + 列表 + 加素材。
> 关联：复刻线 `docs/plans/replica-prompt-slice1-2026-06-23.md`（complementary，不冲突）。

---

## 〇、请用户/Claude 先确认（影响 AddMaterialModal 行为）

1. **硬锁还是软默认**：进入一个「复刻合集」加素材时——
   - 【默认按这个写】**硬锁**：动作锁成复刻，想做笔记请新建笔记合集。最贴「硬区分」。
   - 备选 软默认：默认复刻、但允许在合集内临时切笔记。
   若要留软口子，执行前说一声。
2. **已有合集**：缺 `kind` 字段的旧合集一律默认 `note`（向后兼容、不写迁移脚本）。旧合集里若混着复刻素材，**单项仍按 `item.preflight.intent` 正确路由**，只是合集标签按默认走；不强制迁移。可接受。

---

## 一、数据模型（加字段，非 schema 迁移）

workspace 是 JSON 单文件存储（`WorkspaceStore`，`backend/app/services/workspace_store.py`），加字段只需改模型 + `from_dict` 兜底，**无需迁移脚本**。

1. 后端 `backend/app/models/workspace.py` → `WorkspaceRecord`：新增 `kind: str = "note"`，取值 `"note" | "replica"`。
   - `from_dict`：`kind = str(data.get("kind") or "note")`（旧文件缺字段 → note）。
   - `to_dict`：输出 `kind`。
2. 前端 `frontend/src/types/workspace.ts` → `WorkspaceRecord` 加 `kind: 'note' | 'replica'`；`WorkspaceCreateRequest` 加可选 `kind?`。

**接入函数**：`WorkspaceRecord.from_dict` / `to_dict`。
**实跑标志**：建一个复刻合集后，`data/workspaces/<id>.json` 里有 `"kind": "replica"`；旧合集 GET 出来 `kind` 为 `"note"`。

## 二、建合集流程（3 个入口都带 kind）

1. **手动新建**：`WorkspaceList.tsx`「新建合集」dialog（line 204-240）加「类型」二选（笔记 / 复刻），传给 `createWorkspace({ name, kind })`。
2. **service + 路由**：`frontend/src/services/workspaces.ts` `createWorkspace` 带 `kind`；后端 `POST /workspaces` 创建路由接受并存 `kind`（默认 note）。
3. **自动建合集**：`AddMaterialModal` 在没有目标合集时调 `autoCreateWorkspace`（services/workspaces.ts:51）。这里要**按用户当前选的动作推断 kind**——`selectedAction==='replica'` → 建复刻合集，否则笔记合集。后端 `POST /workspaces/auto-create` 接受 `kind`（或新增 `intent` 入参映射）。

**接入函数**：`createWorkspace`、`autoCreateWorkspace`、对应后端创建/auto-create 路由、`AddMaterialModal.handleGenerateNote`。
**实跑标志**：① 新建 dialog 选「复刻」建出的合集，json `kind=replica`；② 不选合集、直接粘链接选「复刻」生成 → 自动建出的合集 `kind=replica`、选「笔记」→ `kind=note`。

## 三、加素材跟随合集类型（硬区分，见 §〇.1）

1. `AddMaterialModal`：当目标合集已知（从合集详情页打开、或 props 传入 wsId），读该合集 `kind`，把动作（笔记/复刻 区）**预设为合集 kind**；按 §〇.1 决定锁死还是允许改。
2. 自动建合集时，新合集 kind = 用户选的动作（与 §二.3 一致）。

**实跑标志**：进「复刻合集」详情页点加素材 → 动作默认且（硬锁时）只能复刻；进「笔记合集」→ 默认笔记。

## 四、列表 / 侧栏区分

1. `WorkspaceList.tsx` 卡片（`WorkspaceCard`，line 274+）显示 **kind 徽章 + 图标**（笔记 📝 / 复刻 🎬，沿用 `ITEM_TYPE_COLOR` 同款语义色）。
2. 顶部加「全部 / 笔记 / 复刻」筛选（与现有 `TagFilterBar` 并列或合并；复用 `useTagFilter` 模式即可）。
3. 侧栏若列出合集（`Index` / 导航组件，先 `rg` 确认有没有），同样标 kind。没有就跳过。

**实跑标志**：合集列表里笔记合集、复刻合集有不同徽章；点「复刻」筛选只剩复刻合集。

---

## 五、涉及文件

**后端**
- `backend/app/models/workspace.py`（`WorkspaceRecord` 加 `kind` + from_dict/to_dict）
- `backend/app/routes/workspaces.py`（创建路由 + auto-create 路由接受 `kind`）

**前端**
- `frontend/src/types/workspace.ts`（`WorkspaceRecord` / `WorkspaceCreateRequest` 加 `kind`）
- `frontend/src/services/workspaces.ts`（`createWorkspace` / `autoCreateWorkspace` 带 `kind`）
- `frontend/src/pages/WorkspacePage/WorkspaceList.tsx`（新建 dialog 类型选择 + 卡片徽章 + 筛选）
- `frontend/src/components/workspace/AddMaterialModal.tsx`（按合集 kind 预设动作）
- 侧栏/导航组件（若列合集，`rg` 后再定）

---

## 六、验收

1. **加字段不破旧数据**：重启后端，旧合集 GET 出来 `kind=note`，能正常打开、加素材、不报错。
2. **三入口 kind 正确**：手动建（选复刻）、auto-create（选复刻动作）、加素材跟随——三处 json `kind` 都对（实跑看 `data/workspaces/<id>.json`）。
3. **列表能区分能筛**：实跑看到徽章 + 筛选生效。
4. **不回归**：复刻线（replica-prompt-slice1）行为不变；笔记生成、复刻生成、各结果页照常。
5. 单测：`WorkspaceRecord` from_dict/to_dict 加 `kind` 的最小单测（缺字段默认 note、显式 replica 透传）；`backend/tests` 里 workspace 相关测试通过。

## 七、红线

- `WorkspaceRecord` 有 73 处调用 + 大量测试，加字段**只增不改**已有字段，`from_dict` 必须对旧文件兜底（缺 `kind` → note），别让旧合集加载报错。
- 不写 DB 迁移脚本（JSON 存储，靠 from_dict 兜底）。
- 不动 `.env`、不主动 push、一个 commit 一件事、在干净 checkout 上核对单 commit。
- 硬锁/软默认按 §〇.1 用户确认结果做，别自己拍。
- 这是与复刻线**并行的独立功能**，建议在新分支（如 `feat/collection-typing`）做，别和 replica-prompt-slice1 混提交。

---

## 八、备注（不阻塞，留给后续）

- 复刻合集里素材进结果页时，顶栏「笔记/复刻」toggle 对纯复刻素材意义不大（笔记视图会空）。本计划先不动；若硬区分后想让复刻素材隐藏「笔记」toggle，另开小修。
