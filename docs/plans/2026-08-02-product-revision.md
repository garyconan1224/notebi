# NoteBi 2026-08-02 产品修订执行计划

状态：**Q1–Q7 已完成；Q8 阶段 A（适配器/假模型/路由 POC）已完成，阶段 B 真实模型下载与基准仍须在许可证接受前单独停点确认。2026-08-04 已完成 Q1–Q8 审查缺口修正。**
调查基线：`7b47c6a`（分支 `codex/continue-product-redesign`）
目标平台：macOS / Linux；本计划不启动 Windows、安装包或整合包工作
执行方式：Codex 逐批 TDD 直接实现并验证；UI 批次按需使用 OpenDesign 设计/评审
远端策略：只保留本地分支和提交，不 push

## 1. 目标与边界

本计划关闭 2026-08-02 用户反馈的 24 项问题。它不是一次无边界重构，而是按依赖拆成
可独立回滚和验收的批次：

1. 结果页播放器、时间轴、说话人、沉浸式与幽灵版本；
2. 导出信息架构、Obsidian/Notion/飞书、媒体与字幕导出；
3. AI 结构化产物，尤其是真正的思维导图；
4. 新建单条/批量任务的识别、封面、布局、模板可见性与遮挡；
5. 任务中心、终态记录删除与可操作诊断；
6. 完整主题套餐、字体作用域与共用正文工具栏；
7. CrisperWhisper 2.0 的独立 POC 和可选适配。

明确不做：

- 不把 CrisperWhisper 模型权重打包进 NoteBi；
- 不在用户确认前保存 Notion/飞书密钥或改变本地目录权限；
- 不以增加固定高度、隐藏 overflow 或缩小文字来“修复”遮挡；
- 不引入 Mermaid/React Flow 等新依赖来规避结构化产物契约；
- 不删除用户素材、笔记、子任务或媒体文件来实现“删除批次记录”；
- 不顺手处理完整 lint 基线或无关旧代码。

## 2. 24 项反馈追踪表

| 用户项 | 已确认现状 / 根因 | 目标批次 |
|---|---|---|
| 1 | 视频下方控制 47px、时间轴 78px、空说话人 81px、转录头 87px；1024 宽字幕前固定约 293px | Q2 |
| 2 | 只看 `speakerIds` 与 `speaker_retry_task_id`，无法区分“未请求”与“请求后无结果” | Q2 |
| 3a | 播放按钮和首帧 overlay 可播放；播放后点击视频画面不会切换暂停 | Q2 |
| 3b | Milkdown 首次挂载自动规范化 Markdown，被保存为 `USER_EDIT` v2 | Q1 |
| 4 | 刻度条和已有截帧条层级弱；VLM 失败时没有独立可用的故事板缩略图 | Q2 |
| 5 | Obsidian zip 已存在但藏在“主笔记 → 知识管理”；Notion/飞书是独立同步入口，无统一目的地设置 | Q3 |
| 6 | `current/main/transcript/speaker_transcript/source` 被列成 5 个并列内容源，语义重复 | Q3 |
| 7 | `mind_map` 提示词要求 Markdown 多级列表，前端统一用 `<pre>`；其它卡片/表格产物也未按语义渲染 | Q4 |
| 8 | 已有 SRT/VTT/ASS；现有所谓 video export 实际是分析 ZIP，没有原视频/烧录字幕 MP4 | Q3 |
| 9 | 沉浸式有无文案的小 X，但退出入口不醒目、非固定说明 | Q2 |
| 10 | `extract_bvid_from_url` 把区分大小写的 BV 号整体大写，示例变成无效 `BV1YUG36PEDP` | Q1 |
| 11 | `PositiveIntInput` 自带快捷按钮行，却被放入固定 28px 高横排容器，第二行溢出重叠 | Q1 |
| 12 | 新建任务读取全部模板，只在组件内切常用/更多；没有持久化的“新建任务可见”字段 | Q5 |
| 13 | 新建任务左列稀疏、右列过载并单独长滚动 | Q5 |
| 14 | 多处以固定高度承载可换行内容，缺少 1024/125%/长中文布局回归 | Q2、Q5、Q6 |
| 15 | 页面外壳完整，但 2026-08-02 的 595 条日志中结构化诊断为 0，509 条为启动噪声 | Q7 |
| 16 | 前端 `auto` 直接变 `video`，后端批次也硬建 `WorkspaceItem(type=video)`，探测结果不回写 | Q5 |
| 17 | 下载设置等表单文字、边框和控件遮挡属于全局布局约束缺失 | Q6 |
| 18 | 后端和 service 已支持删除终态批次，但批次列表/详情没有入口；单条任务已有删除记录 | Q7 |
| 19 | 任务中心已有批次/单条、过滤、进度、暂停/恢复/取消/重试和详情；应补缺口，不重做 | Q7 |
| 20 | 当前只有浅/深/系统和 4 个强调色，强调色仅改 `--color-accent*` | Q6 |
| 21 | 当前没有字体设置、作用域或上传存储契约 | Q6 |
| 22 | Milkdown 已有格式命令；完整工具栏仅挂在文本笔记，视频/音频正文没有，标题只支持 H2 | Q6 |
| 23 | 用户给的 v1 已弃用；2.0 可选后端、许可证和 macOS 性能均需先基准 | Q8 |
| 24 | 2.0 可带来原样/清洁双轨、逐词时间、forced align、长音频衔接和幻觉抑制；不负责说话人分离 | Q8 |

## 3. 调查证据

### 3.1 运行数据

- 现场素材：workspace `__inbox__`，item
  `008c49c6-c81c-496d-bb21-5c3729368669`。
- 其 v1 `BASELINE` 与 v2 `USER_EDIT` 创建时间只差约 2ms。差异只是 Milkdown 把标题后补空行、
  `-` 改成 `*` 并规范化表格/引用，不是用户操作。
- 实测 B 站示例 URL 的原大小写 BV 号可返回封面；当前 `get_meta()` 三次均因大写后的无效 BV 号
  得到空响应和 `JSONDecodeError`。
- 后端相关测试执行前日志 595 条，执行后 625 条，说明测试 lifespan 正在写生产 `data/logs`。
- 诊断页当前首屏连续显示 `NoteBi application started`；真正的 VLM 400、链接预览失败只有原始英文/异常串。

### 3.2 当前测试边界

调查时通过：

- 前端：83 个测试文件、427 项测试；
- 后端所选：105 项测试。

这些通过结果只证明既有 API/按钮存在，没有覆盖：

- Milkdown 首挂不得保存；
- BV 号大小写；
- 自动批次的真实类型回写；
- 1024/125%/长中文无重叠；
- 思维导图是可视树而不是 `<pre>`；
- 诊断日志不被测试污染且故障具有原因/行动。

### 3.3 关键文件

- 结果页：`frontend/src/pages/result/NoteShell/index.tsx`、`MilkdownEditor.tsx`、
  `NoteMediaCompanion.tsx`、`NoteAudioPanel.tsx`、
  `frontend/src/pages/results/LearningNotesPage/LNVideoPanel.tsx`、`LNTranscriptPanel.tsx`
- B 站预览：`backend/app/downloaders/bilibili_nocookie.py`、
  `backend/app/routes/link_preview.py`、`frontend/src/services/linkPreview.ts`
- 新建任务：`frontend/src/components/workspace/AddMaterialModal.tsx`、
  `MaterialSourcePanel.tsx`、`NoteSettingsPanel.tsx`、`PositiveIntInput.tsx`、
  `backend/app/services/task_batch_service.py`
- 导出：`frontend/src/pages/result/NoteShell/index.tsx`、
  `backend/app/services/note_exporter.py`、`backend/app/routes/workspaces.py`
- AI 产物：`backend/app/services/note_artifacts.py`、
  `frontend/src/pages/result/NoteShell/AiArtifactPanel.tsx`
- 任务/诊断：`frontend/src/pages/TaskCenterPage/*`、`DeployMonitorPage.tsx`、
  `backend/app/services/runtime_log_store.py`、`runtime_log_buffer.py`
- 外观/编辑：`GeneralSettingsPage.tsx`、`AccentPalettePicker.tsx`、
  `frontend/src/styles/nibi-tokens.css`、`editorFormatting.ts`、`lnEditorStore.ts`
- ASR：`backend/app/services/asr_router.py`、`asr_fast_whisper.py`、
  `asr_mlx_whisper.py`、`shared/audio_analyzer.py`

### 3.4 OpenDesign 独立复验

- OpenDesign 已交付可交互原型、工程 UI 规格和四套主题规格，路径见第 5 节。
- Codex 用本地 Chromium 独立打开原型；六个页面切换、1440/1024 切换、导出折叠、新建批量、
  批次删除确认、主题切换均可交互，控制台 0 error。
- 初始化数据实测：视频字幕 12 行、故事板 12 帧、音频波形 96 段、音频字幕 8 行。
- 首版原型曾因 `#vr-frames` 缺 `id` 导致后续监听器未绑定，OpenDesign 已修复；复验不再报错。
- 1024 首版单列会让视频占满首屏，Codex 退回 OpenDesign 修为紧凑 55/45 双列。最终实测
  `frame clientWidth = scrollWidth = 1024`，视频首屏完整可见 6 行字幕、音频 8 行，右侧主笔记同屏可见。

## 4. 执行前必须确认的产品停点

以下是推荐方案。用户回复“按推荐方案执行”后才可开始 Q1；若只确认部分，则只执行已确认批次。

### D1 说话人空状态（推荐）

- 未请求区分说话人且没有 speaker 数据：完全不显示说话人区域。
- 已请求且处理中/失败：显示一行紧凑状态和重试。
- 有 speaker 数据：默认折叠为一行“3 位说话人”，可展开改名/查看统计。
- 旧任务根据原 task payload 的 diarization 参数兼容推断，不批量迁移数据。

替代方案：所有转录都保留“可补做说话人识别”的常驻入口。该方案仍占字幕高度，不推荐。

### D2 导出信息架构（推荐）

顶层只保留三个内容域：

1. **笔记**：当前笔记版本（默认）；仅当主笔记与当前显示不同，才出现“主笔记”子选择。
2. **转录与字幕**：纯文本 / 带时间字幕；“区分说话人”改为选项，不再是独立顶层内容。
3. **媒体**：原视频/音频、视频（软字幕）、视频（烧录字幕）。

目的地作为第二维：下载、Obsidian、Notion、飞书。禁止继续把“内容”和“目的地”混在一层。

### D3 Obsidian 与在线密钥（推荐）

- 始终保留无配置的“下载 Obsidian 包”。
- 设置可配置本地 vault 路径和默认子目录，开启“直接写入 Obsidian”。写入前校验目录、预览目标文件、
  同名时询问覆盖/新版本。
- Notion/飞书只持久化非秘密目的地（page/folder id 等）；token 默认仅本次请求使用。
- 若以后要保存 token，必须单独接系统钥匙串，不写 JSON 设置和日志。

替代方案：本轮只改善 Obsidian zip 的可发现性，不做直接写库。

### D4 视频导出（推荐）

- 原视频：流式下载/复制已有本地媒体，不重新编码。
- 软字幕：视频 + 独立 SRT/VTT 打包。
- 烧录字幕：复用已有 ffmpeg，作为后台任务执行，支持取消、进度、失败清理临时文件。
- 字幕样式使用 Q6 的字幕字体/字号/位置设置；默认不覆盖原视频。

### D5 批次删除语义（推荐）

“删除记录”只删除终态批次记录，不删除子任务、笔记、素材、媒体或导出。确认框必须逐字说明该边界。
级联清理是另一项高风险功能，不纳入本轮。

### D6 主题与字体持久化（推荐）

- 将现有强调色升级为完整 `color_system`，保留浅/深/系统为每套主题的明暗策略。
- 新建专用的后端 SettingsStore 和 GET/PATCH 回读（当前仓库没有该 route/service），不只写 localStorage；
  旧 accent 值兼容映射。
- 字体三个作用域：界面、笔记/总结、字幕；先提供系统字体栈。
- 上传仅接收 WOFF2/TTF/OTF，单文件最大 20MB，校验扩展名和文件签名，存 `data/fonts/<id>/`，
  以生成的 id 提供，不使用用户文件名拼路径；被使用字体不可直接删除。

### D7 AI 产物契约（推荐）

- 后端同时保存 `content_md`（可移植/降级）和按 kind 校验的 `content_json`（界面渲染）。
- 思维导图使用 `root + children[]`，前端以自有 HTML/SVG 树呈现，支持折叠、缩放、导出 PNG/SVG/MD。
- 行动项、卡片、闪卡、术语表、时间线分别使用语义组件；禁止统一 `<pre>`。
- 旧产物没有 JSON 时继续显示 Markdown，并标注“旧版产物”，不强行解析覆盖。

### D8 CrisperWhisper（推荐）

- 只做可选 POC，不替换 `auto`、MLX 或 Faster-Whisper 默认路由。
- 采用 CrisperWhisper 2.0，不继续适配已弃用 v1。
- macOS 只测试 Transformers/PyTorch 后端；不在 macOS 假设 CT2 fork 可用。
- 标准模型权重是非商业研究许可证：只允许用户按需下载并明确接受许可证，不随应用分发。
- POC 通过中文/英文、短/长音频基准后，再由用户决定是否进入正式引擎列表。

权威资料：

- <https://github.com/nyrahealth/CrisperWhisper>
- <https://github.com/nyrahealth/CrisperWhisper/blob/main/DOCS.md>
- <https://huggingface.co/nyralabs/CrisperWhisper2.0_large/blob/main/LICENSE.md>

## 5. OpenDesign 交付

设计项目：`2bd11d3f-ecc1-4d2c-89b5-d7e95b41c8d1`（页面设计优化审查）

本轮要求的交付文件：

- `notebi-2026-08-02-product-revision.html`
- `notebi-2026-08-02-ui-spec.md`
- `notebi-2026-08-02-theme-systems.md`

绝对目录（Codex 在 UI 批次按需读取，不复制进业务源码）：

`/Users/conan/Library/Application Support/Open Design/namespaces/release-stable/data/projects/2bd11d3f-ecc1-4d2c-89b5-d7e95b41c8d1/`

交付状态：三份文件均已生成并由 Codex 复验；最终 1024 方案是紧凑双列，不是早期稿里的单列。

规格优先级：真实代码/数据契约 > 本计划第 4 节产品决定 > `notebi-2026-08-02-ui-spec.md` >
交互 HTML > theme systems。主题文档末尾提到的 localStorage 仅可做即时预览，持久化必须以 D6 和 UI
规格第 7 节的后端 GET/PATCH/readback 为准；HTML 内的 SettingsStore 只是原型模拟，不是实现接口。

Codex 不得凭文字自行发明新版布局；Q2、Q3、Q4、Q5、Q6 必须以这三个产物和当前代码共同为准。
若产物与真实组件/数据契约不一致，立即停下向用户报告，不得修改产品语义来迁就设计稿。

## 6. Codex 执行总规则

每个批次由 Codex 严格串行执行：

1. 读取 `CLAUDE.md`、`docs/AI_HANDOFF.md` 前 80 行、
   `docs/rules/agent-roles.md` 和本计划对应批次；
2. 运行 `git status --short --branch`、`git log --oneline -5`、`git branch --show-current`；
3. 若有非本批次改动或同主题 worktree，停止并报告；
4. **先写失败测试并展示红灯原因，再写最小实现，再跑绿灯**；
5. 只改本批次列出的文件族；实际契约、数据结构、依赖或产品行为与计划不同立即停止；
6. 跑窄测试、相关回归、`git diff --check`；UI 批次还要跑 Playwright 截图/重叠矩阵；
7. 一个批次一个本地 commit，不 push；在提交说明里列出测试命令和未验证边界；
8. Codex 独立复核自己的 diff、测试和运行证据；不以执行汇报替代验证。

禁止：

- 不得修改 `main`，不 cherry-pick、不 stash 用户改动；
- 不得因为测试已存在就跳过新增能复现用户问题的测试；
- 不得安装依赖、下载模型、改变设置 schema 或删除用户数据而不触发计划停点；
- 不得把运行失败降级为“成功但少结果”。

## 7. 分批执行

建议实际顺序：`Q1 → Q2 → Q5 → Q6 → Q3 → Q4 → Q7 → Q8`。编号用于追踪产品域，
不代表必须按数字顺排；Q6 先冻结字幕字体契约，Q3 再消费它，避免导出重复建设设置。

### Q1：确定性 bug——幽灵 v2、B 站封面、区间重叠

目标：先关闭三个不依赖产品设计的根因。

红灯测试：

1. `extract_bvid_from_url()` 对 `BV1YUG36pEdp` 保留 payload 大小写，仅规范 `b`/`v` 前缀；
2. link preview 用该 BV 号返回 `image_url`，JSON 失败要记录 HTTP/content-type 摘要而不是只报 `JSONDecodeError`；
3. Milkdown 初次 parser/serializer 规范化不得调用保存；第一次真实键入仍必须保存；
4. 5/10/30/60 快捷值在 320px 与 125% 缩放下不越过 `PositiveIntInput` 自身边界，后续字段不相交。

实现约束：

- 不把整个 BV 号 `.upper()`；
- 不以延时 debounce 猜测用户是否编辑；应建立“初始 canonical 内容”或明确挂载事务边界；
- `PositiveIntInput` 自己负责自然高度/换行，父容器不固定 28px 承载两行。

重点文件：

- `backend/app/downloaders/bilibili_nocookie.py`
- `backend/app/routes/link_preview.py`
- `frontend/src/pages/result/NoteShell/MilkdownEditor.tsx`
- `frontend/src/components/workspace/PositiveIntInput.tsx`
- `frontend/src/components/workspace/NoteSettingsPanel.tsx`
- 对应 backend/frontend tests

验收：新建示例 URL 在识别卡出现真实封面；首次打开新笔记仍显示 v1；实际编辑一次后才出现 v2；
截图间隔控件在截图 4/5 尺寸无叠加。

建议提交：`fix: preserve note and preview state on first render`

### Q2：结果页媒体工作区

依赖：OpenDesign 交付、D1。

目标：视频/音频共用紧凑媒体工作区，让字幕成为左栏主内容。

行为：

- 视频画面单击切换播放/暂停；按钮、进度条、字幕、画中画等交互子元素不得冒泡触发；Space 保持可用；
- transport 与当前时间/进度合并为一条 44–52px 控制带；低频按钮进入 `…`；
- 视频进度条热区至少 12px，hover/focus 显示时间与最近故事板图，点击/键盘可 seek；
- 独立于 VLM 生成最多 12 张轻量故事板缩略图；无图时仍可精确 seek，不显示空骨架；
- 音频使用同一层级：播放/速度/音量 + 波形/章节，不伪造视频故事板；
- 按 D1 处理说话人；有数据默认折叠；
- 说话人行与“字幕显示/翻译”工具行分别有明确折叠按钮；折叠只隐藏设置工具，不隐藏字幕正文。
  窄窗默认把翻译选项收进 popover，转录标题/数量/折叠入口保持单行；
- 固定显示“退出沉浸式 Esc”，Esc 退出，焦点回到触发按钮；
- 顶栏显示“主笔记”，修订号只在版本历史中显示。

红灯测试：

- 画面 click/play/pause 与子控件 stopPropagation；
- speaker 未请求/处理中/失败/有结果四状态；
- 1024 窄窗保持约 55/45 双列，只有真实视口小于 900px 才降级为单列/分段；
- 1080×900 审查视口下 frame 为 1024×770，`clientWidth = scrollWidth = 1024`；视频和音频
  首屏各至少完整显示 6 行字幕，右侧主笔记版本按钮和标题同屏可见；
- 1024×768 生产视口仍不得横向溢出，播放器后固定区域不能把字幕滚动区挤为 0；
- 1440、1024、CSS zoom 125%、长标题下顶栏控件不相交；
- 沉浸式按钮、Esc、焦点恢复；
- 故事板上限、无 VLM 结果仍生成/展示。

验收：视频和音频各跑一个真实素材；桌面 1440/1024 截图与 OpenDesign 稿对照。

建议提交：`feat: make media notes transcript first`

### Q3：统一导出与媒体导出

依赖：D2、D3、D4、Q6 字幕字体契约可先定义接口后消费，不能重复建设置。

目标：用“内容 × 格式 × 目的地”替代重复菜单，并加入真正媒体导出。

红灯测试：

- 当前显示等于主笔记时不出现重复来源；不同时可明确选择；
- speaker 是转录选项，不是另一个内容源；
- Obsidian zip 无配置可用；直接写库预览路径、拒绝越界、同名策略明确；
- token 不落设置、日志、诊断包；
- 原视频字节不重新编码；软字幕包包含媒体和字幕；烧录任务有进度/取消/失败清理；
- 无字幕、无本地视频、ffmpeg 不可用返回可操作错误；
- SRT/VTT/ASS 现有接口保持回归通过。

实现提示：烧录视频走 pipeline task，不在 HTTP 请求里同步等待；复用系统 ffmpeg 和任务中心。

验收：短视频分别导出原视频、软字幕包、烧录字幕 MP4 并用 ffprobe 校验；Obsidian zip 和配置 vault 各验一次；
Notion/飞书现有同步回归通过。

建议提交：`feat: unify note transcript and media exports`

### Q4：真正的 AI 结构化产物

依赖：D7、OpenDesign。

目标：生成与展示都具有语义，不再把任意 Markdown 当成视觉产物。

红灯测试：

- 每个 kind 的 JSON schema 校验、坏模型输出修复一次、仍坏则失败；
- mind map 只有一个 root、最多四层、节点 id 稳定，无循环；
- 旧 `content_md` 兼容；
- 各 renderer 的空/加载/失败/导出；
- “导出 PNG/SVG”得到真实图，不是 Markdown 改扩展名；
- 插入笔记仍使用可读 Markdown 降级内容。

不新增前端图图库；优先小型自有树布局和现有浏览器 SVG 能力。若确实需要依赖，停止说明包体、许可证和替代方案。

验收：思维导图、行动项、要点卡、闪卡、术语表、时间线各生成一次并人工检查语义；选择改写保持独立 diff 流程。

建议提交：`feat: render typed ai note artifacts`

### Q5：新建任务、自动类型和模板可见性

依赖：OpenDesign、D6 中设置持久化模式。

目标：新建任务布局稳定，自动类型贯穿真实探测，设置能控制弹窗模板。

契约：

- 识别前使用 `unknown/auto` 视觉状态“待识别内容”，不得标视频；
- pipeline probe 得到 video/audio/image/text 后，原子回写 canonical `WorkspaceItem.type` 和批次 item kind；
- probe 失败保持 unknown 并要求处理，不静默按视频成功；
- 模板增加 `show_in_create`（或独立有序可见 id 设置），设置 GET/PATCH/刷新回读；
- 单条与批量新建消费同一份可见模板顺序。

红灯测试：

- 音频、图片、文本、视频 URL/本地文件各至少一个 auto 路径；
- 重启后 type 不回退视频；
- 旧 item 兼容；
- 所有模板隐藏时回退标准总结且给设置入口；
- 1440/1024/125% 两列不失衡、不相交，窄窗转单列；
- 区间、说明、长模板名自然增高。

验收：复现截图 5 的“地方”不得显示视频图标；真实四类素材完成后类型正确；模板设置刷新后新建弹窗一致。

建议提交：`fix: preserve detected types through batch creation`

### Q6：主题套餐、字体和共用正文工具栏

依赖：D6、OpenDesign theme systems。

目标：完整 semantic token 系统，三作用域字体，共用编辑工具栏。

主题：

- `Paper Editorial`（默认，保留朱橙品牌）
- `Graphite Focus`
- `Sage Study`
- `Midnight Studio`

最终名字和 token 以 OpenDesign 交付为准。每套必须覆盖 background/surface/elevated/text/muted/border/accent/
accent-contrast/success/warning/error/info/chart/speaker/focus，并同时验证浅深策略；禁止渐变。

字体：

- 设置预览真实中文、英文、数字、时间码；
- UI、note、subtitle 三作用域独立回读；
- 字体上传安全边界按 D6；
- 导出 HTML/PDF/图片/字幕烧录读取同一作用域设置，缺字体可解释回退。

工具栏：

- 从文本笔记抽成视频/音频/图文/文本共用组件；
- 段落下拉支持正文、H1、H2、H3；保留粗体、斜体、删除线、链接、引用、列表、待办、行内/块代码；
- toolbar 可水平滚动或合理收纳，不能覆盖正文；按钮状态/禁用/快捷键可访问；
- 保持 Markdown 为真实存储，不引入 Word 专有格式。

红灯测试：设置往返、旧 accent 迁移、字体校验/删除占用、主题对比度、所有 note type 工具栏、H1/H2/H3 round-trip、
1024/125% 下载设置与工具栏零重叠。

验收：4 套主题 × 浅深策略核心页面截图；系统字体与一份用户字体预览/回退；视频和音频正文编辑保存后 Markdown 正确。

建议提交：`feat: add reading themes fonts and shared editing tools`

### Q7：任务中心删除与诊断体系

依赖：D5。

目标：补任务中心真实缺口，把日志流拆成可操作事件与技术日志。

任务中心：

- 终态批次卡和详情页增加删除记录；删除后返回列表并刷新统计；
- 运行中不可删除；失败要保留记录并可重试；
- 确认框说明不删除素材/笔记/子任务；
- 失败批次首屏展示聚合原因、受影响项和下一步，技术日志跳诊断页；
- 不重做已有暂停/恢复/取消/重试、过滤和详情。

诊断架构：

1. **用户诊断事件**：有限事件代码、中文摘要、可能原因、建议操作、scope/correlation；
2. **原始技术日志**：按需展开，保留模块和脱敏技术详情；
3. **诊断包**：版本/硬件/非秘密配置摘要/相关任务/近期事件/原始日志，全部脱敏。

必须：

- 测试使用临时 `NOTEBI_LOG_DIR` 或注入 store，不得写 `data/logs`；
- `application_started` 每进程/会话一次，带 session id；
- 重复相同事件在时间窗内聚合计数；
- VLM 模型不匹配、B 站元数据失败、ASR/diarization、ffmpeg、导出、磁盘/权限均有事件映射；
- 子线程/后台 task 传播 task/batch/workspace/correlation；
- 导出包测试证明 token、Cookie、绝对隐私路径已脱敏。

红灯测试：测试前后生产 log 行数不变；相同错误聚合；真实失败能按 task 过滤并显示 cause/action；终态批次删除边界。

验收：手动制造 VLM 类型错误和无效 B 站 URL，诊断首屏显示用户可执行下一步，不再被启动事件淹没。

建议提交：`fix: make task diagnostics actionable and isolated`

### Q8：CrisperWhisper 2.0 POC（独立可丢弃批次）

依赖：D8 单独确认；这是唯一允许安装新 ASR extra/下载模型的批次，执行前再次停点说明下载大小、许可证和磁盘位置。

阶段 A 仅适配器与假模型测试：

- 新 `crisper-whisper` adapter 映射 NoteBi 现有 segment contract；
- 保留逐词 start/end、verbatim/intended 模式、语言和引擎元数据；
- 不改 auto router 默认值；没有依赖时返回“未安装”能力状态；
- diarization 继续由 WeSpeaker/现有路径完成，以时间重叠映射，不宣称 CrisperWhisper 区分说话人。

阶段 B 用户确认后才做本机模型基准：

- 中文/英文；30 秒、5 分钟、30 分钟；安静/对话；
- 指标：实时率、峰值内存、字/词错误抽样、逐词边界误差、重复/漏句、长音频接缝；
- 与当前 MLX 和 Faster-Whisper 相同音频对照；
- 验证 MPS/CPU 回退、取消、进度、模型缓存和卸载。

进入正式引擎的门槛：

- 许可证已被用户接受且不随应用分发；
- macOS 性能不造成不可接受退化；
- 长音频覆盖不低于当前路径；
- 适配器、设置、结果/字幕/导出全链路测试通过。

可能的新功能（POC 通过后另行确认）：原样/清洁切换、逐词点击、高精度字幕编辑 forced-align、填充词统计、
用户编辑字幕重新对齐。不得在 POC 提交中顺带上线。

建议提交：`poc: evaluate crisperwhisper 2 transcription`

## 8. 全局验收矩阵

### 自动化

- 每批窄测试；
- `cd frontend && pnpm test`；
- 相关 backend 分组 pytest；
- `cd frontend && pnpm build`；
- `git diff --check`；
- 完整 lint 只记录本批新增问题，不把历史债宣称为本批通过。

### Playwright 视觉与交互

视口：1024×768、1080×900（1024 frame 精确验收）、1280×800、1440×900、2048×1152；
CSS zoom：100%、125%、150%。

每个核心页面用脚本检查：

- `scrollWidth <= clientWidth`（明确允许横滚的局部容器除外）；
- 可见按钮/输入/标签的 bounding rect 不相交；
- 文本不被 `overflow:hidden` 截断关键含义；
- 焦点可见、键盘可达、dialog focus trap/return；
- 中文长标题、英文长词、无封面、无字幕、无说话人、失败/加载/空状态。

页面：视频结果、音频结果、导出、新建单条、新建批量、任务中心、诊断、常规外观、下载设置、模板设置。

### 真实素材

- 用户给定 B 站 URL；
- 一段本地音频、一张图片、一个文本/网页、一段短视频；
- 有说话人与未请求说话人各一个；
- 有字幕与无字幕各一个；
- 失败 VLM 和失败 URL 各一个。

## 9. Codex 审核门槛

每个 Codex commit 都按以下顺序验证：

1. commit 基线与 diff 范围；
2. 先看新增红灯测试是否真的会在旧代码失败；
3. 沿 UI → service → backend model/store → consumer → GET/readback 追踪；
4. 运行声明的测试，不接受“应当通过”；
5. 对 UI 跑真实浏览器而不是只读快照；
6. 对日志/导出/字体/模型检查隐私、路径和临时文件；
7. 给出明确“通过/不通过”和证据。

发现不通过时，Codex 在原批次范围直接补充修复与验证；超出已确认范围则按停点规则向用户求证。
