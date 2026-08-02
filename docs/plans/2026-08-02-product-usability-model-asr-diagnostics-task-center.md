# NoteBi 易用性、模型、转录、诊断与任务中心整改计划

> 日期：2026-08-02
>
> 执行人：小米
>
> 调查人：Codex
>
> 当前分支：`codex/continue-product-redesign`
>
> 当前 HEAD：`bfe2f95 docs: synchronize current product handoff`

## 0. 执行前必须读

1. 先读 `CLAUDE.md`、`docs/AI_HANDOFF.md`、`docs/rules/agent-roles.md` 和本文。
2. 当前工作区已有大量未提交代码，用户已明确允许把这些改动作为本轮调查基线。不得清理、回退、暂存或提交不属于本文的改动。
3. 先运行：

   ```bash
   git status --short --branch
   git log --oneline -5
   git branch --show-current
   ```

4. 本计划按独立提交拆分。每个提交只处理一个主题，先加窄测试，再改代码，再回归。
5. 不做 Windows、安装包、远程推送、数据库结构迁移或无关页面重构。
6. 当前封面补偿、Apple ASR 硬件探测等代码已经存在未提交的半成品。先理解并补齐，不要从头重写。

## 1. 调查结论与产品决策

| # | 问题 | 已确认原因 | 本轮决策 |
|---|---|---|---|
| 1 | 新建链接没有封面 | `/workspaces/sniff-url` 对已知平台只做快速类型判断，常返回空标题/空缩略图；当前工作区已增加 `/link-preview` 补偿但尚未完整验收 | 保留快速识别，缺图时异步补封面；失败必须显示稳定占位，不能留下空白 |
| 2 | 合集二级层不自动消失 | `WorkspacePicker` 没有外部点击和 Escape 关闭；项目中其他选择器各自实现，规则不统一 | 给“临时浮层”建立统一关闭规则；模态表单和持久折叠区不套用外部点击关闭 |
| 3 | 模型管理重复且默认模型难选 | 页面同时存在服务渠道、模型管理、默认模型三层；模型管理与默认模型选择重复 | 移除独立“模型管理”区，把其搜索/筛选能力收进“更换默认模型”选择器；模型按四类能力展示 |
| 4 | 处理页复制链接 | `ProcessingPage` 明确调用剪贴板 API | 改为“打开原链接”，新标签页跳转；本地文件无外链时不显示 |
| 5 | 截帧最多 60 秒 | 新建页硬限制 60；默认设置和批量入口限制 120；后端及持久化也限制 120，契约不一致 | 手动间隔只要求正整数，不设人为上限；自动策略仍可保留最多 60 秒的推荐值 |
| 6 | 快手、必剪等在线转录 | 前后端配置仍把非正式服务当成稳定引擎 | 删除必剪、快手转录选项及运行分支；历史配置自动迁移到 `auto`；Groq 暂时保留 |
| 7 | 苹果 GPU 看不到 | Apple Silicon 已通过 MLX Whisper 使用 Metal；Faster Whisper/CTranslate2 不支持 MPS，页面却把引擎与设备混在一起 | 自动模式直接展示实际硬件路线；Apple 显示“MLX Whisper · Apple GPU/Metal”，Faster Whisper 仅显示 CPU/CUDA |
| 8 | 本地模型页难读、像没有下载按钮 | 接口已有下载/激活能力，但列表没按用途分组；缓存路径占主视觉，右侧动作与模型信息分离；已下载时只显示灰色“已下载” | 改为用途分组模型卡，一张卡只有一个主动作；路径和技术错误折叠到详情 |
| 9 | 监控日志过于简单 | 日志模型已有任务字段，但普通 logger 缺少任务上下文；页面又同时承载设备、活动和原始日志 | 设置导航改为“诊断日志”，页面只保留诊断；增加结构化上下文、可读原因、建议动作和安全导出 |
| 10 | 任务中心空、不能删、不能跳详情、有重复浮窗 | 后端已有终态任务/批次删除接口，前端未接；单任务卡不是链接；浮动队列未排除 `/tasks` | 接通删除与详情跳转；压缩统计区，补筛选与任务元数据；任务中心内隐藏浮动任务队列 |

### 1.1 统一临时浮层规则

只对下列“临时浮层”应用：下拉菜单、选择器、Popover、小型二级面板。

- 点击浮层内部：保持打开。
- 点击浮层外部：关闭。
- 按 `Escape`：关闭并把焦点还给触发按钮。
- 打开同一组的另一个临时浮层：关闭前一个。
- 路由变化：关闭。
- 模态框、抽屉中的未保存表单：不得因为普通外部点击丢失内容。
- Accordion/“展开详情”：属于持久披露，不因外部点击关闭。

### 1.2 删除语义

- “删除任务”只删除任务历史记录，不删除笔记、合集、原媒体、转写、总结或下载缓存。
- 仅 `SUCCESS`、`FAILED`、`PARTIAL`、`CANCELLED` 等终态允许删除。
- 运行中或排队中的任务不显示删除按钮，继续使用取消/暂停。
- 第一阶段只做单条删除和批次记录删除；“清理 30 天前记录”列为后续增强，不在本轮偷偷增加自动清理。

### 1.3 推荐模型语义

“推荐”必须可解释，不能根据模型名字随意猜测，也不能宣称绝对最好。

- `已验证`：项目内有预置能力元数据或自动化验证。
- `速度优先`：来自受控模型注册表的明确标签。
- `质量优先`：来自受控模型注册表的明确标签。
- 能力未知时显示 `能力待确认`，允许用户手动选择角色，不显示推荐角标。
- 默认模型保存后继续执行 PUT + GET 回读；回读不一致必须报错，不能只靠前端乐观状态。

## 2. 在线转录服务调查

### 2.1 常见正式服务

| 服务 | 输入与调用形态 | 适合 NoteBi 的点 | 接入代价/风险 | 建议 |
|---|---|---|---|---|
| Groq Speech-to-Text | OpenAI 兼容的 multipart 转录接口；当前项目已有 | 已接入、改动最小、速度快 | 云端传输；文件限制和模型能力要在 UI 明示 | 本轮保留并补隐私说明 |
| OpenAI File Transcription | `/v1/audio/transcriptions`，multipart；官方文档当前建议 `gpt-transcribe`，单文件 25 MB | 可复用 OpenAI 风格适配器 | 长音频必须沿用项目现有的覆盖式分段，不能截断 | 候选，不在本轮直接上线 |
| Deepgram Pre-recorded | 支持本地二进制或 URL，单文件上限较大，支持说话人等能力 | 对长音视频和直接上传友好 | 新鉴权、新响应映射；中文质量必须实测 | 新在线服务首选 PoC |
| AssemblyAI | 先上传，再异步创建转录任务并轮询 | 成熟的长任务和说话人能力 | 增加上传生命周期和云端临时文件管理 | 第二候选 |
| 火山引擎录音文件识别 | 录音文件/极速等正式 API，适合中国网络环境 | 国内可达性和中文场景更合适 | 独立签名、任务轮询、计费和隐私告知 | 国内服务首选 PoC |
| 阿里云 Paraformer | 异步提交/查询，支持时间戳、说话人参数 | 中文、说话人能力完整 | 通常要求可访问文件 URL，会引入对象存储/预签名 URL | 暂不首接 |
| 腾讯云录音文件识别 | 创建任务后查询状态 | 国内正式服务、异步长任务 | 独立签名与状态机 | 备选 |

官方依据：

- [OpenAI File transcription](https://developers.openai.com/api/docs/guides/speech-to-text)
- [Groq Speech-to-Text](https://console.groq.com/docs/speech-to-text)
- [Deepgram Pre-recorded audio](https://developers.deepgram.com/docs/pre-recorded-audio)
- [AssemblyAI Upload API](https://www.assemblyai.com/docs/api-reference/files/upload?explorer=true)
- [火山引擎语音识别](https://www.volcengine.com/product/asr)
- [阿里云 Paraformer 录音文件识别](https://help.aliyun.com/zh/model-studio/paraformer-recorded-speech-recognition-restful-api)
- [腾讯云录音文件识别任务](https://cloud.tencent.com/document/product/1093/101674)

### 2.2 本轮边界

本轮只做：

1. 移除必剪、快手转录。
2. 保留并整理 `auto`、`fast-whisper`、`mlx-whisper`、`groq`。
3. 为将来正式服务抽出稳定的 `TranscriptionProvider` 内部协议，但只在现有 Groq 路径中使用，不创建空壳 UI。
4. 小米完成两个离线 PoC 报告：Deepgram 与火山引擎，各用同一组 5 个中文样本比较准确率、时间戳、说话人、耗时、失败恢复和成本。
5. 在用户确认服务与隐私方案前，不加入新 API Key 输入框，不把音频发送给新第三方。

PoC 样本至少包含：短普通话、30 分钟长音频、双说话人、带中英术语、低质量/噪声音频。长音频不能硬截断，必须复用现有覆盖式分段与拼接策略。

## 3. 小米执行顺序

## S0：锁定基线与测试债务

### 目标

避免把当前脏工作区的半成品误当作已验收功能，也避免 Xiaomi 覆盖其他人的改动。

### 操作

1. 保存 `git status --short` 到执行记录，只触碰本文列出的文件。
2. 先复跑调查基线：

   ```bash
   cd frontend
   CI=1 pnpm exec vitest run \
     src/__tests__/AddMaterialModal.test.tsx \
     src/__tests__/ProvidersAndModelsPage.test.tsx \
     src/__tests__/LocalModelsPanel.test.tsx \
     src/__tests__/DeployMonitorPage.test.tsx \
     src/__tests__/TaskCenterPage.test.tsx \
     src/__tests__/FloatingTaskQueue.test.tsx \
     src/__tests__/TranscriberHardwareStrategy.test.ts
   ```

   ```bash
   .venv/bin/python -m pytest \
     backend/tests/services/test_asr_hardware.py \
     backend/tests/services/test_asr_router.py \
     tests/backend/test_admin_logs.py \
     tests/backend/test_task_defaults.py -q
   ```

3. 当前已知基线：后端 `59 passed`；前端 7 个文件中 6 个通过，`FloatingTaskQueue.test.tsx` 有 14 个失败、53 个通过。失败原因是组件已在首页 `/` 隐藏，而旧测试的默认路由仍固定为 `/`。先把需要展示浮窗的旧用例默认路由改到普通非首页路径，再增加 `/tasks` 隐藏用例，不能删除断言蒙混通过。

### 验收

- 测试基线可重复。
- `git diff --name-only` 中没有无关文件被新增修改。

## S1：链接封面、合集浮层和原链接跳转

### 目标

一次修好用户截图 1、2、3 暴露的同类“来源与临时层”问题。

### 涉及文件

- `frontend/src/components/workspace/AddMaterialModal.tsx`
- `frontend/src/components/workspace/MaterialSourcePanel.tsx`
- `frontend/src/components/workspace/WorkspacePicker.tsx`
- `frontend/src/services/linkPreview.ts`
- `frontend/src/pages/result/ProcessingPage/index.tsx`
- `backend/app/routes/link_preview.py`
- `frontend/src/__tests__/AddMaterialModal.test.tsx`
- 新增 `frontend/src/hooks/useDismissibleLayer.ts`
- 新增对应 hook/WorkspacePicker/ProcessingPage 窄测试

### 实现细节

1. 保留当前两段式识别：`sniff-url` 先快速判断；标题或封面为空时调用 `link-preview`。
2. 统一封面 URL：支持 `//i*.hdslb.com/...` 协议相对地址；只允许 `http/https`；图像加载失败后显示稳定的平台占位，不把 `<img>` 隐藏后留下空白。
3. 确认封面从创建请求到任务结果、合集卡片和笔记卡片的字段名一致，重点核对 `thumbnail`、`video_thumbnail_url`、`cover_thumbnail` 的归一化，避免只在新建弹窗里临时显示。
4. `useDismissibleLayer` 负责外部 `pointerdown`、Escape、路由变化和焦点归还；先接 `WorkspacePicker`，再审计现有自制临时浮层：`KnowledgeScopePicker`、`SortMenu`、`TaskboardHead` 菜单、模型选择器。已有正确逻辑的组件只改为复用，不改变视觉。
5. `ProcessingPage` 删除 `navigator.clipboard.writeText` 路径。外部 URL 使用语义化 `<a>`，文案“打开原链接”，`target="_blank" rel="noreferrer"`。没有 URL 时不显示；不要把本地路径暴露给浏览器。

### 测试

- Bilibili 快速识别没有缩略图时，`link-preview` 补回协议相对封面。
- link-preview 失败、图片 404 时仍有占位和可读标题。
- 点击合集浮层内部不关闭；外部点击关闭；Escape 关闭并还焦点。
- 处理页按钮有正确 `href/target/rel`，且不再调用剪贴板。
- 创建后刷新合集/笔记列表，封面仍存在。

### 验收

- 截图 1 的已识别 Bilibili 素材展示真实封面或明确占位。
- 合集选择器不会在用户操作右侧设置时继续遮挡。
- 截图 3 的按钮点击后直接打开源页面。

## S2：取消手动截帧间隔上限

### 涉及文件

- `frontend/src/components/workspace/NoteSettingsPanel.tsx`
- `frontend/src/pages/SettingPage/AnalysisDefaultsPage.tsx`
- `frontend/src/pages/TaskCenterPage/BatchCreatePage.tsx`
- `backend/app/routes/workspaces.py`
- `shared/settings_store.py`
- `frontend/src/__tests__/AddMaterialModal.test.tsx`
- `frontend/src/__tests__/AnalysisTaskDefaults.test.tsx`
- `frontend/src/__tests__/BatchCreatePage.test.tsx`
- `tests/backend/test_task_defaults.py`
- 批量来源接口对应后端测试

### 实现细节

1. 所有手动输入统一为正整数秒：前端保留 `min=1`，移除 `max` 与 `Math.min(60/120, ...)`；后端 Pydantic 移除 `le=120`；设置持久化只做下界校验，不截到 120。
2. 输入空值时允许编辑态为空，失焦再回退默认 5，避免用户删数字时立刻跳回。
3. 增加快捷值 `5 / 10 / 30 / 60 / 120`，它们是建议而不是上限。
4. 自动间隔 `computeAutoInterval()` 的最多 60 秒属于自动推荐算法，可保留；UI 要明确“自动计算”，不能让用户误以为手动仍有限制。
5. 确认间隔大于视频总时长时至少分析首帧或一帧，不出现零帧除法或空任务。

### 测试与验收

- 新建单条、默认设置、批量任务都能输入并回读 `300` 和 `600`。
- `0`、负数、小数和非数字不能提交。
- 保存设置后重新 GET、刷新页面仍为原值。
- 600 秒间隔处理短视频不会崩溃，至少有一帧策略或明确跳过原因。

## S3：重组服务渠道与默认模型

### 目标布局

页面只保留两块：

1. **服务渠道**：连接状态、API 地址、密钥配置、刷新模型；默认折叠为紧凑卡片。
2. **默认模型**：四张角色卡——文本对话、视觉理解、嵌入、重排。每张显示当前供应商/模型、能力标签、状态和推荐理由，右侧只有“更换”。

点击“更换”打开统一模型选择器：顶部搜索；供应商筛选；能力筛选；列表行展示模型名、供应商、能力标签、推荐理由和选中状态。

### 涉及文件

- `frontend/src/pages/SettingPage/ProvidersAndModelsPage.tsx`
- `frontend/src/pages/SettingPage/ModelManagementPage.tsx`
- `frontend/src/pages/SettingPage/ProvidersManagementPage.tsx`
- `frontend/src/components/settings/models/*`
- `frontend/src/services/providers.ts`
- `backend/app/routes/providers.py`
- `shared/settings_store.py`
- `frontend/src/__tests__/ProvidersAndModelsPage.test.tsx`
- 模型选择器和后端模型元数据测试

### 实现细节

1. 从页面移除独立 `ModelManagementPage` 区块，不直接丢掉其中搜索/筛选代码；抽成 `ModelRolePicker`/`ModelPickerDrawer` 给四张默认模型卡复用。
2. 模型能力使用统一枚举：`chat`（文本对话）、`vision`（视觉理解）、`embedding`（嵌入）、`rerank`（重排）。UI 中每个模型至少有一个能力标签。
3. 扩展模型发现响应为可选字段：`capabilities[]`、`recommended_for[]`、`recommendation_reason`、`metadata_source`。旧供应商只有 `id/name` 时保持兼容，显示“能力待确认”。
4. 供应商级能力不能直接伪装成每个模型的能力；只有预置注册表或接口明确返回时才自动标注。
5. 选择完成后沿用现有 PUT + GET 回读；失败时保留原模型并显示错误。
6. 不自动更换用户当前默认模型，不因为“推荐”覆盖现有选择。

### 测试与验收

- 页面不再出现第三块“模型管理”。
- 四个角色都能通过同一个选择器搜索、筛选和保存。
- 视觉筛选不显示已知纯文本模型；重排模型明确标注“重排”。
- 未知模型显示能力待确认而非错误推荐。
- 保存、GET 回读、刷新、服务重启后均一致。
- 键盘可打开选择器、移动、选择、Escape 关闭并还焦点。

## S4：重构转录设置与 Apple GPU 表达

### 涉及文件

- `frontend/src/store/configStore.ts`
- `frontend/src/services/transcriber.ts`
- `frontend/src/pages/SettingPage/TranscriberPage.tsx`
- `frontend/src/locales/zh-CN/settings.json`
- `frontend/src/locales/en-US/settings.json`
- `backend/app/routes/transcriber_config.py`
- `backend/app/services/asr_router.py`
- `backend/app/services/asr_hardware.py`
- `shared/settings_store.py`
- 相关前后端 ASR 测试

### 实现细节

1. 从转录类型枚举、设置卡、后端 Literal/白名单和运行分支中移除 `bcut`、`kuaishou`。不要删除快手“素材下载/平台识别”支持，这次只移除快手转录服务。
2. 读取历史设置时将 `bcut/kuaishou` 迁移成 `auto`，写回时只写新枚举；UI 提示一次“原在线转录已停用，已切换为自动”。
3. 页面信息架构：
   - `自动（推荐）`：展示探测结果，例如“Apple Silicon → MLX Whisper（Apple GPU/Metal）→ CPU 备用”。
   - `Faster Whisper`：只提供 `自动 / CPU / NVIDIA CUDA`，不展示 MPS。
   - `MLX Whisper`：仅 Apple Silicon 显示，固定标注 `Apple GPU · Metal`，不再让用户从设备下拉里选择 MPS。
   - `Groq`：归入“在线”，显示“音频会上传到 Groq”与 API Key 状态。
4. 自动模式最终采用的引擎、设备和回退原因要进入任务诊断事件。
5. 不下载新模型、不发起第三方 PoC 请求，除非用户另行提供授权和密钥。

### 测试与验收

- Apple Silicon + MLX 可用：推荐 `mlx-whisper/mps`，页面清楚显示 Apple GPU。
- Mac 但 MLX 不可用：推荐 Faster Whisper/CPU 并说明原因。
- NVIDIA：推荐 Faster Whisper/CUDA。
- 手动 Faster Whisper + 历史 MPS：安全回退 CPU。
- 旧 `bcut/kuaishou` 配置启动不报错并迁移到 auto。
- 转录设置保存后 GET 回读一致。

## S5：本地模型页与设置布局可读性

### 目标布局

顶部是硬件摘要和推荐：例如“Apple M 系列 · 可使用 MLX”。下面按用途分组：

- 语音转写：Faster Whisper、MLX Whisper。
- 说话人识别：Sherpa、WeSpeaker、Pyannote。
- 图片文字识别：PaddleOCR。

每张模型卡显示：名称、用途、兼容设备、速度/质量档、预计大小、状态。只保留一个主动作，状态机如下：

- 未下载 → `下载`
- 下载中 → 进度 + `取消`（只有后端支持安全取消时才显示）
- 已下载但未启用 → `使用`
- 当前启用 → `使用中`（禁用）
- 失败 → `重试`
- 不兼容 → `当前设备不可用`

缓存路径、仓库 ID、原始错误进入“技术详情”折叠区。

### 涉及文件

- `frontend/src/pages/SettingPage/LocalModelsPanel.tsx`
- `frontend/src/pages/SettingPage/AnalysisDefaultsPage.tsx`
- `frontend/src/pages/SettingPage/DownloadSettingsPage.tsx`
- `frontend/src/pages/SettingPage/NetworkSettingsPage.tsx`
- `frontend/src/styles/settings-page.css`
- `backend/app/services/local_model_manager.py`
- `frontend/src/__tests__/LocalModelsPanel.test.tsx`
- 本地模型接口测试

### 实现细节

1. 先重做 `LocalModelsPanel`，再把同一布局基线应用到下载/网络页：内容最大宽度一致、标题/说明/控件对齐、次要技术说明折叠、主操作靠近对象。
2. 不增加自动下载；“推荐”只提示，必须由用户点击下载。
3. 已下载模型仍必须有清楚的“使用”按钮；不要只显示灰色“已下载”。
4. 不在本轮增加删除模型缓存，避免误删大文件和正在使用模型。
5. 如果小米环境能使用既有 Open Design 项目，可把上述固定信息架构做视觉校验；不得另起一套导航或改变 NoteBi 现有字体、色板、圆角和间距令牌。当前 Codex 环境没有可调用的 Open Design 工具，因此本文给出的布局与状态机是执行基准。

### 测试与验收

- 未下载、下载中、已下载、使用中、失败、不兼容六种状态都有视觉与交互测试。
- 320/768/1440 宽度无文字重叠、按钮漂移或横向滚动。
- 键盘焦点、禁用态、进度条 aria 信息完整。
- 下载完成后无需手动刷新即可变为“使用”；激活后 GET 回读一致。

## S6：把运行监控收敛为诊断日志

### 涉及文件

- `frontend/src/pages/SettingPage/DeployMonitorPage.tsx`
- 设置导航与中英文文案
- `frontend/src/__tests__/DeployMonitorPage.test.tsx`
- `backend/app/services/runtime_log_store.py`
- `backend/app/services/task_runner.py`
- `backend/app/routes/admin.py`
- `tests/backend/test_admin_logs.py`
- 关键 pipeline/download/ASR/VLM 调用点

### 页面结构

1. 页面标题与导航改成“诊断日志”。
2. 移除设备卡片、任务活动页签和与任务中心重复的统计；只保留：筛选栏、诊断事件列表、事件详情、导出。
3. 默认事件行展示：时间、级别、处理阶段、可读摘要、关联任务、结果。
4. 展开后展示：发生位置、可能原因、建议动作、错误类型/状态码、耗时、重试、引擎/供应商/模型/设备、脱敏技术详情、诊断 ID。
5. 支持按严重度、任务、组件/阶段、时间范围和关键词过滤；支持复制诊断 ID和导出脱敏 JSON。

### 结构化事件契约

在现有字段基础上增加并统一：

- `event_code`
- `operation`
- `component`
- `stage`
- `outcome`
- `summary`
- `probable_cause`
- `suggested_action`
- `error_type` / `error_code` / `status_code`
- `duration_ms`
- `retry_count` / `retry_max`
- `engine` / `provider` / `model` / `device`
- `task_id` / `batch_id` / `workspace_id`
- `correlation_id`
- `technical_detail`（脱敏、限长）

使用 `contextvars` 或等价任务上下文，把 task/batch/workspace/correlation ID 自动带进普通 logger，避免每个调用点手工拼字符串。优先补齐下载、链接预览、ASR、VLM、LLM、导出六条链路。

### 安全要求

- 永不记录 API Key、Bearer、Cookie、完整请求体、转写正文、提示词、用户笔记正文。
- 导出前再次脱敏 URL token、查询参数、macOS/Windows 绝对路径和用户名。
- 技术堆栈默认折叠并限长；UI 首屏用用户可读摘要。
- 日志保持只读，本轮不增加“清空全部日志”。

### 测试与验收

- 模拟 Bilibili 封面 JSONDecodeError，日志必须说明“链接预览/Bilibili/响应解析失败/已重试次数/建议重新尝试”，不能只显示 `RetryError`。
- 模拟 ASR 自动回退，能看到原引擎、设备、失败原因和最终引擎。
- 搜索 task ID 能找到该任务完整阶段链。
- 脱敏测试覆盖 API Key、Authorization、Cookie、URL token、绝对路径。
- 导出文件可用于定位问题且不含内容正文和密钥。

## S7：任务中心补齐删除、详情与信息密度

### 涉及文件

- `frontend/src/pages/TaskCenterPage/index.tsx`
- `frontend/src/pages/TaskCenterPage/BatchDetailPage.tsx`
- `frontend/src/components/FloatingTaskQueue.tsx`
- `frontend/src/services/pipeline.ts`
- `frontend/src/services/taskBatches.ts`
- `frontend/src/__tests__/TaskCenterPage.test.tsx`
- `frontend/src/__tests__/FloatingTaskQueue.test.tsx`
- 删除接口对应后端测试

### 页面结构

1. 把四个巨大的统计卡压成一行可点击状态筛选：处理中、等待中、需处理、已完成。
2. 搜索栏旁增加状态、类型、时间筛选；保留批量任务/单条任务切换。
3. 任务行展示真实已有数据：缩略图或来源图标、标题、任务类型、合集、状态、当前阶段、进度、创建/更新时间、耗时、重试次数、最后一条用户可读错误、产出状态。
4. 整行可点击，内部操作按钮阻止冒泡：
   - 运行/等待/失败/取消/部分完成 → `/processing/:taskId`
   - 成功且有 `workspace_id + item_id` → 对应笔记详情
   - 批次 → `/tasks/batches/:batchId`
   - 目标已不存在 → 保留任务详情并说明“产出已不存在”，不能静默无反应
5. 终态任务右侧显示删除按钮。二次确认明确“只删除任务记录，不删除笔记和媒体”；成功后重新拉取列表和统计。
6. 任务中心所有 `/tasks` 路由隐藏 `FloatingTaskQueue`，其他页面仍只在有运行任务时显示。
7. 失败任务提供“查看诊断”深链，自动带 task ID 过滤条件。
8. 空状态根据筛选条件区分“暂无任务”和“没有匹配结果”，提供“新建任务”或“清除筛选”。

### 测试与验收

- 单条任务不同状态都跳到正确页面；内部删除按钮不会同时触发行跳转。
- 终态删除调用现有 DELETE 接口；运行中无删除按钮；后端 409 有友好提示。
- 删除后计数和列表一致；刷新后记录不会回来，笔记仍存在。
- `/tasks`、`/tasks/batches/:id` 不渲染浮动任务队列。
- 普通页面有运行任务时浮窗仍可用；首页继续由活动条承担进度。
- 1280×720 和 1920×1080 下没有大面积无意义空白，操作不被右下角遮挡。

## S8：最终回归与交接

### 自动化

按模块先跑窄测试，再跑：

```bash
cd frontend
CI=1 pnpm test
pnpm build
```

```bash
.venv/bin/python -m pytest tests/backend backend/tests -q
.venv/bin/python -m compileall backend shared
```

如果全量测试超时，记录最后完成的测试文件和退出状态，不得写“已通过”。

### 人工验收场景

1. Bilibili 链接识别出封面；封面失败有占位；创建并刷新后封面仍在。
2. 打开合集选择器，点击右侧设置后自动关闭；模态框未保存表单不会被误关。
3. 处理页直接打开源视频。
4. 截帧间隔输入 300，创建、保存、刷新、批量入口均保持 300。
5. 默认模型四类可筛选、带能力标签和可解释推荐，刷新后保持。
6. Apple Silicon 页面清楚显示 MLX/Apple GPU；无必剪和快手转录。
7. 本地模型六种状态清楚，下载/使用按钮靠近模型。
8. 诊断页能用一条失败事件定位任务、阶段、原因、重试和建议，导出无敏感信息。
9. 任务中心可以进详情、删终态记录、查看诊断，且没有右下角浮窗。

### 每个提交后的交接格式

- 提交哈希与主题。
- 修改文件。
- 用户可见行为。
- 实际运行的测试命令、通过数和退出码。
- 未验证项：网络服务、Apple/NVIDIA 真机、浏览器尺寸等逐项写明。
- 仍存在的脏文件必须列出并说明归属，不能打包进提交。

## 4. 建议提交拆分

1. `fix: restore link covers and dismiss transient pickers`
2. `fix: open processing source links directly`
3. `fix: remove manual frame interval ceiling`
4. `feat: consolidate provider and default model selection`
5. `fix: clarify Apple ASR and retire unofficial transcribers`
6. `feat: reorganize local model downloads by purpose`
7. `feat: turn runtime monitor into structured diagnostics`
8. `feat: enrich task center navigation and deletion`
9. `test: close product usability regression matrix`

如果实际改动因当前脏文件无法安全拆分，停止并报告重叠文件，不能用 `git add -A`。

## 5. 直接给小米的执行提示词

> 你现在执行 `docs/plans/2026-08-02-product-usability-model-asr-diagnostics-task-center.md`。先按 S0 做 Git 对账和当前测试基线，不要清理或吸收已有脏文件。严格按 S1→S8 串行执行，每个主题先测试、后实现、再窄回归，并拆成独立本地提交。不要 push。遇到以下情况立即停下用中文报告事实和选项：现有接口/数据结构与计划不一致；需要引入依赖；需要下载模型；要新增云转录供应商或发送音频到第三方；删除语义会影响笔记/媒体；当前脏文件无法安全区分归属。每完成一个提交，都更新 `docs/AI_HANDOFF.md` 的当前指针、实际测试结果和未验证项。
