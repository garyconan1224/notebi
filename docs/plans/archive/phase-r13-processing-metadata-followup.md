---
name: phase-r13-processing-metadata-followup
status: ready
branch: feat/phase-r13-processing-metadata-followup
baseline_commit: d2a4df0  # R12 merge 后
owner: ds v4-pro via ccswitch
created_date: 2026-05-25
---

# Phase R13 — ProcessingPage 元数据贯通 + 跳转/命名修复

## 背景

R12 让 ProcessingPage **download 任务页** 显示了视频标题/封面/统计。
手测发现 **analyze 任务页**（`/processing/analyze-xxx`）仍显示 `www.bilibili.com`，原因：
yt-dlp 拿到的 metadata 只写进 download task.result，**没有传递到 analyze task.payload**。

同时还有 3 个问题需要一并修：

| # | 现象 | 根因 |
|---|---|---|
| 1 | analyze 任务页标题是 `www.bilibili.com` | analyze task payload 没有 title/cover；前端 fallback 到 hostname |
| 2 | 自动建的工作空间名字是 `Bilibili · 0525-1234`（hostname + 时间戳） | `_generate_workspace_name` 用 hostname，download 完成后没回写 |
| 3 | 截图分析没看完就自动跳到结果页 | ProcessingPage `setTimeout(..., 1500)` 太短，1.5s 后强制跳转 |
| 4 | 标题没有平台前缀（用户要求 `bilibili · 视频名` 格式） | 当前直接显示 title，没有 prefix |

## 范围（5 项 commit）

| # | 内容 | 文件 | commit |
|---|---|---|---|
| R13.1 | download → analyze 时复制 yt-dlp metadata 到 analyze.payload | workspaces.py `_on_download_success` | R13.1 |
| R13.2 | ProcessingPage 同时读 payload.video_title / payload.video_thumbnail_url | ProcessingPage/index.tsx | R13.2 |
| R13.3 | 标题加平台前缀（`bilibili · 视频标题`） | ProcessingPage/index.tsx + 新增 platform util | R13.3 |
| R13.4 | download 完成后回写工作空间名为视频标题 | workspaces.py `_on_download_success` | R13.4 |
| R13.5 | ProcessingPage 不自动跳转结果页，改为按钮高亮 + 持久 chip | ProcessingPage/index.tsx | R13.5 |

---

## R13.1 详细步骤 — analyze task 继承 download metadata

**文件**：`backend/app/routes/workspaces.py`

**当前实现**（约 L122-141）：

```python
analyze_payload: Dict[str, Any] = {"video_basenames": [video_basename]}
if refs:
    _augment_video_analyze_payload(analyze_payload, refs[0][1])
analyze_task = runner.create_task(project_id, "analyze", analyze_payload)
```

**改动**：在 create_task 之前把 download task.result 的 4 个字段塞进 analyze_payload：

```python
analyze_payload: Dict[str, Any] = {"video_basenames": [video_basename]}
if refs:
    _augment_video_analyze_payload(analyze_payload, refs[0][1])

# R13.1 继承 download 阶段 yt-dlp 抽取的视频元数据，供 ProcessingPage 在 analyze 阶段展示
_dl_result = completed_task.result or {}
for _key in ("video_title", "video_duration", "video_uploader", "video_thumbnail_url"):
    if _dl_result.get(_key):
        analyze_payload[_key] = _dl_result[_key]
# 同时记录原始 URL，供前端展示「URL · 平台」回退
if completed_task.payload.get("url"):
    analyze_payload["source_url"] = completed_task.payload["url"]
```

**注意**：source_url 用于 R13.3 平台识别（analyze task 没有原始 url 字段）。

**测试**：

新增 `tests/backend/test_download_to_analyze_metadata.py`：

```python
"""R13.1：download task SUCCESS 时把 yt-dlp metadata 传给 analyze task。"""
from __future__ import annotations
from backend.app.services.task_runner import task_runner
from backend.app.routes import workspaces as ws_routes


def test_on_download_success_copies_yt_dlp_metadata_to_analyze_payload(monkeypatch, tmp_path):
    """download task.result 里的 video_title 等应该出现在新建的 analyze task.payload。"""
    # 构造一个假的 download task record
    created: list = []
    def _fake_create_task(project_id, task_type, payload):
        rec = type("T", (), {"task_id": "analyze-fake-xxx"})()
        created.append({"project_id": project_id, "task_type": task_type, "payload": payload})
        return rec
    monkeypatch.setattr(task_runner, "create_task", _fake_create_task)

    fake_dl = type("DL", (), {
        "task_id": "note-xxx",
        "project_id": "ws-1",
        "result": {
            "save_path": str(tmp_path / "test.mp4"),
            "video_title": "三代封神！那四代呢？",
            "video_duration": 402,
            "video_uploader": "测试 UP 主",
            "video_thumbnail_url": "https://example.com/cover.jpg",
        },
        "payload": {"url": "https://www.bilibili.com/video/BV1xxx"},
    })()
    # 触发 video 文件存在
    (tmp_path / "test.mp4").touch()

    ws_routes._on_download_success(fake_dl, task_runner)

    assert created, "应该至少创建了一个 analyze task"
    payload = created[0]["payload"]
    assert payload["video_title"] == "三代封神！那四代呢？"
    assert payload["video_duration"] == 402
    assert payload["video_uploader"] == "测试 UP 主"
    assert payload["video_thumbnail_url"] == "https://example.com/cover.jpg"
    assert payload["source_url"] == "https://www.bilibili.com/video/BV1xxx"
```

**验收**：`.venv/bin/python -m pytest tests/backend/test_download_to_analyze_metadata.py -q` 通过

**commit**：`feat(phase-r13): R13.1 download SUCCESS 时把 yt-dlp metadata 复制到 analyze.payload`

---

## R13.2 详细步骤 — ProcessingPage 兜底读 payload

**文件**：`frontend/src/pages/result/ProcessingPage/index.tsx`

**当前代码**（约 L115-123）：

```typescript
const result = task?.result ?? {}
const title: string = result.video_title || task?.payload?.title || safeHostname
const coverUrl: string = result.video_thumbnail_url || ''
const durationSec: number = Number(result.video_duration) || 0
```

**改动**：把 payload 也作为来源（优先级：result > payload > fallback）：

```typescript
const result = task?.result ?? {}
const payload = task?.payload ?? {}
// R13.2 标题/封面/时长来源优先级：download task.result（直接来源）→ analyze task.payload（继承自 download）→ fallback
const title: string = result.video_title || payload.video_title || payload.title || safeHostname
const coverUrl: string = result.video_thumbnail_url || payload.video_thumbnail_url || ''
const durationSec: number = Number(result.video_duration || payload.video_duration) || 0
const uploader: string = result.video_uploader || payload.video_uploader || ''
```

`url` 同样：

```typescript
const url = task?.payload?.url ?? task?.payload?.source_url ?? state?.url ?? ''
```

**验收**：B 站任务跑到 analyze 阶段时 ProcessingPage 显示真实标题

**commit**：`feat(phase-r13): R13.2 ProcessingPage 兜底读 payload.video_title 以支持 analyze 阶段`

---

## R13.3 详细步骤 — 标题加平台前缀

**用户要求**：标题前面带平台名，格式 `bilibili · 三代封神！那四代呢？`。

**新建** `frontend/src/lib/platformPrefix.ts`：

```typescript
/**
 * R13.3 根据 URL 识别平台并返回小写前缀名。
 * 用于 ProcessingPage 等处的标题展示 `bilibili · 视频名`。
 */
export function platformPrefixFromUrl(url: string): string {
  if (!url) return ''
  let hostname = ''
  try { hostname = new URL(url).hostname.toLowerCase() } catch { return '' }

  // 主流平台映射表（参考 docs/test-urls.md）
  const map: Array<[RegExp, string]> = [
    [/\bbilibili\.com$/, 'bilibili'],
    [/\b(youtube\.com|youtu\.be)$/, 'youtube'],
    [/\bxiaohongshu\.com$/, 'xiaohongshu'],
    [/\b(douyin\.com|iesdouyin\.com)$/, 'douyin'],
    [/\bkuaishou\.com$/, 'kuaishou'],
    [/\bweixin\.qq\.com$/, 'weixin'],
  ]
  for (const [re, name] of map) {
    if (re.test(hostname)) return name
  }
  // 兜底：取域名第二段
  const parts = hostname.replace(/^www\./, '').split('.')
  return parts.length >= 2 ? parts[parts.length - 2] : hostname
}
```

**在 ProcessingPage/index.tsx 引入**：

```typescript
import { platformPrefixFromUrl } from '@/lib/platformPrefix'
// ...
const platform = platformPrefixFromUrl(url)
// 渲染处把 title 改成：
<div className="title">
  {platform && <span style={{ color: 'var(--ink-3)', fontWeight: 400, marginRight: 10 }}>{platform} ·</span>}
  {title}
</div>
```

**测试**：

新建 `frontend/src/__tests__/platformPrefix.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { platformPrefixFromUrl } from '@/lib/platformPrefix'

describe('platformPrefixFromUrl', () => {
  it('returns bilibili for B 站 URL', () => {
    expect(platformPrefixFromUrl('https://www.bilibili.com/video/BV1xxx')).toBe('bilibili')
  })
  it('returns youtube for both youtube.com and youtu.be', () => {
    expect(platformPrefixFromUrl('https://www.youtube.com/watch?v=x')).toBe('youtube')
    expect(platformPrefixFromUrl('https://youtu.be/x')).toBe('youtube')
  })
  it('returns xiaohongshu / douyin / kuaishou / weixin', () => {
    expect(platformPrefixFromUrl('https://www.xiaohongshu.com/explore/x')).toBe('xiaohongshu')
    expect(platformPrefixFromUrl('https://www.douyin.com/video/x')).toBe('douyin')
    expect(platformPrefixFromUrl('https://www.kuaishou.com/short-video/x')).toBe('kuaishou')
    expect(platformPrefixFromUrl('https://mp.weixin.qq.com/s/x')).toBe('weixin')
  })
  it('falls back to second-level domain for unknown platforms', () => {
    expect(platformPrefixFromUrl('https://www.example.com/x')).toBe('example')
  })
  it('returns empty string for invalid url', () => {
    expect(platformPrefixFromUrl('')).toBe('')
    expect(platformPrefixFromUrl('not-a-url')).toBe('')
  })
})
```

**commit**：`feat(phase-r13): R13.3 标题加平台前缀 (bilibili · 视频名 格式)`

---

## R13.4 详细步骤 — 工作空间名回写为视频标题

**文件**：`backend/app/routes/workspaces.py` `_on_download_success`

**当前实现已经把视频标题写回 item.name**（见 L143-156），但**没有写 workspace name**。

**改动**：在已有循环里，同时回写 workspace name（仅当当前名字是自动生成的 hostname 格式时）：

```python
# 当前已有的代码块
for ws, item in refs:
    new_ids = list(item.related_task_ids) + [analyze_task.task_id]
    try:
        _update_kwargs: Dict[str, Any] = {"related_task_ids": new_ids}
        if _title and (not item.name or item.name in (item.source_value, item.source_value.split("/")[-1])):
            _update_kwargs["name"] = _title
        _store.update_item(ws.workspace_id, item.item_id, **_update_kwargs)
    except Exception:
        pass

    # R13.4 新增：把工作空间名回写为「平台 · 视频标题」（仅自动建空间走这里）
    _yt_title = (completed_task.result or {}).get("video_title") or _title
    if _yt_title and _is_auto_generated_workspace_name(ws.name):
        try:
            _platform = _platform_prefix_from_url(completed_task.payload.get("url") or "")
            _new_ws_name = f"{_platform} · {_yt_title}" if _platform else _yt_title
            _store.update_workspace(ws.workspace_id, name=_new_ws_name)
        except Exception:
            pass  # 写失败不影响主流程
```

**新增工具函数**（放在文件顶部 `_generate_workspace_name` 附近）：

```python
def _is_auto_generated_workspace_name(name: str) -> bool:
    """判断 workspace name 是否是自动生成的 hostname + 时间戳格式（R13.4 用）。

    匹配 `_generate_workspace_name` 产出的模式：`Xxx · MMDD-HHMM` 或 `工作空间 · MMDD-HHMM`。
    """
    import re as _re
    return bool(_re.match(r"^(?:[A-Za-z一-龥]+ · \d{4}-\d{4}|工作空间 · \d{4}-\d{4})$", name or ""))


_PLATFORM_HOST_MAP = [
    (("bilibili.com",), "bilibili"),
    (("youtube.com", "youtu.be"), "youtube"),
    (("xiaohongshu.com",), "xiaohongshu"),
    (("douyin.com", "iesdouyin.com"), "douyin"),
    (("kuaishou.com",), "kuaishou"),
    (("mp.weixin.qq.com",), "weixin"),
]


def _platform_prefix_from_url(url: str) -> str:
    """与前端 platformPrefixFromUrl 同语义，返回小写平台名或 ''."""
    from urllib.parse import urlparse as _u
    if not url:
        return ""
    try:
        host = (_u(url).hostname or "").lower()
    except Exception:
        return ""
    for hosts, name in _PLATFORM_HOST_MAP:
        if any(host.endswith(h) for h in hosts):
            return name
    parts = host.replace("www.", "").split(".")
    return parts[-2] if len(parts) >= 2 else host
```

**确认 store 支持 update_workspace**：

```bash
grep -n "def update_workspace\|def update " backend/app/services/workspace_store.py | head
```

若没有 `update_workspace(workspace_id, name=...)`，需要参照 `update_item` 风格新增一个。**改动前先确认接口存在性**。

**测试**：

新增 `tests/backend/test_workspace_rename_on_download.py`：

```python
"""R13.4：download SUCCESS 后自动把 hostname-时间戳 格式的 ws 名改为「平台 · 视频标题」。"""

def test_workspace_renamed_when_auto_generated(...):
    # 1. 建一个 ws，名字用 _generate_workspace_name 生成（确保格式吻合）
    # 2. 建一个 item，related_task_ids=[download_task_id]
    # 3. 构造 fake download task，result 含 video_title
    # 4. 调 _on_download_success
    # 5. 断言 ws.name 现在是 "bilibili · 三代封神！那四代呢？"
    ...

def test_workspace_not_renamed_when_user_named(...):
    # 1. ws.name = "我的工作空间"（用户自定义）
    # 2. _on_download_success
    # 3. 断言 ws.name 不变
    ...
```

**commit**：`feat(phase-r13): R13.4 download 完成后回写自动建空间名为「平台 · 视频标题」`

---

## R13.5 详细步骤 — 取消自动跳转

**用户反馈**：「截图分析没做完自动切换到结果页了」

**根因**：ProcessingPage L93-102 的 effect 在 status === SUCCESS 后 **1.5 秒强制跳走**。

**改动方案**（推荐 B）：

### 方案 A：延长到 8 秒
简单，但用户可能仍想停留更久看 step-stream。

### 方案 B（推荐）：完全取消自动跳，按钮改高亮
- 删除 L93-102 的整个 useEffect
- 「查看结果」按钮在 isSuccess 时高亮（已经是 var(--ink) 主色，已 ok）
- 增加 chip 文案改成 `完成 · 点击查看结果`（删除 `自动跳转中…`）
- 用户主动点按钮才走 navigate

具体改 ProcessingPage/index.tsx：

```typescript
// 删除这段：
// useEffect(() => {
//   if (!isSuccess) return
//   if (!itemId) return
//   const timer = setTimeout(() => {
//     const wid = workspaceId ?? 'default'
//     navigate(`/workspaces/${wid}/items/${itemId}/overview`, { replace: true })
//   }, 1500)
//   return () => clearTimeout(timer)
// }, [isSuccess, workspaceId, itemId, navigate])
```

修改成功后 chip：

```tsx
{isSuccess && (
  <span className="chip" style={{...}}>
    <span className="chip-dot" style={{ background: 'var(--accent-green)' }} />
    完成 · 点击查看结果
  </span>
)}
```

**验收**：任务完成后 ProcessingPage **不自动跳走**，用户点「查看结果」按钮才跳。

**commit**：`feat(phase-r13): R13.5 取消 ProcessingPage 自动跳转，改为按钮触发`

---

## 全部完工

1. 跑全套：`pnpm build && pnpm test --run && .venv/bin/python -m pytest tests/backend -q`
2. 更新本文件 frontmatter `status: done`
3. 更新 docs/EXECUTION_PLAN.md 在 Phase R 区段追加 R13 一行
4. 更新 docs/COMPLETED_WORK.md 追加 R13 段
5. **不 push、不自行 merge**，5 个 commit 全做完后停下等用户授权

## 禁止事项

- ❌ 不动 R12 已落地的组件（SystemResourceCard / TasksCard / StepProgress）
- ❌ 不引入新依赖
- ❌ 不改后端 schema（仅扩展 payload 的可选 dict 字段）
- ❌ 不 push 远端

## 手测复现路径

启 `./start.sh` → Composer 粘 `https://www.bilibili.com/video/BV1xxx`（任意 B 站短视频）→ 一键解析 → 跳到 `/processing/note-xxx` → 看：

1. 标题：`bilibili · 三代封神！那四代呢？`（不再是 `www.bilibili.com`）
2. 封面：B 站缩略图（防盗链失败黑底也算正常）
3. 任务自动切换到 analyze 阶段（`/processing/analyze-xxx`），标题/封面**继承显示**
4. 任务完成后 chip 提示「完成 · 点击查看结果」，**不会自动跳走**
5. 返回主页看工作空间名：`bilibili · 三代封神！那四代呢？`（不再是 `Bilibili · 0525-1234`）
