---
phase: R19
title: 综合笔记 av_synthesis · 图文教学笔记 pipeline + Markdown 导出
status: ready
owner: xiaomi mimo v2.5-pro
estimated_hours: 10
depends_on:
  - R18 已合（含 chip 重构 § 0，引入 av_synthesis id；含 lecture 模板）
decisions:
  - 公式/代码 OCR：方案 C（跳过，让 LLM 从转写+VLM 描述推断），不做 spike
related_spec:
  - docs/spec/04-pipeline-tasks.md
  - docs/spec/05-result-pages.md
references:
  - wdkns-skills `bilibili-render-pdf`（LaTeX 教学笔记骨架）
  - wdkns-skills `bilibili-notes-to-obsidian`（Obsidian vault 结构 / R20 用）
  - wdkns-skills `subtitle-refine`（字幕精修流程 / R18 已部分借鉴）
---

## 背景

R17 把「综合笔记 ⭐ av_synthesis」作为 av_combined 默认 chip。本 phase 实现后端 pipeline + 前端结果页展示 + Markdown 导出。PDF / Word / Obsidian 押后到 R20。

**输出形态**（用户选骨架 C）：

```
# 视频标题
> 平台 · UP主 · 时长 · 添加日期

![封面](cover.jpg)

## 全局摘要
（lecture 模板 LLM 综合产出，~300 字）

## 关键帧画廊
| 时刻 | 画面 | 场景描述 |
|---|---|---|
| 00:12 | ![](frames/001.jpg) | … |
| 02:34 | ![](frames/008.jpg) | … |

## 章节正文
### 1. 引言（00:00~01:20）
![](frames/002.jpg)
> 主讲人此处讲：…（转写原文摘选）

**重点**：…（LLM 提炼）

**公式**（如有 OCR 命中）：$E = mc^2$

**代码示例**（如有 OCR 命中）：
```python
print("hello")
```

### 2. 章节标题 …

## 字幕原文
<details>
<summary>展开查看完整转写（含时间戳）</summary>
…
</details>

## 最终综合
（综合上下文的最终笔记，由 LLM 综合关键帧 + 字幕生成；强调"对教学最有价值的洞察"）
```

## 用户决议（2026-05-26）

1. 先做 MD 导出，PDF/Word/Obsidian R20 做
2. 综合笔记勾选时联动勾画面+转写，取消依赖项时给 hint（R17 实现）
3. 骨架选 C（最全版本）
4. 导出格式选择放结果页（不是添加素材时选）
5. 公式 / 代码 OCR 能做就做，做不来跳过——本 phase **先 spike 1h 评估**

## 修改清单

### 0. ~~Spike：公式 / 代码 OCR 评估~~ → 用户已拍板方案 C（跳过 OCR）

不做 spike，不集成 pix2tex / PaddleOCR 公式检测。关键帧只走基础 VLM 描述，LLM 在生成笔记时若识别出公式/代码内容（从转写或 VLM 描述里），用 markdown 代码块或 `$…$` 包裹即可。本期不追求公式渲染精度。

<details><summary>原 spike 内容（保留备忘，不执行）</summary>

1h 内确认以下其一：
- A) **pix2tex**（开源）能识别公式 LaTeX，集成成本可接受 → 加进 pipeline
- B) **PaddleOCR + 区域检测**：先用 OCR 识别屏幕文字，再用正则 `^def |\\(|=` 等启发式判断是否代码/公式 → 实现简单但准确率一般
- C) 完全跳过：关键帧 OCR 只走 PaddleOCR 拿纯文字，公式 / 代码不特殊处理（LLM 自己从转写里推断）

**默认推方案 B**（成本最低），spike 后写一段决策结论在本文件末尾「Spike 结论」一节，用户/Opus 确认后再继续。

</details>

### 1. 后端：新 task 类型 `av_synthesis`

#### 1a. `backend/app/services/pipeline_tasks.py` 注册新 handler

```python
async def run_av_synthesis(task: Task, ctx: TaskContext) -> dict:
    """综合笔记：图文教学笔记生成 → Markdown 文件。

    依赖：
    - 同 task workspace 内已有 visual_analysis 产物（关键帧 + VLM 描述）
    - 同 task workspace 内已有 transcribe_summary 产物（转写 segments）
    - 用户细调里选的 summary_template（默认 lecture）
    """
    workspace_dir = ctx.workspace_dir
    payload = task.payload or {}

    # 1. 收集依赖产物
    frames = load_frames_manifest(workspace_dir / "frames")  # [{ts, path, vlm_desc, ocr_text}]
    transcript = load_transcript(workspace_dir / "transcript.json")  # [{start, end, text, speaker?}]
    metadata = task.workspace.metadata  # title / uploader / duration / cover

    # 2. 时间戳对齐：每个关键帧匹配最近的 transcript segment
    aligned = align_frames_to_transcript(frames, transcript)

    # 3. LLM 分章节：把 aligned 数据扔给 LLM，让它输出章节边界
    chapters = await llm_split_chapters(aligned, metadata, ctx.api_key)
    # chapters: [{title, start_ts, end_ts, frame_indices, transcript_indices}]

    # 4. OCR 公式 / 代码（按 spike 结论）
    if FORMULA_OCR_ENABLED:
        for f in frames:
            f["formula"] = detect_formula(f["path"])
            f["code"] = detect_code(f["path"], f["ocr_text"])

    # 5. 渲染 Markdown
    template = SUMMARY_TEMPLATES["lecture"]  # 默认 lecture，用户细调可改
    md = render_av_synthesis_md(
        metadata=metadata,
        global_summary=await llm_global_summary(transcript, template, ctx.api_key),
        frames=frames,
        chapters=chapters,
        transcript=transcript,
        final_synthesis=await llm_final_synthesis(aligned, chapters, ctx.api_key),
    )

    out_path = workspace_dir / "av_synthesis.md"
    out_path.write_text(md, encoding="utf-8")

    return {
        "av_synthesis_path": str(out_path.relative_to(workspace_dir)),
        "chapters": chapters,
        "has_formula": any(f.get("formula") for f in frames),
        "has_code": any(f.get("code") for f in frames),
    }
```

#### 1b. `backend/app/services/av_synthesis/` 新模块

拆 4 个文件：

```
backend/app/services/av_synthesis/
├── __init__.py
├── align.py           # align_frames_to_transcript
├── chapters.py        # llm_split_chapters
├── render.py          # render_av_synthesis_md（Jinja2 模板）
└── templates/
    └── lecture.md.j2  # 教学笔记 MD 模板（骨架 C）
```

`lecture.md.j2` 模板就是本文件「输出形态」那段 Markdown 的 Jinja 化，包含 frontmatter 字段。

#### 1c. handler 注册

在 [pipeline_tasks.py task router](backend/app/services/pipeline_tasks.py) 内加：

```python
TASK_HANDLERS = {
    ...
    "av_synthesis": run_av_synthesis,
}
```

### 2. 后端：依赖检查 & 编排

`av_synthesis` 必须在 `visual_analysis` 和 `transcribe_summary` 完成后跑。在 TaskRunner 的依赖图里加：

```python
DEPS = {
    "av_synthesis": ["frame_extract", "vlm_analyze", "asr"],
}
```

R17 在 `featuresToSteps` 里已经把 av_synthesis 展开成 `['frame_extract', 'asr', 'av_align', 'note_render']`——这里**改成** `['frame_extract', 'vlm_analyze', 'asr', 'av_synthesis']`（让 av_synthesis 作为最后一个独立步骤，不再拆 av_align / note_render）。

### 3. 前端：结果页展示 + 导出按钮

#### 3a. `frontend/src/pages/results/AVSynthesisResultPage.tsx` 新建

新结果子页路由：`/result/:workspaceId/av-synthesis`

- 顶部：标题 + 封面
- 主区：直接渲染 markdown（用现有 `<MarkdownRenderer>`）
- 右侧栏：章节目录（toc）+ 导出按钮组
- 导出按钮：
  - 📄 **导出 Markdown**（本期实现）
  - 📕 ~~导出 PDF~~（灰态，提示「R20 即将支持」）
  - 📘 ~~导出 Word~~（灰态）
  - 📗 ~~导出 Obsidian Vault~~（灰态）

#### 3b. 在 ResultsOverview（s05）加入口卡片

如果当前 task 有 `av_synthesis_path` 产物，结果总览页加一张顶置卡片「⭐ 综合笔记已就绪」，点击进 AVSynthesisResultPage。

#### 3c. 导出 Markdown 接口

后端加 `GET /api/workspace/{id}/export/av-synthesis.md`，直接返回文件流。前端按钮 `<a download href="…">`。

### 4. 测试

#### 4a. 后端
- `tests/services/av_synthesis/test_align.py`：5 帧 + 10 segment 对齐 → 每帧匹配 1 个 segment
- `tests/services/av_synthesis/test_render.py`：给定 fixture 渲染出 MD，断言含「## 全局摘要 / ## 关键帧画廊 / ## 章节正文」三个 H2
- `tests/services/test_pipeline_av_synthesis.py`：mock LLM + mock frames，端到端跑 handler，输出文件存在

#### 4b. 前端
- `__tests__/AVSynthesisResultPage.test.tsx`：mock workspace 产物，断言 markdown 渲染出 + 导出按钮存在
- `__tests__/featuresToSteps.test.ts`：av_synthesis → 展开 4 步骤正确

#### 4c. 端到端验证（用户跑）
1. 复制一条 B 站教学视频 URL（建议 5~10 分钟）到 Composer
2. 选「音视频综合」+「综合笔记」默认勾选
3. 等 pipeline 跑完
4. 进 AVSynthesisResultPage 验证：标题/封面正确、章节结构合理、关键帧带描述、字幕折叠可展开、点导出能下载 .md

## Spike 结论（DS 完成后回填）

> 待 spike 后填写。模板：
>
> - 选择方案：A / B / C
> - 公式 OCR：xxx
> - 代码 OCR：xxx
> - 工时影响：+/- xh

## 验收标准

1. [x] Spike 结论已写 — 用户已拍板方案 C（跳过 OCR，LLM 自行推断公式/代码）
2. [x] 后端 `pytest backend/tests/services/av_synthesis/` 全绿（12 case: 6 align + 6 render）
3. [x] 后端 `pytest backend/tests/services/test_pipeline_av_synthesis.py` 通过（8 case）
4. [x] 前端 `npm run test` 全绿（76 case，含 AVSynthesisResultPage 2 case）
5. [x] `npm run build` 无 TS 错
6. [ ] 端到端：B 站教学视频跑通 → 产出含「全局摘要 / 关键帧画廊 / 章节正文 / 字幕原文 / 最终综合」5 个 H2 段落的 .md 文件
7. [x] 结果页能预览 + 能下载 .md（代码已实现 + curl 测试通过，等待用户人工验证）
8. [x] 综合笔记产物 .md 文件大小 < 5MB（关键帧用相对路径引用，不内嵌 base64）

## 不在本期范围

- PDF 渲染（R20）
- Word 渲染（R20）
- Obsidian Vault 导出（R20）
- 自定义模板编辑器（押后）

## 完工后

- ① `docs/EXECUTION_PLAN.md` R19 打勾
- ② 本文件 frontmatter 改 done + 填 commits / completed_date / actual_hours
- ③ `docs/COMPLETED_WORK.md` 追加（附端到端测试视频 URL + 产物路径）
- ④ commit message：`feat(R19): av_synthesis pipeline + markdown export for educational notes`
