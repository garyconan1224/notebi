---
title: M7 失败素材修复计划 — 先把 9 条基线跑通再继续 UI
status: ready
created: 2026-06-04
owner: xiaomi mimo v2.5-pro
source_report: docs/plans/m7-1-baseline-report.md
---

# M7 失败素材修复计划

## 0. 结论

M7-1 的 9 条基线里有 3 条失败：本地 `.txt`、本地 `.md`、B站 `/opus/` 图文动态。不要把它们留到 M7-7，也不要先做 M7-2 UI。

正确顺序：

1. 先 commit `docs/plans/m7-1-baseline-report.md`，保住勘验结果。
2. 立即做小修分支，修 `.txt/.md` 本地文本加载，让 6/9 变 8/9。
3. 再做 M7-3 后端主分支，修 B站 opus 的根因：PROBE 下载后识别 + download 适配器泛化，让 8/9 变 9/9。
4. 9 条基线没重新跑通前，不进入 M7-2/M7-4/M7-5/M7-6。

## 1. 当前状态

启动前先确认：

```bash
git status --short --branch
git log --oneline -5
```

当前已知工作区：

- 分支：`feat/k-m7-1-baseline`
- 待提交：`docs/plans/m7-1-baseline-report.md`
- 不纳入本轮：`docs/plans/phase-c-ai-director-design-draft.md`、`tests/test_douyin_e2e.py`、`tests/test_platform_download.py`

先执行：

```bash
git add docs/plans/m7-1-baseline-report.md
git commit -m "docs(k-m7): M7-1 端到端勘验报告"
git checkout main
git merge --no-ff feat/k-m7-1-baseline
```

不 push。

## 2. 子任务 A：修 `.txt/.md` 本地文本加载

### 2.1 分支与范围

分支：

```bash
git checkout main
git checkout -b fix/k-m7-local-text-loaders
```

只允许改：

- `shared/text_loader.py`
- `tests/backend/test_text_pipeline.py`

不要改 `pipeline_tasks.py`，不要改前端，不要加依赖。

### 2.2 根因

`workspaces.py` 上传类型映射已经把 `.txt` 和 `.md` 归为 text：

- `backend/app/routes/workspaces.py:302`
- `backend/app/routes/workspaces.py:303`

但文本 loader 只支持 URL / PDF / DOCX：

- `shared/text_loader.py:333` `load_auto`
- `shared/text_loader.py:351` `.pdf`
- `shared/text_loader.py:353` `.docx`
- `shared/text_loader.py:355` 未识别直接抛错

所以本地 `.txt/.md` 上传能创建 text item，但 pipeline 解析失败。

### 2.3 实现要求

在 `shared/text_loader.py` 增加轻量 loader：

- 新增 `load_plain_text(path)`，支持 `.txt`、`.md`、`.markdown`。
- 文件不存在时抛 `TextLoaderError("文本文件不存在: ...")`。
- 读取编码用 `utf-8-sig`，失败可 fallback `utf-8` with `errors="replace"`；不要引入 chardet。
- 内容走现有 `_normalize()`。
- `TextDocument.source_type` 建议扩展为 `"text"`，或者如果类型注解牵连太多，可先保守用 `"docx"` 以外的新 Literal `"text"` 并同步类型定义。
- `title` 用文件 stem。
- `meta` 至少包含：
  - `parser: plain_text`
  - `extension: .txt/.md`

更新 `load_auto()`：

- 显式 `source_type in {"text", "txt", "md", "markdown"}` 走 `load_plain_text()`。
- 扩展名 `.txt/.md/.markdown` 走 `load_plain_text()`。
- 错误文案里补上 `text|txt|md`，避免用户看到旧提示。

### 2.4 测试要求

在 `tests/backend/test_text_pipeline.py` 增加最小单测：

- `test_load_plain_text_txt_roundtrip`
- `test_load_plain_text_markdown_roundtrip`
- `test_load_auto_plain_text_by_extension`
- `test_load_auto_plain_text_by_source_type`

断言：

- `source_type == "text"`
- `title == path.stem`
- content 包含原文关键字
- `meta["parser"] == "plain_text"`
- `meta["extension"]` 正确

运行：

```bash
KMP_DUPLICATE_LIB_OK=TRUE .venv/bin/python -m pytest tests/backend/test_text_pipeline.py -q
```

再用 M7 fixtures 真实跑本地 `.txt/.md` 两条，确认 pipeline SUCCESS。

### 2.5 提交

```bash
git add shared/text_loader.py tests/backend/test_text_pipeline.py
git commit -m "fix(k-m7): 支持本地 txt/md 文本加载"
git checkout main
git merge --no-ff fix/k-m7-local-text-loaders
```

不 push。

## 3. 子任务 B：M7-3 PROBE 内容识别 + download 泛化

### 3.1 分支与范围

分支：

```bash
git checkout main
git checkout -b feat/k-m7-3-probe-download
```

优先改：

- `backend/app/services/pipeline_tasks.py`
- `tests/backend/test_pipeline_tasks.py`

必要时可小改：

- `shared/url_sniffer.py`，但只能用于下载器提示/短链展开，不得重新把前期 sniff 当最终类型。
- `tests/backend/test_url_sniffer.py`

不要改 M7-2 前端 UI。

### 3.2 不允许的捷径

不要只给 `shared/url_sniffer.py` 加 `/opus/ -> text` 然后宣布修好。

原因：这只能修一个 URL 形态，仍然保留"前期 URL 猜类型"的根因。M7 的目标是下载后内容驱动分析：先获取真实内容，再在 PROBE 阶段判断形态和重算步骤。

### 3.3 目标行为

M7-3 完成后，note task 应支持以下下载/识别路径：

| 输入 | 下载器/加载器 | PROBE 识别 | 后续步骤 |
|---|---|---|---|
| 普通网页/公众号/MBA智库/少数派 | `text_loader.load_url` | text | 不转写、不截帧，直接 note/summary |
| 小红书图文 | `run_xiaohongshu_download` | image_text 或 text_with_images | 不转写，保留正文+图片，后续可进 VLM/详细稿 |
| B站 `/opus/` 图文动态 | B站图文/网页正文适配器，不能走视频 yt-dlp | text 或 image_text | 不转写、不截帧 |
| 视频 URL | `run_ytdlp_download` | video | transcribe + analyze + note |
| 音频 URL | `run_ytdlp_download` 或音频路径 | audio | transcribe + note |
| 本地文本 | `load_auto` | text | note/summary |

### 3.4 推荐实现结构

在 `pipeline_tasks.py` 给 `handle_note_task` 增加小型内部调度层，避免把逻辑散落在主函数里。

建议新增 helper，命名可调整：

```python
def _download_note_source(
    *,
    url: str,
    payload: dict,
    record: TaskRecord,
    runner: TaskRunner,
    task_id: str,
    project_video_dir: Path,
) -> dict:
    ...

def _probe_note_source(download_result: dict, payload: dict) -> dict:
    ...

def _steps_for_note_kind(kind: str, requested_steps: list[str]) -> list[str]:
    ...
```

`_download_note_source()` 返回统一结构，例如：

```python
{
    "ok": True,
    "kind_hint": "text" | "image_text" | "video" | "audio",
    "source_path": "...",
    "content": "...",
    "title": "...",
    "images": [...],
    "video_file": "...",
    "metadata": {...},
    "background": "...",
}
```

注意：不要求一次把 M7-5 的 md/html 详细稿做好；M7-3 只负责让后端识别和步骤选择正确，产物可以先进入已有 `markdown`/`result` 字段。

### 3.5 下载器选择规则

在 download 阶段先基于 URL 做"下载器提示"，但不要把它当最终内容类型：

1. 小红书：优先 `is_xiaohongshu_url_or_text()` + `run_xiaohongshu_download()`。
2. 普通网页/公众号/少数派/MBA智库/B站 opus：优先 `load_url()` 或专门网页正文适配器。
3. 明确视频/音频平台链接：走 `run_ytdlp_download()`。
4. 不确定：可以先尝试文本网页抽取；失败再回落 yt-dlp。回落顺序必须写日志，方便排查。

B站 opus 的最低可接受修法：

- 不进入 `run_ytdlp_download()` 的视频流下载路径。
- 能抽到正文或页面文字，并让 task SUCCESS。
- 如果页面文字抽取为空，但平台限制导致无法解析，必须给出清晰错误，不允许再出现 `No valid video URL found` 这种视频下载错误。

### 3.6 PROBE 阶段要求

当前 PROBE 在 `pipeline_tasks.py:1277-1282` 只是占位。M7-3 要在这里做实际识别：

- 根据 download result / 文件后缀 / MIME / 元数据判断 `note_kind`。
- 把 `note_kind`、`source_title`、`source_text`、`images`、`background_for_recognition` 写入 task.result。
- 根据 `note_kind` 重算后续 steps：
  - `text`: 移除 `transcribe`、`analyze`
  - `image_text`: 移除 `transcribe`，保留图片信息；VLM 是否立即跑可按 M7 卡决定，至少不能失败
  - `video`: 保留 `transcribe`、`analyze`
  - `audio`: 保留 `transcribe`，移除 `analyze`

### 3.7 `background_for_recognition` 接入

当前字段只在 bridge 透传，pipeline 未消费。M7-3 至少做到：

- 从 payload 读 `background_for_recognition`。
- 合并下载器抓到的简介/描述文字，形成 `background_context`。
- 写入 task.result，字段名建议：
  - `background_for_recognition`
  - `source_description`
  - `background_context`
- 文本总结/笔记生成时把它作为上下文传入 prompt。若暂时无法改所有 prompt，至少要在日志和 result 中可见，不能静默丢弃。

### 3.8 测试要求

在 `tests/backend/test_pipeline_tasks.py` 增加后端单测，全部 mock 外部网络和模型调用。

必须覆盖：

1. text URL 不调用 `run_ytdlp_download`，会进入 text/note 路径。
2. B站 `/opus/` 不调用视频 yt-dlp，失败信息不含 `No valid video URL found`。
3. 小红书图文调用 `run_xiaohongshu_download`，保留 `images` 和正文。
4. video URL 仍调用 `run_ytdlp_download`，旧视频路径不回归。
5. `background_for_recognition` 出现在最终 result，并参与文本上下文。

运行：

```bash
KMP_DUPLICATE_LIB_OK=TRUE .venv/bin/python -m pytest tests/backend/test_pipeline_tasks.py tests/backend/test_text_pipeline.py -q
```

如果改了 sniffer，再跑：

```bash
KMP_DUPLICATE_LIB_OK=TRUE .venv/bin/python -m pytest tests/backend/test_url_sniffer.py -q
```

### 3.9 真实验收

启动服务：

```bash
./dev.sh
```

重跑 `docs/plans/m7-test-fixtures.md` 的 9 条素材。验收口径：

- `.txt` SUCCESS
- `.md` SUCCESS
- `.pdf` SUCCESS
- `.docx` SUCCESS
- 少数派 SUCCESS
- MBA智库 SUCCESS
- 微信公众号 SUCCESS
- 小红书图文 SUCCESS，正文和图片信息保留
- B站 opus SUCCESS，不能再走视频 yt-dlp 并报 `No valid video URL found`

只有 9/9 通过，或外部平台因登录/反爬不可控但错误类型正确，才允许进入 M7-2。

### 3.10 提交

```bash
git add backend/app/services/pipeline_tasks.py tests/backend/test_pipeline_tasks.py
# 如有改动再加 shared/url_sniffer.py tests/backend/test_url_sniffer.py
git commit -m "feat(k-m7): PROBE 内容识别与下载适配器调度"
git checkout main
git merge --no-ff feat/k-m7-3-probe-download
```

不 push。

## 4. 完成后同步

M7-3 完成且 9 条基线重跑后，更新：

- `docs/plans/m7-1-baseline-report.md`：追加"修复后复测"段落，不改写原始勘验事实。
- `docs/PROJECT_STATUS.md`：M7 状态从"勘验起步"改为"后端识别/下载修复完成，待统一入口"。

不要更新 `EXECUTION_PLAN.md`，Track K 当前走 kickoff 卡体系。

## 5. 给 mimo 的直接开工话术

```text
先不要进 M7-2/UI。M7-1 的 3 个失败必须先修。

按 docs/plans/m7-failed-fixtures-fix-mimo-prompt.md 执行：
1. commit docs/plans/m7-1-baseline-report.md
2. fix/k-m7-local-text-loaders 修 .txt/.md，本地测试和真实两条 fixture 通过后 merge main
3. feat/k-m7-3-probe-download 做 PROBE 内容识别 + download 泛化，重点修 B站 opus 不再误走 video yt-dlp，并接入 background_for_recognition
4. 重跑 9 条素材，没到 9/9 不进入 M7-2/UI

红线：不要只给 sniffer 加 /opus/ 规则就收工；这不是 M7 根因修复。
```
