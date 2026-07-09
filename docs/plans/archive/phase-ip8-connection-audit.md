---
phase: IP.8
title: Connection Audit — 把所有现存后端能力体现到前端 UI
status: ready
branch: feat/ip8-connection-audit
created: 2026-05-20
priority: P1
estimate_hours: 6-9
depends_on: IP.7 已合并
---

# IP.8 后端能力 → 前端 UI 全量接通

## 原则（用户决议 2026-05-20）

- **目前后端有的都要在前端体现**
- UI 参考设计稿做（`docs/design/components/*.jsx` + `styles.css`）
- 命名差异以**功能/后端字段**为准，前端文案可意译
- 沿用 H1 design-tokens，禁止 hardcode 颜色

## 子任务

### IP.8.1 启用 Compare Tab（image_compare + text_compare）

**模型**：⭐ 小米 2.5 Pro
**预计**：2-3h

**后端已就绪**：
- `GET /workspaces/{wid}/items/{iid}/image_compare`（N9 做的）
- `GET /workspaces/{wid}/items/{iid}/text_compare`（N10 做的）

**改动文件**：
- `frontend/src/pages/WorkspacePage/TaskboardPage/index.tsx`（去掉 compare tab disabled）
- 新建 `frontend/src/pages/WorkspacePage/TaskboardPage/CompareTab.tsx`
- `frontend/src/services/workspaces.ts`（加 `fetchImageCompare` / `fetchTextCompare`）

**操作步骤**：
1. grep `image_compare\|text_compare` backend/app/routes/workspaces.py 看返回 schema
2. CompareTab 内部按 item 类型分支：
   - 选 1 个图片素材时调 image_compare，按设计稿 cmp- 类布局展示对比（参考 docs/design/styles.css 第 1721 行 .cmp-tbl）
   - 选 1 个文字素材时调 text_compare，相同布局
   - 视频/音频素材：暂不支持，显示 "本类型暂不支持对比"
3. 默认拉当前 workspace 内所有同类素材做对比；如果只有 1 个就显示"至少需要 2 个同类素材"
4. 复用 design/components/taskboard.jsx 里 cmp-* 相关 JSX（约第 200-380 行的对比模块）

**验收**：
- ✅ Compare Tab 不再禁用
- ✅ 至少 2 张图片的 workspace 进 Compare Tab，能看到对比表
- ✅ 文字素材同理
- ✅ pnpm build + lint 新文件零错误

commit: `feat(IP.8.1): Compare Tab 启用（image_compare + text_compare）`

---

### IP.8.2 顶栏接 /admin/system/stats（CPU/内存/磁盘实时）

**模型**：⭐ 小米
**预计**：30min

**后端**：`GET /admin/system/stats`（psutil 实时读，无写）

**改动文件**：
- `frontend/src/layouts/AppShell.tsx`（顶栏，如果还没顶栏就加 1 个）
- 新建 `frontend/src/hooks/useSystemStats.ts`（10s 轮询）
- `frontend/src/services/admin.ts`（新建）

**UI 设计参考**：设计稿原图顶栏有 `后端 127.0.0.1:8010 · online` 圆点 + `GPU 4090 · 71%` chip。

**实际做法**：
- 后端 chip：从 `/admin/system/stats` 拿 status，绿点 = online
- 系统 chip：显示 `CPU 23% · MEM 8.1G/16G`（GPU 字段如返回就显示，没有就显示 CPU/MEM）
- 10s 轮询，失败显示 `离线`

commit: `feat(IP.8.2): AppShell 顶栏接 /admin/system/stats 实时指标`

---

### IP.8.3 Composer 提示词风格 select 接 /prompt_formats_config

**模型**：⭐ 小米
**预计**：1h

**后端**：
- `GET /prompt_formats_config` 返回 `{ formats: [...], active_visual_id, active_textual_id }`
- 用户在设置页可增删 formats

**改动文件**：
- `frontend/src/services/promptFormats.ts`（已存在，确认有 fetchPromptFormatsConfig）
- `frontend/src/pages/WorkbenchPage/Composer.tsx`（"提示词风格" cell 替换 hardcode）

**操作**：
1. Composer mount 时调 fetchPromptFormatsConfig
2. "提示词风格" cell 改成 native select，options 从 formats 中过滤"视觉"类型
3. 默认值 = active_visual_id
4. 选中后写入 Composer state（promptStyle = format.id），IP.1 已透传到 preflight

commit: `feat(IP.8.3): Composer 提示词风格 select 接后端 prompt_formats_config`

---

### IP.8.4 「资料库」侧栏入口跳 /search

**模型**：⭐ 小米
**预计**：15min

**改动文件**：`frontend/src/layouts/AppShell.tsx`

**操作**：
1. NAV_ITEMS 里 library 项把 `disabled: true` 去掉
2. path 改成 `/search`（已存在的页面）
3. label 保留"资料库"

commit: `feat(IP.8.4): 资料库侧栏入口启用，跳 /search`

---

### IP.8.5 字幕单独抽取（transcript /extract）

**模型**：⭐ 小米
**预计**：1.5h

**后端**：`POST /transcript/extract` 入参看 transcript.py TranscriptRequest schema

**用户场景**：用户想在跑完整 pipeline 前**只看一眼字幕内容**，决定要不要花时间分析

**改动文件**：
- `frontend/src/pages/WorkspacePage/TaskboardPage/MaterialCard.tsx`（卡片菜单加"快速抽字幕"）
- 新建 `frontend/src/components/workspace/TranscriptPreviewModal.tsx`（轻量预览，不入库）

**操作步骤**：
1. grep `class TranscriptRequest` backend/app/routes/transcript.py 看字段（URL / ASR model / 等）
2. MaterialCard 菜单（IP.5 加的"…"）加新项「快速抽字幕」（仅 video/audio 类型显示）
3. 点击 → 弹 TranscriptPreviewModal
4. modal 内调 POST /transcript/extract，spinner 转
5. 返回后显示纯文本字幕（可滚动），底部 "关闭" + "粘进任务（待支持）" 按钮
6. 结果**不写入 item.results**，仅前端展示，关闭即丢

commit: `feat(IP.8.5): MaterialCard 加"快速抽字幕"快捷入口（不入库预览）`

---

### IP.8.6 N4 添加素材模态智能默认勾选复核（先制作，后续修改）

**模型**：⭐ 小米
**预计**：1h（先快速过一遍，发现问题再开新子任务）

**改动文件**：`frontend/src/components/workspace/AddMaterialModal.tsx`（或对应路径，先 grep）

**操作步骤**：
1. grep `AddMaterialModal\|智能默认勾选\|defaultTab` 全前端
2. 走一遍 N4 设计：粘 URL → 自动识别类型 → 智能默认勾选哪些任务
3. 跑一次：粘一个 B 站 URL → 看模态是否自动勾选 video + transcribe + analyze
4. 与设计稿 docs/design/components/preflight.jsx 对照
5. 如发现回归（IP.7 改流程导致默认勾选失效）：
   - **不要现场修**，只在 commit message 末尾"已发现"区记录
   - 列出哪些勾选项失效、设计稿期待的勾选项
6. 如没发现回归：commit 空 diff（写一行说明即可）

commit: `chore(IP.8.6): N4 智能默认勾选复核记录` （内容根据实际发现）

---

## 完工标准

- ✅ 6 子任务独立 commit
- ✅ `pytest tests/backend -q` 全绿
- ✅ `pnpm build` + `pnpm lint`（新文件）零错误
- ✅ 视觉对照设计稿，cmp 表格/顶栏 chip/select 风格/资料库入口/MaterialCard 菜单项 全部到位

## 与下一阶段的关系

完成后整个 H 系列首页 **100% 真接通**（所有现存后端能力都在前端体现）。
然后可以开 **[C] AI 导演**（Style 报告 + Storyboard shot 网格 + 生成模型 API 接入）或 **[D] 开源准备**。
