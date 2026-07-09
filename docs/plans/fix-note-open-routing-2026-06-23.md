# 修复:笔记项目打不开 / 错进复刻结果页（给小米 · 2026-06-23）

> 用户报障：之前做的笔记项目「打不开」或「打开是复刻结果页」。
> 本计划基于**实测数据**定位（非猜测），分两个真因，按序修。

---

## 一、实测根因（已用真实数据 + curl + tsc 验证）

**真因 1：「打不开」= NoteShell 崩溃（已修，待提交）**
- `/note` 页因 `remarkGfm is not defined` 整页白屏（`NoteShell/index.tsx`）。这是 react-markdown→Milkdown 迁移残留的死代码引用了被删的 import（main 上就有的旧 bug，非复刻引入）。
- 已删死代码块修复；**`npx tsc --noEmit` 全局 0 错误**，NoteShell 干净。
- curl `GET /workspaces/{id}/items/{itemId}/note` 对笔记项 **HTTP 200、note_md 1406 字**——数据没问题，纯前端崩溃。
- ⚠️ 该修复目前是**未提交改动**，挂在 `feat/replica-prompt-slice1`。

**真因 2：「打开是复刻结果页」= intent 与真实数据错配 + 复刻页回落假演示数据**
- 扫描全部合集：9 个 `intent=''` 笔记项 → 正确路由 `/note`；5 个 `intent='replica'`。所有素材卡片入口都走 `resolveItemRoute`，**笔记项不会被路由到复刻页**（路由本身没坏）。
- 但有 **2 个 `intent='replica'` 却装着笔记数据、`frames=0` 的项**（`aedffe77` bilibili、`12d741b9` test-replica-c3-v2）——复刻测试期产生的错标/脏数据。
- 这种项进 `video_detail` 后，后端 `get_item_result`（`workspaces.py:2345`）在「无真实 frames」时**回落到 `build_demo_video_result` 假演示帧** → 用户看到一个装着假内容的复刻页。这就是「打开是复刻结果页」。

---

## 二、修复方案（按序，每步实跑验证）

### Commit 1 —— 提交 NoteShell 崩溃修复（已改好）

- 工作树里 `NoteShell/index.tsx` 已删死代码（remarkGfm 块），直接提交：`fix(NoteShell): 删 react-markdown 迁移残留死代码导致的 remarkGfm 整页崩溃`。
- **实跑标志**：打开任一 `intent=''` 笔记项目 `…/items/{id}/note` → 正常渲染笔记正文（不再白屏 / 不再 `remarkGfm is not defined`）。

### Commit 2 —— 结果页防呆兜底：永不落「空/假的错类型页」（核心）

目标：任何素材都不该落到「没有对应数据的结果页」，更不能展示假演示数据。

1. **复刻页自愈**（`VideoResultPage.tsx`）：拉到 `getItemResult` 后，若**真实 `frames` 为空**：
   - 该项有笔记数据（拉一次 `getItemNote` 或看 result 里 note 字段，`note_md` 非空）→ `navigate('…/note', { replace: true })` 自动跳笔记页；
   - 否则显示明确「暂无复刻数据 / 处理中 / 失败」空态，**不要展示 demo 假帧**。
2. **后端不要拿假数据冒充真实**（`workspaces.py` `get_item_result`）：`build_demo_video_result` 回落**仅限明确的 demo/调试场景**；真实 item 无 frames 时返回空 frames + 状态标记（让前端走空态/自愈），别回落假演示帧。
   - 若改后端风险大，**至少在响应里加 `is_demo: true` 标记**，前端 VideoResultPage 见到 `is_demo` 且是真实 item 时按空态处理 + 自愈。
3. **对称（可选，低优先）**：`NoteShell` 若无笔记数据但有 frames → 顶部提示「该素材是复刻向，去复刻页」。

**接入函数**：`VideoResultPage`（getItemResult 后的分支）、`get_item_result`。
**实跑标志**：打开 `aedffe77`（intent=replica、无 frames、有笔记数据）→ **自动跳到 `/note` 看到笔记**，或显示明确空态；**绝不再出现装着假 bilibili 帧的复刻页**。

### Commit 3 —— （可选）权威 primary_view，治本

让"该进哪个页"由真实数据决定，不再单靠可能错配的 `intent`：

- 后端 item / library 响应给每个 item 算一个 `primary_view: 'note' | 'replica'`：有 frames 且 intent=replica → replica；有笔记数据 → note；兜底 note。
- `resolveItemRoute` 优先用 `primary_view`，无则回退现有 intent 逻辑。
- **先做完 Commit 1-2 实跑**，若兜底已够稳，Commit 3 可不做。

### Commit 4 —— （可选）清理 2 条脏数据

- `aedffe77`、`12d741b9` 这两条错标项：交用户决定删除或纠正 intent。**不自动删**，在报告里列出让用户拍板。

---

## 三、涉及文件

- `frontend/src/pages/result/NoteShell/index.tsx`（Commit 1，已改）
- `frontend/src/pages/result/VideoResultPage.tsx`（Commit 2 自愈 + 空态）
- `backend/app/routes/workspaces.py` `get_item_result`（Commit 2 不冒充假数据 / 加 is_demo）
- `frontend/src/lib/resolveItemRoute.ts` + item/library 响应（Commit 3 可选）

---

## 四、验收

1. **笔记项目全开**：9 个 `intent=''` 项逐一打开 `/note` 都正常渲染，无白屏、无 `remarkGfm`。
2. **错标项不再假页**：打开 `aedffe77` → 自愈到 `/note` 或明确空态；页面**不含 demo 假帧**。
3. **复刻正路不回归**：正常复刻项（有 frames）打开 `video_detail` 仍正常显示真实帧 + 提示词。
4. **路由不回归**：note→/note、replica（有数据）→video_detail，各入口（Library/合集卡片/收藏/Overview）一致。
5. `npx tsc --noEmit` 0 错误；相关单测通过。

---

## 五、红线 / 须知（§6.5）

- 改前用 `rg`+`Read` 确认 `VideoResultPage` 取数、`get_item_result` 回落逻辑（注意本机 rg 把 replica/note 显示成 n，核对用 Read）。
- **每个 commit 真实场景实跑**：用上面列的具体 item id（`aedffe77` 等）走真实 UI 验证「自愈/空态/不再假帧」，靠现象确认，别只跑单测。重启用 `./dev.sh`，确认后端是跑新代码的新进程。
- 走 `.claude/skills/e2e-fullflow-test` 点真实页面，禁止猜 API、禁止编造数据。
- 不自动删用户数据（Commit 4 的脏项交用户拍板）。
- demo 回落改动要小心：别把正常复刻页的真实数据也判成空（`_video_result_has_real_data` 的判定要保留）。
- 不动 `.env`、不主动 push、一个 commit 一件事、干净 checkout 核对单 commit。
