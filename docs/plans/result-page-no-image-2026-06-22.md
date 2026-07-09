# 反馈3：结果页无图 — 根因分析 + 修复计划（2026-06-22）

> 来源：本地视频笔记结果页无图（note.md 0 图 + 「此图为…」孤立配图说明）。
> **根因已由 Claude 跑数据坐实**，本计划含证据、方案选项、分工建议。

---

## 一、现象

- 本地上传视频（如 `Web3村长.flv`）结果页 `note.md` **0 图**。
- note.md 有 `## 附：Billy Note 配置界面示例 [04:56]` + `此图为…` 这类**有说明无图**的孤立段落。
- 该 workspace 的 `_分析报告` 目录**空**、无 `_图文分镜.md`、无截图 png。
- **偶发**：同一视频在别的 workspace（链接导入）有图。

## 二、根因（Claude 实测坐实，非猜）

### 核心：analyze 被 `is_already_processed` 误判 skip
1. `run_batch_analysis`（`shared/video_analyzer.py:1099`）：
   `if is_already_processed(vp, target_json_dir): state.update(skipped); continue` —— **跳过 `process_video`**（不截帧、不写图文分镜.md）。
2. `is_already_processed`（`:454-470`）：基于视频 **safe_name（文件名）** 查
   `target_json_dir / (safe_name + "_视觉数据.json")`，json complete（有 frames）则返回 True。
3. `target_json_dir = get_workspace_json_dir(record.project_id)`（`pipeline_tasks.py:992 / 2373`）。
4. **本地上传视频的 project 共享 json_dir**：实测证据
   `data/workspaces/default_project/json_data/…Web3村长_视觉数据.json` 存在。
5. ∴ 同名视频第一次处理写 json，**后续同名视频上传 → is_already_processed 命中 → skip → 当前 workspace 不产出截图 + 图文分镜.md**。
6. **偶发解释**：取决于同名视频 json 是否已存在。新视频有图、重复视频无图；链接视频 project 独立故不受影响。
7. **决定性证据**：`58f187fb` 的 `_分析报告` 目录**空**（process_video 没跑过），但 `default_project/json_data` 有该视频 json。

### 次生：summary 留孤立配图说明
- skip 后当前 workspace 无截图 → frames 列表空 → `build_prompt`（`summary_generator.py:454 if frames:`）**不引导 `[[图N]]` 配图**。
- 但 `source.md` 仍有 `## 画面分析 / ### 逐帧画面` 文字（疑来自之前 json sync 的全局概览，**执行前需确认来源**）。
- summary LLM 基于这些画面文字，生成 `## 附：xx界面示例 [时间戳]` + `此图为…` 的**纯文字配图说明**。
- note.md **无 `[[图N]]` 残留** → 证明是 LLM 幻觉生成，非 `_postprocess_frames` 删图残留。

## 三、修复方案

### Part A：analyze skip（核心）— ✅ 用户已定 A1：复用 VLM 描述 + 重新截帧

**实测关键**：`is_already_processed` 命中的是 ② 共享 `project json_dir` 的 json
（`get_workspace_json_dir(project_id)`，本地上传共享如 `default_project`）；但**截图在原处理
workspace 的 `_分析报告/frames/`**，命中的 json 不记录原 workspace。所以「直接复制原截图」找不到源
→ A1 不走「复制原截图」，走「**复用 VLM 描述 + 当前视频重新截帧**」（VLM 调用贵、cv2 截帧便宜）。

**A1 实现**：
1. `_视觉数据.json` 结构：`{video_title, product_name, global_visual_summary, frames:[{timestamp, content_zh, description_zh, image_prompt_en}]}`（实测 100 帧，**无图片文件名字段，只有 timestamp**）。
2. 截图命名规则：`make_frame_filename(safe_name, ts)` = `{safe_name}_{HH_MM_SS}.jpg`，落 `{workspace}/{safe_name}_分析报告/frames/`。
3. `is_already_processed` 命中时，不再 `skip; continue`，改为**复用模式**：
   - 读命中 json 的 `frames`（timestamp + 描述）；
   - 按各 `timestamp` 从**当前视频**截帧 → 保存到**当前 workspace** 的 `frames/`；
   - 用 json 描述 + 新截图写当前 workspace 的 `_图文分镜.md` + `_视觉数据.json`（`save_results`）；
   - **不调 VLM**（保留省钱）。
4. 这样 `_run_analyze`（`pipeline_tasks.py:2814`）能读到当前 workspace 的 `_图文分镜.md`，frames 进 summary，note 有图。

**实现点**：`shared/video_analyzer.py` 的 `run_batch_analysis` skip 分支（`:1099`）改为调用一个新的「复用」路径（只截帧+写产物、跳过 VLM）。

### Part B：summary 不留孤立配图说明（兜底，独立可做）
确无可配图（frames 空）时，summary 不应写配图说明：
- **B1**：`build_prompt` 在 frames 空时明确指示「本次无配图，不要写『此图为…』『附：…界面示例』之类暗示有图的描述」。
- **B2（后处理兜底）**：summary 后处理删除「`## 附：…` + `此图为…`」这类**未紧邻真实图片**的配图说明段落。
- 建议 B1 + B2 双保险。

## 四、涉及文件
- Part A：`shared/video_analyzer.py`（is_already_processed / run_batch_analysis）、`backend/app/services/pipeline_tasks.py`（_run_analyze skip 后处理）。
- Part B：`backend/app/services/summary_generator.py`（build_prompt / 后处理）、`backend/tests/test_summary_generator.py`。

## 五、验收
- **Part A**：**重复上传同名本地视频**，结果页仍有独立成行的 `![](/static/…)`（不再因 skip 0 图）。
- **Part B**：确无截图时，note.md 不出现「此图为 / 附：xx界面示例」孤立无图段落（加单测覆盖）。

## 六、分工建议（能否给小米）

| 部分 | 难度 | 给谁 | 说明 |
|---|---|---|---|
| **根因定位 + 方案设计** | 高（偶发 + 多处判断） | **Claude 已完成** | 见上，证据齐全 |
| **Part A 缓存策略** | 产品决策 | ✅ **用户已定 A1** | 复用 VLM 描述 + 重新截帧 |
| **Part A 实现**（A1：复用+重截帧） | 中 | 小米可执行 | 方案已明确（见 Part A）；须保留去重省钱语义 |
| **Part B summary 兜底** | 低（单点 + 有测试模式） | **小米可做** | 明确：无图时不生成/清理孤立配图说明 |

### 给小米的红线
- 不改 DB schema。
- Part A 改截图缓存/复制逻辑，**须保留既有「省钱去重」语义**（除非用户选 A2）。
- **偶发问题必须先复现**（同名视频二次上传得到 0 图）再改，附改前/改后实测对比。
- Part B 须附「无图样本 → 清理后」的 pytest 证据，不许只看代码猜。
- 执行 Part B 前先确认 `source.md` 画面分析文字的来源（json sync？），避免误删有效内容。
