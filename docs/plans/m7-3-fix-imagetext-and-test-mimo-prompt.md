---
title: M7-3 修复 — 图文(image_text) 走对图片分析 + 清残留失败测试（merge 前必修）
status: ready
owner: xiaomi mimo v2.5-pro
created: 2026-06-04
parent: docs/plans/track-K-M7-kickoff.md
branch: feat/k-m7-3-opus-adapter（续用）或 feat/k-m7-3-imagetext-fix
prereq: opus 移动端重写已完成（cc81103）；本卡修复验收 + Opus review 暴露的 2 个回归
---

# 0. 背景（Opus 验收 + review 实测）

opus 重写 ✅（移动端 `__INITIAL_STATE__`，真正文 1591 字）。但**merge 前有 2 个必修问题**（mimo 上轮判断不准，已核实）：

1. **小红书等 image_text analyze 崩** —— `_steps_for_note_kind` 给 `image_text` **保留了视频 `analyze`**，而 analyze 段 `pipeline_tasks.py:1591` 预检查 `raise "本地视频文件不存在"`（图文没视频）。**是 M7-3（`77a52a3` 新增该函数）引入的回归**，不是"已有问题"。
2. **1 个残留失败测试** —— `test_pipeline_tasks.py::...test_parse_opus_item_...` `ImportError`（引用重写后已删的 `_parse_opus_item`）。旧 API 方案残留，**上轮"测试全过"不实**（没跑全量）。

---

# 1. 任务 A（先做，让测试转绿）

删 `tests/backend/test_pipeline_tasks.py` 里的 `test_parse_opus_item_extracts_content_and_images`（已被 `tests/backend/test_bilibili_opus.py` 的移动端测试取代）。
→ 跑**全量** `pytest tests/backend/ -q` 确认全绿（别只跑单文件）。

---

# 2. 任务 B（核心）：image_text 走「图片 OCR+VLM」而非视频 analyze

## 2.1 去掉错配的视频 analyze
`pipeline_tasks.py:1434 _steps_for_note_kind` 的 `image_text` 分支：改成和 text 一样去掉 `analyze`（也去 `transcribe`）——图文不走视频帧预检查（`:1591`）。

## 2.2 给图集接图片分析（复用现成能力，别动 handle_image_task）
image_text 下载到的图集（`download_result["images"]` 图片路径列表），逐张做：
- **OCR**：复用 `shared.ocr_service.extract_text(image_bytes)`（现成，读文件成 bytes 传入）
- **VLM 描述**：仿 `handle_image_task`（`pipeline_tasks.py:2647+`）的单图调用——`create_default_registry()` → `provider.chat(ChatRequest(model=vision_model, messages=[{image_url(base64) + 中文描述 prompt}]))`，拿 100-200 字中文描述。
- **建议**：抽一个轻量函数 `analyze_image_file(path, vision_model, api_key) -> {"description","ocr_text"}`（放 service 层），image_text 调它。**不改 `handle_image_task`**（surgical，零回归；DRY 留后续）。
- `vision_model` 从 `settings.vision_model` 读（已有）。
- 把每张图的「描述 + OCR 文字」并入笔记正文/`background_context`（图文笔记 = 图集展示 + 原正文 + 各图视觉描述）。

## 2.3 兜底
无 `api_key`/`vision_model` → 跳过 VLM，只存图+正文+OCR，**不崩**；单张图失败不影响其余。

---

# 3. 验收（`./dev.sh` 真跑）

- **小红书**：note_kind=image_text，6 图下载+展示 + 原正文 + **每图有 VLM 描述/OCR**，**不崩**。
- **9 条素材全绿**（重点小红书 + opus 标题含「AI圈大事件」）。
- **全量 `pytest tests/backend/` 绿**（删旧测试后）。

---

# 4. 红线
- **不改 `handle_image_task`**（避免回归）；**不 import `bilibili_nocookie`**。
- 图集分析要有单测（mock `provider.chat` + `extract_text`），别只跑通就算。
- 一个任务一个小 commit；改完 `pytest`（.venv + `KMP_DUPLICATE_LIB_OK=TRUE`）+ `./dev.sh` 真验；**不主动 push**。
- 结构/字段对不上、或图集分析接不通 → 停下问（CLAUDE.md §4），别塞假数据。

---

# 5. 开工话术（复制即用）

```
执行 M7-3 修复任务，先读 docs/plans/m7-3-fix-imagetext-and-test-mimo-prompt.md。

启动：git status && git log --oneline -8 对账；在 feat/k-m7-3-opus-adapter 续做（或新建 feat/k-m7-3-imagetext-fix）；./dev.sh。

任务A（先做）：删 tests/backend/test_pipeline_tasks.py 里的 test_parse_opus_item_extracts_content_and_images（旧 API 残留，已被 test_bilibili_opus.py 取代）。跑全量 pytest tests/backend/ 确认绿。

任务B（核心）解决图文：
1. pipeline_tasks.py:1434 _steps_for_note_kind 的 image_text 分支去掉 analyze（和 text 一样去 transcribe+analyze），不再走 :1591 视频文件预检查。
2. 给 image_text 的图集接图片分析（复用现成、别改 handle_image_task）：对 download_result["images"] 每张图，OCR 复用 shared.ocr_service.extract_text，VLM 仿 handle_image_task(:2647+) 的单图 provider.chat 调用拿中文描述；建议抽 analyze_image_file(path,vision_model,api_key) 放 service 层。把每图描述+OCR 并入笔记正文/背景。
3. 无 key/model 跳过 VLM 不崩；单图失败不影响其余。

验收：小红书出「6图+正文+每图VLM描述」不崩；9 条全绿；全量 pytest 绿。

红线：不改 handle_image_task、不 import bilibili_nocookie；图集分析要有 mock 单测；一任务一commit、pytest(.venv+KMP)+./dev.sh真验、不push；接不通就停下问别塞假数据。
```
