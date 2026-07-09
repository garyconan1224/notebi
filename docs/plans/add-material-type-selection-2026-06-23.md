# 📋4 新建弹窗「先选做什么」两级改造 + 复刻接上(2026-06-23）

> 来源：手测 19 条第 4 条「添加链接应该先选笔记，才有底下各类分类笔记，我还要复刻等等其他功能跟笔记同级，先给做做按钮占位」。
> 产品方向 + UI 方案已由用户逐项拍板（见 §三）。范围：前端 `AddMaterialModal` 类型选择层改造 + 把现有「复刻(replica)」链路提到一级入口。

---

## 一、背景

当前新建弹窗第一步**直接选笔记类型**（自动/视频/图文/音频），没有"先选做什么"这一层。而「复刻(replica)」其实已有完整链路，只是埋在设置里、没独立入口。用户要：先选大类型（笔记 / 复刻 / 未来功能），笔记才出细分；复刻等提为一级、未做的先占位。

## 二、现状（代码事实）

- `frontend/src/components/workspace/AddMaterialModal.tsx`（650 行）：
  - `StagedConfig.videoIntent: 'learning' | 'replica'`、`imageMode: 'replica_prompt' | 'ocr'`（行 48-49）——**复刻意图字段已存在**。
  - `NOTE_TYPE_CARDS`（行 70-74）：auto/video/image_text/audio 四类，渲染在**行 494** `NOTE_TYPE_CARDS.map(...)`；选中值 `selectedNoteType`（行 625）。
  - `NOTE_STYLE_OPTIONS`（行 77-94）：17 个总结风格——**本计划不碰**（那是 ③5/8）。
  - 提交逻辑在行 296-347（payload 组装 + `onAdded`）。
- `frontend/src/lib/resolveItemRoute.ts`：**已按 intent 分流**——`intent !== 'replica'` → `/note`（NoteShell）；`intent === 'replica'` → 原路由（video_detail / image_result，保留逐帧+提示词）。
- 后端 `pipeline_tasks.py` 有 `intent == 'replica'` 分支、`workspace.py` / `routes/workspaces.py` 有 intent 字段、preflight 也带 intent。**复刻后端链路现成**。

> ⚠️ 本机 `rg` 高亮会把命中词显示成 `ln`/`n`（如 `replica` 显示成 `ln`）；核对代码一律用 `Read`。

## 三、用户拍板（产品 + UI 已定）

- 一级「你要做什么」：**笔记 + 复刻（可用）** + **AI 视频 / 分镜脚本 / 二创改写（占位）**。
- **UI 方案 A（渐进 + 主次）**：笔记/复刻 两个大卡为核心；三个占位缩成**一行虚线锁定小卡**；选「笔记」后二级「笔记类型」**才滑出**（一级二级不堆叠）。
- **复刻**：这次接上——选复刻则按素材自动走现有 replica 流程（不另做二级）。
- 占位风格：**沿用 ④15**（灰/锁，点击 `toast`「该功能即将上线」，不跳转）。
- **不碰** 17 个总结风格（`NOTE_STYLE_OPTIONS`）。

## 四、方案（改 `AddMaterialModal.tsx` 类型选择层）

1. **新增一级状态**：`selectedAction: 'note' | 'replica' | 'ai_video' | 'storyboard' | 'rewrite'`（默认 `'note'`）。
2. **一级 UI（方案 A）**，渲染在现 `NOTE_TYPE_CARDS`（行 494）**之前**：
   - 笔记 / 复刻：两个大卡（图标+名+一句话），可选、当前态高亮。
   - AI 视频 / 分镜脚本 / 二创改写：一行虚线锁定小卡（`placeholder`），点击 `toast('该功能即将上线')`，不改 `selectedAction`。
3. **二级（渐进）**：
   - `selectedAction === 'note'` → 渲染现有 `NOTE_TYPE_CARDS`（auto/video/image_text/audio），逻辑不变。
   - `selectedAction === 'replica'` → **不显笔记类型卡**；按素材 sniff 出的媒体类型设 intent：视频→`videoIntent='replica'`、图片→`imageMode='replica_prompt'`。
   - 一级未选定/选占位时，不展开二级（避免堆叠）。
4. **复刻接上（关键）**：提交时 payload 带 `intent`（`'learning'`（笔记）/ `'replica'`（复刻））。**复用现有链路**：`resolveItemRoute` 已按 intent 分流到 NoteShell vs 原始结果页；后端 pipeline intent 分支现成。
   - 小米**先 `Read` 行 296-347 的提交逻辑**，确认 intent 当前怎么进 payload（现可能默认 learning），把"复刻"接到 `intent='replica'`。
5. **占位 toast**：复用项目现有 toast（参考 NoteShell / ④15 用法）。

## 五、涉及文件

- `frontend/src/components/workspace/AddMaterialModal.tsx`（主改：一级选择 + 二级渐进 + 复刻 intent + 占位 toast）
- 可能 `frontend/src/types/workspace.ts` / `services/workspaces.ts`（intent 字段透传，若需）
- `resolveItemRoute.ts`、后端 pipeline intent 分支：**复用，不改**
- 关联测试 `AddMaterialModal.test.tsx` / `AddMaterialModal.local.test.tsx`（更新）

## 六、验收

- 新建弹窗第一步是「你要做什么」：笔记/复刻 两大卡 + 三个占位小卡（虚线锁）。
- 点占位（AI视频/分镜/二创）→ `toast`「即将上线」，不进下一步。
- 选**笔记** → 二级「笔记类型」滑出（auto/视频/图文/音频）→ 生成走 NoteShell，行为同现在。
- 选**复刻** → 不出笔记类型；提交后走**原始结果页**（video_detail / image_result，逐帧+提示词），即 `intent='replica'` 生效。
- 17 个总结风格**原样不动**。
- `npm run build` + `npm test`（含 AddMaterialModal 测试）全绿。

## 七、给小米的执行须知与红线

- **先 `Read` 定位再改**：行 494 类型卡渲染、行 296-347 提交逻辑、`selectedNoteType` / `StagedConfig` 的 intent 流转——`rg` 找位置但**用 `Read` 看真代码**（rg 高亮显示成 `ln`/`n`）。
- **只改类型选择层**：不碰 17 个总结风格、不碰后端 pipeline / resolveItemRoute（复刻复用现成链路）。
- **复刻必须真接通**：选复刻 → `intent='replica'` → 实跑确认走的是原始结果页（不是 NoteShell）。
- 占位项一律 `toast`，不是死链/报错。
- **自验（§6.5 必做）**：`./dev.sh` 实跑三条路径——① 选笔记→出二级→生成走 NoteShell；② 选复刻→走原始结果页；③ 点占位→toast「即将上线」。三条都验到才算完成。
- 不 `git push`；干净工作树；commit 写清「📋4 新建弹窗先选做什么 + 复刻接上」。
- 遇到与现状不符 / intent 流转和预期不一致，回报 Claude，别自行改后端或路由。
