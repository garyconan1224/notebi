# 视频笔记流程 · 阻断 Bug 修复计划（2026-06-22）

> **来源**：用户手测 17 条反馈（`docs/test-reports/manual-local-video-2026-06-21.md` 第 85–109 行）
> **工作流**：Claude 调研 + 跟用户沟通确认 → 本文件落详细计划 → 小米读取执行 → Codex 审查。
> **状态图例**：✅ 已完成　🔧 返工中　⬜ 待调研

---

## 背景

本地视频上传端到端 + 添加素材入口体验。手测暴露：转写遇无音轨崩、本地上传配置入口形态不对（弹了右侧抽屉且狂闪）。

> Bug #2（路由 note）、Bug #3（找 workspace 文件）手测已确认生效。

---

## 阻断项 1：转写遇无音轨视频崩溃 ✅（小米已实现 `8ef4984`）

**现象**：无音轨视频 note 任务 FAILED，`transcribe 失败: tuple index out of range`，progress 0.3。
**根因**：转写轨直接把视频喂 faster-whisper（`asr_fast_whisper.py:430`），转写前未检测音轨；无音轨时库内部越界；except 还吞掉了 traceback。
**用户决定**：无音轨 → 跳过转写、仍出画面笔记 + 提示。
**已实现**：`8ef4984` fix(asr): 无音轨视频跳过转写 + traceback 完整记录。
**手测状态**：用户换带音轨文件（`note-ce542bf34389`）已成功生成笔记（转写未崩）；**无音轨那条建议补一次实跑确认**（用 `…Web3村长.mp4` 跑，确认跳过 + 出画面笔记 + 提示）。

---

## 阻断项 2：本地视频配置入口 🔧（方案 A 返工为「统一中间模态」）

**进展**：小米初版（`25907ed` + `b4e0d6e`）让本地上传弹 **PreflightDrawer（右侧抽屉）**。用户手测后要求返工——抽屉狂闪 + 形态不对。

**用户最终决策（2026-06-22 手测后）**：
1. **删除** PreflightDrawer（右侧抽屉，旧）+ 其测试 `PreflightDrawer.test.tsx`。删后狂闪应消失，未消失再修。
2. **本地 + 链接统一走同一个中间模态** AddMaterialModal（「添加素材」居中弹窗），两个入口体验一致。
3. 配置用 AddMaterialModal **现有项**（笔记类型 / 风格 / 配图 / 视觉模型）；PreflightDrawer 独有的「背景信息 + 逐项任务勾选」**先丢弃**（当前精简方向）。
4. 中间模态**视觉风格采用旧 PreflightDrawer 的设计语言**（按钮 / 字体 / 配色）——删 PreflightDrawer 前先把要复用的样式提取出来。

**⚠️ 关键技术依赖（必读）**：AddMaterialModal 现在通过 **`generateNote`** 端点提交（`AddMaterialModal.tsx:262`），而 `generateNote` 对本地路径会无条件校验 URL → 400（即旧 Bug #1）。所以让本地文件走 AddMaterialModal **必须解决提交路径**：
- **推荐路线**：AddMaterialModal 提交时**按来源分流**——链接维持 `generateNote`；**本地文件改走 `savePreflight + startItemPipeline`**（复用小米 `25907ed` 已在 `Composer.handleFileChange` 写过的 upload→savePreflight→start 逻辑，搬进 AddMaterialModal）。这样后端 `generateNote` 不必动、也绕开旧 Bug #1。

**实现要点**：
1. `Composer.tsx`：
   - `handleFileChange` 上传后改成 `setUploadOpen(true)`（开 AddMaterialModal），不再 `setPreflightOpen(true)`。
   - 删除 `preflightOpen` 状态、`onFineTune`、`<PreflightDrawer>` 渲染与 import。
2. `AddMaterialModal.tsx`：
   - 支持本地文件入口：无 `urlValue` / `sniffResult` 时展示文件名、配置项照常。
   - 提交分流（见上）：本地走 savePreflight + startItemPipeline + navigate；链接维持 generateNote。
   - 视觉改造：套用 PreflightDrawer 设计语言。
3. 删除 `PreflightDrawer.tsx` + `PreflightDrawer.test.tsx`。
4. 链接「微调」入口（原 onFineTune → PreflightDrawer）取消——确认其配置已被 AddMaterialModal 覆盖。

**涉及文件**：`Composer.tsx`、`components/workspace/AddMaterialModal.tsx`、删 `PreflightDrawer.tsx` / `PreflightDrawer.test.tsx`。

**验收**：
- 本地上传 + 链接添加弹出的是**同一个中间模态**，视觉为旧抽屉风格、无右侧抽屉、无狂闪。
- 本地视频经中间模态配置后能正常 start、生成笔记（**重点验证不撞 generateNote 400**）。
- 勾 / 不勾配图结果不同（配置真透传）。
- 取消不残留半截 item。
- 前端 `build` 通过；删 `PreflightDrawer.test.tsx` 后测试套件仍绿、无残留引用。

---

## ① 下一批：封面 · 图 · 信息缺失类（已分析，分派如下）

### 第 18 条：处理页缺封面 + 标题 →【小米执行，根因已明确】
- **根因**（核实 `pipeline_tasks.py:1358` 本地分支返回）：`_download_note_source` 本地返回的 dict **无 thumbnail 字段**，title 仅文件名 stem；处理早期 result 无封面/标题可显示。
- **修复**（小米）：
  1. 本地视频下载阶段用 ffmpeg 提首帧 → 存 `thumbnail.jpg` → 写入 `result["cover_thumbnail"]`（转 /static/ URL；复用项目已有截帧能力）。
  2. PROBE 后把文件名 stem 写入 `result["video_title"]`，处理页早期即有标题。
  3. 前端 ProcessingPage 已有封面/标题展示逻辑，无需改。
- **验收**：本地视频处理页早期就显示首帧封面 + 文件名标题。

### 第 7 条：结果页所见即所得无图 →【小米执行，Claude 已实测定位】
- **根因（实测，非猜）**：note.md 把图片 markdown **拼进了 `##` 标题行**——实例 `note.md:147` = `## ![截图@00:00](/static/…shot.png)本地与线上对比 [04:02]`。图嵌标题里，Milkdown 渲染不作独立图显示 → "没图"。static 路径本身正确、文件存在（**排除**路径错 / LLM 没生成 / embed_frames=false）。
- **修复**（小米）：note 生成插图时图片**单独成行**，与标题分开——
  - 现状：`## ![图](path)标题文字 [mm:ss]`
  - 改为：`## 标题文字 [mm:ss]` ⏎⏎ `![图](path)`
  - 定位插图 / 标题拼接处（`summary_generator.py` 插图位置逻辑），把图从标题行移到标题下方独立行。
- **验收**：结果页正常显示截图；标题不含图片语法。

### 第 3 条：添加链接不显示封面 →【小米已实测 + Claude 已核实，修两个 bug】
小米跑实测附数据、Claude 核实代码，确认两个独立 bug：
- **bug2（P0，bilibili 封面）**：`bilibili_nocookie.py:29/32` try `from .base` / except `from base`，但 `downloaders/` 下**没有 base.py** → import 失败、`_HAS_BILI=False`、bilibili link-preview 走不通。**修**：先定位 `Downloader` 基类真实定义处（`bilibili_opus.py` 不依赖 base、自实现，基类在别处），修正 import 路径或补回 base 模块。
- **bug1（P1，通用 SSR 站如 sspai）**：`url_sniffer.py:81` `_OG_IMAGE_RE` 只匹配 `property="og:image"`，不匹配 `name="og:image"`；`link_preview.py` XPath 同样问题。**修**：regex / XPath 同时匹配 `property` 和 `name`。
- 注：bilibili / YouTube 在 sniff_url 是「已知平台不发 HTTP」返回 null（设计如此），其封面靠专用 downloader（即 bug2 路径）。
- **验收**：添加 bilibili 链接显示封面；sspai 等通用站也显示。

### 第 19 条：处理页进度分阶段 →【用户定 A：前端小改 + 按内容类型动态显示】
用户决策：做 **A**（前端 StepProgress 改映射，不动后端），并**按来源 + 内容类型显示不同步骤**：

| 类型 | 步骤序列 |
|---|---|
| 链接视频 | 排队 → 下载 → 转录 → 分析 → 生成笔记 → 完成 |
| 本地视频 | 转录 → 分析 → 生成笔记 → 完成（无下载） |
| 音频 | （链接含下载）→ 转录 → 生成笔记 → 完成（无分析） |
| 图文 / 图片 | （链接含下载）→ 分析 → 生成笔记 → 完成（无转录） |
| 文字 | 生成笔记 → 完成 |

- **实现**（小米，纯前端）：StepProgress 按 `source_type`(local/link) × `note_kind`(video/audio/image/text) 选步骤序列；把「分析」(FRAMES+VLM) 从「生成笔记」拆成独立步。ProcessingPage 已有 source_type / note_kind 数据可用。
- **验收**：不同类型素材处理页显示对应步骤——本地无「下载」、音频无「分析」、图文无「转录」。

---

## 后续 UI 批次（非本次阻断范围，记录正确理解）

**第 4 条（已澄清）**：添加素材后先选**功能板块**（平级）——「笔记」「复刻」或其他：
- 「笔记」→ 现在这套配置 → 笔记结果页。
- 「复刻」→ 复刻结果页（项目既有 **[C] 复刻 · AI 导演**）。
- 本次只需后续批次**先把平级功能按钮位置占好**。

---

## 给小米的执行须知

- **本次主任务 = 阻断项 2 返工**（阻断项 1 `8ef4984` 已做，仅需补无音轨实跑确认）。
- **自验**：
  - 前端 `build` 通过；删 PreflightDrawer 后无残留引用、测试套件绿。
  - 实跑：本地上传 + 链接添加都弹同一中间模态；本地视频配置后能生成笔记（重点验证不撞 generateNote 400）；无狂闪。
  - 真机验证前用 `./dev.sh` 重启，确认后端是新进程。
- **红线**：不 `git push`；不改 `.env` / DB schema；待调研项（第 3 / 7 条）和后续 UI 批次（第 4 条）不在本次范围，别擅自扩散；视觉迁移只搬样式，别改后端逻辑。
- **完成后**：回报自验结果（build + 实跑现象 + 截图），由 Claude 出 Codex 审查提示词。

---

## 🔧 手测验证 + 返工（2026-06-22）

> 小米 #3/#7/#18/#19 改动**均在工作树未提交**（`M`，含新建 `backend/app/downloaders/base.py`）。手测暴露下列问题需返工。**第一步：小米先把这批 commit，得到干净基线，再按下方改**（避免同树未提交改动互相覆盖）。

### #7 结果页无图 → 返工：先定位「0 帧」
- **手测**：最新 `note.md`(b5b11106) **0 图**；该 workspace `ln-screenshots/` 下 **0 个 png** → 不是拆图逻辑删的，是**截帧根本没产出**。
- **排查（小米，按序）**：① 该视频 analyze 是否真截出帧（看 FRAMES 日志、`*_图文分镜.md` 有无帧）② `.flv` 格式截帧是否失败（换 mp4 对比）③ embed_frames 是否被关。
- **修**：按定位结果——flv 截帧失败则修截帧；帧有但没进 note 则修插图。
- **验收**：带图视频 note.md 有独立成行的 `![](/static/…)`，结果页可见图。

### #19 进度分阶段 → 返工：A 方案撞「并行」
- **手测**：进度显示「转录✅完成·分析中」，日志转录才 3/364s。
- **根因**：后端 transcribe / analyze **并行**，A 方案线性进度条把转录提前标完成。
- **修（小米，前端）**：把转录 + 分析并成一个「转录·分析（并行）」阶段、或两轨都完成才标完成；不让单轨完成就跳步。
- **验收**：两并行轨都没完成前，不显示「转录完成」。

### #18 处理页封面+标题+时长 → 返工：前端没接 + 缺时长
- **手测**：后端提首帧生效（日志「首帧封面已提取」），但①添加弹窗/处理页没显示封面 ②无「视频时长」。
- **修（小米）**：① 前端 ProcessingPage / AddMaterialModal 真正读 `cover_thumbnail` 渲染封面 ② 本地视频 PROBE 后写 `video_duration`（ffprobe）+ 前端显示。
- **验收**：本地视频处理页/添加弹窗显示首帧封面 + 标题 + 时长。

### #6 删「③ 输出」→ 新增
- AddMaterialModal 的「③ 输出（导出预设）」区块删除（生成后在结果页导出即可）。

### #3 链接封面 → 已改，待实跑验证
- 已改 `url_sniffer.py` / `link_preview.py`（regex/XPath 加 `name`）+ 新建 `base.py`（修 bilibili import）。
- **验收（实跑）**：加 bilibili 链接显示封面、sspai 等通用站也显示。
