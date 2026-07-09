---
title: "[C] 复刻 · AI 导演 — 设计稿草案"
status: draft
version: v0.1
created_date: 2026-06-02
owner: 待定（建议 Opus）
nature: 收敛草案，非 SPEC 定稿
---

# [C] 复刻 · AI 导演 — 设计稿草案（DRAFT v0.1）

> **性质**：把现有散落的设计/契约/路线收敛成一份连贯设计稿，供用户审阅 + 拍板。
> **不是 SPEC 定稿**；定稿后再回填 `docs/spec/08-remix-export-progress.md`。
> 本文件**不改任何代码、不改 SPEC、不改 ROADMAP**。
> 真相源：`docs/design/components/director.jsx`、`storyboard.jsx`、`docs/spec/08-remix-export-progress.md`、`docs/roadmap/track-R-remix.md`、`docs/flows/remix.md`。

---

## 0. 关键发现（先对账，再设计）

1. **ROADMAP 写 [C]「需先补完整设计稿」与现状不符**：AI 导演的 UI 设计稿（`director.jsx`，505 行，含完整 5 Tab）+ 分镜设计稿（`storyboard.jsx`）+ check 截图（`06_director.png` / `04_storyboard.png`）**早已存在**（2026-05-25 设计同步进来的）。**设计不缺**。
2. **真正缺的是三件**：
   - ① **收敛**：真相散在 5 个文件里，没有一份「实现者照着做」的统一文档。
   - ② **拍板**：SPEC 8.1 里多项标着 `⏳ 未做` / `远期`，需要你定方向（见 §4）。
   - ③ **两个孤儿 Tab**：设计稿里的「收藏帧」「提示词版本」两个 Tab，在 `track-R-remix.md` 的 R1~R5 里**没有对应任务**（见 §2）。
3. **建议**：定稿后把 ROADMAP §8/§11 那句「需先补完整设计稿」改成「**设计稿已就绪，待收敛 + 拍板**」，避免下次又误判为阻塞。

---

## 1. 资产盘点（现有真相源 + 实现状态）

| 资产 | 路径 | 状态 |
|---|---|---|
| 复刻流程图 / 产品依据 | `docs/flows/remix.md` | ✅ 文本镜像在 |
| SPEC 契约（复刻/导出/进度/异常） | `docs/spec/08-remix-export-progress.md` | ✅ |
| 路线分解 R1~R5 | `docs/roadmap/track-R-remix.md` | ✅ 含子任务/模型/分支 |
| AI 导演 UI（5 Tab） | `docs/design/components/director.jsx` + `check/06_director.png` | ✅ 设计完整 |
| 分镜 UI（shot 网格 + 导出/预览） | `docs/design/components/storyboard.jsx` + `check/04_storyboard.png` | ✅ 设计完整 |
| 分镜/复刻后端基础 | `shared/storyboard_generator.py` | 🟡 部分（输出 markdown，待结构化 JSON） |
| 前端分镜页 | `frontend/src/pages/StoryboardPage/index.tsx` | 🟡 部分（markdown 直展，待 shot 网格） |
| 分镜启动弹窗 | `frontend/src/pages/WorkspacePage/TaskboardPage/StoryboardLaunchModal.tsx` | ✅ |
| 提示词标签库（7 维度） | Taskboard「标签库」子标签 | ✅ Phase 3C 已实现 |
| 参考帧收藏 | 前端按钮 + 存储 | 🟡 部分（按钮 + 存储有，聚合 UI 未完） |
| 提示词版本记录 | 数据结构层 | 🟡 数据结构已支持，UI 未做 |
| 导出工作包 zip | Phase 1I 前后端逻辑 | ⛔ 代码保留 / UI 隐藏（SPEC 8.2 决议） |

---

## 2. AI 导演结构（director.jsx 五 Tab）↔ R 任务映射

设计稿 `director.jsx` 顶部注释明确：`Tabs: 收藏帧 · 提示词版本 · A/B 对比 · 风格 DNA · AI 对谈`。映射到 `track-R-remix.md`：

| director Tab | 设计源 | SPEC 8.1 状态 | 已实现 | 对应 R 任务 | 缺口 |
|---|---|---|---|---|---|
| **收藏帧** | director.jsx（左列表 + 右「生成提示词 auto」+「用此 prompt 生成」） | 部分（按钮+存储） | 🟡 部分 | ❌ **无** | 需补 R 任务 or 并入收藏功能 |
| **提示词版本** | director.jsx（v1→v2→v3 时间线 + 派生/对比/生成 4 张） | 数据结构✅ / UI 未做 | 🟡 数据层 | ❌ **无** | 需补 R 任务 |
| **A/B 对比** | director.jsx（原作↔生成 · 5 维度 + AI 建议） | ⏳ 未做（IP.8.1 已通图/文对比） | 🟡 图文部分 | **R4** | 视频/音频对比缺 |
| **风格 DNA** | director.jsx（词云 + 调色板 + 镜头分布 + 音乐 + 导出 PDF/套用） | ⏳ 未做 | ❌ | **R3** | 全新 |
| **AI 对谈** | director.jsx（对话 + 视频上下文侧栏 + 快速提问 + 一键生成分镜） | — | ❌（仅设计） | **R5** | 全新（独立页，不依附 Taskboard） |
| Storyboard 页（独立，非 Tab） | storyboard.jsx（3 variants + sb-grid/sb-shot + 导出.fcpxml/生成预览） | — | 🟡 markdown 直展 | **R1 / R2** | 结构化 + 导出/预览 |

> ⚠️ **缺口高亮**：5 个 Tab 里有 2 个（收藏帧 / 提示词版本）在 R1~R5 没任务。但二者底层（存储 / 数据结构）**已就绪**，只差 UI，成本低——是否单列 R6/R7 见决策 **D5**。

---

## 3. 各子模块设计要点（收敛 design + spec）

### 3.1 R1 · 分镜 shot 网格（地基）
- 后端 `storyboard_generator.py` 从「输出 markdown」升级为「输出结构化 JSON」：per shot = 编号 / 时长 / 视觉描述 / 字幕 vo / 参考帧 id。
- 前端 `StoryboardPage` 用 `sb-grid` + `sb-shot` 渲染（缩略图 + num + dur + title + desc + vo），保留旧 markdown fallback。
- 设计参照：`storyboard.jsx` 第 28~84 行（storyboard-card / sb-tabs / sb-body / sb-grid）。

### 3.2 R2 · 生成预览 / .fcpxml 导出
- `.fcpxml`（Final Cut XML）导出按钮；`ffmpeg` 拼低分辨率预览视频。
- 设计参照：`storyboard.jsx` 第 21~22 行两个按钮（导出 .fcpxml / 生成预览）。
- **R2.3 = 拍板项 D2**（接不接图像生成补缺失参考帧）。

### 3.3 R3 · 风格 DNA 报告（= H2.5）
- 单素材风格 DNA：色调 / 构图 / 节奏 / 调性；多素材聚类 → 趋势报告。
- 报告内容（director.jsx 风格 DNA Tab）：风格关键词词云 / 调色板 palette / 镜头分布 / 音乐偏好 / AI 复刻建议 + 「导出 PDF」「套用此风格」。
- 触发策略（SPEC 8.1）：默认手动；设置页可开自动，阈值默认 5（= 拍板项 **D4**）。

### 3.4 R4 · A/B 对比（视频 + 音频补全）
- 后端 `video_compare` / `audio_compare` endpoint；Compare Tab 支持视频/音频类型（图/文已在 IP.8.1 通）。
- 设计（director.jsx A/B Tab）：原作 ↔ 生成 side-by-side · 5 维度 breakdown + AI 建议「应用」按钮。
- 「生成结果对比」3 档精度 10s/30s/60s（SPEC 8.1）= 拍板项 **D3**。

### 3.5 R5 · AI 导演对话面板（集大成）
- 完整对话页（**独立一级入口，不依附 Taskboard**），可同时挂多工作空间 + 多素材上下文。
- 能力：一键生成分镜 / 切片 / 翻译 / 重写；右侧「视频上下文」侧栏 + 「快速提问」预设。
- 设计参照：`director.jsx` 完整（对话流 + 上下文侧栏 + 输入「告诉 AI 导演你想要什么——切片、改编、复刻...」）。

### 3.6 收藏帧夹（孤儿 Tab，无 R 任务）
- 底层：收藏按钮 + 存储已支持（SPEC「部分实现」）。差：聚合成复刻清单的 UI + 「用此 prompt 生成」入口。
- 见决策 **D5**。

### 3.7 提示词版本栈（孤儿 Tab，无 R 任务）
- 底层：数据结构已支持（SPEC）。差：v1→v2→v3 时间线 UI + 回退/对比/派生。
- 见决策 **D5**。

---

## 4. 🔲 待你拍板的开放决策（设计稿定稿前必须定）

| # | 决策 | 背景 | 选项 |
|---|---|---|---|
| **D1** | 接哪些**生成模型 API** | SPEC 标「远期」：可灵 / 即梦 / MJ / Flux / Suno | (a) 先全部灰显 placeholder，不实接；(b) 先接 1 个跑通；(c) 全部远期，本期不碰 |
| **D2** | R2.3 **图像生成补缺失参考帧** | track-R 明确标「拍板」 | 接 / 不接 / 先 mock |
| **D3** | 生成结果对比**精度 3 档**（10s/30s/60s） | SPEC 8.1 | 确认保留？算法基础是什么？本期是否实现 |
| **D4** | 风格报告**自动触发阈值**（默认 5 素材） | SPEC 8.1 | 确认默认值 / 是否本期做自动触发 |
| **D5** | **收藏帧 + 提示词版本**两 Tab | 已设计、底层就绪、无 R 任务 | (a) 补成 R6/R7 独立做；(b) 并入 R3/R5；(c) 本期不做只灰显 |
| **D6** | AI 导演**一级入口何时点亮** | SPEC 8.5 现为隐藏/灰显 | 依赖哪些 R 完成后转可用（建议见 §5） |
| **D7** | **首批做哪几个 R** | 范围控制 | 见 §5 建议，你定最终顺序 |

---

## 5. 建议执行顺序与依赖（供 D7 参考，最终你定）

```
R1 分镜结构化（地基，已有代码改造）        ← 先做
  └─ R2 导出.fcpxml / 预览（依赖 R1 结构化数据）
R3 风格 DNA      ┐ 相对独立，可并行
R4 A/B 对比      ┘ （R4 复用 IP.8.1 图文对比基础，成本较低）
R6/R7 收藏帧 / 版本栈（底层就绪，纯 UI，可穿插填空）
R5 AI 导演对话面板（集大成，挂多素材上下文）  ← 放最后
```

- **入口点亮（D6）建议**：`R1 + R2 + 至少一个分析 Tab（R3 或 R4）` 完成后，把 AI 导演从灰显转可用。
- **依赖关键**：R2 依赖 R1 的结构化 shot 数据；R5 依赖前面几个 Tab 已能产出内容（否则对话面板没东西可调）。

---

## 6. 定稿后回填清单（本草案被批准后再做，不在本次）

- [ ] 把本草案确认内容回填 `docs/spec/08-remix-export-progress.md`（把「未来要做」细化为已设计 + 已拍板）。
- [ ] ROADMAP §8 / §11：把「需先补完整设计稿」改为「设计稿就绪，待按 R1~R7 执行」。
- [ ] `docs/roadmap/track-R-remix.md`：按 D5 决定补 R6（收藏帧）/ R7（版本栈）。
- [ ] `docs/EXECUTION_PLAN.md`：把 [C] 单行展开为 R1~R7 子任务（按 §5 工作流）。
- [ ] 各 R 进入实现时，再按 §5.2 单独展开「操作步骤」执行计划。
