# 计划：知识库合集范围 / 设置页合并+默认模型 / 笔记媒体导出 / 复刻细化调研

> 日期：2026-07-02　分支：建议接 `feat/global-knowledge` 或新切
> 作者：Claude（终端，已实测调研）　执行：小米　审查：Codex
> 说明：四个任务方向均已明确、可直接执行。任务 4（复刻）用户已拍板「砍掉 story/compete，只留提示词复刻并打磨」。

---

## 任务 1：知识库支持「选合集范围 + 新会话」

### 现状（已核实）
- `/knowledge` 页与后端（`global_knowledge.py` + `routes/knowledge.py`）已由小米实现，目前是**纯全局**（索引所有非 trashed 合集）。
- `KnowledgeAskRequest` 只有 `question`，**没有合集范围**（`routes/knowledge.py:20`）。
- 「新对话」按钮已有（左侧栏），但历史会话是否持久化待确认。

### 目标
参考截图：可**新建会话**，并能选择**限定到某个 / 某几个合集**提问（不选=全局）。

### 做法
**后端：**
- `KnowledgeAskRequest` 增加可选 `workspace_ids: List[str] | None = None`。
- `global_knowledge.ask_global` / 索引构建：当传了 `workspace_ids` 时，只对这些合集的 items 建/取子索引检索；不传=全局（保持现状）。
  - 实现建议：`_indexable_records` 支持按 `workspace_ids` 过滤；子范围索引缓存键 = 该范围的 items_hash 聚合（与全局索引分开缓存，避免互相失效）。
- 来源卡已带 `workspace_id/workspace_name`，无需改。

**前端（`pages/KnowledgePage`）：**
- 顶部或输入框上方加**合集多选器**：默认「全部笔记」，可勾选一个/多个合集。数据源用 `fetchLibrary` 或 workspaces 列表里 kind=note/replica 的合集。
- 选中后 `askKnowledge(question, workspace_ids)` 带上范围；空态/占位提示按范围更新（如「已限定 2 个合集」）。
- 「新对话」：清空当前 messages 开新会话（若要持久化历史会话列表，另评估，本任务先做「能开新会话 + 选范围」）。

### 验收
- 不选合集时与现在一致（全局）；选 1-N 个合集时答案只来自这些合集（来源卡验证）。
- 新对话能清空重开；`npm run build` 通过。

---

## 任务 2：设置页——供应商与模型合并 + 新增「默认模型」区

### 现状（已核实）
- `ProvidersAndModelsPage.tsx` 内部用 Tab 切「供应商管理」「模型管理」两个子视图（`TabKey = 'providers' | 'models'`）。
- 模型能力字段：`text_model`(chat) / `vision_model` / `embedding_model` 已有；`rerank_model` 需按
  [global-knowledge 计划的任务 C](global-knowledge-nav-embedding-rerank-2026-07-02.md) 补上。

### 目标
- 把「供应商」和「模型」**放在同一页**（不再 Tab 切换，或改成同页上下两区）。
- 新增「**默认模型**」区：为每种用途（对话/视觉/嵌入/重排）**指定默认用哪个模型**。

### 做法（前端为主）
- `ProvidersAndModelsPage.tsx`：去掉 Tab，改为单页分区布局：
  1. 区块一「供应商」：现有供应商管理内容。
  2. 区块二「模型」：现有模型管理内容。
  3. **区块三「默认模型」**（新增）：四个选择器 —— 对话模型 / 视觉模型 / 嵌入模型 / 重排模型，各自从「已启用供应商的可用模型」里选，保存到 `text_model / vision_model / embedding_model / rerank_model`。
- 后端：确认设置读写接口支持这四个字段（`embedding_model` 已有；`rerank_model` 依赖任务 C 先落地）。
- 说明文案：默认模型用于全局默认；留空回落系统默认常量。

### 依赖
- 「重排模型」依赖 [global-knowledge 计划任务 C](global-knowledge-nav-embedding-rerank-2026-07-02.md) 的 `rerank_model` 字段先落地。若 C 未做，本任务先做 对话/视觉/嵌入 三个，rerank 留位。

### 验收
- 设置页一屏能看到 供应商 + 模型 + 默认模型；四个默认模型可选可存；刷新回显正确；`npm run build` 通过。

---

## 任务 3：笔记结果页——按类型导出媒体本体

### 现状（已核实）
`/static` 已挂载整个 `data/` 目录（`main.py`），媒体文件（视频/音频/图）本来就能通过静态 URL 直接下载。各结果页导出按钮现状：
- **VideoResultPage**：有「导出字幕」(srt/vtt/ass) + 「导出复刻包」，**缺「导出视频」本体**。
- **AudioResultPage**：有「导出字幕」，**缺「导出音频」本体**。
- **ImageResultPage**：只有隐藏的「工作包」，**缺「导出图」**。

### 目标
- 视频笔记：导出**视频** + 字幕（字幕已有 → 只补视频）。
- 音频笔记：导出**音频** + 字幕（字幕已有 → 只补音频）。
- 图文笔记：导出**图**（可多张打包或逐张）。

### 做法
- 媒体文件路径：结果页 `result` 里已有媒体的 static url / 文件路径（视频 `save_path`/`downloaded_files`、音频 `audio.filename`、图 `frames`/image 列表）。
- 前端：在各结果页的导出区加按钮：
  - VideoResultPage：加「导出视频」→ 触发下载该视频的 static url（`<a download>` 或 `window.open`）。
  - AudioResultPage：加「导出音频」→ 同理下载音频 static url。
  - ImageResultPage：加「导出图」→ 单张直接下载；多张则前端逐个下载或走后端 zip（见下）。
- 若某类型有多文件（如图文多图、多分P视频）需要打包：复用/新增后端 zip 端点（工作空间已有 zip 导出逻辑可参考 `_copy_task_config`/工作包导出）。**单文件优先直接静态下载，避免加后端负担。**
- 统一放进现有「导出」下拉/按钮组里，风格与现有字幕导出一致。

### 红线
- 优先用已有 static url 直接下载，不新增重后端逻辑；多文件打包才考虑 zip 端点。
- 找不到媒体文件（如纯文本笔记）时按钮禁用/隐藏，不报错。

### 验收
- 视频页能下视频、音频页能下音频、图文页能下图；文件能正常打开；`npm run build` 通过。

---

## 任务 4：复刻功能——细化调研报告（看完由用户定方向，本文不含改动）

### 4.1 现状全链路（已核实代码）
- **入口**：添加素材选「复刻」action → 创建 `kind=replica` 合集；二级类型 `replica_kind ∈ {prompt, story, compete}`（`AddMaterialModal.tsx:290`）。
- **图片复刻**：走 `image_mode=replica_prompt` → `ImageResultPage`：对图片生成**多风格可复用提示词**（tab 切风格 + 一键复制 + 版本），**功能可用**（`ImageResultPage.tsx` promptStyle/promptVersions/copy）。
- **视频复刻**：走 `intent=replica`：
  - `replica_kind=prompt`：只跑 **下载→截帧**，跳过转写和总结（`pipeline_tasks.py:2418`）；逐帧出 MJ 风格提示词。
  - 结果进 `VideoResultPage`：有「导出复刻包」（选中帧打包）、逐帧提示词。
  - 视频走 Gemini 视频模型时用**复刻专用 prompt**（标注镜头/转场/构图/拍摄手法，`pipeline_tasks.py:255`）。
  - 路由已修：`intent=replica` → `video_detail` 并自动打开（`ProcessingPage:73/318`）。

### 4.2 现存问题（细化）
1. **story / compete 是空壳**：前端能选这两种，但后端 `pipeline_tasks.py` **只判断 `replica_kind=='prompt'`**，story/compete 没有任何分支 → 选了走默认笔记流程，产出与「笔记」无异，名不副实。
2. **缺 story/compete 的产出定义**：
   - `prompt`（已做）=可复用视觉提示词（复刻画面）。
   - `story`（未定义）=推测应产出「叙事/分镜脚本」（结构+每段作用+台词/运镜）。
   - `compete`（未定义）=推测应产出「竞品对标拆解」（对标多条同题材，差异/优劣/可借鉴点）。
   - **这三者产出差异需用户先拍板**，否则无法实现。
3. **复刻没有专属结果视图**：复用「笔记」的 `VideoResultPage`，复刻的核心产出（提示词卡片 / 分镜脚本 / 一键全复制 / 导出脚本）没有为复刻单独优化的呈现。
4. **图片 vs 视频复刻体验不统一**：图片复刻是「多风格提示词 tab」，视频复刻是「逐帧提示词 + 复刻包」，两条路交互差异大，用户心智不一致。
5. **入口/命名**：`prompt/story/compete` 对新手不直观，缺少每种「产出什么」的说明。

### 4.3 用户已拍板方向：砍掉 story/compete，只留「提示词复刻」并打磨

**4.3.1 砍掉 story/compete（前端）**
- `AddMaterialModal.tsx`：移除 `replica_kind` 的 story/compete 选项（`useState<'prompt'|'story'|'compete'>` 改为只有 `prompt`，或直接去掉二级选择，复刻默认就是提示词复刻）。
- 提交 payload 时 `replica_kind` 恒为 `prompt`（或整段移除，后端已默认按 prompt 处理）。
- 核对后端 `pipeline_tasks.py` 里 `replica_kind=='prompt'` 分支：现在没了 story/compete，逻辑天然收敛，无需改后端（默认即 prompt）；确认非 prompt 时也不会走错分支。

**4.3.2 打磨提示词复刻——专属结果视图 + 统一图/视频体验**
- **图片复刻**（`ImageResultPage`，已可用）：作为标杆——多风格提示词 tab + 一键复制 + 版本。保留，视觉可微调对齐视频。
- **视频复刻**（`VideoResultPage`）：目前是逐帧提示词 + 复刻包，体验偏「笔记」。打磨点：
  1. 提示词**卡片化**呈现（每帧一张卡：缩略图 + 提示词 + 单卡复制），对齐图片复刻的卡片感。
  2. 加「**一键全复制**」（把所有帧提示词按顺序拼成一段，方便整体粘到出图工具）。
  3. 「导出复刻包」保留，补一个「**导出提示词脚本**」（.txt/.md：逐帧提示词 + 时间点）。
- **统一心智**：图/视频复刻都围绕「可复用提示词」这一核心产出组织页面（卡片 + 复制 + 导出），减少两条路的交互差异。

**4.3.3 入口文案**
- 复刻入口去掉 story/compete 后，加一句说明「复刻 = 从视频/图片逐帧提取可复用的画面提示词，用于二次创作/出图」。

### 4.4 验收（任务 4）
- 添加素材的复刻不再有 story/compete，只有提示词复刻；选复刻能正常跑通、结果进复刻视图。
- 视频复刻结果页：提示词卡片化 + 一键全复制 + 导出提示词脚本可用；图片复刻保持可用。
- `npm run build` 通过；跑一个真实视频复刻验证端到端。

---

## 给小米的红线（任务 1-3）
- 后端验证前确认**新进程**；前端一律 `npm run build` 核对。
- 任务 1 不传 workspace_ids 时行为与现状完全一致（回归全局问答）。
- 任务 2「重排模型」依赖 global-knowledge 计划任务 C 的 `rerank_model` 字段；未落地则先做 对话/视觉/嵌入 三个。
- 任务 3 优先用 static url 直接下载，不新增重后端逻辑；找不到媒体时按钮禁用不报错。
- 任务 4 砍 story/compete 只动前端选项，**别误删后端 prompt 分支**；打磨结果视图别破坏现有笔记视图（复刻走的是同一 VideoResultPage，改动要按 intent=replica 区分，不影响学习笔记）。
- 每个任务独立 commit + 自测证据；不装新依赖、不改 `.env`、不 `git push`。
