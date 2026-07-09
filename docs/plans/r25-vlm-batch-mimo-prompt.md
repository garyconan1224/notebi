---
phase: R25 VLM 多帧合并（多图单请求）· 视频分析再提速
status: ready
owner: opus（规划+对账）/ xiaomi-mimo-2.5pro（执行）
parent: docs/ROADMAP.md §11（R 轨性能）；接续 perf(video) VLM 多帧并发 commit 227cc7c
predecessor_commit: 227cc7c  # 已把逐帧 VLM 并发数与性能档位联动(3/6/8) + cancel 下沉 worker
estimated_hours: 6-9h（含 POC + 质量验收）
note: |
  2026-06-01 用户决策「再压耗时」。并发(227cc7c)只到 ~2-2.7×（106帧 1h→22~30min），
  距「十几分钟」还差，瓶颈是 VLM「单帧 ~100s × 调用次数」。本阶段把多帧合并进一次
  VLM 请求以减少调用次数，与并发叠加 → 目标逼近十几分钟。
  R25 为 R 轨 perf 续号（R24 = VLM 多帧并发 227cc7c）；若与 ROADMAP 正式编号冲突由 opus/用户校正。
decisions:
  - 多图输入可行：本仓库 sf_client.build_vision_user_content + analyze_product_images 已用多图 content。
  - 核心风险 = 单帧描述质量可能下降 + N 张图输出对齐；故 POC 先行 + 质量验收闸门 + 计数不符回退逐帧。
  - frames_per_call 默认 4（保质量、防限流）；与并发叠加：在飞图片数 = 并发数 × batch。
---

## 0. 对账结论（2026-06-01，mimo 必读 · 已读码确认，别再猜）

**为什么这么改**：视频分析耗时 = `调用次数 × 单帧 VLM ~100s`。227cc7c 的并发降的是「轮数」（106 帧 ÷ 并发），多图合并降的是「调用次数」（多帧 ÷ batch）。两者**叠加**：106 帧、batch=4、并发=8 → ⌈106/4⌉=27 批 ÷ 8 ≈ 4 轮 → 有望进十几分钟。

**现状关键事实（file:line 已确认）**：

- **单帧 VLM**：`shared/sf_client.py:263 analyze_video_frame(api_key, model, image_b64, video_title)`。
  - 请求体 `messages[0].content = [{image_url}, {text:prompt}]`（已是多模态数组）；prompt 要求输出 JSON `{description_zh, image_prompt_en}`（4 维度、≥150 字）；`max_tokens=2048, temperature=0.3`。
  - 解析：`re.search(r"\{[\s\S]*\}", raw)` → `json.loads` → 取两字段；失败则把 raw 当 description_zh。
  - 网络层 `_post_json`（:51，`@retry` 5× 指数退避，:39-50）处理 429/超时。
- **多图 helper 已存在且在用**：`shared/sf_client.py:222 build_vision_user_content(prompt_text, images)` 产出 `[{text}, {image_url}...]`；`analyze_product_images:238` 已用多图 → **多图输入仓库已验证可行**。
- **帧循环**：`shared/video_analyzer.py:753 process_video`。227cc7c 后已并发：`ThreadPoolExecutor(max_workers=worker_count)`（:818 区域）→ 每帧 `executor.submit(_analyze_frame_task, ...)`（:678 worker，内部调 `analyze_video_frame`）→ `as_completed` 收集 → `frames.sort(key=timestamp)`（保序）。`cancel_event` 已下沉（worker 顶部短路 + 提交/收集双检 + 取消跳总结），`concurrency` 参数回退 `config.API_CONCURRENCY`。
- **并发档**：`shared/settings_store.py:_TIERS` 的 `vlm_concurrency`（low=3/medium=6/high=8）+ `PerformanceConfig.vlm_concurrency`；`backend/app/services/pipeline_tasks.py:_tier_vlm_concurrency()` 传入 3 个 VLM 调用点（:930 av_combined / :1002 N7 / :1359 R22 并行轨）。
- **图片已缩放**：`video_analyzer.py:179 resize_frame`→`MAX_IMAGE_SIDE`（config）；`:188 frame_to_base64`。
- **断点续传**：`process_video` 用 `analyzed_ts` 跳过已分析时间戳（:801 区域）；`append_checkpoint` 逐帧落盘。

## 1. 计划

| 项 | 内容 | 落点 |
|---|---|---|
| **新 API** | `analyze_video_frames_batch(api_key, model, images_b64: list[str], video_title) -> list[dict]`：多图一请求，返回与输入**等长、按序对齐**的 `[{description_zh, image_prompt_en}, ...]` | `shared/sf_client.py`（新增，**不改** analyze_video_frame） |
| **batch worker** | `_analyze_frames_batch_task(batch, ...)`：编码 N 帧→调 batch API→**异常或计数不符则逐帧回退** `analyze_video_frame`→返回 list[frame_data] | `shared/video_analyzer.py`（新增） |
| **改循环** | `process_video` 把「逐帧 submit」改「按 batch 分组 submit」；并发数(worker_count)现在是并发**批**数；收集时按帧展开（计数/进度/checkpoint/push_live 逐帧） | `shared/video_analyzer.py:process_video` |
| **配置** | `frames_per_call` 参数（None 回退新常量 `config.VLM_FRAMES_PER_CALL=4`）；可选与档位联动 | `shared/config.py` + 透传 run_batch_analysis/process_video |

## 2. mimo 启动提示词（直接复制）

```
R25 VLM 多帧合并：把多张视频帧合并进一次 VLM 请求，减少调用次数，与已有并发(R24/227cc7c)叠加再提速。
背景必读: docs/plans/r25-vlm-batch-mimo-prompt.md §0（已读码确认，别再猜）
现状: shared/video_analyzer.py:753 process_video 已并发(ThreadPoolExecutor)逐帧调 sf_client.py:263 analyze_video_frame。多图 content 仓库已用(sf_client.py:222 build_vision_user_content / analyze_product_images:238)。

【任务0: POC 先行（不通过就停下报告，别硬上）】
  目的：先证明 Qwen3-VL 多图单请求能返回「等长、可解析、按序」的结果。
  - 写一个一次性脚本(/tmp，跑完删)：取 2 张测试帧 → 构造 content=[{text:批量说明}, {image_url 图1}, {image_url 图2}] →
    POST /chat/completions(复用 _post_json) → 打印原始返回。
  - 批量说明 prompt 要求：严格输出一个 JSON 数组，长度=2，第 i 个元素对应第 i 张图，
    每个元素 {"index": i(从1), "description_zh": "...", "image_prompt_en": "..."}，不要 markdown 代码块。
  - 验收：返回能解析成长度=2 的数组、index 顺序对、两条描述明显对应两张不同图。
  - ❌ 若模型不稳定返回数组/串图/质量崩 → 停下，把现象贴给用户/opus，不要继续任务1。

【任务1: 新增 batch API（shared/sf_client.py，保留 analyze_video_frame 不动）】
  - analyze_video_frames_batch(api_key, model, images_b64: list[str], video_title) -> list[dict]
  - content = [{type:text, text: 批量prompt}] + 每张图 {type:image_url, image_url:{url:data:image/jpeg;base64,...}}（按输入顺序）。
  - 批量prompt = 复用单帧的 4 维度描述要求，但改成：「我按时间顺序给你 N 张帧，严格输出长度=N 的 JSON 数组，
    第 i 元素对应第 i 张图，每元素 {index, description_zh, image_prompt_en}；不要 markdown」。
  - max_tokens 随 N 放大避免截断：如 min(8192, N*700)；temperature=0.3。
  - 解析：去 ```json 围栏 → re.search(r"\[[\s\S]*\]", raw) → json.loads → 必须是 list；有 index 按 index 升序对齐，否则按数组序。
  - 契约：返回 list 必须 len==len(images_b64) 且按输入序对齐；len 不符或解析失败 → raise（让调用方回退）。

【任务2: batch worker + 改 process_video 循环（shared/video_analyzer.py）】
  - _analyze_frames_batch_task(batch: list[(sec, frame_img)], api_key, vision_model, product_name, safe_name, frames_dir, cancel_event):
    · 顶部 cancel_event.is_set() → 返回 None（跳过，沿用 _analyze_frame_task 的取消语义）。
    · 编码每帧(frame_to_base64) → analyze_video_frames_batch。
    · 【关键】try batch；except 或 返回长度≠batch → 回退：逐帧调 analyze_video_frame（保质量+不丢帧），append_log 记一句降级。
    · 每帧 save_frame_to_disk + 组 frame_data(timestamp=format_timestamp(sec) 等)；返回 list[frame_data]（按 batch 顺序）。
  - process_video：把「for 每帧 submit」改成「按 frames_per_call 分组(跳过 analyzed_ts 已分析帧)→每组 submit 一个 _analyze_frames_batch_task」。
    · worker_count(并发) 不变，现在并发的是「批」。
    · as_completed 收集：future.result() 是 list；逐条 append_checkpoint + frame_count++ + state.update(analyzed_frames=frame_count) + push_live_frame + on_frame。
    · cancel 处理照搬现有：收集循环顶部 cancel→for f in pending: f.cancel()+break；result 为 None 跳过；末尾 cancel→跳总结返回 None。
  - frames_per_call: 新增形参(None 回退 config.VLM_FRAMES_PER_CALL)，透传 run_batch_analysis→process_video。
  - shared/config.py 新增 VLM_FRAMES_PER_CALL = 4（注释：多帧合并进一次 VLM 请求的帧数，保质量/防限流）。
  （可选·别强求）想与档位联动就在 _TIERS 加 vlm_frames_per_call(low=1/med=3/high=4) + property + pipeline 传参；不做就用常量。

【验证（必须按序，质量闸门不过就降 batch 或回退）】
  1. pytest 新增(tests/test_video_analyzer_concurrency.py 同款 monkeypatch 套路)：
     - batch API 解析：mock _post_json 返回 N 元素数组 → 得到等长对齐 list。
     - 计数不符回退：mock batch 返回 N-1 元素 → _analyze_frames_batch_task 走逐帧回退，最终帧数=N、不丢、有序。
     - cancel：batch worker 顶部 cancel→None；process_video 中途 cancel→不再发起新批、跳总结、返回 None。
     - 顺序：batch 乱序/多批并发 → frames.sort 后 timestamps 升序、集合完整。
     - 既有 72 测试全绿（别回归 227cc7c 的并发/取消）。
  2. 真实视频(必须，用户最在意)：同一条视频跑 batch=1(基线) vs batch=4：
     - 量前后 wall time（贴数字）；
     - 【质量闸门】抽查 5 帧 description_zh：长度/4 维度是否还在、是否串图/泛化。明显退化 → 把 batch 降到 2~3 或回退报告，别硬提速。
  3. 组合验证：高档(并发8 × batch4) 跑 ~100 帧，确认进十几分钟级且帧不丢不乱。
  - git commit: perf(video): VLM 多帧合并单请求(多图)再提速; 不要 push。

【红线】
  - POC 不过不准上任务1（多图不稳就如实停下）。
  - 不丢帧/不乱序：计数不符/解析失败一律回退逐帧，绝不静默丢帧；frames.sort 保序保留。
  - 质量不显著退化：抽查闸门不过就降 batch_size，速度让位质量。
  - cancel_event 在 batch 下确实生效（取消后不发起新批 + 跳总结）。
  - max_tokens 随 N 放大，避免输出截断导致 JSON 不全。
  - 不装新依赖（标准库 + 现有 requests/_post_json）；保留 analyze_video_frame 不动；POC 脚本跑完删，不留 debug 文件。
  - 改动若要跨 5+ 文件或动 schema/认证 → 停下问 opus/用户（CLAUDE.md §4）。
```

## 3. 进度

- [x] 任务0 POC：多图单请求返回等长可解析数组（不过则停）
- [x] 任务1 `analyze_video_frames_batch`（sf_client.py，保留单帧函数）
- [x] 任务2 batch worker + process_video 分批 + 计数不符回退 + config 常量
- [x] 验证：pytest（解析/回退/cancel/有序）+ 既有 72 绿（441 passed）
- [x] 验证：真实视频 batch=1 vs 4 耗时 + 5 帧质量抽查（闸门）
- [x] commit `perf(video): VLM 多帧合并单请求(多图)再提速`（不 push）

## 4. 备注（opus → 用户）

- 预期：并发(227cc7c) × 合并(本阶段) 叠加后高档有望进十几分钟级；但**单帧描述质量是真实风险**，所以计划把「质量抽查」设成硬闸门，宁可少合并几张也不让描述崩。
- 另有一个遗留收口（非本阶段）：227cc7c 的并发改动尚未写进 `EXECUTION_PLAN.md` / `COMPLETED_WORK.md`，也没单独 phase 文档。要补可另起小任务。
