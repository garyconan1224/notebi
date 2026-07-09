# 笔记体验改造：混合笔记 + 简体字幕 + 字幕翻译 + 总结配图

> 计划日期：2026-07-03
> 来源：用户四点诉求（混合笔记 / 繁转简 / 字幕翻译按钮 / 总结提示词重写+一段一图）
> 执行：小米；审查：Codex。四个 Stage 相互独立，可分别 commit + 分别过审。
> 用户已拍板的产品决策：
> - Item 4 范围：**9 种总结全部重写** + **LLM 时间戳占位符法**配图
> - Item 1 触发：**用户手动选「混合笔记」**
> - Item 3 翻译：**落盘缓存**

---

## Stage 2（先做·最独立·风险最低）：字幕繁转简统一到 ASR 出口

### 背景 / 根因
Mac（Apple Silicon）默认走 mlx-whisper（`asr_router.select_asr_engine` 优先级 mlx > fast > remote）。
繁→简的 `opencc t2s` 只写在 fast-whisper（`asr_fast_whisper.py:493-503`），**mlx 路径没做转换**，导致 Whisper 输出的繁体原样落盘成字幕。

### 修复方案
1. 在 `asr_router.run_local_asr_with_fallback` 的**统一返回出口**加繁转简：对 `text` 和每个 segment 的 `text` 跑 `opencc t2s`。
   - 抽一个 `shared` 或 `asr_router` 内的 `_to_simplified(text: str) -> str`，`OpenCC("t2s")` 惰性单例；`opencc` 不可用时静默返回原文（照抄 `asr_fast_whisper.py:496-503` 的 try/except 写法）。
2. 把 `asr_fast_whisper.py` 里原有的 t2s 后处理**删除或保留均可**——统一到 router 后 fast 路径重复转换无害（t2s 幂等），建议删除以免两处维护；删除时确认 fast-whisper 单独调用点（如有）仍经过 router。
3. remote HTTP 引擎结果也过同一出口。

### 涉及文件
- `backend/app/services/asr_router.py`（新增 `_to_simplified` + 出口调用）
- `backend/app/services/asr_fast_whisper.py`（移除重复 t2s，可选）

### 验收
- 新增/更新 pytest：给一段含繁体的假 segments，断言经 router 出口后为简体（mock 掉真实 ASR，只测后处理）。参考现有 `backend/tests/services/test_asr_router.py`。
- `cd backend && KMP_DUPLICATE_LIB_OK=TRUE .venv/bin/pytest tests/services/test_asr_router.py -q` 全绿。
- 真机：Mac 上跑一条中文视频，确认字幕落盘是简体（对照 `git log` 确认后端是新进程 + `--reload`）。

---

## Stage 3：字幕翻译按钮（落盘缓存）

### 背景 / 现状
`LNTranscriptPanel.tsx:148` 已有「原文 / 说话人 / 译文」三态，但**「译文」按钮 `disabled`**，翻译逻辑未接。用户要：字幕区上方加「翻译」按钮 + 目标语言选择，结果落盘缓存。

### 修复方案
**后端**
1. 新增翻译端点：`POST /workspaces/{ws_id}/items/{item_id}/translate`，body `{ target_lang: "zh"|"en"|"ja"|... }`。
2. 逐段翻译：取该 item 的 transcript segments，用 `provider.chat(ChatRequest(...))`（复用 `summary_generator.py:872` 同款入口）批量翻译，保持 segment 对齐（建议按段编号成对输出，避免顺序错位）。
3. **落盘缓存**：结果写进 item results，键形如 `translations: { "<target_lang>": [ {t_sec, text}, ... ] }`；已存在同 target_lang 直接返回缓存，不重复调 LLM。
   - schema 变化仅在 results JSON 内新增字段，**不动 DB 表结构**（若涉及表结构变更→停下问用户）。

**前端**
4. `LNTranscriptPanel.tsx`：字幕区上方工具栏加「翻译」按钮 + 语言下拉；点击调端点，成功后启用「译文」态并渲染缓存译文。
5. 「译文」态从 item 的 `translations[currentLang]` 读；无缓存时按钮显示 loading。

### 涉及文件
- `backend/app/routes/workspaces.py`（新端点）
- `backend/app/services/`（新增或复用一个 translate service 函数）
- `frontend/src/pages/results/LearningNotesPage/LNTranscriptPanel.tsx`
- `frontend/src/services/workspaces.ts`（前端调用封装）

### 验收
- 后端：pytest mock provider，断言端点返回对齐的译文 + 第二次调用命中缓存（provider 只被调一次）。
- 前端：`cd frontend && npm run build` 通过。
- 真机：一条英文视频 → 点翻译选中文 → 「译文」态显示中文；刷新页面后仍在（验证落盘）。

---

## Stage 1：混合笔记类型（用户手动选）

### 背景 / 现状
`AddMaterialModal.tsx:95` 只有 `auto/video/image_text/audio`。`diarize`（说话人）开关（:1710）和截帧间隔逻辑已存在，但没有「混合笔记」类型把两者收进统一设置区。

### 修复方案
1. 前端 `NOTE_MEDIA_KINDS` 新增 `{ value: 'mixed', label: '混合笔记', desc: '视频截帧 + 图文提取 + 说话人（用于既有视频又有图文的素材）' }`。
2. 选中 `mixed` 时，设置区同时展示：**截帧设置**（间隔/上限，复用现有 UI）+ **说话人设置**（复用 `diarizeOn` 开关）。
3. 提交 payload 带 `note_media_kind: 'mixed'`（沿用现有 `resolvedNoteKind` 通道，:837）。
4. 后端 pipeline：`mixed` 分支对素材**既跑视频转写+截帧、又跑图文视觉理解**，合并进同一份 source.md / 笔记。
   - ⚠️ 后端合并逻辑是本 Stage 的**重点和风险点**：先 `rg` 现有 video / image_text 两条 pipeline 的入口，判断能否复用拼装；若需较大改动或触及状态机→回报 Claude 再拆细。

### 涉及文件
- `frontend/src/components/workspace/AddMaterialModal.tsx`
- `frontend/src/pages/WorkbenchPage/preflightTasks.ts`（如涉及任务映射）
- `backend/app/services/pipeline_tasks.py`（mixed 分支）
- `frontend/src/types/workspace.ts`（类型补 `'mixed'`）

### 验收
- 前端 `npm run build` 通过；添加素材弹窗能选「混合笔记」并同时看到截帧+说话人设置。
- 后端 pytest：mixed payload 能同时产出 transcript 与 image_infos。
- 真机 E2E（用 `.claude/skills/e2e-fullflow-test`）：混合素材走完 pipeline，结果页既有转写字幕又有图文。

> 🔴 红线：`mixed` 后端合并若发现与现有状态机/pipeline 冲突，**停下回报**，不要擅自改状态机。

---

## Stage 4（核心·最大）：9 种总结提示词重写 + LLM 时间戳占位符配图

### 背景 / 根因
- 现有 9 种风格（`summary_templates.py` TEMPLATES + `summary_generator.py` 图文分支）**全是纯文字**，多个模板明确写「不要插入图片」。
- 图片只在 `note_assembler.py:336`（R3.18）按**固定间隔机械插进「原文」视图**，从没进总结正文 → 「带图总结没图 / 图文对不上」。
- 调研 BiliNote：用**占位符法**——LLM 在语义需要处输出 `*Screenshot-[mm:ss]`，后端按时间戳取真实帧替换；标题用锚点做跳转。图由内容语义决定，天然「一段一图、图文对得上」。

### 修复方案

**A. 通用占位符机制（先搭地基）**
1. 约定占位符格式：`![配图](*FRAME-[mm:ss])`（选此格式因为它本身是合法 markdown 图片语法，LLM 不易写歪；`*FRAME-` 前缀便于正则识别）。
2. 后端新增解析器（放 `note_assembler.py` 或新 `frame_placeholder.py`）：
   - 正则扫 `\*FRAME-\[(\d{1,2}:\d{2})\]`。
   - 新增 helper `find_nearest_frame(frames, target_sec)`：frames 已带 `sec`/`timestamp`，取最近的一帧 `frame_image_path`。
   - 把占位符替换成 `/static/` 真图 URL（复用 `_to_static_url`）；找不到帧则删除该占位符行（不留断图）。
3. 该解析在总结落盘/组装阶段统一跑一遍（video 类才启用；image_text / audio 无 frames 时占位符直接清除）。

**B. 9 种总结提示词重写**
对 `summary_templates.py` 的 9 个模板 + `summary_generator.py` 的图文分支逐个改：
- **带图模式开启时**（video 素材 + 用户选了「带图笔记」而非「纯文字模式」），在每个模板末尾追加统一「配图规则」段（见下方示例），并**移除原有「不要插入图片」措辞**。
- **纯文字模式**：保持不插图（配图规则不注入）。
- 逐个模板按其定位微调正文结构（标准=教学结构、小红书=情绪化短句、公众号=引言正文结尾、教程=步骤、科普=白话类比……保持各自风格，只统一「配图规则」这一块）。

配图规则示例（注入到 system_prompt 末尾）：
```
【配图规则（带图模式）】
- 每个 ## 小节，若视频在该处有值得看的画面（图表/代码/UI/演示/关键对比），
  在该节正文末尾单独一行输出：![配图](*FRAME-[mm:ss])
- mm:ss 取自转写分段真实时间戳，指向最能代表本节内容的那一帧。
- 一节最多一图；纯口播、无画面价值的小节不配图（宁缺毋滥）。
- 只放占位符，不要描述图片内容，系统会替换成真实截图。
```

**C. 带图/纯文字开关联动**
- 确认 AddMaterialModal 里「带图笔记 / 纯文字模式」开关（截图底部可见）已把标志传到后端；后端据此决定是否注入配图规则 + 是否跑占位符替换。若该标志尚未打通 → 一并接上。

### 涉及文件
- `backend/app/services/summary_templates.py`（9 模板 + 配图规则注入）
- `backend/app/services/summary_generator.py`（图文分支 + 占位符解析调用）
- `backend/app/services/note_assembler.py` 或新 `frame_placeholder.py`（占位符解析 + find_nearest_frame）
- `backend/app/services/pipeline_tasks.py`（带图标志透传、解析挂载点）
- `frontend/src/components/workspace/AddMaterialModal.tsx`（确认带图/纯文字标志传递）

### 验收
- pytest：
  - 占位符解析单测：给假 markdown（含 `*FRAME-[mm:ss]`）+ 假 frames，断言替换成正确 `/static/` URL；找不到帧时占位符被清除。
  - `find_nearest_frame` 单测：多帧下取最近。
  - 每个模板注入配图规则后仍能正常生成（mock provider）。
  - `KMP_DUPLICATE_LIB_OK=TRUE .venv/bin/pytest tests/test_summaries.py tests/test_summary_generator.py tests/test_note_assembler.py -q` 全绿。
- 真机（note-8073b3761125 同类视频）：带图模式下每个主要小节有一张对得上内容的截图；纯文字模式无图。

> 🔴 红线：
> - 不改 DB schema（translations / mixed 都只在 results JSON 内加字段；若必须动表→停下问用户）。
> - 小米做调研/改动必须**自己跑 pytest + build 出数据证据**，不许只看代码猜。
> - 与现状不符（如带图标志根本没传、frames 不带 sec）→ 停下回报 Claude，不要凭猜继续。

---

## 建议执行顺序
Stage 2（繁转简，最独立）→ Stage 3（翻译）→ Stage 1（混合笔记）→ Stage 4（总结配图，最大，依赖占位符地基）。
每个 Stage 独立 commit，Codex 逐个过审。
