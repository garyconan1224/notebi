---
title: Track K · R4 新建项目完整设置 + 回归修复
status: ready
owner: Claude(难) + mimo(简单)
created: 2026-06-10
context: gemini 改了 6 个 commit(d012c4d→6e7100f)但上下文没把控好，Claude 接手从头理清
---

# Track K · R4：新建项目完整设置 + 回归修复

> 本文档是执行依据。Claude 负责难的部分，mimo 负责简单的部分（每条都标了 `[Claude]` / `[mimo]`）。
> **不重写 gemini 全部**——对的保留，错的/没做好的才重写。

---

## ⚡ 实时状态对账（2026-06-10 代码核对，状态以本表为准；下方 §1 为初始诊断留档）

| 项 | 真实状态 | 说明 |
|---|---|---|
| 1.1 ETA | ✅ 已完成 | commit `6c5c291`：v1 单调递减减过头 → 改 EMA 平滑（α=0.3）|
| 1.2 死任务 | ✅ 已完成 | `task_store._load` 启动时把非终态僵尸（PENDING/运行中各阶段）标 FAILED + dirty 落盘，根治重启复活；新增 3 个测试（commit 见 git log R4.2）|
| 1.3 封面 | ✅ 已完成 | `pipeline_tasks.py:2302` R3.13 继承 download 展示字段（封面/时长/作者）|
| 1.4 源 md 图 | ✅ 已完成 | `note_assembler` R3.18 逐帧嵌图；源 md 弹窗 R4.3（b931f1c）改 react-markdown 渲染，图片正常显示 |
| 2 完整设置 | 🔄 进行中 | 取画面已成型：R4.4 弹窗板块化(eb7002a) / R4.5 探测时长端点(69ab256) / R4.6 取画面UI卡片化(0df85c5) / R4.6.1 B站时长fix(953d596，实测77s) / R4.6.2 一体折叠卡(9032bd8)；**剩 R4.7 纯文字跳过截帧 + 全局设置页(模型/转写语言/proxy)**。OCR 已砍（不暴露，代码留后端）|

---

## 0. 背景：gemini 做了什么

gemini 在 Claude 的 R3.17/R3.18 之上提交了 6 个 commit（435 行 / 10 文件）：

| commit | 内容 | 评估 |
|---|---|---|
| `d012c4d` | AddMaterialModal 加 image mode+interval；修 ETA 循环 | ⚠️ 部分对 |
| `652f0bc` | 前端 taskStore 死任务清理(2行)；source.md 闸门(note_assembler 5行) | ⚠️ 治标 |
| `3e22542` | 修 ETA 0 显示 + preflight capture 参数映射 | ⚠️ |
| `f89864b` | image_mode=ocr 视频截帧 PaddleOCR | ✅ 保留(用户再考虑) |
| `7f59a94` | ETA 优雅 stall 不掉 0 | ⚠️ |
| `6e7100f` | image_mode=ocr 时 bypass VLM batch API | ✅ 保留 |

**总判断**：gemini 方向基本对，但 ① ETA 实现过度复杂且有定时器 bug ② 死任务只治前端、后端根因没动 ③ 设置太简陋、远不是用户要的「完整新建项目设置」。

---

## 1. 四个回归问题 · 评估与处置

### 1.1 ETA 倒计时循环（20→0→20）
- **根因**（Claude 早先定位）：减到 0 后 `lastEtaRef=0` 被当「首次」→ `newEta` 跳回。
- **gemini 现状**：用 `hasInitializedRef` flag + `eta=-1` 哨兵 + `max(1,prev-1)` 不落 0 + 双 effect 阻尼。**循环基本压住了**（方向对）。
- **仍存在的问题**：
  1. 第二个定时器 effect 依赖 `[tasks]`（useGlobalEta.ts:113）→ 每次 SSE 进度更新都销毁重建 `setInterval`，倒计时不连贯。
  2. 「有新进度就重置成 newEta」（:64-68）→ 倒计时会往上跳。
  3. 双 effect + stall penalty + 阻尼系数，过度复杂、难维护。
- **处置**：`[Claude]` **重写为简洁版**——保留 `hasInitialized` 哨兵思路，定时器 effect 改 `[]` 不依赖 tasks，去掉阻尼魔法数，用「平均速率 + 单调递减 + 减到 0 保持 1s」。

### 1.2 /tmp/test.mp3 死任务
- **根因**（Claude 定位）：TaskStore 持久化到 `.local/backend_tasks.json`，PENDING 僵尸存在文件里，后端启动 `_load()`（task_store.py:35）**原样加载回内存**，前端过滤治标不治本。
- **gemini 现状**：只改了前端 taskStore(2行) + task_store 加了原子写入和 `delete()`。**后端 `_load` 没加启动清理，根因没解决**。当前 json 非终态=0 只是测试任务跑完了，再产生僵尸、重启照样复活。
- **处置**：
  - `[Claude]` **后端 `_load` 加启动清理**：加载时把所有非终态任务（PENDING/各运行阶段）标记为 FAILED（error="后端重启，任务中断"）。理由：进程重启后 executor 线程池是空的，这些任务不可能继续执行，全是僵尸。
  - `[Claude]` 保留 gemini 的原子写入 `_save`（好改进）和 `delete()`。
  - `[Claude]` 顺带定位 `/tmp/test.mp3` 创建源（grep 仅见测试 `test_audio_a3.py`，疑似历史误建）——启动清理可兜底，但要确认运行时没有 API 误建 audio 任务。

### 1.3 分析完封面丢失
- **现状**：Claude 的 `R3.15`（pipeline_tasks 继承 thumbnail）已修，gemini 没碰。
- **处置**：`[保留]` 无需动。端到端跑视频确认即可。

### 1.4 源 md 没图
- **现状**：Claude `R3.18` 已做图文化，gemini `652f0bc` 把 `== "纯色过渡帧"` 升级成 `_is_low_value_frame()` 闸门（合理）。**截图3 证实源 md 已有图**。
- **真正问题**：那个「源 Markdown」弹窗显示的是 **raw 源码**，图片语法 `![](...)` 没渲染成图 → 用户视觉上「只有文字」。
- **处置**：`[待确认]` 需用户明确——是希望「源 md 弹窗」也渲染图片预览，还是只是导出 md 文件的图路径问题。**先不动，问用户**。

---

## 2. 核心新需求：新建项目「完整设置」

> 用户原话：新建项目时一个完整设置——视觉模型用什么、提示词模型、要不要图片、几秒一帧、是不是 OCR……整体设置完成后新建项目就按这套走。
> 场景：① 有的视频不要图片、只要画面里的文字(OCR) ② 有的视频不需要看画面(只转写) ③ 都要可选。

### 2.1 设置项设计（Claude 提案，待用户确认）

**A. 画面处理模式（核心，三档单选）**

| 档 | 含义 | 用户场景 |
|---|---|---|
| 不处理画面 | 只转写音频，不截帧不分析 | "不需要看里面的内容" |
| 视觉模型描述 | VLM 理解画面内容(content_zh) | 默认，需要画面理解 |
| OCR 文字提取 | 只读画面里的文字，不需视觉模型 | "需要的是视频里的文字" |

**B. 截帧（画面处理 ≠ 不处理时显示）**
- 截帧方式：AI 镜头分析 / 按秒截帧
- 截帧间隔：N 秒/帧（按秒截帧时）— gemini 已有 frameInterval
- 最大帧数

**C. 嵌图到笔记**
- 是否嵌图（embed_frames，Claude R3.17 已有开关）
- 密度：智能自适应（默认）/ 手动张数

**D. 音频转写**
- 是否转写（关掉=纯画面笔记）
- Whisper 模型档位 / 语言

**E. 模型选择**
- 视觉模型（VLM）：画面处理=视觉模型时可选（Qwen-VL 等）
- 文本/提示词模型：总结用的 LLM（DeepSeek-V3 等）

**F. 总结**
- 模板/风格：标准/教学笔记/小红书/…
- 深度：简洁/详细

**G. 其他（Claude 补充）**
- 笔记语言（中/英）
- 代理 proxy（某些源需要）
- 归入知识库（已有）

### 2.2 落点：放哪？
- gemini 放在「添加素材弹窗」里，且只有 2 项 → 太挤。
- **建议**：项目级「默认设置」——新建工作空间时设定一次，该项目所有素材继承；添加素材弹窗只保留最常用快捷开关（嵌图/画面模式），高级项进「项目设置」。**待用户拍板交互形态**。

---

## 3. 分工执行清单

### `[Claude 做]`（难 / 逻辑微妙 / 跨前后端）
1. **重写 ETA**（useGlobalEta.ts）——简洁版，修定时器重建 + 跳变。
2. **死任务后端根治**（task_store.py `_load` 启动清理 + 保留 gemini 原子写入/delete + 定位创建源）。
3. **画面处理三档的后端 pipeline 接入**（pipeline_tasks.py：不处理/VLM/OCR 分支编排；OCR 复用 gemini PaddleOCR）。
4. **设置 → note task payload 的契约设计**（generate-note 端点 + payload.preflight 字段定义）。

### `[mimo 做]`（简单 / 照设计画 UI / 改类型）
1. **修类型不一致**：AddMaterialModal `useState('vision')` 与 StagedConfig `imageMode: 'replica_prompt'|'ocr'` 冲突 → 统一成 `'vision'|'ocr'|'none'`（提示词见 §4）。
2. **画面处理三档 UI**：把 gemini 的 imageMode 下拉从 2 档（vision/ocr）扩成 3 档（加「不处理画面」），按 §2.1-A。
3. **新建项目设置面板 UI**：按 §2.1 表单分组渲染（Claude 给字段契约后）。

### `[保留不动]`
- 封面修复（R3.15）、源 md 图文化（R3.18 + gemini 闸门）、OCR PaddleOCR 实现（f89864b/6e7100f）、task_store 原子写入。

### `[待用户确认]`
- §1.4 源 md 弹窗要不要渲染图片预览。
- §2.1 完整设置项最终清单 + §2.2 交互形态（项目级设置 vs 弹窗）。

---

## 4. 给 mimo 的提示词（简单任务）

**任务 M1 · 修 imageMode 类型不一致**
> 在 `frontend/src/components/workspace/AddMaterialModal.tsx` 与 `frontend/src/types/workspace.ts`：`AddMaterialModal` 用 `useState('vision')` 但 `StagedConfig.imageMode` 类型是 `'replica_prompt'|'ocr'`，不一致。统一改为 `'vision'|'ocr'|'none'` 三值，并同步 `generateNote` 调用与后端字段。只改类型与默认值，不改逻辑。跑 `npx tsc --noEmit` 通过。

**任务 M2 · 画面处理三档下拉**
> 在 AddMaterialModal 把 imageMode 下拉从 2 档扩成 3 档：`none=不处理画面(只转写)`、`vision=视觉模型描述`、`ocr=OCR文字提取`。选 `none` 时隐藏截帧间隔。文案见本文档 §2.1-A。等 Claude 完成后端 payload 契约后再接线。

---

## 5. 执行顺序建议
1. 先 Claude 修两个确定的 bug（ETA、死任务）→ 各一个 commit。
2. 用户确认 §2.1 完整设置清单 + §2.2 形态。
3. Claude 定 payload 契约 + 后端三档分支 → mimo 照契约画 UI。
4. 端到端跑视频回归（封面/ETA/死任务/图/源md）。
