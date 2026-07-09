---
title: Track K · 添加链接意图分流 + 图文默认总结路由
status: ready
owner: Claude 桌面定方案 -> 小米 v2.5pro 终端执行 -> Codex 审查
created: 2026-06-18
scope: AddMaterialModal 添加链接入口、note task payload、图文源 MD 还原、基于源 MD 的标准总结、默认总结模板推荐
non_goals: 不实现复刻分析完整流程、不改数据库 schema、不拆 NoteShell 产品页、不做音频/视频结果页重构
---

# Track K · 添加链接意图分流 + 图文默认总结路由

> 本计划只解决一件事：用户添加链接后，先选择“要做什么”，再进入对应设置；选择“笔记”后，再按视频笔记 / 图文笔记 / 音频笔记分流。图文笔记完成后先把图片和原文还原成可读的 `source.md`，再基于 `source.md` 生成标准总结正文，并给出合适的默认总结方式。
>
> 当前第一版只把“笔记”链路做实；“复刻分析 / 竞品分析 / 资料收藏”等入口先做占位，不启动任务。

---

## 0. 当前背景

当前 `AddMaterialModal` 的主路径是：

```text
输入链接 -> 生成笔记 -> 后端 sniff/probe 自动判断 -> note task -> NoteShell
```

问题：

1. 用户添加链接时，产品意图不清楚：同一个链接可能是“学习笔记”、也可能是“复刻分析”。
2. 选择“笔记”后，视频 / 图文 / 音频的设置混在一起，图文也会看到视频化的配图/截帧语义。
3. 图文笔记里的首要任务不是逐图描述，而是先把文字型图片、混合型图片、演示型图片里的有效信息还原成 `source.md`，再基于源 MD 做标准总结。
4. 当前已经新增 `tool_recommendation` 总结模板，但还没有把它接成图文默认推荐。

---

## 1. 产品结论

### 1.1 添加链接后的层级

添加链接弹窗应该变成三层渐进：

```text
① 输入源
   粘贴链接，自动 sniff 展示平台/标题/可能类型

② 选择任务
   笔记       可执行
   复刻分析   占位
   竞品分析   占位
   资料收藏   占位

③ 笔记类型与设置
   自动识别
   视频笔记
   图文笔记
   音频笔记
```

不要把“视频笔记 / 图文笔记 / 音频笔记”放在第一层；它们是“笔记”任务下面的子类型。

### 1.2 第一版实际支持范围

| 层级 | 第一版行为 |
|---|---|
| 笔记 | 可执行 |
| 复刻分析 | 卡片可见，显示“即将支持”，点击不提交 |
| 竞品分析 | 卡片可见，显示“即将支持”，点击不提交 |
| 资料收藏 | 卡片可见，显示“即将支持”，点击不提交 |
| 自动识别 | 默认；沿用 sniff/probe |
| 视频笔记 | 手动 override 为 video note |
| 图文笔记 | 手动 override 为 image_text note |
| 音频笔记 | 手动 override 为 audio note |

---

## 2. UI 方案

### 2.1 视觉结构

弹窗仍用现有 `AddMaterialModal`，不要新建页面。布局建议：

```text
┌────────────────────────────────────────────┐
│ ADD MATERIAL · 添加素材                     │
│ 添加素材                                    │
│ 当前工作空间 · 已识别平台/标题              │
├────────────────────────────────────────────┤
│ ① 输入源                                   │
│ [ link icon ][ url input / url preview ]    │
│ [已识别 小红书 · 标题]                      │
├────────────────────────────────────────────┤
│ ② 选择任务                                  │
│ [笔记] [复刻分析] [竞品分析] [资料收藏]      │
├────────────────────────────────────────────┤
│ ③ 笔记类型                                  │
│ [自动识别] [视频笔记] [图文笔记] [音频笔记]  │
│                                            │
│ 这里根据选择显示针对设置                    │
├────────────────────────────────────────────┤
│ 状态说明                       [开始生成]   │
└────────────────────────────────────────────┘
```

### 2.2 任务卡片

任务卡片用 2x2 grid，卡片尺寸稳定，不要因为文案变化跳动。

- `笔记`：FileText 图标，主色强调，可执行。
- `复刻分析`：Sparkles 或 Wand2，置灰 badge `即将支持`。
- `竞品分析`：BarChart 或 Search，置灰 badge `即将支持`。
- `资料收藏`：Bookmark，置灰 badge `即将支持`。

点击占位卡片：

- 不切换为可提交状态。
- toast：`这个入口先占位，当前请使用「笔记」。`
- 卡片可短暂 shake 或 pulse 一下，但不要弹第二层复杂提示。

### 2.3 笔记类型卡片

当任务选择 `笔记` 后，显示笔记类型 segmented cards：

| 类型 | 文案 | 设置区 |
|---|---|---|
| 自动识别 | 根据链接自动选择 | 显示 sniff 结果和“可手动改” |
| 视频笔记 | 字幕、截图、时间戳总结 | 保留现有配图/视觉模型/取画面 |
| 图文笔记 | OCR、图片理解、图文总结 | 图文模式、OCR/视觉、默认总结识别 |
| 音频笔记 | 转写、会议/播客总结 | 第一版只显示占位说明，提交可先走 auto/audio payload |

### 2.4 动画建议

目标是“清晰地从任务进入子设置”，不要做花哨 hero。

建议动画：

1. `② 选择任务` 卡片点击后，卡片 active ring 从外向内收束。
2. `③ 笔记类型` 区块用 collapse + fade + 轻微 slide-down 出现。
3. 切换笔记类型时，设置区 crossfade，不整块弹跳。
4. 识别到链接类型后，`自动识别` 卡片右上角出现小 badge：
   - `推荐：图文笔记`
   - `推荐：视频笔记`
   - `推荐：音频笔记`

实现建议：

- CSS transition 即可，不引入新动画库。
- `max-height + opacity + transform` 做展开。
- 尊重 `prefers-reduced-motion: reduce`，关闭位移动画。

示例 CSS 方向：

```css
.intent-panel {
  transition: opacity .18s ease, transform .18s ease, max-height .22s ease;
}

.intent-panel[data-open="true"] {
  opacity: 1;
  transform: translateY(0);
}

.intent-panel[data-open="false"] {
  opacity: 0;
  transform: translateY(-4px);
}

@media (prefers-reduced-motion: reduce) {
  .intent-panel {
    transition: none;
    transform: none;
  }
}
```

---

## 3. 数据模型与接口

### 3.1 前端状态

`AddMaterialModal` 增加两个状态：

```ts
type MaterialIntent = 'note' | 'replica' | 'competitive' | 'bookmark'
type NoteMediaKind = 'auto' | 'video' | 'image_text' | 'audio' | 'text'
```

默认：

```ts
materialIntent = 'note'
noteMediaKind = 'auto'
```

### 3.2 generate-note request

`GenerateNoteRequest` 增加：

```py
intent: str = "note"  # 第一版只允许 note 真执行
note_media_kind: str = "auto"  # auto | video | image_text | audio | text
```

前端 `generateNote(...)` 透传：

```ts
intent?: 'note' | 'replica' | 'competitive' | 'bookmark'
noteMediaKind?: 'auto' | 'video' | 'image_text' | 'audio' | 'text'
```

### 3.3 后端 item / task payload

创建 note task 时 payload 写入：

```py
payload["intent"] = "note"
payload["note_media_kind"] = req.note_media_kind
payload["workspace_id"] = workspace_id
payload["item_id"] = item.item_id
```

`WorkspaceItem.preflight.intent` 可以继续用现有字段，但不要把 `note_media_kind` 塞进 `intent`，避免和 `learning/replica` 混淆。

建议写入：

```py
item.preflight.tasks["note"] = {
    "media_kind": req.note_media_kind,
}
```

若第一版不方便持久化到 preflight，至少保证 task payload 和 result 有该字段。

---

## 4. 后端分流逻辑

### 4.1 用户选择优先

后端 PROBE 当前会识别 `note_kind=image_text/video/...`。新增规则：

1. 如果 `payload.note_media_kind == "auto"`：沿用现有 probe。
2. 如果用户选择 `image_text`：优先按图文笔记处理。
3. 如果用户选择 `video`：优先按视频笔记处理。
4. 如果用户选择 `audio`：优先按音频笔记处理。
5. 如果选择和实际链接明显冲突，第一版不要失败；记录 warning log，并尽量回退 probe。

示例：

```py
requested_kind = str(payload.get("note_media_kind") or "auto")
if requested_kind != "auto":
    runner.append_log(task_id, f"用户选择笔记类型：{requested_kind}")
```

### 4.2 图文内容分类

新增轻量函数：

```py
def classify_image_text_note(results: dict[str, Any]) -> dict[str, str]:
    ...
```

第一版只识别：

```text
tool_recommendation
unknown
```

输入材料：

- `source_text_enriched` / `source.md`（优先）
- `source_md_raw`
- `markdown`
- `image_infos[].extracted_text`
- `image_infos[].content_summary`
- `image_infos[].action_steps`
- `image_infos[].visual_elements`
- `image_infos[].description`
- `image_infos[].ocr_text`

工具推荐关键词第一版：

```text
工具, App, 应用, 软件, 插件, 网站, 推荐, 支持, 功能, 工作流,
Markdown, Obsidian, 导出, 记录, 转写, 效率, iOS, Mac, Windows
```

输出：

```py
{
    "content_category": "tool_recommendation",
    "default_summary_template": "tool_recommendation",
}
```

写入 task result / item results：

```py
result["content_category"] = category
result["default_summary_template"] = default_template
```

### 4.3 图文源 MD 还原与标准总结链路

更正后的图文笔记主链路必须是：

```text
原始文字 + 图片
  -> VLM 逐图理解
  -> 生成 source.md / source_text_enriched
  -> 基于 source.md 做标准总结
  -> 写入 note.md / note_body
```

职责边界：

| 产物 | 职责 | 不应包含 |
|---|---|---|
| `image_infos` | 单图结构化理解结果，供组装 source.md 使用 | 面向用户的最终总结 |
| `source.md` / `source_text_enriched` | 源材料还原层；尽量完整承载图片文字、步骤、表格、关键视觉信息 | 大段总结判断、泛泛学习心得 |
| `note.md` / `note_body` | 基于 `source.md` 的标准总结层；面向阅读和复用 | `图1/OCR/图片描述/视觉元素列表` 这类材料调试痕迹 |

图片进入 `source.md` 的规则：

1. 文字型图片：把图片文字转为 Markdown 正文、标题、列表或表格；不要插入原图。
2. 混合型图片：文字部分转 Markdown；图标、流程、界面状态等视觉信息只保留对理解有价值的说明。
3. 演示型 / 流程型图片：能用文字表达清楚的，转成步骤；位置关系、界面状态、箭头流程不可替代时，在对应段落保留图片引用。
4. 图标 / Logo / 装饰图：默认跳过；只有它承载产品名、按钮状态、关键入口时才写入源 MD。
5. 表格 / 对比图：优先还原成 Markdown 表格；还原不了完整结构时，保留关键行列和图片引用。

`note.md` 生成规则：

1. `note_body` 必须以 `source.md` / `source_text_enriched` 为主输入，而不是重新逐图描述 `image_infos`。
2. `image_infos` 可以作为补充上下文，但 prompt 必须要求模型把它们融合进 `source.md` 语义，不允许输出“图 1 显示……”这类逐图描述。
3. 图文默认总结应使用图文专用 standard prompt，不走视频 standard 的时间戳规则。
4. 内容分类可以作为总结风格提示，但不能跳过源 MD 还原。例如工具推荐、教程、清单都应先有源 MD，再生成总结。
5. 如果 `source.md` 为空且图片 VLM 也没有提取到有效内容，任务应失败或明确提示“缺少可总结内容”，不能产出空 note。

### 4.4 后续可扩展分类

先不实现，但保留枚举位置：

```text
tutorial
opinion
checklist
product_recommendation
text_card
unknown
```

---

## 5. 总结默认推荐

### 5.1 NewSummaryModal 默认选中

`GET /note` 或 `item.results` 应让前端能拿到：

```ts
default_summary_template?: string
content_category?: string
```

如果 NoteShell 当前没有把 results 暴露给 `SummariesTab`，第一版可以在 `ItemNote` API 增加：

```py
"summary_hint": {
    "content_category": results.get("content_category", ""),
    "default_template": results.get("default_summary_template", ""),
}
```

前端传给 `SummariesTab`：

```tsx
<SummariesTab defaultTemplate={note.summary_hint?.default_template} ... />
```

`NewSummaryModal` 初始 template：

```ts
const [template, setTemplate] = useState(defaultTemplate || 'standard')
```

注意 defaultTemplate 变化时要同步，但不要覆盖用户已经手动选择的模板。

### 5.2 工具推荐模板行为

已存在/计划保留：

- `tool_recommendation`
- 不插图
- 不写视频时间点
- 输出工具推荐结构

工具推荐适合文字型图文，不等于所有图文默认。

---

## 6. 执行拆分

### Step A：入口 UI + payload 分流

目标：

- AddMaterialModal 展示任务卡片。
- 选择“笔记”后展示笔记类型卡片。
- 占位卡可见但不可执行。
- `generate-note` 透传 `intent/note_media_kind`。
- 后端接收并写入 task payload/result。

建议文件：

- `frontend/src/components/workspace/AddMaterialModal.tsx`
- `frontend/src/services/workspaces.ts`
- `frontend/src/__tests__/AddMaterialModal.test.tsx`
- `backend/app/routes/workspaces.py`
- `tests/backend/test_generate_note.py`

验收：

- `pnpm build`
- AddMaterialModal 相关测试通过。
- generate-note payload 包含 `intent=note` 和 `note_media_kind`。

### Step B：图文分类 + 默认总结推荐

目标：

- 图文 note task 完成后分类。
- 工具推荐类默认推荐 `tool_recommendation`。
- NewSummaryModal 默认选中“工具推荐”。

建议文件：

- `backend/app/services/pipeline_tasks.py`
- `backend/app/routes/workspaces.py`
- `backend/app/services/summary_generator.py`
- `backend/tests/test_summary_generator.py`
- `tests/backend/test_pipeline_tasks.py`
- `tests/backend/test_item_note_write.py`
- `frontend/src/components/NewSummaryModal.tsx`
- `frontend/src/components/SummariesTab.tsx`
- `frontend/src/types/workspace.ts`

验收：

- 工具推荐类图文 item 的 note API 暴露 `summary_hint.default_template=tool_recommendation`。
- 新建总结弹窗默认选中“工具推荐”。
- 视频 standard 总结时间戳行为不回退。

---

## 7. 交互验收清单

1. 粘贴小红书工具推荐链接。
2. 弹窗显示：
   - ① 输入源
   - ② 选择任务：笔记 / 复刻分析 / 竞品分析 / 资料收藏
   - ③ 笔记类型：自动识别 / 视频笔记 / 图文笔记 / 音频笔记
3. 选择“图文笔记”后，设置区不再显示视频时长/截帧文案，应显示图文/OCR/视觉理解相关文案。
4. 生成完成后进入 NoteShell。
5. 打开“新建总结”，默认选中“工具推荐”。
6. 生成的工具推荐总结：
   - 没有图片 Markdown。
   - 没有 `[mm:ss]` 时间点。
   - 有“一句话判断 / 解决的问题 / 核心功能与亮点 / 适合谁使用 / 局限与注意”。

---

## 8. 给小米 v2.5pro 终端的执行提示词

```text
你是执行者，只按下面任务改代码。
不要重新规划，不要全项目调查，不要开 subagent。
启动只跑：
git status --short --branch
git log --oneline -5

注意：当前 main 可能已有未提交改动，先确认这些改动是否属于“图文笔记卡 26% / 查看结果跳转 / 图文总结模板 / 工具推荐模板”这一批。如果发现不相关改动，停止汇报，不要覆盖。

只读和本任务直接相关的文件；超过 300 行的文件先 rg 定位再 sed 片段读取。
完成后跑相关测试，提交一个 commit。
最后回复：改了哪些文件、测试结果、commit hash，并给出可复制给 Codex 的审查提示词。

任务：Track K 添加链接意图分流 + 图文源 MD 还原 + 基于源 MD 的标准总结

目标：
1. AddMaterialModal 从“直接生成笔记”改成三层：
   - ① 输入源
   - ② 选择任务：笔记 / 复刻分析 / 竞品分析 / 资料收藏
   - ③ 笔记类型：自动识别 / 视频笔记 / 图文笔记 / 音频笔记
2. 第一版只有“笔记”可执行；复刻分析、竞品分析、资料收藏只做占位卡，点击 toast 提示“即将支持”，不得提交任务。
3. 笔记类型选择透传到后端 generate-note：
   - intent: "note"
   - note_media_kind: "auto" | "video" | "image_text" | "audio" | "text"
4. 后端 GenerateNoteRequest 接收 intent/note_media_kind，并写入 task payload。用户选择 image_text/video/audio 时，note task 应记录该选择，auto 时沿用现有 sniff/probe。
5. 图文 note task 的主链路改成“先还原 source.md，再基于 source.md 总结”：
   - 原始文字 + 图片
   - VLM 逐图理解
   - 生成 source.md / source_text_enriched
   - 基于 source.md 生成标准总结 note.md / note_body
6. 图文图片处理规则：
   - 文字型图片：把图片文字转成 Markdown 正文、标题、列表或表格，写入 source.md；不要在 note.md 里描述“图片上有文字”。
   - 混合型图片：文字转 Markdown；图标、流程、界面状态只保留对理解有价值的说明。
   - 演示型/流程型图片：能转文字的转成步骤；位置关系、界面状态、箭头流程不可替代时，在 source.md 对应段落保留图片引用。
   - 表格/对比图：优先还原为 Markdown 表格；结构不完整时保留关键行列和图片引用。
   - Logo/装饰图：默认跳过，除非承载产品名、按钮入口、关键状态。
7. note.md / note_body 只能基于 source.md 做标准总结，不允许直接逐图描述 image_infos。最终正文不应该出现“图1 显示 / OCR / 图片描述 / 视觉元素列表”这类材料层痕迹。
8. 图文 standard 总结必须是图文专用，不要套视频 standard 的时间戳规则；如果内容明显是教程/工作流，可以在 standard prompt 里组织成“掌握什么 / 前置条件 / 核心步骤 / 常见坑 / 验收方法”这类结构，但仍然必须基于 source.md。
9. 图文 note task 完成后做轻量内容分类。第一版只识别：
   - tool_recommendation
   - unknown
10. 工具推荐识别依据应优先使用 source.md / source_text_enriched，其次才看 image_infos。关键词包括工具/App/应用/软件/插件/网站/推荐/支持/功能/工作流/Markdown/Obsidian/导出/记录/转写/效率/iOS/Mac/Windows 等信号。
11. 识别为工具推荐时，结果里写入：
   - content_category = "tool_recommendation"
   - default_summary_template = "tool_recommendation"
12. NoteShell 的 note API 暴露 summary_hint：
   - content_category
   - default_template
13. NewSummaryModal 支持 defaultTemplate；当 default_template=tool_recommendation 时，打开“新建总结”默认选中“工具推荐”。
14. UI 动画只用 CSS transition，不引入新依赖。展开/切换用轻微 fade + slide，尊重 prefers-reduced-motion。

建议涉及文件：
- frontend/src/components/workspace/AddMaterialModal.tsx
- frontend/src/services/workspaces.ts
- frontend/src/__tests__/AddMaterialModal.test.tsx
- frontend/src/components/NewSummaryModal.tsx
- frontend/src/components/SummariesTab.tsx
- frontend/src/types/workspace.ts
- backend/app/routes/workspaces.py
- backend/app/services/pipeline_tasks.py
- backend/app/services/summary_generator.py
- backend/app/services/summary_templates.py
- tests/backend/test_generate_note.py
- tests/backend/test_pipeline_tasks.py
- tests/backend/test_item_note_write.py
- backend/tests/test_summary_generator.py

禁止事项：
- 不实现复刻分析完整流程，只做占位。
- 不改数据库 schema。
- 不新建 NoteShell 产品页。
- 不引入动画库或新依赖。
- 不破坏视频 standard 总结时间戳行为。
- 不覆盖用户手动编辑过的 note.md。
- 不让 VLM 逐图分析结果直接变成最终 note.md。
- 不在 note.md 输出“图1/OCR/图片描述/视觉元素”这类材料调试文本。

验收标准：
1. pnpm build 通过。
2. AddMaterialModal 测试通过。
3. generate-note 后端测试通过，payload 包含 intent/note_media_kind/workspace_id/item_id。
4. 图文任务 result 保存 source_text_enriched 或等价字段；导出的/落盘的 source.md 能看到图片文字、步骤、表格等源材料还原结果。
5. note_body / note.md 基于 source.md 做标准总结，正文不出现逐图描述、OCR 调试词、图片分类标签。
6. 文字型图片内容能进入 source.md，并进一步影响 note.md 总结。
7. 演示型/流程型图片能转成步骤；不可替代图片才保留图片引用。
8. 图文工具推荐类任务 result 包含 content_category/default_summary_template。
9. Note API 返回 summary_hint。
10. 新建总结弹窗默认选中“工具推荐”。
11. 生成工具推荐总结时不插图、不写时间点。
```

---

## 9. 给 Codex 的审查提示词

```text
你只做验收审查，不写业务功能。
请检查本次 commit 是否完成任务，必要时跑相关测试。
结论第一行写：通过 / 不通过 / 需要补充验证。

任务目标：
AddMaterialModal 添加链接后先选择任务意图；选择“笔记”后再选择视频/图文/音频笔记；图文笔记必须先把原文和图片还原成 source.md，再基于 source.md 生成标准总结 note.md；图文工具推荐类内容仍需默认推荐 tool_recommendation 总结模板。

重点审查：
1. UI 是否按三层结构实现，复刻分析/竞品分析/资料收藏是否只是占位且不会提交任务。
2. generate-note 是否透传并持久记录 intent/note_media_kind，且没有破坏现有自动识别。
3. 图文 image_text 链路是否先生成 source.md / source_text_enriched，且其中包含图片文字、步骤、表格、关键视觉信息的源材料还原。
4. note.md / note_body 是否基于 source.md 做标准总结，而不是逐图描述 image_infos；正文不应出现“图1/OCR/图片描述/视觉元素列表”等材料调试痕迹。
5. 文字型图片是否转文字进入 source.md；演示型/流程型图片是否转步骤，只有不可替代时才保留图片引用。
6. 图文工具推荐分类是否优先基于 source.md 写入 content_category/default_summary_template，Note API 是否暴露 summary_hint。
7. NewSummaryModal 是否默认选中后端推荐模板，且用户手动切换模板不会被覆盖。
8. 视频 standard 总结时间戳行为是否未回退。

建议验证：
- pnpm build
- frontend AddMaterialModal 相关测试
- backend summary_generator / generate_note / image_text pipeline 相关 pytest
- 构造或使用真实图文任务，检查 source.md 和 note.md 的职责边界：source.md 是源材料，note.md 是总结
```
