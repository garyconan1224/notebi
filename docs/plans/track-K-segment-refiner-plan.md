---
title: Track K · 引擎无关字幕切分层（segment_refiner）执行计划（交付 mimo 执行）
status: ready
owner: mimo（执行）/ 用户（拍板）
created: 2026-06-08
context: R2 实测发现「问题 2」——ASR 出来的字幕一段就 20 秒太长，点击跳转/阅读体验差。根因是 whisper 默认句级粗分段。
strategy: 用户 2026-06-08 已定 —— **不引入任何新 ASR 库（不要 stable-ts / WhisperX）**。做一个**引擎无关的纯函数切分层**，挂在「ASR 出原始段 → 存入 results」之间，对 mlx / faster / remote / gemini 的输出统一生效，换引擎零改动。
relates:
  - docs/plans/track-K-video-note-regression-fix-plan.md（主计划 · §10 R2 的后续）
  - /Users/conan/Desktop/wdkns-skills/skills/subtitle-refine/SKILL.md（切分规则来源：≤14 字、原区间内拆分、零全局漂移）
---

# 0. 给 mimo 的总则（必读 · 红线）

1. **不装任何新依赖**。本层是纯 Python 标准库实现，零第三方库。若你觉得「需要 pip install 才能做」——停下问用户，是你方向错了。
2. **引擎无关**。不要碰 `asr_mlx_whisper.py` / `asr_fast_whisper.py` / `asr_groq.py` 的转写逻辑。切分只作用在它们**统一输出后**的 `[{start, end, text}]` 上。
3. **不破坏 R2 字幕编辑**。`results["transcript_segments"]` 是字幕的「存储真相」，显示行 / 双击编辑（`update_transcript_segment`）/ source.md / note 全从它派生。切分**必须在它存入 `results` 之前**完成，让存进去的就是细段。顺序错了，PATCH 的 `segment_idx` 会和显示对不上 → 复现 R2 的「保存失败」。
4. **TDD**：先写测试（`backend/tests/test_segment_refiner.py`），再写实现。时间零漂移是最易错点，必须有测试守住。
5. **改动前先解释、改完 1-2 句总结**；与本文不符、或实际锚点对不上，**停下问用户**（用户是编程新手）。
6. 一步一 commit，别跨步顺手做。

---

# 1. 目标（一句话）

新增 `shared/segment_refiner.py`，把任意 ASR 引擎输出的过长字幕段，**在原时间区间内**按标点/字数切成 ≤16 字的短段，挂进 pipeline 的 `transcript_segments` 存入前。效果：33 秒 2 段 → 切成约 8–10 段，每段 3–4 秒可点击跳转，且时间无漂移。

---

# 2. 为什么这么设计（背景 · 已核对代码）

**数据流（字幕的存储真相）**：

```
ASR 引擎(mlx/faster/remote/gemini)
  → 统一输出 segments = [{start, end, text}]      ← 粗段，20 秒一段
  → 【本层在这里插入：refine_segments()】          ← 切成细段
  → 存入 results["transcript_segments"]            ← 存储真相
       ├─→ _build_display_transcript_lines()       → results["transcript"] 显示行 [{t_sec,t_str,text}]
       ├─→ note_assembler.extract_transcript_from_results()  → note.md / 知识库（note_assembler.py:67 优先读它）
       ├─→ note_assembler 构 source.md（note_assembler.py:168 读它，用 edited_text or text）
       └─→ workspaces.update_transcript_segment()  → R2 双击编辑按它的下标定位
```

结论：只要在**存入 `transcript_segments` 之前**切好，下游全部自动受益，且 R2 编辑下标天然对齐。**不要**在显示层（`_normalize_transcript_to_lines`）切——那样存储是粗段、显示是细段，编辑下标会错位。

---

# 3. 模块设计 · `shared/segment_refiner.py`

> 放 `shared/` 与 `shared/transcript_cleaner.py` 同级（note_assembler 已用 `from shared.transcript_cleaner import ...`，导入路径一致）。

## 3.1 公开函数签名

```python
def refine_segments(
    segments: list[dict],
    *,
    max_chars: int = 16,      # 单段目标最大「字数」（中文按字、英文单词按 1）
    min_chars: int = 4,       # 切分后子段最小字数，避免碎片闪现
    min_dur: float = 0.8,     # 子段最短时长(秒)，避免过短闪现；不足则与相邻合并
) -> list[dict]:
    """把过长 segments 按标点/字数切细，时间在原区间内按字符比例分配。

    输入/输出都是 [{"start": float, "end": float, "text": str}]。
    - 段 <= max_chars：原样保留（仅 strip text）。
    - 段 > max_chars：三级切分（句末→句中→字数硬切），子段时间按字符比例分配，
      子段首尾衔接、总覆盖时长 == 原段 (end-start)，无全局漂移。
    - 空 text 段跳过。
    引擎无关：mlx/faster/remote/gemini 的输出都吃这一个格式。
    """
```

## 3.2 切分算法（三级，对齐 wdkns subtitle-refine）

`_split_text(text, max_chars, min_chars) -> list[str]`：

1. **句末优先**：在 `。！？!?…` 后断开成「句子」。
2. **句中次之**：句子仍 > max_chars，在 `，、；,;：:` 后断开成「子句」。
3. **字数兜底**：子句仍 > max_chars（无标点长串，如英文/数字/口播无停顿），按 max_chars 硬切。
4. **合并碎片**：切完后 < min_chars 的子段，向**前一子段**合并（前面没有则向后），避免「好」「的」这种闪现。
5. 切分只删「切点处的空白」，**不增删原文字符**（标点保留在前段末尾，符合中文字幕习惯）。

字数口径 `_char_len(text)`：中文/CJK 每字算 1；连续 ASCII 字母/数字组成的「单词」算 1（对齐 wdkns「英文单词默认视为一个字」）。实现可简化为：先按空白和 CJK 边界切 token，CJK 字符逐字、ASCII 串整体各计 1。

## 3.3 时间分配（零漂移，最易错，重点）

`_allocate_time(pieces, start, end) -> list[dict]`：

- 设原段时长 `dur = end - start`，各子段权重 = 该子段 `_char_len`。
- 累积分配：`t = start`；对每个 piece，`seg_dur = dur * (w_i / w_total)`，该段 = `{start: t, end: t + seg_dur, text: piece}`，然后 `t += seg_dur`。
- **强制收尾**：最后一段 `end` 直接赋值为原 `end`（消除浮点累积误差），保证 `out[-1]["end"] == 原 end`。
- 结果必须满足：`out[0]["start"] == 原 start`、`out[i]["end"] == out[i+1]["start"]`、`out[-1]["end"] == 原 end`。
- min_dur 兜底：若某子段时长 < min_dur，与前一子段合并文本与时间（避免闪现）；合并发生在时间分配后、收尾前。

## 3.4 word-level 增强（**本次不做**，仅预留）

函数内可检测 `seg.get("words")`（faster/mlx 开 `word_timestamps=True` 时才有）。**本次一律走比例分配**；word 分支留一行 `# TODO(future): 若 words 存在，切点对齐最近 word 边界取精确时间` 即可，不实现、不开 word_timestamps。避免扩大改动面。

---

# 4. TDD · `backend/tests/test_segment_refiner.py`（先写）

至少覆盖：

1. **短段不动**：`[{0,3,"你好世界"}]`（4 字 ≤16）→ 原样返回。
2. **长段切分 + 段数**：一段 20 秒 40 字含标点 → 切成多段，每段 `_char_len ≤ 16`。
3. **零漂移（核心）**：切分后 `out[0].start == 原.start`、`out[-1].end == 原.end`、相邻 `end==start`、`sum(子段时长) ≈ 原时长`（浮点容差 1e-6）。
4. **标点优先**：`"今天天气很好。我们出去玩吧。"` 在 `。` 处切，不在句中切。
5. **无标点长串**：40 个连续汉字无标点 → 按字数硬切成 ≤16 字段。
6. **碎片合并**：切后产生 1 字尾段 → 合并进前段，无 < min_chars 段。
7. **英文/混合**：`"hello world this is a test ..."` 单词计数，按 token 切不切断单词。
8. **空/退化**：空 list → `[]`；text 为空的段跳过；start==end 的零时长段不崩。

运行：`KMP_DUPLICATE_LIB_OK=TRUE .venv/bin/pytest backend/tests/test_segment_refiner.py -q`

---

# 5. 接入 pipeline（存入 transcript_segments 之前）

**先 `rg` 找全所有「ASR 段落落进 results」的点，逐处在存入前插一行 refine**：

```bash
rg -n "transcript_segments" backend/app/services/pipeline_tasks.py
```

已知两处（核对锚点，行号可能漂，按符号定位）：

- **A. whisper/字幕子流程**：[pipeline_tasks.py:634](backend/app/services/pipeline_tasks.py:634) 拿到 `transcript_text, transcript_segments, whisper_duration = whisper_result` 后，紧接着插：
  ```python
  from shared.segment_refiner import refine_segments
  transcript_segments = refine_segments(transcript_segments)
  ```
  这样 [:755](backend/app/services/pipeline_tasks.py:755) 的 `_build_display_transcript_lines` 和 [:761](backend/app/services/pipeline_tasks.py:761) 存入 results 都用细段。
- **B. gemini 视频模型路径**：[pipeline_tasks.py:281](backend/app/services/pipeline_tasks.py:281) `all_transcript_segments.extend(segments)` —— 改为对**整体** refine 后再 build lines：在 [:287](backend/app/services/pipeline_tasks.py:287) 循环结束、构造 `final_result` 之前插
  ```python
  all_transcript_segments = refine_segments(all_transcript_segments)
  all_transcript_lines = _normalize_transcript_to_lines(transcript_text, all_transcript_segments)
  ```
  （注意 gemini 段本就偏长，切分收益最大；`all_transcript_lines` 要用 refine 后的重建，保持显示与存储一致。）
- **C. 其它转写返回点**：若 `rg` 发现还有第三处（如实时字幕 [:1970](backend/app/services/pipeline_tasks.py:1970) 区域），判断它是否最终落进某个 `results["transcript_segments"]`；**只在「会落进 results 的存储路径」插 refine**，纯实时显示用的临时段不必动（避免误伤，拿不准就停下问用户）。

**不要**在 `asr_router.py` / `asr_*_whisper.py` 里插——保持引擎层纯净，refine 是 pipeline 层职责。

---

# 6. 配置（可选，先用默认）

`max_chars` 默认 16 已可用。若要可配，挂到 `load_settings().transcriber`（参考 `whisper_model_size` 的取法），加 `subtitle_max_chars: int = 16`；**新增配置字段属于 §4 风险项，加前先问用户**。本次建议先硬编码默认值，跑通再说。

---

# 7. 验证清单（全做完后）

- [ ] `pytest test_segment_refiner.py` 全绿（尤其零漂移用例）。
- [ ] `KMP_DUPLICATE_LIB_OK=TRUE .venv/bin/pytest backend -q` 整体不回归（R2 字幕编辑相关测试仍绿）。
- [ ] 实跑：拿一条 B 站短视频生成笔记 → NoteShell 字幕轴每段明显变短（≤16 字 / 3–4 秒），点击能精确跳转。
- [ ] 双击改某段字幕 → 保存成功（R2 不破）、source.md 同步、刷新后仍在（落盘）。
- [ ] source.md 的「## 转写正文」是细段，时间码连续无跳变。

---

# 8. 执行顺序 + commit 颗粒度

1. `test_segment_refiner.py`（先写测试，红） → commit `test(k): segment_refiner 切分层测试`
2. `shared/segment_refiner.py`（实现到测试转绿） → commit `feat(k): 引擎无关字幕切分层 segment_refiner`
3. 接入 pipeline A/B（+ 视情况 C） → commit `feat(k): pipeline 字幕段切细（接 segment_refiner）`
4. 实跑验证 → 更新主计划 §10 标记问题 2 已解 + `docs/COMPLETED_WORK.md` 追加一段。

> 红线回顾：不装新库、不碰引擎层、refine 在存 results 前、TDD、一步一 commit、拿不准停下问用户。
