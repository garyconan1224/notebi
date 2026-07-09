---
name: phase-r13.6-metadata-coverage-hotfix
status: done
branch: feat/phase-r13.6-metadata-coverage-hotfix
baseline_commit: e117f6e  # R13 merge 之后
owner: ds v4-pro via ccswitch
created_date: 2026-05-25
---

# Phase R13.6 — yt-dlp 元数据覆盖到 audio/note/text/image handler

## 背景

R13 只覆盖了 **download → analyze 路径**（`_on_download_success` 回调）。
但前端 `_bridge_to_pipeline_payload` 把素材按类型派发到不同 task_type，4 条路径完全独立：

| item.type | task_type | handler | R13 覆盖？ |
|---|---|---|---|
| video (url) | `download` → 派生 `analyze` | handle_download_task → handle_analyze_task | ✅ R13.1 已覆盖 |
| audio (url) | `audio` | handle_audio_task | ❌ **缺** |
| note 复合 (任意 url) | `note` | handle_note_task | ❌ **缺** |
| text (url) | `text` | handle_text_task | ❌ **缺**（text 没有视频元数据，但有 title） |
| image (url) | `image` | handle_image_task | ❌ **缺**（image 可能从远程拿 EXIF 标题） |

用户实测：同 URL 多类型全勾后，audio 任务在 vlm 阶段显示 `bilibili · www.bilibili.com`（hostname fallback），因为 audio task.payload/result 里都没有 video_title。

## 目标

让所有调用 `run_ytdlp_download` 的 handler 都把 metadata 写回 `task.result`，并触发同样的 workspace 改名逻辑。

## 子任务（4 项）

| # | 内容 | 文件 | commit |
|---|---|---|---|
| R13.6.1 | 抽出共享工具：`apply_ytdlp_metadata_to_task(record, runner, dl_result)` | pipeline_tasks.py | R13.6.1 |
| R13.6.2 | handle_audio_task 调用共享工具回写 metadata | pipeline_tasks.py L1981 附近 | R13.6.2 |
| R13.6.3 | handle_note_task 调用共享工具回写 metadata | pipeline_tasks.py L840 附近 | R13.6.3 |
| R13.6.4 | 全套验证 + 文档 | pytest + manual | R13.6.4 |

> text / image 暂不处理：text 走 `fetch_text` 不走 yt-dlp；image 暂无元数据需求。后续如需再拆 R13.7。

---

## R13.6.1 详细步骤 — 抽出共享工具

**文件**：`backend/app/services/pipeline_tasks.py`

**新增工具函数**（放在 `_run_download_step` 附近，约 L385 之后）：

```python
def _apply_ytdlp_metadata_to_task(
    record: TaskRecord,
    runner: TaskRunner,
    dl_result: Dict[str, Any],
) -> Dict[str, Any]:
    """R13.6.1 把 yt-dlp 返回的 metadata 写进 task.result，并触发工作空间改名。

    返回值：一个 dict，含本次要 merge 进 task.result 的 metadata 字段。
    调用方负责把返回值 merge 到自己最终的 result dict 里。

    副作用：
    - 在 task.result 上即时 update（runner.store.update(..., result=...)）
    - 调用 workspaces._on_download_metadata_ready 触发 workspace 改名（如适用）
    """
    meta: Dict[str, Any] = {}
    for key in ("title", "duration", "uploader", "thumbnail_url"):
        val = dl_result.get(key)
        if not val:
            continue
        meta[f"video_{key}"] = val
    if not meta:
        return meta

    # 即时写入 task.result，前端 SSE 下一帧就能看到
    try:
        current = dict(record.result or {})
        current.update(meta)
        runner.store.update(record.task_id, result=current)
    except Exception:
        pass  # 写失败不阻塞主流程

    # 触发 workspace 改名（懒导入避免循环 import）
    try:
        from backend.app.routes.workspaces import (
            _maybe_rename_workspace_from_video_title,
        )
        _maybe_rename_workspace_from_video_title(record, meta)
    except Exception:
        pass

    return meta
```

**同时在 `backend/app/routes/workspaces.py` 抽出 `_maybe_rename_workspace_from_video_title`**：

把 R13.4 的工作空间改名逻辑从 `_on_download_success` 里提取出来：

```python
def _maybe_rename_workspace_from_video_title(
    record: TaskRecord,
    meta: Dict[str, Any],
) -> None:
    """R13.6.1 把 yt-dlp 拿到的视频标题回写到关联的自动建空间。

    任何 handler（download/audio/note）拿到 metadata 后都能调这个工具。
    """
    video_title = (meta or {}).get("video_title") or ""
    if not video_title:
        return
    url = record.payload.get("url") or record.payload.get("source") or ""
    platform = _platform_prefix_from_url(url) if url else ""
    new_ws_name = f"{platform} · {video_title}" if platform else video_title

    # 找到引用此 task_id 的 workspace items
    for ws in _store.list_all():
        if not _is_auto_generated_workspace_name(ws.name):
            continue
        for item in ws.items:
            if record.task_id in item.related_task_ids:
                try:
                    _store.update(ws.workspace_id, name=new_ws_name)
                except Exception:
                    pass
                return
```

> ⚠️ 注意：`_on_download_success` 里 R13.4 已有的改名逻辑要**保留**（向后兼容），但内部改成调用 `_maybe_rename_workspace_from_video_title`。这样三条路径走同一段逻辑。

### 验收

- `.venv/bin/python -m pytest tests/backend/test_workspace_rename_on_download.py -q` 仍通过（不破坏 R13.4 测试）
- 新增 unit test `tests/backend/test_apply_ytdlp_metadata.py` 测共享工具：
  ```python
  def test_apply_metadata_writes_to_task_result_and_returns_meta(...):
      # 构造 fake record + runner，调用工具
      # 断言 record.result 含 video_title 等字段
      ...
  ```

**commit**：`feat(phase-r13.6): R13.6.1 抽出 _apply_ytdlp_metadata_to_task + 共享 workspace 改名工具`

---

## R13.6.2 详细步骤 — handle_audio_task 接入

**文件**：`backend/app/services/pipeline_tasks.py` 约 L1981

**当前代码**（精简）：

```python
elif _is_platform:
    log(f"🎬 检测到平台 URL，使用 yt-dlp 抽取音频流")
    result = run_ytdlp_download(
        url=source,
        output_dir=str(audio_dir),
        format_selector="bestaudio/best",
        log=lambda m: runner.append_log(task_id, m),
        progress_callback=lambda p, msg: runner.set_progress(task_id, 0.05 + p * 0.1, msg),
    )
    if not result.get("ok"):
        raise RuntimeError(f"音频下载失败（yt-dlp）：{result.get('error', '未知错误')}")
    audio_local_path = Path(result["save_path"])
```

**改动**：在 result.get("ok") 检查之后插入一行：

```python
    if not result.get("ok"):
        raise RuntimeError(f"音频下载失败（yt-dlp）：{result.get('error', '未知错误')}")

    # R13.6.2 把 yt-dlp 元数据回写到 task.result，让 ProcessingPage 在 audio 阶段显示真实标题
    _apply_ytdlp_metadata_to_task(record, runner, result)

    audio_local_path = Path(result["save_path"])
```

### 验收

- 后端测试：在 `tests/backend/test_audio_task_metadata.py` 新增 1 个用例 mock run_ytdlp_download 返回含 title 的 dict，断言 record.result.video_title 被设置
- 手测：B 站 URL 创建 audio 任务，进入 `/processing/audio-xxx` 看标题是否变成 `bilibili · 真实视频标题`

**commit**：`feat(phase-r13.6): R13.6.2 handle_audio_task 回写 yt-dlp metadata`

---

## R13.6.3 详细步骤 — handle_note_task 接入

**文件**：`backend/app/services/pipeline_tasks.py` 约 L840（download step 内）

**当前代码**（精简）：

```python
if "download" in steps:
    runner.store.update(task_id, status=TaskStatus.DOWNLOAD.value)
    runner.set_progress(task_id, 0.02, "开始下载视频...")
    dl_kwargs = _resolve_download_kwargs(payload)
    out = run_ytdlp_download(
        url=url,
        output_dir=str(project_video_dir),
        log=lambda m: runner.append_log(task_id, m),
        progress_callback=lambda p, msg: runner.set_progress(task_id, p * 0.3, msg),
        speed_callback=lambda s: runner.set_download_speed(task_id, s),
        **dl_kwargs,
    )
    if not out.get("ok"):
        raise RuntimeError(...)
    download_save_path = str(out.get("save_path") or "")
```

**改动**：在 raise 检查之后，`download_save_path = ...` 之前插入：

```python
    if not out.get("ok"):
        raise RuntimeError(...)

    # R13.6.3 把 yt-dlp 元数据回写到 task.result（note task 也走这条路径）
    _apply_ytdlp_metadata_to_task(record, runner, out)

    download_save_path = str(out.get("save_path") or "")
```

### 验收

- 后端单测：`tests/backend/test_note_task_metadata.py` 新增 1 用例
- 手测：单 URL 多类型同时建 video + audio → 两个任务标题都正确

**commit**：`feat(phase-r13.6): R13.6.3 handle_note_task download 步骤回写 yt-dlp metadata`

---

## R13.6.4 详细步骤 — 全套验证 + 文档

1. 跑：`pnpm build && pnpm test --run && .venv/bin/python -m pytest tests/backend -q`
2. 手测路径：
   - 起 backend + frontend，**确保 main 已含 R13** (`git log --oneline -3` 看到 `e117f6e merge: ... R13 ...`)
   - 粘 B 站短视频 URL → AddMaterialModal 默认勾 video + audio → 一键解析
   - 跳到 `/processing/audio-xxx`：标题应该是 `bilibili · 真实视频名`，**不再是 `www.bilibili.com`**
   - 同时检查 video（download/analyze）任务标题也对
   - 返回 `/workspaces`：新建空间名变成 `bilibili · 真实视频名`
3. 更新 [`docs/EXECUTION_PLAN.md`](../EXECUTION_PLAN.md) 在 R13 行下追加 R13.6 行
4. 更新 [`docs/COMPLETED_WORK.md`](../COMPLETED_WORK.md) 追加 R13.6 段
5. 本文件 frontmatter `status: done`

**不 push、不自行 merge**，停下等用户授权。

**commit**：`docs(phase-r13.6): R13.6 收口记录 + EXECUTION_PLAN / COMPLETED_WORK 同步`

---

## 禁止事项

- ❌ 不动 R12/R13 已落地的代码（除了 `_on_download_success` 改用新工具函数）
- ❌ 不改 task_runner.create_task 去重逻辑（R14 处理）
- ❌ 不动 task schema / Pydantic model
- ❌ 不引入新依赖
- ❌ 不 push 远端

---

## 备注

text / image handler 暂不处理：
- text 走 `fetch_text` 取 HTML/PDF，**没有 yt-dlp**，元数据走 `doc.title`（已有），不在 R13 框架内
- image 暂无视频标题概念，跳过

若用户后续要 text/image 的 source URL 也带平台前缀显示（如 `xiaohongshu · 笔记标题`），开 R13.7 单独处理。
