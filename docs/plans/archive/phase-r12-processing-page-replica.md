---
name: phase-r12-processing-page-replica
status: done
branch: feat/phase-r12-processing-page-replica
baseline_commit: 7ec9914
owner: claude opus 4.7 (R12.1~R12.3) → ds v4-pro via ccswitch (R12.4~R12.6) → Codex QA
created_date: 2026-05-25
completed_date: 2026-05-25
commits_done:
  - R12.1 7bee6d3 yt-dlp 抽取 title/duration/uploader/thumbnail_url 写入 task.result
  - R12.2 d6edc1e Hero 读真实标题/封面/时长/帧数/句数/ETA
  - R12.3 3801eb3 step-stream desc + 三色日志(ok/warn/err) + 前缀符号
  - R12.4 4922c80 后端 /system/stats 端点（psutil + nvidia-smi 跨平台）
  - R12.5 f88de4a SystemResourceCard 四宫格 + 并行槽位（轮询 /system/stats）
  - R12.6 634f3c5 TasksCard 侧栏活跃任务列表 + 点击切换路由
---

## 收口状态

- 当前在 `feat/phase-r12-processing-page-replica` 分支，R12.1~R12.6 已全部完成并提交。
- Codex QA 已清理分支中混入的非 R12 global SSE/R9 残留，并修复 `ProcessingPage/index.tsx` 的 touched-file React hooks lint 问题。
- 不 push 远端；merge 前仍按用户授权执行。
- 颜色继续走 `var(--*)` token，参考 [`docs/DESIGN_TOKENS.md`](../DESIGN_TOKENS.md) §2。
- 设计稿真相源：[`docs/design/components/processing.jsx`](../design/components/processing.jsx) L147-250（右侧 aside）。

# Phase R12 — ProcessingPage 1:1 复刻设计稿

## 目标

把 `frontend/src/pages/result/ProcessingPage/index.tsx` 与设计稿
`docs/design/components/processing.jsx` 对齐。当前差距：
标题/封面/统计元数据/step 内联日志/右侧 3 张卡（缺 2 张）。

## 范围（6 项，#6 预览帧延后到 N7b）

| # | 内容 | 文件 | commit |
|---|---|---|---|
| R12.1 | 后端 yt-dlp 抽取 title/duration/uploader 写进 task.payload+result | shared/video_download_ytdlp.py + task_runner.py | R12.1 |
| R12.2 | 前端 Hero 区读真实标题 + 封面 + 完整 stats 行 | ProcessingPage/index.tsx + processing.css | R12.2 |
| R12.3 | StepProgress 改 step-stream：每步 desc + 内联 logs(warn/err/ok 三色) + 进度条 | StepProgress.tsx + processing.css | R12.3 |
| R12.4 | 后端 /system/stats 端点：psutil CPU/RAM + nvidia-smi GPU/VRAM | 新建 backend/app/routes/system.py | R12.4 |
| R12.5 | 右侧 SystemResourceCard 卡：四宫格 + 并行槽位条 | 新建 SystemResourceCard.tsx + 拉取 /system/stats | R12.5 |
| R12.6 | 右侧 TasksCard 卡：活跃任务列表，点击切换 | 新建 TasksCard.tsx，复用 useTaskStore | R12.6 |

## 延后

- **#6 预览帧卡** — 依赖 N7b 视频后端 vlm 阶段回写 current_frame，留到 N7b 实现时一起做。

---

## R12.4 详细步骤 — 后端 /system/stats 端点

**目标**：暴露 CPU / RAM / GPU / VRAM 实时数据给前端 SystemResourceCard 拉取。

### 文件

**新建** `backend/app/routes/system.py`（不要塞进 admin.py，单独 router）

### 实现要点

1. 路由：`GET /system/stats` → 返回 JSON（schema 见下）
2. 依赖：`psutil` 已安装（version 7.2.2）；nvidia-smi 在 macOS 上不存在 → **try/except 包住，失败时 gpu 字段返回 None**
3. macOS 兼容：用 `subprocess.run(['nvidia-smi', ...], timeout=2)`，FileNotFoundError / TimeoutExpired → gpu = None
4. 不缓存，每次请求实时采样（前端 3-5s 轮询一次）

### 返回 schema

```python
{
  "cpu": {"percent": 42.3, "cores": 16},                  # psutil.cpu_percent / cpu_count
  "ram": {"used_gb": 18.2, "total_gb": 64.0, "percent": 28.4},  # psutil.virtual_memory
  "gpu": {                                                # None 表示无 NVIDIA GPU
    "name": "RTX 4090",
    "utilization_percent": 71,
    "vram_used_gb": 16.1,
    "vram_total_gb": 24.0,
  } | None,
}
```

### 关键代码骨架

```python
# backend/app/routes/system.py
from __future__ import annotations
import shutil
import subprocess
from typing import Any
import psutil
from fastapi import APIRouter

router = APIRouter(prefix="/system", tags=["system"])


def _query_nvidia_gpu() -> dict[str, Any] | None:
    """通过 nvidia-smi 查询 GPU 状态；无 NVIDIA / 命令缺失返回 None。"""
    if not shutil.which("nvidia-smi"):
        return None
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,utilization.gpu,memory.used,memory.total",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=2,
        )
        if result.returncode != 0:
            return None
        line = result.stdout.strip().splitlines()[0]
        name, util, used_mb, total_mb = [p.strip() for p in line.split(",")]
        return {
            "name": name,
            "utilization_percent": int(float(util)),
            "vram_used_gb": round(int(used_mb) / 1024, 1),
            "vram_total_gb": round(int(total_mb) / 1024, 1),
        }
    except (subprocess.TimeoutExpired, FileNotFoundError, ValueError, IndexError):
        return None


@router.get("/stats")
def get_system_stats() -> dict[str, Any]:
    mem = psutil.virtual_memory()
    return {
        "cpu": {
            "percent": psutil.cpu_percent(interval=0.1),
            "cores": psutil.cpu_count(logical=True) or 0,
        },
        "ram": {
            "used_gb": round(mem.used / 1024**3, 1),
            "total_gb": round(mem.total / 1024**3, 1),
            "percent": mem.percent,
        },
        "gpu": _query_nvidia_gpu(),
    }
```

### 集成

`backend/app/main.py` 注册 router：

```python
from .routes import system as system_routes
app.include_router(system_routes.router)
```

### 测试

**新建** `tests/backend/test_system_stats.py`：

```python
from fastapi.testclient import TestClient
from backend.app.main import app

def test_system_stats_returns_cpu_and_ram():
    client = TestClient(app)
    r = client.get("/system/stats")
    assert r.status_code == 200
    data = r.json()
    assert "cpu" in data and "percent" in data["cpu"]
    assert "ram" in data and "total_gb" in data["ram"]
    assert "gpu" in data  # value 可能是 None（macOS / 无 NVIDIA）

def test_system_stats_gpu_field_is_dict_or_none():
    client = TestClient(app)
    data = client.get("/system/stats").json()
    assert data["gpu"] is None or isinstance(data["gpu"], dict)
```

### 验收

- `.venv/bin/python -m pytest tests/backend/test_system_stats.py -q` 通过
- `curl http://localhost:8000/system/stats` 返回合法 JSON

**commit**：`feat(phase-r12): R12.4 后端 /system/stats 端点 (psutil + nvidia-smi 跨平台)`

---

## R12.5 详细步骤 — 右侧 SystemResourceCard 卡

**目标**：在 ProcessingPage 右侧栏第一张卡，四宫格显示 GPU / RAM / VRAM / ETA + 底部并行槽位条。

### 文件

**新建** `frontend/src/pages/result/ProcessingPage/SystemResourceCard.tsx`

### 数据来源

1. 通过 `useEffect` + `setInterval(3000)` 轮询 `/system/stats`（用 `services/client.ts` 的 axios 实例）
2. 并行槽位用 `useTaskStore.tasks.filter(t => !isTaskTerminal(t.status)).length` 算 runningCount
3. ETA：直接复用 ProcessingPage 已算好的 `etaSec` —— **通过 props 传入**，不要在 card 里重算

### Props 设计

```typescript
interface SystemResourceCardProps {
  etaSec: number  // 0 表示不显示
}
```

### 视觉对齐设计稿（processing.jsx L148-180）

四宫格（2 列 grid）：

| label (eyebrow) | value (大字, var(--display) 28px) | sub (灰色 11px) |
|---|---|---|
| GPU | `${util}%` (无 GPU 时 `—`) | `${name} · ${vram_total}G` |
| RAM | `${used_gb}G` | `/ ${total_gb}GB` |
| VRAM | `${vram_used}G` (无 GPU `—`) | `/ ${vram_total} GB` |
| ETA | `${eta}s` 或 `—` | `剩余时间` |

底部并行槽位条（divider + 顶部 12px padding-top）：

```tsx
<div style={{ marginTop:14, paddingTop:12, borderTop:'1px solid var(--line)' }}>
  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
    <span className="eyebrow">并行槽位</span>
    <span className="mono" style={{ fontSize:11, color:'var(--ink-3)' }}>
      <b style={{ color:'var(--ink)', fontSize:13 }}>{runningCount}</b> / {parallelLimit}
      <span style={{ marginLeft:6, color:'var(--accent-green)' }}>推荐 {recommend}</span>
    </span>
  </div>
  <div style={{ display:'flex', gap:4 }}>
    {Array.from({ length: parallelLimit }).map((_, i) => (
      <div key={i} style={{
        flex:1, height:5, borderRadius:3,
        background: i < runningCount ? 'var(--ink)' : 'var(--bg-sunken)',
        border: i < runningCount ? 'none' : '1px dashed var(--line)',
      }}/>
    ))}
  </div>
  <div className="mono" style={{ fontSize:10, color:'var(--ink-4)', marginTop:6 }}>
    CPU {cores}核 · RAM {ram.total_gb}GB{gpu ? ` · ${gpu.name} ${gpu.vram_total_gb}GB` : ''}
  </div>
</div>
```

### 并行槽位常量

```typescript
const recommend = 6         // 本机推荐并行数，先固定（后续可由后端按 CPU 核数推算）
const parallelLimit = Math.max(3, recommend)
```

### header（与设计稿一致）

```tsx
<h4>系统资源 <span className="chip"><span className="chip-dot" style={{background:'var(--accent-green)'}}/>{gpu ? 'GPU active' : 'CPU only'}</span></h4>
```

### Header chip 配色

- 有 GPU：背景 `rgba(34,211,154,0.12)`，文字 `var(--accent-green)`，dot 同绿
- 无 GPU：文字 `var(--ink-3)`，dot `var(--ink-3)`

### 加载 / 错误态

- 首次加载（stats === null）：四宫格的 value 全显示 `—`
- fetch 失败：保留上一次成功的数据，console.warn 一次（不要 toast 烦人）
- 卸载时清 interval

### 集成到 ProcessingPage

```tsx
// 在 <aside className="proc-side"> 内，<LiveLog> 之前插入
<SystemResourceCard etaSec={etaSec} />
```

### 包装样式

用现有 `.side-card` class（CSS 已有），不要新写容器样式。

### 测试

不强制写单测，但要保证：
1. 后端没启时不报红（错误捕获即可）
2. 真实启动后 3 秒内出现数据

### 验收

- 启 backend + frontend → 打开 /processing/<id> → 右侧第一张卡显示 GPU/RAM/VRAM/ETA 四宫格
- mac 上 GPU 行显示 `—` + `CPU only` chip；linux/win + NVIDIA 真实数字 + `GPU active` chip
- 并行槽位条点亮 = 当前活跃任务数

**commit**：`feat(phase-r12): R12.5 SystemResourceCard 四宫格 + 并行槽位 (轮询 /system/stats)`

---

## R12.6 详细步骤 — 右侧 TasksCard 卡

**目标**：在 ProcessingPage 右侧栏第二张卡，列活跃任务，点击切到对应 /processing/{id}。

### 文件

**新建** `frontend/src/pages/result/ProcessingPage/TasksCard.tsx`

### 数据来源

```typescript
import { useTaskStore } from '@/store/taskStore'
import { isTaskTerminal } from '@/types/task'

const tasks = useTaskStore((s) => s.tasks)  // 已有 R10 全局事件流自动更新
const activeTasks = tasks
  .filter(t => !isTaskTerminal(t.status) || t.task_id === currentTaskId)
  .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
  .slice(0, 8)  // 最多 8 条
```

> ⚠️ 与 R10 FloatingTaskQueue 数据源一致，但**侧栏永远显示**（不像浮动队列全终结才隐藏），且包含当前任务即使 done 也保留高亮。

### Props

```typescript
interface TasksCardProps {
  currentTaskId: string
}
```

### 视觉对齐设计稿（processing.jsx L183-240）

header：
```tsx
<h4>
  任务
  <span className="mono" style={{fontSize:10,opacity:0.6}}>{activeTasks.length} 个活跃 · 点击切换</span>
</h4>
```

每条 tasklet：

```tsx
<div
  key={t.task_id}
  className="tasklet"
  onClick={() => navigate(`/processing/${t.task_id}`)}
  style={{
    padding:'10px 12px', margin:'0 -12px',
    borderRadius:10,
    background: isActive ? 'var(--bg-sunken)' : 'transparent',
    borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
    borderBottom: '1px solid var(--line)',
    cursor: 'pointer',
    display: 'flex', gap: 10,
  }}
>
  <div className="tl-thumb">
    {coverUrl ? <img src={coverUrl} alt=""/> : <div style={{ background:'var(--bg-sunken)', width:'100%', height:'100%' }}/>}
  </div>
  <div className="tl-body" style={{ flex:1, minWidth:0 }}>
    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
      <div className="tl-title" style={{ flex:1, minWidth:0, fontSize:13, fontWeight:600,
                                          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
        {title}
      </div>
      {isActive && (
        <span className="mono" style={{ fontSize:9, color:'var(--accent)', flexShrink:0,
                                         padding:'1px 5px', border:'1px solid var(--accent)', borderRadius:4 }}>
          查看中
        </span>
      )}
    </div>
    <div className="tl-meta" style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, color:'var(--ink-3)', marginTop:3 }}>
      <span className={`dot ${dotCls}`} style={{ width:6, height:6, borderRadius:99, background: dotColor }}/>
      <span>{t.status.toLowerCase()}</span>
      <span style={{ opacity:0.4 }}>·</span>
      <span style={{ flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis' }}>
        {Math.round((t.progress ?? 0) * 100)}%
      </span>
    </div>
    {/* 进度条 */}
    <div style={{ marginTop:6, height:2, background:'var(--bg-sunken)', borderRadius:99, overflow:'hidden' }}>
      <div style={{
        height:'100%', width:`${(t.progress ?? 0) * 100}%`,
        background: t.status === 'FAILED' ? 'var(--accent)'
                  : t.status === 'SUCCESS' ? 'var(--accent-green)'
                  : 'var(--ink)',
      }}/>
    </div>
  </div>
</div>
```

### 字段映射

- `title` = `t.result?.video_title || t.payload?.title || t.payload?.url || t.task_id.slice(0,8)`
- `coverUrl` = `t.result?.video_thumbnail_url || ''`（失败 onError 隐藏）
- `dotColor`: SUCCESS→`var(--accent-green)` / FAILED→`var(--accent)` / PENDING→`var(--ink-4)` / 其它→`var(--ink)`
- `isActive` = `t.task_id === currentTaskId`

### tl-thumb 样式（在 processing.css 追加）

```css
.vm-processing-scope .tasklet { display: flex; gap: 10px; }
.vm-processing-scope .tasklet:hover { background: var(--bg-sunken) !important; }
.vm-processing-scope .tl-thumb {
  width: 56px; aspect-ratio: 16/9; border-radius: 6px;
  overflow: hidden; flex-shrink: 0; background: #000;
}
.vm-processing-scope .tl-thumb img { width: 100%; height: 100%; object-fit: cover; }
```

### 集成到 ProcessingPage

```tsx
<aside className="proc-side">
  <SystemResourceCard etaSec={etaSec} />
  <TasksCard currentTaskId={taskId} />
  <LiveLog logs={logs} />   {/* 保留 LiveLog 作为第三张 */}
</aside>
```

### 空状态

`activeTasks.length === 0` 时：

```tsx
<div style={{ padding:'20px 0', textAlign:'center', color:'var(--ink-4)', fontSize:12 }}>
  暂无活跃任务
</div>
```

### 验收

- 多任务并发：起 3 个不同 URL → 切到任意 /processing/<id> → TasksCard 显示 3 条 + 当前任务高亮 + 红色"查看中"角标
- 点击某条 → 路由跳到 `/processing/<另一个 id>`，TasksCard 高亮切换
- 完成的任务自动消失（除非是当前正在看的）

**commit**：`feat(phase-r12): R12.6 TasksCard 侧栏活跃任务列表 + 点击切换路由`

---

## 完工收口

- [x] 更新本文件 frontmatter `status: done`，补 R12.4/5/6 commit hash
- [x] 更新 [`docs/EXECUTION_PLAN.md`](../EXECUTION_PLAN.md)：在 Phase R 区段后追加 R12 行
- [x] 更新 [`docs/COMPLETED_WORK.md`](../COMPLETED_WORK.md)：追加 R12 完成记录
- [ ] 等用户授权 merge；不 push 远端

## 决议（用户已拍板）

- 按顺序依次做完 6 项
- 任务卡（侧栏）+ 浮动队列**两个都保留**（侧栏=处理页内导航，浮动=跨页提醒）
- 系统资源要**真实数据**（不 mock）
- 不 push 远端，做完 6 commit 等用户授权 merge

## 收口验证（2026-05-25）

- `.venv/bin/python -m pytest tests/backend -q`：320 passed, 2 skipped
- `cd frontend && pnpm test --run`：9 files / 47 tests passed
- `cd frontend && pnpm build`：passed
- `cd frontend && pnpm exec eslint src/pages/result/ProcessingPage/index.tsx src/pages/result/ProcessingPage/StepProgress.tsx src/pages/result/ProcessingPage/SystemResourceCard.tsx src/pages/result/ProcessingPage/TasksCard.tsx`：passed
- `cd frontend && pnpm lint`：47 errors / 1 warning，仍为项目存量 lint 基线；R12 touched files targeted eslint 已通过

## 验收

1. 粘 B 站短视频 URL → /processing/<id>：标题显示视频真实标题、封面图显示视频缩略图
2. stats 行显示真实时长/帧数/句数（无数据时省略对应项）
3. step-stream 7 步顺序对，每步有 desc，logs 按 ok/warn/err 三色显示
4. 右侧栏 3 张卡可见：系统资源（GPU/RAM 数字真实变化）、任务（点击跳别的任务）、(预览帧暂缺)
5. R12 touched files targeted eslint、`pnpm build`、`pnpm test --run` 通过；全量 `pnpm lint` 仍有项目存量基线错误
6. `.venv/bin/python -m pytest tests/backend -q` 通过

## 禁止事项

- ❌ 不动 R8 PreflightDrawer / R10 FloatingTaskQueue / AddMaterialModal
- ❌ 不写 hardcoded hex/px/border，全走 var(--*) token
- ❌ 不引入新依赖（psutil 项目里检查下有没有；nvidia-smi 走 subprocess）
- ❌ 不 push 远端
