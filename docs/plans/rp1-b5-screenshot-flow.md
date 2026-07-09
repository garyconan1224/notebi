---
phase: RP1-B · B-5 技术分析
title: 视频暂停截图 → 上传 → 插入笔记光标位置 · 跨组件流程设计
status: ready
owner: Opus 4.7 出方案，mimo 2.5pro 实现
parent_plan: docs/plans/result-pages-redesign-v1.md § RP1-B · B-5
companion: docs/plans/rp1-execution-handoff.md § 3.3 提示词 B-5
depends_on:
  - B-1 LearningNotesPage 双栏布局已建好
  - B-3 LNNotesPanel 的 MdView 已用 CodeMirror 6（B-5 要调它的光标 API）
---

## 0. 核心结论（mimo 看这一段就够开工）

1. **跨组件通信用 zustand store**（项目已有 zustand 5 + persist 中间件）。新建 `lnEditorStore`。
2. **截图流程 5 步**：
   - ① 视频面板按 📷 → canvas 抓 video 当前帧 → blob（PNG）
   - ② 上传 `POST /workspaces/{ws}/ln/screenshots` → 拿到 `{ url, filename }`
   - ③ 拼接 markdown 字符串：`![截图@${ts}](${url})\n`
   - ④ 调 store 的 `insertAtCursor(md)` → CodeMirror dispatch insert 到当前光标
   - ⑤ toast 成功 + 视频面板恢复
3. **CodeMirror 6 光标 insert 标准 API 在 §3.4**，复制粘贴可用。
4. **后端端点骨架在 §4**，仿 `backend/app/routes/notes.py upload_video` 即可。
5. **错误处理 6 项在 §5**，逐项做。

---

## 1. 跨组件通信方式决策

| 候选 | 优势 | 劣势 | 决策 |
|---|---|---|---|
| **zustand store** | 项目已用、可暴露方法、跨任意层级组件 | 增加全局状态 | ✅ **选这个** |
| ref forwarding（父→子） | 无新增依赖 | LNVideoPanel 要把方法传给 LearningNotesPage 再传给 LNNotesPanel 再传给 MdView，4 层 prop drilling | ❌ |
| Context API | 中等 | 重渲染面积大 | ❌ |
| Custom event bus | 无依赖 | 类型不安全、调试难 | ❌ |

**选 zustand 的理由**：项目已有 7 个 store + persist 中间件，模式成熟。`lnEditorStore` 只暴露 1 个方法 + 1 个 setter，开销极低。

---

## 2. 数据流图（精确）

```
用户操作                  组件                              副作用 / 网络
──────────                ──────────                       ────────────────────

[暂停视频]    ───────►    LNVideoPanel
                          (HTMLVideoElement ref)
                          video.pause()

[点 📷 截图]  ───────►    LNVideoPanel.handleScreenshot()
                              │
                              ▼
                          canvas = document.createElement('canvas')
                          canvas.width = video.videoWidth
                          canvas.height = video.videoHeight
                          ctx.drawImage(video, 0, 0)
                              │
                              ▼
                          canvas.toBlob(blob => ..., 'image/png')
                              │
                              ▼  blob
                          uploadScreenshot(workspaceId, blob, ts)
                                                                  │
                                                                  ▼
                                                            POST /workspaces/
                                                            {ws}/ln/screenshots
                                                            multipart/form-data
                                                            file=<blob>
                                                            ts=<seconds>
                                                                  │
                                                                  ▼
                                                            { url, filename }
                              ▲                                   │
                              └───────────────────────────────────┘
                              │
                              ▼
                          md = `![截图@${formatTs(ts)}](${url})\n`
                              │
                              ▼
                          useLnEditorStore.getState()
                            .insertAtCursor(md)
                              │
                              ▼
                          (在 store 内调 cmView.dispatch({changes:...}))
                              │
                              ▼
                          MD 视图光标处插入 markdown
                              │
                              ▼
                          (B-4 已有的 debounce PATCH 自动触发保存)
                              │
                              ▼
                          toast.success('已插入笔记 @ 03:42')
```

---

## 3. 代码骨架

### 3.1 lnEditorStore（新建）

```ts
// frontend/src/store/lnEditorStore.ts
import { create } from 'zustand'
import type { EditorView } from '@codemirror/view'

interface LnEditorState {
  cmView: EditorView | null   // MdView mount 时注册，unmount 时清空

  // setter
  setCmView: (v: EditorView | null) => void

  // 跨组件调用：在 CodeMirror 当前光标处插入文本
  insertAtCursor: (text: string) => boolean
}

export const useLnEditorStore = create<LnEditorState>((set, get) => ({
  cmView: null,

  setCmView: (v) => set({ cmView: v }),

  insertAtCursor: (text) => {
    const view = get().cmView
    if (!view) return false
    const { from, to } = view.state.selection.main
    view.dispatch({
      changes: { from, to, insert: text },
      // 把光标移到插入文本之后
      selection: { anchor: from + text.length },
    })
    view.focus()
    return true
  },
}))
```

**关键 API 解释**：
- `view.state.selection.main.head` = 当前光标位置；如果有选区，`from`/`to` 是选区范围
- `view.dispatch({changes: ..., selection: ...})` = CodeMirror 6 唯一的修改方式（state 是不可变的）
- `view.focus()` = 插入后让用户能继续打字

### 3.2 MdView 注册到 store（B-3 写完后扩展）

```tsx
// frontend/src/pages/results/LearningNotesPage/MdView.tsx 补一段
import { useLnEditorStore } from '@/store/lnEditorStore'

// 在 EditorView 创建后注册
useEffect(() => {
  // ... 创建 view 后 ...
  useLnEditorStore.getState().setCmView(view)
  return () => {
    useLnEditorStore.getState().setCmView(null)
    view.destroy()
  }
}, [])
```

### 3.3 LNVideoPanel（截图按钮 + 抓帧）

```tsx
// frontend/src/pages/results/LearningNotesPage/LNVideoPanel.tsx
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Camera } from 'lucide-react'
import { uploadLnScreenshot } from '@/services/lnScreenshots'
import { useLnEditorStore } from '@/store/lnEditorStore'

interface Props {
  videoUrl: string
  workspaceId: string
}

export function LNVideoPanel({ videoUrl, workspaceId }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [shooting, setShooting] = useState(false)
  const insertAtCursor = useLnEditorStore((s) => s.insertAtCursor)

  async function handleScreenshot() {
    const video = videoRef.current
    if (!video) return
    if (video.readyState < 2) {
      toast.error('视频未加载完成')
      return
    }

    setShooting(true)
    try {
      // 暂停（如果还在播）
      if (!video.paused) video.pause()

      // 抓帧
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas context not available')
      ctx.drawImage(video, 0, 0)

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => b ? resolve(b) : reject(new Error('toBlob failed')),
          'image/png',
        )
      })

      // 上传
      const ts = video.currentTime
      const { url } = await uploadLnScreenshot(workspaceId, blob, ts)

      // 拼 markdown 并插入光标处
      const tsStr = formatTs(ts)
      const md = `\n![截图@${tsStr}](${url})\n`
      const inserted = insertAtCursor(md)

      if (inserted) {
        toast.success(`已插入笔记 @ ${tsStr}`)
      } else {
        toast.error('未找到笔记编辑器（请先切到 MD 视图）')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '截图失败'
      toast.error(msg)
    } finally {
      setShooting(false)
    }
  }

  function formatTs(sec: number): string {
    const m = Math.floor(sec / 60)
    const s = Math.floor(sec % 60)
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  }

  return (
    <div className="ln-video-panel">
      <video ref={videoRef} src={videoUrl} controls />
      <div className="ln-video-toolbar">
        <button onClick={handleScreenshot} disabled={shooting}>
          <Camera size={14} />
          {shooting ? '截图中…' : '截图插入'}
        </button>
      </div>
    </div>
  )
}
```

### 3.4 上传客户端

```ts
// frontend/src/services/lnScreenshots.ts
import { http } from './client'

interface UploadScreenshotResponse {
  url: string       // /static/data/workspaces/{ws}/ln-screenshots/xxx.png
  filename: string  // xxx.png
}

export async function uploadLnScreenshot(
  workspaceId: string,
  blob: Blob,
  ts: number,
): Promise<UploadScreenshotResponse> {
  const form = new FormData()
  form.append('file', blob, `screenshot-${Date.now()}.png`)
  form.append('ts', String(ts))
  const res = await http.post<UploadScreenshotResponse>(
    `/workspaces/${workspaceId}/ln/screenshots`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  )
  return res.data
}
```

---

## 4. 后端端点骨架

```python
# backend/app/routes/export.py 或 workspaces.py 新加
from fastapi import UploadFile, File, Form
from pathlib import Path
import re
from datetime import datetime

_SAFE_NAME = re.compile(r'[^a-zA-Z0-9._-]+')

@router.post("/{workspace_id}/ln/screenshots")
async def upload_ln_screenshot(
    workspace_id: str,
    file: UploadFile = File(...),
    ts: float = Form(0.0),
):
    ws_root = get_workspace_root(workspace_id)
    if not ws_root.exists():
        raise HTTPException(404, "workspace not found")

    dst_dir = ws_root / "ln-screenshots"
    dst_dir.mkdir(parents=True, exist_ok=True)

    # 文件名：基于 ts + timestamp，避免冲突
    ts_int = int(ts)
    now = datetime.now().strftime("%H%M%S")
    safe = f"shot-{ts_int:06d}-{now}.png"

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:    # 10MB 限制
        raise HTTPException(413, "screenshot too large")

    (dst_dir / safe).write_bytes(content)

    # 静态挂载 URL（/static 已挂到 data/）
    rel = (dst_dir / safe).resolve().relative_to(ROOT_DIR.resolve())
    url = "/static/" + str(rel).replace("\\", "/").lstrip("/").replace("data/", "", 1)
    # 注意：data/workspaces/{ws}/ln-screenshots/xxx.png
    #   → /static/workspaces/{ws}/ln-screenshots/xxx.png
    return {"url": url, "filename": safe}
```

**注意**：mimo 实现时**用 codegraph 或 rg 确认 `/static` 挂载路径**：

```bash
rg -n 'StaticFiles|app.mount\("/static' backend/app/main.py
```

确认 base 路径后再写 URL 拼接代码。

---

## 5. 错误处理矩阵（必须每项有 UI 反馈）

| 触发条件 | 处理 | 用户能感知 |
|---|---|---|
| 视频未加载完（readyState < 2） | toast.error('视频未加载完成') | ✅ |
| canvas.getContext('2d') 返回 null（罕见） | toast.error('截图失败：浏览器不支持 canvas') | ✅ |
| toBlob 失败 | toast.error('截图失败：帧转换错误') | ✅ |
| 上传 4xx / 5xx | axios 错误捕获 → toast.error(err.message) | ✅ |
| 上传成功但 store 没注册编辑器（用户在 HTML 视图） | toast.error('未找到笔记编辑器（请先切到 MD 视图）') | ✅ |
| 视频跨域（CORS）抓帧失败（throw SecurityError） | toast.error('视频跨域，无法截图') + 长说明  | ✅ |

**特别注意"跨域抓帧"**：HTML5 `<video>` + `<canvas>` 的 `drawImage` 在视频跨域时会污染 canvas，`toBlob` 抛 SecurityError。
- 后端 `/static` 是同源，应该 OK
- 如果未来视频源是外站，需要 `<video crossOrigin="anonymous">` + 服务器 CORS 头
- 本期不处理跨域视频，写到注释里

---

## 6. HTML 视图下的截图体验（边界）

用户当前在 HTML 视图时点截图：
- 方案 A（推荐）：截图按钮点击时**自动切到 MD 视图**再 insert（B-3 store 暴露 switchView）
- 方案 B：toast 提示「请先切到 MD 视图」（§5 已写）

**建议先用方案 B（最简单）**，二期再做方案 A。在 B-5 mimo 提示词里明确"用方案 B"。

---

## 7. 验证清单（mimo 写完后必跑）

- [ ] 启动 dev 后访问学习笔记页
- [ ] MD 视图打开 → 视频播放到 30s → 暂停 → 点截图 → 笔记里出现 `![截图@00:30](/static/.../shot-xxxxxx.png)`
- [ ] 切到 HTML 视图 → 看到图片渲染出来
- [ ] 切回 MD 视图 → 把光标放到第 5 行末尾 → 视频跳到 1:30 → 截图 → 截图字符串在第 5 行末尾插入（不是末尾）
- [ ] HTML 视图下点截图 → toast「请先切到 MD 视图」
- [ ] 视频还在加载时点截图 → toast 错误提示
- [ ] 上传后 `data/workspaces/{ws}/ln-screenshots/` 下有新文件
- [ ] B-4 的自动保存被触发（`ln.md` 文件内含新增图片引用）
- [ ] `pnpm build` EXIT=0
- [ ] `.venv/bin/python -m pytest backend/tests -q -k "ln_screenshots"` 至少 1 pass（happy path）

---

## 8. 不在 B-5 范围（mimo 不要顺手做）

- ❌ 不要做视频快照画廊（截图历史浏览，属 B+ 二期）
- ❌ 不要做截图标注（画箭头、加文字，远超本期）
- ❌ 不要做"截到上传期间显示预览"（用 toast 已经够，加 modal 收益小）
- ❌ 不要支持 HTML 视图直接插图（用方案 B 即可）
- ❌ 不要做截图 OCR（属 AI 导演范畴）

---

## 9. 与 B-3 的接口约定（B-3 mimo 会话务必遵守）

B-3 在 MdView 创建 EditorView 后**必须立即调用 `useLnEditorStore.getState().setCmView(view)`**，
unmount 时 `setCmView(null)`。

这是 B-3 实现时唯一需要为 B-5 准备的钩子，**不要因为 B-3 工单没写而漏掉**。
