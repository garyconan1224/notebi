---
title: Track K — 笔记知识库（多平台链接 → 详细稿 → 知识库 → 总结/问答）设计草案
status: draft
created: 2026-06-03
owner: conan
relates:
  - F4 URL 嗅探（shared/url_sniffer.py）
  - T2 网页抓取/微信（Track T）
  - V/A/I 素材分析（视频转写·关键帧 / 音频 / 图片）
  - R20 导出（obsidian/pdf/docx builder）
  - rag_qa_service + shared/knowledge_base.py（跨工作空间 embedding RAG）
note: 这是讨论用草案；正式编号（Track K）与挂载 ROADMAP/EXECUTION_PLAN 的方式待用户拍板，AI 不擅自改这两个事实源。
---

> ⚠️ **2026-06-05 修正注记**：长期知识库方向保留，但**本轮范围收窄**——只做**单素材统一笔记页（NoteShell）**；文中「md+html」改为「`note.md` 唯一源 + 应用内富文本/Markdown/对照视图 + html 美观导出产物」；**多素材综合 / 跨笔记知识库后置**。当前唯一执行依据 [`track-K-M7-result-pages-redesign.md`](track-K-M7-result-pages-redesign.md)。

# 0. 这份文档是什么

把"视频笔记"升级为**多平台内容笔记知识库**的产品设计草案。核心：粘贴任意平台链接 → 自动判类型 →【第一阶段·全自动】生成详细稿 →（同一工作空间 = 一个知识库）→【第二阶段·交互式】用户自选风格做总结、或对知识库提问（可联网增强）→ 导出/同步。

> 给非工程视角的说明：本项目**80% 的底层能力已经存在**（下载、嗅探、转写、分析、RAG、导出都有），这份方案的重点是"重新编排 + 补齐 4 块缺口 + 产品化"，不是从零造。

---

# 1. 用户诉求（原话提炼，2026-06-03）

1. 粘贴 B站/小红书/抖音/YouTube 等链接，内容可能是视频/图片/文章/**混合**，做成笔记。
2. **第一阶段全自动**：链接 → 详细稿（不用选风格）。
3. **第二阶段交互式**：拿到详细稿后，用户**在结果页自己挑总结风格**生成总结（可反复、可多种）。
4. **同一工作空间 = 一个知识库**，总结**基于整个库**；总结也可只针对单个链接。
5. 知识库内容多时需要 **embedding + rerank**（思考如何加入、何时接入、是否按模型自动识别）。
6. 要**问答**，且问答**最好能联网**补充。
7. 详细稿格式由 AI 定（用户：不太懂，合适就行）。
8. 笔记是产品的**默认第一功能**。

---

# 2. 现状地基盘点（读代码确认）

| 能力 | 现状 | 位置 |
|---|---|---|
| 链接类型嗅探（不下载判类型） | ✅ 7 平台×4 类型，4 级策略；小红书已建模 image/text/video 混合 | `shared/url_sniffer.py` |
| 多平台**真实下载** | ⚠️ 仅 B站专门实现 + yt-dlp 兜底 | `backend/app/downloaders/bilibili_nocookie.py` |
| note 多阶段编排（下载→转写→分析→笔记） | ✅ | `pipeline_tasks.py:1193 handle_note_task` |
| 总结模板 | ✅ 9 种（基于转写文本） | `services/summary_templates.py` |
| **知识库 + embedding RAG** | ✅ 跨工作空间索引、Short/Long 自动切换、带来源引用 | `shared/knowledge_base.py` / `rag_qa_service.py` / `routes/rag.py` |
| embedding/rerank 模型 + 能力体系 | ✅ bge-m3 / bge-reranker-v2-m3（硅基流动）；Capability=chat/vision/embedding/rerank 自动选模型 | `shared/config.py` / `runtime_llm_config.py` / `settings_store.py` |
| 导出 | ✅ obsidian/pdf/docx | `services/av_synthesis/*_builder.py`（R20） |
| 笔记页 / 首页 | ✅ LearningNotesPage（/ln）；首页 Workbench 已是默认 index | `pages/results/LearningNotesPage/`、`pages/WorkbenchPage/` |

**4 块真实缺口**：
1. 非 B站平台的真实下载/提取（尤其小红书图文、微信文章的深度内容）。
2. "混合类型"（一个链接里既有视频又有图文）没有统一的详细稿结构。
3. "详细稿 / 总结稿"两段产物没有显式拆开建模。
4. RAG 当前是 cross-workspace，需对齐成"单 workspace = 单知识库"；问答联网未做；笔记的产品定位（note 只是 task 类型之一，不是第一公民）。

---

# 3. 目标产品形态

```
工作空间 = 一个知识库
   │
   ├─ 粘贴多个链接（B站/小红书/YouTube/文章…）
   │     每个链接 →【全自动】详细稿（md 展示层 + chunk 检索层）
   │
   ├─ 库内容少 → 直接拼接做总结/问答
   ├─ 库内容多 → 自动启用 embedding 检索 + rerank 精排
   │
   ├─【交互式·总结】用户选风格，带图、带来源 [1][2]
   │     ├─ 单素材：针对一个链接
   │     └─ 跨素材：整库综合/对比（"这几个视频共同观点"）
   │
   └─【交互式·问答】对知识库提问（RAG）+ 可选联网补充
        │
        ▼ 详细稿 + 总结稿 + 问答 → 导出（obsidian/pdf/docx）/ 同步
```

---

# 4. 关键设计决策

## 4.1 详细稿格式 = md 展示层 + chunk 检索层（双层，同源生成）
- **展示/导出层 = Markdown**：frontmatter（来源 URL/平台/作者/时长/抓取时间）+ 正文或转写（带时间戳）+ 图集/关键帧（图片引用）。给人读、给导出用。
- **检索层 = 结构化 chunk**：复用 `rag_qa_service` 现有结构（`source_file` / `time_range` / `skeleton_text` / `source_url`）。给 embedding/RAG 用。
- 两层由同一份抓取内容生成；md 负责"读"，chunk 负责"搜"。

## 4.2 workspace = 知识库
- `knowledge_base.load_folder_as_knowledge(project_json_dir)` 本就是"把一个文件夹的产物加载成知识库"。把 `project_json_dir` 语义对齐到 workspace 目录即可。
- 现状 RAG 是 cross-workspace，需收敛到 single-workspace 维度（K2/K4 处理）。

## 4.3 embedding / rerank：何时 / 如何 / 自动识别（直接回答用户疑问）
- **何时接入**：由知识库体量**自动切换**——`ShortKnowledge`（少，≤约 12000 字直接拼）/ `LongKnowledge`（多，embedding 检索 + rerank 精排）。阈值在 `shared/config.py` 的 RAG 阈值。用户无需手动管。
- **如何接入**：复用 `knowledge_base.py` + `rag_qa_service.py`，把"笔记知识库"接进去即可，不新造索引引擎。
- **自动识别模型**：Capability 体系（chat/vision/embedding/rerank）能从所配服务商 `/v1/models?sub_type=` 拉取支持的模型，并按能力自动选默认（embedding=bge-m3，rerank=bge-reranker-v2-m3）。
- **前提**：用户在设置里配好一个 OpenAI 兼容（如硅基流动）且支持 embedding/rerank 的 key。
- **待核对**：进 K4 时确认 `retrieve_with_sources` 是否已把 rerank 接进召回链路（配置有 RERANKER_MODEL，调用链需核）。

## 4.4 总结：单/多范围 + 风格库 + 带图
- 范围：单素材（针对一个链接）+ 跨素材（整库）。
- 风格做成"**可配置 prompt 库**"，内置：学习讲义/速览摘要/口播稿/步骤复刻/大纲思维导图/金句摘录/问答卡片(Anki)/行动清单（后续加新风格只改配置）。
- 带图：把详细稿里的关键帧/图集按相关性嵌入总结稿。
- 交互：结果页可多次生成、多风格并存、保存。

## 4.5 问答 + 联网增强
- 基线：复用 `rag_qa_service`（检索 + 来源引用 [1][2]），对齐单 workspace。
- 联网增强：问答时可选调用 web search 拿实时/外部资料，与知识库 chunk 一起喂给模型。
- 搜索源待选：Tavily（API，最易）/ SearXNG（自托管，契合本地优先但配置麻烦）/ Bing API。**这是给产品最终用户用的联网，与 Claude Code 的 WebSearch 无关。**

---

# 5. 分阶段实施（建议编号 K0–K6）

- **K0 地基对齐**：盘点复用点；定义详细稿数据结构（4.1）；**治理 ln.md vs 图文分镜.md 数据接入债**。
- **K1 多平台详细稿归一（第一阶段后端核心）**：downloaders 改适配器模式——Bilibili(有)+Ytdlp(YT/抖音/快手)+Article(微信/通用网页)+〔后置〕Xhs(小红书)；统一输出"详细稿"（md+chunk）；混合类型=一份多段；复用 transcribe+关键帧。
- **K2 知识库 + 详细稿结果页（前端·第一阶段）**：workspace=知识库语义对齐；结果页展示详细稿（修数据债）；首页 Composer 默认动作=生成笔记。
- **K3 交互式总结生成器（第二阶段·重点）**：结果页总结面板（选风格）；单/跨素材；带图；`summary_templates` → 风格库；多次/多风格/保存。
- **K4 知识库问答 + 联网增强**：复用 rag_qa_service（对齐单 workspace）；Short/Long 自动切换接线；联网搜索源接入。
- **K5 导出/同步**：复用 obsidian/pdf/docx（R20）覆盖详细稿+总结稿；可选同步本地 Obsidian vault。
- **K6 平台扩展（持续）**：优先级 = 通用网页兜底+YouTube → 抖音/快手+微信 → 小红书图文（最难，最后）。

**建议先开**：K1 的「通用网页兜底 + 详细稿结构」（最稳、收益最大、不碰小红书风控）。

---

# 6. 需要新增的依赖（§4 红线：先报不装，按阶段征求授权）

| 依赖 | 用途 | 阶段 |
|---|---|---|
| `trafilatura` | 网页正文→md（通用兜底/微信） | K1 |
| `gallery-dl` | 小红书等图集下载 | K6 |
| 联网搜索（Tavily/SearXNG/Bing 三选一） | 问答联网增强 | K4 |
| 小红书专门库（如 `xhs`） | 小红书图文/签名（风控强） | K6 末，再评估 |

yt-dlp 已在用，YouTube/抖音无需新装。

---

# 7. 风险与技术债

1. **小红书风控**最硬 → 放最后（K6 末）。
2. **ln.md 数据接入债** → K0/K2 治理。
3. **RAG 维度对齐**：现 cross-workspace → 需 single-workspace（K2/K4）。
4. **联网搜索源选型**：成本/隐私/出网（K4 决策）。
5. **改动面大**：跨 downloaders/pipeline/前端结果页/首页 → 严格一 phase 一 commit。

---

# 8. 与 ROADMAP 的关系 + 建议挂载

- **复用**：F4(嗅探)/T2(网页抓取)/V·A·I(分析)/R20(导出)/rag_qa_service。
- **新方向**：建议新立 **Track K（笔记知识库 / Knowledge Base）**（注意：N1–N11 已是完成的"spec 落地差异"phase 群，"N" 已占用，故用 K 避免混淆）。
- **优先级**：与现有 §11 未做项（F3 错误体验 → [C] AI 导演 → [D] 开源）的先后，由用户决定。

---

# 9. 待用户拍板

1. 采纳 Track K 这个编号与分阶段吗？要我把它挂进 ROADMAP §2 表 + EXECUTION_PLAN 吗？（AI 不擅自改这两个事实源）
2. 优先级：Track K 插在 F3/[C]/[D] 之前还是之后？
3. 第一个子任务从 K1「通用网页兜底 + 详细稿结构」开工，并先装 `trafilatura`，可以吗？
4. 联网搜索源（K4）倾向哪个：Tavily（省事）/ SearXNG（自托管隐私）/ 以后再定？

---

# 10. 交互逻辑细化（2026-06-03 用户决议）

**核心交互**：粘贴链接 → 选择放入哪个工作空间（=知识库）→ **不选则自动创建一个新知识库**。
现状基础已有：`WorkbenchPage/Composer.tsx` 已含 workspace 多选 + `autoCreateWorkspace`。

**还需优化的点（待逐步做）**：
1. **自动建库命名**：不选库时自动建，名字用「首个链接标题 / 平台名」或「未命名知识库·日期」，允许事后改名。
2. **去重**：同一链接再次加入同一知识库 → 提示「已存在」或跳过，避免重复抓取/重复索引。
3. **批量粘贴**：支持一次多行粘贴多个链接，批量入库。
4. **抓取失败占位 + 重试**：单个链接抓取失败时给占位卡片 + 重试按钮，不拖垮整个入库流程。
5. **增量索引**：往已有知识库继续加内容时，embedding 索引**增量更新**而非全量重建（内容多时的性能点）。

# 11. MVP 竖切方案（先用简单的、从头到尾）

> 用户决议：不做大横切，**先把整条链路用最简单方式端到端打通**，再逐步深化；错误体验和音视频深化都放到「逐步优化」里。

**原则**：~90% 复用现有（`text_loader` / `knowledge_base` / `rag_qa_service` / `summary_templates` / 导出三件套），新增最少，**MVP 第一步零新依赖**（readability-lxml 已在用）。

**端到端蓝图**：粘贴链接 → 选/自动建知识库 → 抓取成详细稿(md+chunk) → 入库 → 结果页选风格出总结 → 对库问答 → 导出。

**逐步落地顺序**：
- **M1（第一步·最简竖切）**：**网页文章 / 微信链接** → 详细稿(md) → 入知识库 → 结果页出一个默认总结。复用 `text_loader`（无需新依赖）。先把「头到尾」跑通一类。
- **M2**：接入 **B站视频**（字幕→总结，note 路径1 已完成）进同一套知识库形态。
- **M3**：结果页**交互式换风格总结**（单素材，风格库）+ 总结带图。
- **M4**：**知识库问答**（复用 rag_qa_service，对齐单 workspace）→ 之后加**联网增强**。
- **M5**：**导出/同步**（复用 obsidian/pdf/docx）覆盖详细稿+总结稿。
- **M6+**：更多平台（YouTube→抖音/快手→小红书）+ 跨素材总结 + 错误体验 + 音视频深化。

**MVP 依赖**：第一步 M1 **无需新增依赖**；联网搜索源（M4 后段）与 gallery-dl/小红书（M6）到对应步骤再议。
