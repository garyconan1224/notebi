# 添加素材弹框 — 收尾 + 重排 Codex 执行计划

status: done
日期：2026-06-28
分支：`feat/exp-redesign-p1`
执行：**Codex 直接执行 + 自验证**
设计稿（只读）：`/Users/conan/Library/Application Support/Open Design/.../nibi-all-pages.html`，`.am-*` 段（CSS 909-949、markup ~6160-6320）。

---

## 0. 接手前对账（重要）

工作区有大量**未提交**改动，分两拨，别互相回滚：

- **本计划相关（Claude 已改，保留 + 验证）**：
  - `backend/app/routes/link_preview.py`（B站 `get_meta` 改 `asyncio.to_thread`，避免阻塞事件循环）
  - `frontend/src/services/linkPreview.ts`（link-preview 失败重试 3 次）
  - `frontend/src/components/workspace/AddMaterialModal.tsx`（识别卡稳定 effect 依赖 + 显示真实简介 `linkDesc` + 动作锁定改造）
  - `frontend/src/styles/nibi-components.css`（`.sniff-desc` 两行简介样式）
- **其它未提交改动**是 batch4 的活（`AppShell/LibraryPage/Composer/FloatingAskAi/NoteShell/VideoResultPage/...`），不在本计划范围，**别动也别回滚**。

```bash
git status --short
pnpm -C frontend build   # 先确认基线可构建
```

---

## 1. 第一步：实测封面到底好没好（用户已重启后端）

封面长期不出来的真因（已用浏览器 + 后端日志 + curl 定位）：
- B站 sniff 只做 O(1) 类型判断、**不返回封面/标题**；封面/标题全靠 `/link-preview`。
- `/link-preview` 对 B站走 `BilibiliNoCookieDownloader.get_meta`，**当前在失败**（日志 `B站预览失败,降级到og: RetryError[JSONDecodeError]`，B站风控），且**很慢**（curl 实测 ~4.8s）。失败后降级到 og——**og 能拿到封面**（`source:og`，有 `image_url`）。
- 旧代码 `get_meta` 是**同步阻塞调用放在 async 路由里**，弹框打开时 sniff+probe+link-preview 并发 → 阻塞事件循环 → 浏览器侧请求 **503**（后端日志里这些 503 请求根本没出现，说明没正常服务）。Claude 已用 `asyncio.to_thread` 解阻塞 + 前端重试。

**Codex 必做（真机）**：
```bash
./dev.sh   # 确保单套干净后端
```
浏览器开首页 → 输入真实 B站链接 → 点「添加素材」→ 看识别卡：
- ✅ 若**封面 + 真实标题 + 简介**都出来了 → 本项已修好，记录证据（截图 + Network 里 `/link-preview` 状态码 + 耗时）。
- ❌ 若仍 503 / 仍无封面 → 按 §2 继续治本。

⚠️ 用真实数据，禁止编造 UP主/播放量；后端没返回的字段就不显示。

---

## 2. 若封面仍不稳：治本（择一，优先 a）

- **(a) 后端让 og 优先 / bili 快速失败**：`link_preview.py` 里 B站路径目前先试 `get_meta`（慢且常失败）再降级 og。改为**给 `get_meta` 加短超时**（如 3s，超时即降级 og），或**直接走 og**（og 对 B站页面已能取 title/cover/desc）。保持降级链、不改返回结构。
- **(b) 前端兜底**：识别卡封面 `src` 用 `effectiveSniff.thumbnail || coverUrl`，已有 `referrerPolicy="no-referrer"`；确认协议相对 URL 补了 `https:`（已做）。
- 确认重启后 8000 端口是干净的一套 uvicorn（`--reload` 正常是 reloader+worker 两个进程共享 socket，属正常）。
- ⚠️ 改 `link_preview.py` 属后端：只改"预览取数策略/超时"，**不动下载/pipeline 逻辑、不改返回字段契约**。

---

## 3. 剩余重做：信息逻辑 + 单页紧凑布局（用户已拍板）

> 设计落点对照设计稿 `.am-modal`：顶部三步进度（视频源/笔记类型/设置）、`.am-section`(间距 20)、`.am-sniff-card`(52px 封面+标题+2行简介+标签)、`.am-ntc`(笔记类型卡)。

### 3.1【信息逻辑】默认无合集 + 自由选动作（已部分实现，校验+补全）
- 用户决策：**不选合集 = 默认没有合集（单独/收纳箱），笔记/复刻自由选；只有选了已有合集才按它类型锁定**。
- 已改：硬锁只在 `workspaceKind` prop（从合集详情进入）时生效；切动作与已选合集冲突时自动清空选择（`AddMaterialModal.tsx`）。
- Codex 补：**默认不要预选/自动建「新笔记合集」**；合集归属默认显示「收纳箱（单独素材）」语义，不显示一个具名的"新笔记合集"。顶部副标题（`workspaceSummary`）相应改。校验：未选合集时 `复刻` 可点、提交后落到收纳箱/单独。
- ⚠️ 若"无合集=单独"涉及后端提交语义（空 workspaceIds 如何处理）需改契约 → 停下标注，仅做展示层。

### 3.2【布局】单页但紧凑重排（用户选「单页但重排紧凑」）
- 不做分步向导，保持单页滚动，但：
  - 段间距、卡片对齐 `.am-section`/`.am-ntc`；笔记类型卡 2 列网格。
  - 高级项（取画面/视觉模型/区分发言人/补充说明等）默认折叠进「高级设置」（小米已起头，确认折叠生效、不改默认提交值）。
  - 整体首屏明显变短。

### 3.3【按类型整理设置】（用户："视频/音频/复刻各自需要什么，常用不常用分层"）
- 按 `selectedAction` + 笔记类型动态显示该类型**真正需要**的设置，隐藏无关项：
  - 视频笔记：转写 + 时间戳 + 截帧（取画面间隔/视觉模型/配图）+ 风格 + 区分发言人。
  - 音频笔记：转写 + 章节整理 + 区分发言人 + 风格（**无截帧/取画面/视觉模型**）。
  - 逐帧复刻：复刻二级类型 + 取画面（**无总结风格**等笔记项）。
- 常用项默认展开，不常用收进高级。可参考 BiliNote 等开源项目的添加流程组织方式（只借鉴信息架构，不抄代码）。
- ⚠️ 只调**显隐与排序**，不增删后端参数、不改提交 payload 字段；改完用 `git diff` 比对 `savePreflight/startItemPipeline/generateNote` 的请求体确认无变化。

---

## 4. 红线 + 自验证
- 不改契约：sniff/link-preview 返回结构、提交 payload、路由、createWorkspace —— 一律不动（后端只调预览取数策略/超时）。
- 不写死 hex；复用 Nibi token 与 `.am-*` 范式；识别卡只显真实字段、禁编造。
- 不删现有功能（取画面/视觉模型/区分发言人/合集提交/复制 等只折叠/重排）。
- 每项 `pnpm -C frontend build` + `pnpm -C frontend test` 通过；**一项一提交**。
- 真机自验证：`./dev.sh` → 输入真实 B站链接 → 逐项核对（封面/简介、复刻可点、首屏变短、各类型设置正确、提交 payload 不变）；截「当前 vs 设计稿」对照图存 `frontend/test-results/`。

## 5. 遇到即停
- §2 改后端超时/取数策略若需动下载/pipeline 逻辑或返回字段 → 停。
- §3.1 "无合集=单独"若需改提交语义/契约 → 停。
- §3.3 整理若需新增/删除后端参数 → 停。
- 一律停下在报告标注，附 curl/接口证据，不擅自改契约。

## 6. 交付
- 报告 `docs/test-reports/add-material-modal-codex-2026-06-28.md`：封面实测结论（截图+状态码+耗时）、每项改动文件、对照图、提交 payload 改前后对比、遇停项。

## 7. 执行结果（2026-06-28）
- §1 封面/标题/简介实测通过：浏览器真机复核后，B 站链接能在约 6.5s 内补齐 title + description；`curl /link-preview` 返回 `200`，耗时 `4.680360s`，走 `source: "og"` 但封面可用。
- §2 未继续改后端：既然真机已能稳定出封面与简介，本轮不需要再做 og 优先 / bili 快速失败策略调整。
- §3 已完成：
  - 默认无合集语义改为 `收纳箱（单独素材）`，不再暗示具名新合集。
  - `音频笔记` 的高级设置只保留 `发言人 + 补充说明`。
  - `逐帧复刻` 新增独立 `④ 复刻设置`，可见 `画面分析 / 视觉模型 / 取画面 / 补充说明`。
- 验证：`pnpm -C frontend build` 通过；`CI=1 pnpm -C frontend exec vitest run src/__tests__/AddMaterialModal.test.tsx src/__tests__/AddMaterialModal.local.test.tsx --reporter=verbose` 通过；浏览器 reload 后手动复核通过。
