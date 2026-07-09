# 添加素材弹框 3 项修复 — 小米执行计划

status: ready
日期：2026-06-28
分支：`feat/exp-redesign-p1`
执行：**小米终端执行**；Codex 验收。
设计稿（只读对照源）：`/Users/conan/Library/Application Support/Open Design/namespaces/release-stable/data/projects/2bfc4c3c-b63e-49f2-ad5c-a0e210cfdb3e/nibi-all-pages.html`，`.am-*` 段（CSS 909-949、markup 6160-6320）。

---

## 0. 背景

`AddMaterialModal`（`frontend/src/components/workspace/AddMaterialModal.tsx`，954 行）是首页/库页「添加素材」弹框。真机三处问题：

1. 识别到视频链接后，识别卡**没有封面、视频信息太少**（图：只显示占位图标 + 平台 + 时长 + “已识别视频”）。
2. 整个弹框**太长**（视频源/合集归属/你要做什么/笔记设置/取画面/区分发言人 全部平铺）。
3. 「选择合集」处缺**新建合集**入口。

---

## 1. ⚠️ 小米必读：先拿真实数据，禁止编造

本任务最大风险是「识别卡显示什么字段」。**你必须先用真实接口数据确认后端到底返回了哪些字段，只渲染真有的字段，缺的就不显示，绝不写死/编造 UP主、简介、播放量等假数据。**

第一步（强制，先做再改代码）：
```bash
cd /Users/conan/Desktop/nibi
# 1) 确认 sniff 返回结构（换成真实 B站链接）
curl -s 'http://127.0.0.1:8000/...sniff端点...' --data '...'   # 端点/参数照 services/workspaces.ts 里 sniffUrl 实现来
# 2) 确认 link-preview / 封面端点返回（coverUrl 来源）
# 3) 确认 getVideoDuration 返回
```
- 在 `frontend/src/services/workspaces.ts` 找 `sniffUrl` 的真实端点与 `SniffResult` 类型定义；把**实际返回的字段贴进交接报告**（thumbnail / title / platform / duration / uploader / desc 哪些有、哪些是 null）。
- 代码里**只渲染确认存在的字段**。例如：若 sniff/link-preview 对 B站不返回 uploader，就**不显示 UP主**那一项；不要照设计稿的 “UP主：知识分享官” 写死。
- 遇到「设计稿要某字段、但后端没有」→ **停下，在报告标注「需后端补 X 字段」**，不擅自造数据、不擅自改后端。

> 现有代码已有封面逻辑：`effectiveSniff.thumbnail || coverUrl`（行 563-565）；`coverUrl` 由 link-preview 补（行 182、330）。封面没显示 = 这条链路对 B站没拿到图。先查清楚 link-preview 为什么没返回封面（端点失败？字段名不符？跨域？），用真实 curl 证据说明，再决定怎么修——别盲改。

---

## 2. 逐项

### 2.1【问题1】识别卡显示封面 + 视频信息（对齐 `.am-sniff-card`）
- 设计依据：`.am-sniff-card`（CSS 931-943，markup 6211-6234）——`52px 封面缩略图` + 标题 + **2 行简介** + 标签行（平台 / 时长 / UP主 / 已识别）。
- 修复（**仅渲染真实字段**）：
  - 封面：先修好 `coverUrl`（link-preview）链路，识别卡左侧 `.am-sniff-thumb` 显示 `effectiveSniff.thumbnail || coverUrl`；拿不到才显占位图标。
  - 信息：标题（`effectiveSniff.title`）、平台（`platform`）、时长（`videoDuration`，已有）。简介/UP主**仅当后端返回才显**（见 §1）。
  - 视觉对齐 `.am-sniff-card`（缩略图 52px、标题、标签行），复用 Nibi token。
- 文件：`AddMaterialModal.tsx`（识别卡 JSX 约行 500-595）+ 对应 css。
- 验收：输入真实 B站链接 → 识别卡显示**真实封面 + 标题 + 时长**（有就显，没有不编）；视觉贴近 `.am-sniff-card`。

### 2.2【问题2】弹框太长 → 收纳高级设置
- 现状：6 段平铺（视频源 / 合集归属 / 你要做什么 / 笔记设置 / 取画面 / 区分发言人），首屏极长。
- 修复（布局收敛，**不删任何功能/不改提交逻辑**）：
  - 主流程保留可见：① 视频源（识别卡）② 合集归属 ③ 你要做什么 ④ 笔记类型。
  - **把「取画面 / 视觉模型 / 区分发言人」等高级项收进一个默认折叠的「高级设置 ▾」**（accordion，点开展开），减少首屏高度。
  - 段间距对齐设计 `.am-section`（`margin-bottom:20px`）；笔记类型卡可 2 列网格（`.am-note-grid`）。
  - 弹框宽度/最大高对齐 `.am-modal`（max-width 560、max-height 85vh、body 滚动）。
- 文件：`AddMaterialModal.tsx` + css。
- ⚠️遇停：折叠任何项若会改变默认提交值/payload → 停下标注；折叠只能影响显隐，不能改默认参数。
- 验收：首屏明显变短；展开「高级设置」原有取画面/区分发言人等全在、功能不变；提交参数与改前一致（对比 payload）。

### 2.3【问题3】选择合集处加「新建合集」
- 现状：合集归属有「选择合集」按钮（workspace picker），无新建。
- 修复：picker 里加「+ 新建合集」项 → 调 `createWorkspace`（`services/workspaces.ts:43`，`kind` 传当前上下文 note/replica），建好后选中该合集。
- 文件：`AddMaterialModal.tsx`（合集选择区）。
- ⚠️遇停：若 `createWorkspace` 必须带 item、不支持建空合集 → 停下标注，改为「输入名称、提交时一并创建」的轻方案，别改后端。
- 验收：选择合集弹层里能新建合集并自动选中，提交后素材归入该合集。

---

## 3. 给小米的执行须知与红线

- **先 §1 拿真实数据再写代码**；识别卡只渲染真字段，**禁止编造 UP主/简介/播放量**等。
- **不改契约/后端**：sniff/link-preview/createWorkspace/提交 payload 一律不动；只改前端展示与布局。改完用 `git diff` 确认没碰 `services/*` 的请求体与端点。
- 不写死 hex、不用 `Instrument Serif`、不用负 letter-spacing；新增样式用 Nibi token。
- 不删现有功能（取画面/视觉模型/区分发言人/合集提交等全保留，只折叠/重排）。
- 每项改完：`pnpm -C frontend build` + `pnpm -C frontend test` 必须通过；**一项一提交** `fix(design): 添加素材弹框 X 修复`。
- 真机自验证：`./dev.sh` 起前后端，首页/库页点「添加素材」，输入真实 B站链接，逐项核对 §2 验收；截图存 `frontend/test-results/`。
- 遇到 §2 各「遇停」项、或真实数据与设计稿字段冲突 → **停下回报 Claude/用户**，附上你跑的 curl/接口返回证据，不自行决定。

## 4. 交付
- 报告 `docs/test-reports/add-material-modal-fixes-2026-06-28.md`：§1 接口真实返回字段清单（证据）、每项改动文件、对照截图、提交 payload 改前后对比、遇停/待后端补字段项。
