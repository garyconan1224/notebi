---
title: Track K · M7 · NI 详细执行卡 —— 「生成笔记」智能入口（添加侧，走后端统一流程）
status: done
owner: 计划=Claude(CC) / 执行=xiaomi mimo v2.5-pro + Claude(CC)
created: 2026-06-06
completed_date: 2026-06-06
commits: c7bee83 (NI.1), 0e7cfb4 (NI.2-redo), f63ea5f (NI.3), 5476bc6 (NI.4 merge)
actual_hours: 4
parent: docs/plans/track-K-M7-noteshell-execution-plan.md
position: 插在 R3 与 R4 之间 —— 用户 2026-06-06 定：它是 R2/R3 真实测试的前置（没有正确素材入口，结果页测不准）
depends: R0/R1/R2/R3（NoteShell + 媒体接入已 done）；后端 handle_note_task 统一流程已存在
scope: 只新增「生成笔记」一条添加路径；走后端已有 handle_note_task 统一流程；不改现有四类型解析、不碰复刻线
workflow: 一会话一子任务；分支 feat/k-ni-<n>-xxx；CC 验收后再下一子任务
---

# 0. NI 是什么（一句话）

> 「添加素材」页新增一条 **「生成笔记（智能识别）」** 路径:粘贴链接 → 自动探测内容(图文/视频/音频/纯文) → 走后端**已有的** `handle_note_task` 统一流程(图文都抓) → 产出进 NoteShell。**取代"手选类型才能解析"的痛点,并修复"图文链接选『文字』丢图"的 bug**(同一根源)。

# 1. 为什么这是 R2/R3 测试的前置（用户视角）

- R2(三视图)/R3(媒体)的结果页要测准,必须有**正确的素材数据**(图文带图、视频带帧/转录)。
- 现状手选类型会丢内容(图文选『文字』丢图),素材源头就不对 → 结果页测不准。
- 所以**先打通正确的"生成笔记"入口,再回头用真实素材测 R2/R3**。

# 2. 已核实的代码事实（关键:后端已就绪,只差前端接）

| 拼图 | 事实（file:line） |
|---|---|
| **后端统一流程(已有)** | `handle_note_task`(pipeline_tasks.py:1527):复合任务,`steps=download/transcribe/analyze/note`,状态机 `DOWNLOAD→PROBE→FRAMES→ASR→VLM→SUM→STORE` |
| **自动探测(已有)** | `_classify_note_url`(:1196)→ xiaohongshu/bili_opus/text_page/video_audio；`_download_note_source`(:~1242) 按平台抓取,返回 `kind_hint`(text/image_text/video/audio)+content+images。**小红书→image_text,图文都抓**(:1264) |
| **前端嗅探(已有)** | `sniffUrl()`→`POST /sniff-url`→`SniffResult{possible_types}`(workspaces.ts:89);AddMaterialModal 已用它**辅助手选类型** |
| **缺口** | 前端"一键解析"按**手选单一 type** 建任务(走 handle_text/image/audio 分流),**从不创建 note task / 不走统一流程** → 图文被当纯文字 |
| assemble 触发 | `register_success_callback` 注册在 `("analyze","text","audio","image")`(workspaces.py:348)——**待核实是否含 note task 的 type**;不含则 NI.1 要补 |
| 数据模型 | `ItemType` 只有 video/audio/image/text(**无 image_text**)→ NI 要定 image_text 笔记落成哪个 type |

# 3. 关键设计决策（CC 替你定）

1. **走后端已有统一流程,不另造解析**:NI 让前端创建 **note task**(`steps=download/transcribe/analyze/note`),复用 `handle_note_task`。**不改它内部逻辑、不改现有四类型解析、不碰复刻线**。
2. **入口形态**:AddMaterialModal 新增一条与四类型**并列的「生成笔记(智能识别)」路径**(用户原话"专门有个按钮、不同路径")。选它 → 不手选类型 → 粘贴 URL → sniff 显示"识别为:图文/视频…" → 点「生成笔记」→ 建 note task → 进 NoteShell。
3. **保留现有"一键解析(按类型)"不动**:给复刻线/高级场景用;NI 是新增并存路径,零破坏。
4. **image_text 落库 type**:小红书图文 → 建议 `item.type=image`(多图 + 文字正文),正好复用 R3.1 的 image inline 展示(多图展示在 NI.3 完善);具体以 NI.1 核实 handle_note_task 实际产出为准。
5. **产出接 NoteShell**:note task 完成 → assemble note.md(含图文 media)→ NoteShell 可读。assemble 不触发则 NI.1 补注册。

# 4. 子任务分解（一会话一子任务,分支 feat/k-ni-<n>-xxx）

### NI.1 — 后端打通「发起 note task → 产出进 NoteShell」(核实驱动)
**先核实(不臆造,逐条 rg 确认):**
- a. 现在谁/怎么创建 note task(video learning 那条线?有无现成 API 端点前端可调?payload 形状?)
- b. note task 完成后 `_assemble_note_for_task` 是否触发(注册 task_type 是否覆盖 note task)
- c. `handle_note_task` 产出后 item 怎么落库、type 设什么(尤其 image_text)
**再按结果补缺**,目标:`给 URL → 创建 note task → 统一流程 → 产出 item(type 合理) → assemble → GET …/note 能读到(图文 media 齐)`。缺端点补端点、缺 assemble 注册补注册。
- **验收**:`curl` 用一个**小红书图文 URL** 发起 note task → item 生成 + `notes/<item>/note.md` 有图文 + `GET …/note` 的 `media.images` 有图;pytest 绿;不动现有四类型解析/复刻(回归)。

### NI.2 — 前端「生成笔记(智能识别)」入口
- `AddMaterialModal` 加并列入口「生成笔记」:粘贴 URL → `sniffUrl` 显示"识别为 X" → 点「生成笔记」→ 调 NI.1 的创建接口建 note task → 跳转/提示进度。
- 前端 service 加创建 note task 的函数(对接 NI.1 端点)。
- 保留现有"一键解析(按类型)"原样。
- **验收**:`./dev.sh`,粘贴**你那个小红书图文链接** → 生成笔记 → 进 NoteShell **看到图 + 文**(不再丢图);tsc 绿;现有添加流程回归正常。

### NI.3 — 端到端 + 收口
- 四种来源各跑:小红书图文 / 视频 / 网页文 / B站opus → 生成笔记 → NoteShell 正确显示(图文多图展示完善)。
- 文档收口:execution-plan §2 登记 NI 阶段(R3 与 R4 之间)、本文件标 done、COMPLETED_WORK 追加。
- **NI 完成后 → 回头用真实素材补测 R2(三视图)/R3(媒体),再展开 R4。**

# 5. NI 总验收
- 「生成笔记」入口:粘贴任意支持链接 → 自动识别 → 走统一流程 → 进 NoteShell,**图文不丢图**。
- **零回归**:现有四类型"一键解析"、复刻线、各结果页、后端分析正常;未装新库。

# 6. mimo 开工话术（NI.1,复制即用）
```
执行 Track K · NI.1（后端打通「发起 note task → 产出进 NoteShell」）。开工前读 docs/plans/track-K-M7-NI-note-intake-kickoff.md §2/§3/§4。

启动：git status（确认 main 干净）&& git log --oneline -8 对账；从 main 新建 feat/k-ni-1-note-task-intake。

先核实（逐条 rg 确认，不臆造）：① 现在怎么创建 note task（handle_note_task，steps=download/transcribe/analyze/note）——video learning 那条线在哪发起、有无前端可调的 API 端点、payload 形状；② note task 完成后 _assemble_note_for_task 是否触发（workspaces.py:348 注册的 task_type 是否覆盖 note task 的 type）；③ handle_note_task 产出后 item 落库 type 怎么设（尤其小红书 image_text，ItemType 无 image_text）。

再按核实结果打通：给一个 URL → 创建 note task → 走 handle_note_task 统一流程 → 产出 item（type 合理）→ assemble → GET …/note 能读到（图文 media 齐）。缺前端可调端点就补一个，缺 assemble 注册就补 note 的 task_type。不改 handle_note_task 内部逻辑、不改现有四类型解析、不碰复刻线。

验收：curl 用一个小红书图文 URL 发起 note task → item 生成 + notes/<item>/note.md 有图文 + GET …/note 的 media.images 有图；KMP_DUPLICATE_LIB_OK=TRUE .venv/bin/python -m pytest <相关测试> 绿；现有四类型解析回归正常。不 push；核实有出入或要新增端点先停下说明再做。完成贴 curl 结果 + pytest + git diff --stat。
```

---

# 7. NI 修订（2026-06-06 用户实测反馈）

NI.1（generate-note 端点 + assemble + 兜底）已合（c7bee83）。NI.2 实测**形态不对**——「生成笔记」被塞进了原手选类型页（仍要选类型/勾任务/选采集模式），不是用户要的"零配置全自动"。据此重做 + 增强。

**用户三决策（2026-06-06）：**
1. **入口形态**：「生成笔记」= 与四类型**并列的第五个入口卡片**；选它进**零配置模式**（只输链接，隐藏类型/分析任务/采集模式）。
2. **配图智能**：每张图 **VLM 识别内容 → 按语境插入正文合适位置**；文字型图 OCR 并入正文；md / html 带图。
3. **纯粹笔记**：生成笔记路径**不含任何复刻**；"只想文本分析"等细化挪到**结果页**做，不在添加时选。

**修订后子任务（执行顺序 NI.2-redo → NI.3 → NI.4）：**
- **NI.2-redo（前端零配置入口）**：`AddMaterialModal` 加并列第五卡片「生成笔记」；选中后界面**只剩** 链接输入(+粘贴文字) + sniff「识别为 X」提示，**隐藏** ③分析任务 / 图片采集模式 / 其它类型配置；底部只留「生成笔记」按钮 → 调已有 `generate-note` → 进 NoteShell。不含复刻。现有四类型 +「一键解析」保留原样（复刻/手动场景，与生成笔记互不干扰）。
- **NI.3（后端图文智能合成）**：核实 `handle_note_task` 现在如何把图文合成 md；增强为——每张图 VLM 识别内容，文字型图 OCR 并入正文，配图按内容语境插入正文合适位置（建议一次 LLM 合成：正文 + 各图描述/OCR → 输出带图占位的 md）；md 用 `![](/static/…)` 引用，html 展示图。核实驱动，不动前端。
- **NI.4（端到端 + 收口）**：小红书图文 → 生成笔记 → NoteShell 图文按位置混排 + html 带图；四来源（图文/视频/网页/opus）回归；文档收口。

---

# 8. NI 对 R1–R5 的连带调整（2026-06-06 评估）

主干（R0–R5 + NI）**不推翻**，只做几处协调 + 一个待观察项：

- **R0 / R1 / R2**：不动。NI.3 后用**真实图文素材重测 R2 三视图**（验证图能在阅读/对照里显示）。
- **R3 图片展示统一（实质调整）**：R3.1 的「正文顶部贴单图」与 NI.3 的「图按语境内嵌正文（可多张）」冲突 → 统一到「**图在正文 md（`![]()` 渲染）**」。**在 NI.3 一并切换，不单独回头改 R3**；R3.1 顶部首图区保留作封面或去掉，NI.3 时定。
- **R4**：路由收敛**纳入「生成笔记产出 item → 直达 NoteShell」**（与列表直达统一），方向不变。
- **R5**：`note.html` 带图**复用 NI.3 成果**，不重复造。
- **待观察 ·「结果页做按需分析」**（重新 OCR/VLM/换角度/对片段深入）：用户 2026-06-06 定「NI/R 做完再看」。现阶段用现有 **总结风格(14)+AI 问答+编辑** 覆盖事后处理，**暂不新增专门期**；真碰到缺口再评估（可能 R6）。

---

# 9. NI.3 实施记录（2026-06-06）

**改动范围**：仅后端 `backend/app/services/pipeline_tasks.py` + 新测试，不动前端。

**实现要点**：
1. `handle_note_task` 的 image_text 分支（原 3.6 步）升级：保留 `analyze_image_file` 逐图 VLM+OCR → 收集结构化 `image_infos`（含 `/static/` URL）→ 调 `_compose_images_with_llm()` 一次 LLM 合成。
2. `_compose_images_with_llm()`：system prompt 指导 LLM 区分「文字型图 → OCR 融入正文」与「配图 → `![](url)` 按语境插入」；输入正文 + 图列表(描述/OCR/URL)，输出完整 markdown。
3. `_img_to_static_url()`：复用 `workspaces.to_static_url` 逻辑，将 data 下绝对路径转 `/static/...`。
4. **兜底**：无 api_key / LLM 失败 / 返回空 → 回退原逻辑（描述堆末尾），best-effort 不报错不阻断。
5. 合成结果写入 `source_text_from_download` → step 6 → `results["markdown"]`，`note_assembler` 已会用它。

**测试**（`tests/backend/test_image_compose.py`，8 passed）：
- LLM 合成成功 → 输出含 `![...](/static/...)` 图引用 + 图不在末尾堆叠
- LLM 返回空 → fallback 空串
- 无 api_key → 跳过
- LLM 异常 → 不阻断
- `_img_to_static_url` 路径转换正确
