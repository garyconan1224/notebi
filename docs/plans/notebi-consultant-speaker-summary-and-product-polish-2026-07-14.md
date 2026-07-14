---
status: implemented_and_verified
created: 2026-07-14
updated: 2026-07-14
owner: Codex
priority: P0
---

## 本轮用户确认的追加范围（2026-07-14）

本轮用户确认按前一轮建议直接实现以下行为：

- 说话人改名后，主笔记与所有历史总结版本的落盘内容同步更新；不再只更新 JSON 或接口回显。
- 说话人保存为“姓名 + 角色”档案。角色使用固定下拉选项：主持人、我司领导、客户、讲师、其他；姓名可自由输入。
- 后续区分说话人总结将把姓名和角色作为证据上下文，角色未知时不得推断。
- 新建总结改为后台任务，展示阶段和百分比进度。
- OpenAI-compatible Provider 继续作为统一开放协议，并覆盖华为昇腾常见的 vLLM-Ascend / MindIE OpenAI-compatible 服务；不能依赖硅基流动专有参数。
- 音频波形自适应播放器宽度；字幕行减少头像与完整姓名重复；转写导出显示内容标题与类型。

实现约束：保持旧 `speaker_map`、旧总结模板和旧接口兼容；不做数据库 schema 迁移，新增角色信息使用现有 JSON results 的兼容字段。

## 本轮实现与验证结果（2026-07-14）

- 改名链路现在同时更新 `results.speaker_map`、内存中的所有历史总结、`note.md` 与 `summaries/**/*.md`；角色以 `results.speaker_roles` 保存，姓名与角色在前端独立编辑。
- 区分说话人提示词新增姓名/角色档案、证据账本、逐人观点、互动闭环、共识/分歧/决策/行动项/风险检查规则；短文本和长音频分块链路都透传角色档案。
- 新建总结通过既有 TaskRunner 异步执行，阶段为 `SUM`，前端显示日志、百分比和终态；版本号在任务完成后分配。
- OpenAI 兼容客户端按 provider 独立携带 `base_url`，使用标准 `/models`、`/chat/completions`、`/embeddings`、`/rerank`，可配置 vLLM-Ascend 和 MindIE；增加 `docs/openai-compatible-providers.md`。
- 音频波形按容器宽度重采样，字幕详细模式只在说话人切换时显示完整姓名，独立转写导出带内容标题与转写类型。
- 验证：后端 `1032 passed, 2 skipped`；前端 `29 files / 204 tests passed`；前端 TypeScript/Vite build 通过；Python compileall 与 `git diff --check` 通过。

# NoteBi 咨询师录音总结、模型设置与产品文案修复计划

## 1. 用户已确认的产品决策

本计划由 Codex 负责规划，交给其他工具执行。执行工具不得重新设计产品方向；如实际代码、接口、数据结构或用户可见行为与本计划不一致，必须停下并回报。

已确认：

1. 用户在“添加素材”中选择的总结方式，就是该素材本次生成所使用的总结方式，不能在后端被默认模板覆盖。
2. 普通总结和区分说话人总结都支持音频和视频。
3. 开启“区分说话人”后，才显示区分说话人的专属模板；关闭时只显示普通总结模板。
4. 用户可见的 `Nibi` 全部改为 `NoteBi`；内部名称也尽量修改，但必须保留必要的旧数据、旧 key、旧路由和产品模式兼容。
5. 旧的“会议纪要 / 线下采访 / 客户接待”等说话人模板必须保留。新增的两个模板使用不同的“咨询师录音版本”名称，不替换旧模板。
6. 本轮不删除旧总结、不覆盖旧总结；新模板生成新版本或新模板记录。

## 2. 当前事实与问题证据

### 2.1 目标素材的当前结果

目标素材：

```text
/workspaces/__inbox__/items/38db58af-8404-4441-928f-aa01c3b39477/note
```

当前已有总结模板为 `speaker_meeting`，输出主要是：

- 会议概览表格；
- 议题 / 说话人 / 观点 / 时间证据表格；
- 决议、分歧、行动项表格；
- 使用 `SPEAKER_00`、`SPEAKER_01` 等未重命名身份。

这与用户要求的两种格式不一致。当前问题不是只有前端显示问题，必须同时调整模板提示词、长音频分块总结链路、前端模板选择和回归测试。

### 2.2 模型设置问题证据

当前后端 `/providers` 返回的 SiliconFlow 配置类似：

```json
{
  "capabilities": ["chat"],
  "default_models": {"chat": "deepseek-ai/DeepSeek-V3"}
}
```

但当前模型接口实际可返回：

- chat：64 个模型；
- vision：64 个模型；
- embedding：8 个模型；
- rerank：6 个模型。

因此“找不到模型”至少包含两层问题：

1. 前端 `/providers` 响应解析丢失了顶层默认 provider 元数据；
2. 前端和后端使用旧的 provider 能力标签过滤模型，导致视觉、嵌入、重排模型虽存在，却不能配置。

### 2.3 Nibi 残留范围

已发现用户可见或可能用户可见的残留包括：

- 首页最近任务 fallback 文案；
- 设置页的 `~/.nibi` / `~/.NIBI` 文案；
- 设置语言包中的 appName、简介、关于页文案；
- 关于页 GitHub 地址中的 `nibi`；
- 导出 Markdown、HTML、PDF、Obsidian 的生成署名和 tag；
- 后端 FastAPI title、导出模板和默认标题；
- 内部 CSS class、localStorage key、旧产品模式 `nibi`、兼容路由和模块名。

## 3. 总体执行顺序

按以下顺序执行，不要一开始全局机械替换：

1. 先修复总结模板契约和前后端透传；
2. 再修改添加素材和新建总结的交互；
3. 再修复模型列表、能力和默认模型保存回显；
4. 最后做 NoteBi 文案及内部命名清理；
5. 每阶段运行针对性测试，确认无误后再进入下一阶段；
6. 最后用目标素材生成两种新模板，进行浏览器验收。

## 4. 阶段 A：新增两个咨询师说话人模板

### 4.1 建议模板 ID

使用稳定、不会与旧模板冲突的 ID：

```text
speaker_consultant_detailed
speaker_consultant_meeting_customer_voice
```

显示名称必须是：

```text
咨询师录音版本详细总结
咨询师录音版会议纪要/客户声音
```

两个模板均设置：

```text
speaker_aware_only = true
style_categories = (style_audio, style_video_with_frames, style_video_text_only)
output_format = markdown
```

视频使用这两个模板时，以带说话人标签的转写为主；不要因为选择模板就强行加入画面描述或图片占位符。

### 4.2 模板一：咨询师录音版本详细总结

目标：输出以主谈人 / 汇报人为主线的高管会谈观点提炼文档。

必须遵守：

1. 第一行标题格式：

   ```markdown
   # [日期]_[主谈人/汇报人]与会谈对象[会议主题/会谈名称]
   ```

2. 日期、主谈人、会谈对象、主题只能取自素材元数据或原文；缺失时写“待确认”，禁止猜测。
3. 按议题切换分段，不按“开始 / 中间 / 结束”时间顺序分段。
4. 使用：

   ```markdown
   **一、[第一个核心议题]**

   1. **[观点摘要]**，展开说明，保留数据、案例和金句。
   2. **[观点摘要]**，展开说明。

   **二、[第二个核心议题]**
   ```

5. 每个观点必须是“加粗观点摘要 + 非加粗论据 / 数据 / 案例”。
6. 主谈人作为主线，使用“指出 / 介绍 / 分享 / 强调”等第三人称动作。
7. 其他发言人不得单独拆成无关段落，应插入对应议题的要点，并明确写“XXX补充”。
8. 问答必须合并成完整链路：提问、回应、客户反馈或行动项。
9. 保留数字、对比、案例、金句和中英文专业表达。
10. 去掉口头禅、重复、第一人称和无意义寒暄。
11. 涉及客户或第三方时，改为第三人称客观表述。
12. 最后一段使用“**小结**”或“**展望**”，用自然段总结建议和后续方向，不再编号。

### 4.3 模板二：咨询师录音版会议纪要/客户声音

目标：输出按会谈流程组织、完整保留双方声音和互动闭环的会议纪要。

必须遵守：

1. 不输出总标题，直接从第一环节开始。
2. 按会谈流程环节分段，例如：

   ```markdown
   **一、开场寒暄与背景介绍**
   **二、客户业务现状分享**
   **三、方案讨论与问答**
   **四、后续行动讨论**
   ```

3. 每个环节的第一条是该环节的总起。
4. 第一层使用编号，每个编号代表一个发言轮或子主题：

   ```markdown
   1. **CEO分享客户业务发展：**
      * 具体背景、数据和原话事实。
      * 客户当前挑战和目标。

   2. **咨询师回应客户关于成本的问题：**
      * 回应内容。
      * 可参考案例或数据。
      * 客户反馈和后续要求。
   ```

5. 第二层统一使用 `*`，不能再使用数字编号。
6. 双方按实际发言顺序交替出现，不拆成“我方 / 客户方”两个独立区块。
7. 简短问答合并成一个要点；较长互动必须闭环为“客户问题 → 我方回应 → 客户反馈 / 后续行动”。
8. 客户的自我披露、震惊、兴趣、质疑、要求 follow up、小范围 trial 等必须保留。
9. 保留中英文混杂的行业术语，不强行翻译。
10. 保留现场感，但把口语转换为书面表达。
11. 不额外添加“小结”或“总结”段，最后一个讨论环节自然结束。

### 4.4 说话人身份规则

- 有用户重命名的 `speaker_map`：使用用户重命名后的名称。
- 没有重命名：保留 `SPEAKER_00` 等原始身份，不得猜测真实姓名或职位。
- 原文不能确认“主谈人 / 客户方 / 咨询师方”时，必须写“角色待确认”。
- 不允许为了满足标题格式或角色格式而虚构人物、日期、决策、负责人、截止时间或客户反馈。

### 4.5 必须覆盖的代码入口

重点检查和修改：

- `backend/app/services/summary_templates.py`
- `backend/app/services/summary_generator.py`
- `backend/app/services/pipeline_tasks.py`
- `backend/app/routes/templates.py`
- `backend/app/routes/workspaces.py`
- `frontend/src/components/NewSummaryModal.tsx`
- `frontend/src/components/SummariesTab.tsx`
- `frontend/src/pages/result/NoteShell/index.tsx`
- `frontend/src/components/workspace/AddMaterialModal.tsx`

长音频必须验证 `_generate_audio_summary()` 的分块模式也使用新模板的结构，而不是只在短音频 `build_prompt()` 中生效。

## 5. 阶段 B：添加素材与新建总结交互

### 5.1 普通模式

- 默认不启用区分说话人。
- 只展示普通总结模板。
- 用户在添加素材中选中的 `summary_template` 必须原样透传。
- 后端不得在 `summary_template` 缺失以外的情况下擅自替换用户选择。

### 5.2 区分说话人模式

- “区分说话人”从“高级设置”移到笔记设置主区域，直接可见。
- 音频和视频都支持此开关。
- 开启后同时设置：

  ```text
  diarize = true
  summary_mode = speaker_aware
  ```

- 开启后显示所有说话人模板：旧模板 + 两个咨询师新模板。
- 关闭后隐藏说话人模板，并恢复普通模板选择。
- 开启后默认选择第一个新咨询师模板，但如果用户已经明确选择旧模板，不得覆盖用户选择。
- 说话人数设置仍保留，并继续透传 `speaker_count`。
- 音频 / 视频均要覆盖链接提交、本地文件提交、批量视频提交和结果页“新建总结”。

### 5.3 删除非笔记入口

从添加素材弹窗移除以下用户可见入口及点击占位：

- AI视频；
- 分镜脚本；
- 二创改写。

只移除 NoteBi 笔记产品界面的入口，不删除仍被其他产品模式或兼容路由使用的后端能力。

## 6. 阶段 C：模型列表与默认模型配置

### 6.1 响应解析

统一处理 `/providers` 两种合法结构：

```json
[...]
```

和：

```json
{
  "data": [...],
  "default_provider_for_chat": "...",
  "default_provider_for_vision": "...",
  "default_provider_for_embedding": "...",
  "default_provider_for_rerank": "..."
}
```

不能在先取 `res.data.data` 后，再从已经变成数组的变量上读取顶层默认字段。

涉及：

- `frontend/src/pages/SettingPage/ModelManagementPage.tsx`
- `frontend/src/pages/SettingPage/ProvidersAndModelsPage.tsx`
- `frontend/src/store/providerStore.ts`
- `frontend/src/services/providers.ts`

### 6.2 能力和模型选择

当前 provider 可能只声明 `chat`，但同一个 OpenAI 兼容接口实际支持视觉、嵌入、重排模型。实现时必须让用户能够按能力配置模型：

- 使用 `/providers/{provider_id}/models?capability=chat|vision|embedding|rerank` 获取候选模型；
- 不要只因为 provider 静态 capabilities 缺少某能力，就把已有候选模型隐藏；
- 用户保存某角色模型时，后端必须确保该 provider 的能力配置和默认模型配置足以让运行时解析到它；
- `GET /providers` 刷新后必须能回显 provider、角色和 model；
- 失败时显示明确原因，不要静默显示“没有匹配的模型”。

如需要增加 provider 能力字段，使用现有 settings JSON / provider 配置契约，不新增数据库 schema；必须保持旧配置可读取。

### 6.3 保存和刷新回显

每类默认模型都必须验证：

1. 选择 provider；
2. 选择 model；
3. 点击保存；
4. 重新读取 `/providers`；
5. 刷新浏览器；
6. 页面仍显示相同 provider 和 model。

不能只验证 PUT 请求成功。

## 7. 阶段 D：Nibi → NoteBi 命名清理

### 7.1 必须修改的用户可见内容

- 首页 Hero、任务卡片和 fallback 文案；
- 设置页标题、说明、应用名称和 `~/.nibi` 文案；
- 关于页、语言包、GitHub 链接占位；
- 导出 Markdown / HTML / PDF / Obsidian 的署名、标题和 tag；
- 后端 API title 或诊断页面中直接显示给用户的产品名。

统一使用 `NoteBi`，路径文案统一使用项目真实路径对应的 NoteBi 名称。

### 7.2 内部命名清理原则

在不扩大风险的前提下修改：

- NoteBi 专属 CSS class；
- NoteBi 专属 localStorage key；
- NoteBi 专属前端 fallback key；
- NoteBi 专属导出标识。

必须保留：

- `nibi` 产品模式值，因为其他产品模式仍依赖；
- 旧 localStorage key 的读取 fallback；
- 历史导出 / 历史笔记的读取兼容；
- 旧 API 路径和旧总结模板 ID；
- 共享模块和其他产品模式仍使用的内部命名。

执行前先用 `rg` 建立残留清单，完成后再次搜索。不要仅做全局大小写替换。

重点入口：

- `frontend/src/config/product.ts`
- `frontend/src/pages/WorkbenchPage/Hero.tsx`
- `frontend/src/pages/WorkbenchPage/RecentTasks.tsx`
- `frontend/src/layouts/SettingsShell.tsx`
- `frontend/src/pages/SettingPage/AboutPage.tsx`
- `frontend/src/locales/zh-CN/settings.json`
- `frontend/src/locales/en-US/settings.json`
- `frontend/src/lib/modelMemory.ts`
- `backend/app/routes/export.py`
- `backend/app/services/note_exporter.py`
- `backend/app/services/av_synthesis/templates/`

## 8. 兼容和数据安全要求

- 不删除 `speaker_meeting`、`speaker_interview`、`speaker_customer_reception`。
- 不修改已有总结文件内容。
- 不改变旧总结读取路径。
- 不新增数据库迁移。
- 不修改 API key、密码、环境变量中的真实值。
- 不下载新模型、不安装新依赖；如发现必须安装，先停下询问。
- 不迁移实际数据目录，除非先确认当前真实路径、兼容读写方案和回滚方式。
- 不删除视频 / 图片 / 文字的既有功能。

## 9. 测试和验收

### 9.1 后端

新增或更新：

- `backend/tests/services/test_summary_templates.py`
- `backend/tests/test_summary_generator.py`
- `tests/backend/test_audio_initial_summary.py`
- `tests/backend/test_audio_a3.py`
- `tests/backend/test_video_templates.py`
- `tests/backend/test_summaries.py`
- provider / workspaces API 相关测试

至少覆盖：

1. 两个新模板存在、名称正确、只允许 speaker-aware；
2. 普通模式使用说话人模板会被拒绝；
3. 音频短文本生成两种格式；
4. 音频长文本分块生成两种格式；
5. 视频带说话人转写也能生成两种格式；
6. 没有说话人标签时不会伪造身份；
7. 用户选择的模板 ID 能从添加素材一路到流水线和最终总结；
8. provider 能正确保存和刷新回显 chat / vision / embedding / rerank；
9. 旧模板和旧总结仍能读取。

### 9.2 前端

至少覆盖：

- `frontend/src/__tests__/AddMaterialModal.test.tsx`
- `frontend/src/__tests__/NewSummaryModal.test.tsx`
- `frontend/src/__tests__/NoteShellSummarySwitch.test.tsx`
- provider / model settings 相关测试

验证：

- 普通模式不显示说话人模板；
- 开启区分说话人后显示旧模板和两个新模板；
- 选中的模板 ID、`summary_mode`、`diarize`、`speaker_count` 正确提交；
- 添加素材弹窗不再显示 AI 视频、分镜脚本、二创改写；
- 模型选择保存后刷新仍正确；
- 用户可见文案不再出现 Nibi。

### 9.3 静态检查和浏览器验收

运行：

```bash
pnpm --dir frontend exec tsc --noEmit --pretty false
pnpm --dir frontend test -- --run
pnpm --dir frontend build
./.venv/bin/pytest -q backend/tests tests/backend
```

浏览器至少验证：

1. 添加音频，选择“咨询师录音版本详细总结”，开启区分说话人，生成成功；
2. 添加视频，选择“咨询师录音版会议纪要/客户声音”，开启区分说话人，生成成功；
3. 目标素材生成两种新总结，旧 `speaker_meeting` 仍在；
4. `/settings/providers-models` 中四类模型可配置并刷新回显；
5. 首页、设置、关于页、导出结果不再显示用户可见 Nibi；
6. 浏览器控制台无新增错误。

## 10. 执行工具的停点

出现以下任一情况必须停止，不得自行决策：

1. 发现需要数据库 schema / migration；
2. 发现实际总结保存结构与本计划不一致；
3. 发现模型能力只能通过下载新模型或安装依赖解决；
4. 发现修改 Nibi 内部命名会影响其他产品模式或历史数据；
5. 发现新模板会改变旧总结内容或旧模板读取；
6. 发现视频、图片、文字功能必须改变才能实现本计划；
7. 需要修改环境变量、API key、鉴权或权限逻辑；
8. 预计改动范围超出本计划且无法保持兼容。

停点汇报格式：

```text
我在执行 X 时发现实际情况是 A，但计划写的是 B。
现在有两个方案：
1. ...
2. ...
这会影响 ...。
请确认后再继续。
```

## 11. 给外部执行工具的直接指令

你是执行者，只按本计划实施，不重新规划产品方向，不删除旧模板，不覆盖旧总结，不主动扩大范围。

启动时先运行：

```bash
git status --short --branch
git log --oneline -5
git branch --show-current
```

然后按阶段 A → B → C → D 执行。每个阶段完成后运行对应测试并报告：

- 修改文件；
- 修改原因；
- 测试命令和结果；
- 尚未验证的项目；
- 是否触发停点。

不要执行：

- `git push`；
- `git reset --hard`；
- 删除旧模板或旧总结；
- 全局无差别替换所有 `nibi`；
- 修改真实 API key、密码或 `.env`；
- 安装依赖、下载模型或迁移数据目录。

## 12. 2026-07-14 实施记录

已完成：

1. 新增 `speaker_consultant_detailed` 与 `speaker_consultant_meeting_customer_voice`，保留三种旧说话人模板；两种新模板均仅限说话人模式，并同时支持音频与视频分类。
2. 添加素材页将“区分说话人”和预计人数前置到笔记设置；开启后默认选择咨询师详细总结，仅展示说话人专属模板；已移除 AI 视频、分镜脚本、二创改写入口。
3. 新建总结页在说话人模式下展示相同的五种模板，并默认选择咨询师详细总结。
4. 默认模型配置不再因 provider 初始 capability 只有 `chat` 而隐藏；保存某个角色模型时，后端同步保存该角色 capability 与全局默认 provider/model，运行时可以解析该 provider。
5. 用户可见的 Nibi 品牌文案、任务卡、设置抬头、关于页、导出署名与标签已统一为 NoteBi；旧产品 mode、CSS class 和 localStorage key 保留兼容，避免破坏既有数据。

已验证：

- `pnpm --dir frontend exec vitest run`：29 个文件、200 个测试通过。
- `./.venv/bin/pytest -q backend/tests`：400 个测试通过（存在既有第三方弃用与未注册 integration 标记警告）。
- `pnpm --dir frontend build`：通过。
- `./.venv/bin/python scripts/verify_notebi_product_polish.py`：通过；已确认首页无 Nibi、添加素材的说话人模板可见、视觉模型下拉可见 SiliconFlow 和模型。

未执行真实 LLM 生成或更改用户的默认模型选择：这两项会产生新的总结版本或更改实际设置，需由用户在界面中选择具体模型/素材后触发。
