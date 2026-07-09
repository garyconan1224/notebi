---
title: Track K · R4.6 取画面 UI 重做（卡片化 + 真实时长 + 预估帧数）
status: ready
owner: mimo 执行（Claude 已定方案 + 目标代码 + mockup）
depends_on: R4.5（probeDuration service）
created: 2026-06-10
---

# Track K · R4.6：取画面 UI 重做

> 📌 给 mimo：只改 `AddMaterialModal.tsx`（+ 它的测试），把「取画面」从朴素 radio 换成两张卡片，接 R4.5 的 `probeDuration` 显示真实时长和预估帧数。目标代码已写好照抄。1 commit。

---

## 0. 目标（用户确认的 mockup）

- 智能/手动做成**两张可点卡片**（替代 radio），选中态橙色描边（`--accent-warm`，项目里截帧/分镜语义色）。
- 识别为视频后**探测时长**（调 R4.5 的 `probeDuration`），两张卡各显示**预估帧数**（约 N 张）；智能卡显示「每 X 秒」，手动卡输入秒数后帧数实时更新。
- 拿不到时长时显示「识别后显示」，并回退默认行为（不报错）。

---

## 1. 现状锚点（`frontend/src/components/workspace/AddMaterialModal.tsx`，R4.4 之后）

- import：`:3` lucide、`:14-18` service（已有 `sniffUrl` 等）
- helper：`:66` `computeAutoInterval(durationSec?)` 已存在
- state：`:86-90` `embedFrames/frameInterval/noteExpanded/captureMode`
- `effectiveUrl`（:93）、`effectiveSniff`（:94）已算好
- 取画面 radio 段：**`:288-310`**（要替换）
- `handleGenerateNote` 里有 `computeAutoInterval(undefined)`（rg 定位）

---

## 2. 改动（6 处，都在这一个组件）

### Step A · import 加 `probeDuration` + `Settings2` 图标

```tsx
import { ChevronDown, FileText, Link2, Settings2, Wand2, X } from 'lucide-react'
```
```tsx
import {
  autoCreateWorkspace,
  generateNote,
  probeDuration,
  sniffUrl,
} from '@/services/workspaces'
```

### Step B · state 加 `videoDuration`（:90 那组 useState 后面）

```tsx
  const [videoDuration, setVideoDuration] = useState(0) // 探测到的视频时长（秒），0=未知
```

### Step C · 组件外加两个 helper（:70 `computeAutoInterval` 后面）

```tsx
/** 预估帧数：时长 ÷ 间隔，四舍五入、至少 1；拿不到时长返回 0（UI 显示「识别后显示」）*/
function estimateFrames(durationSec: number, intervalSec: number): number {
  if (durationSec <= 0 || intervalSec <= 0) return 0
  return Math.max(1, Math.round(durationSec / intervalSec))
}

/** 秒数 → M:SS */
function formatDuration(sec: number): string {
  if (sec <= 0) return ''
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
```

### Step D · 加探测时长 useEffect（组件内，与其它 useEffect 同级即可）

```tsx
  // 识别为视频后，轻量探测时长（供「取画面」算预估帧数）；非视频/拿不到 → 0
  useEffect(() => {
    if (!open || !effectiveUrl || effectiveSniff?.primary_type !== 'video') {
      setVideoDuration(0)
      return
    }
    let cancelled = false
    probeDuration(effectiveUrl)
      .then((r) => { if (!cancelled) setVideoDuration(r.duration_sec || 0) })
      .catch(() => { if (!cancelled) setVideoDuration(0) })
    return () => { cancelled = true }
  }, [open, effectiveUrl, effectiveSniff?.primary_type])
```

### Step E · 替换取画面段（整段 `:288-310` 换成卡片版）

```tsx
              {/* 配图打开后才出现：取画面方式（两张卡片）*/}
              {embedFrames && (() => {
                const autoInterval = computeAutoInterval(videoDuration)
                const autoFrames = estimateFrames(videoDuration, autoInterval)
                const manualFrames = estimateFrames(videoDuration, frameInterval)
                const cardBase = {
                  textAlign: 'left' as const, padding: '12px 14px', borderRadius: 10,
                  cursor: 'pointer', background: 'var(--bg)',
                }
                const sel = (on: boolean) => ({
                  ...cardBase,
                  border: on ? '2px solid var(--accent-warm)' : '1px solid var(--line)',
                  background: on ? 'rgba(255,184,76,0.08)' : 'var(--bg)',
                })
                return (
                  <div style={{ marginLeft: 34, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <span className="mono" style={{ fontSize: 12 }}>取画面</span>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div onClick={() => setCaptureMode('auto')} style={sel(captureMode === 'auto')}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <Wand2 size={15} style={{ color: 'var(--accent-warm)' }} />
                          <span style={{ fontSize: 13, fontWeight: 600 }}>智能</span>
                        </div>
                        <div className="kw" style={{ fontSize: 11 }}>按时长自动</div>
                        <div className="kw" style={{ fontSize: 11, marginTop: 4 }}>
                          {videoDuration > 0 ? `每 ${autoInterval} 秒 · 约 ${autoFrames} 张` : '识别后显示'}
                        </div>
                      </div>
                      <div onClick={() => setCaptureMode('manual')} style={sel(captureMode === 'manual')}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <Settings2 size={15} style={{ color: captureMode === 'manual' ? 'var(--accent-warm)' : 'var(--ink-3)' }} />
                          <span style={{ fontSize: 13, fontWeight: 600 }}>手动</span>
                        </div>
                        <div className="kw" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                          每隔
                          <input
                            type="number" min={1} max={60} value={frameInterval}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setFrameInterval(Number(e.target.value) || 5)}
                            style={{ fontSize: 11, width: 42, padding: '1px 4px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--ink-1)' }}
                          />
                          秒
                        </div>
                        <div className="kw" style={{ fontSize: 11, marginTop: 4 }}>
                          {videoDuration > 0 ? `约 ${manualFrames} 张` : '识别后显示'}
                        </div>
                      </div>
                    </div>
                    {videoDuration > 0 && (
                      <div className="kw" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                        视频时长 {formatDuration(videoDuration)} · 识别时获取
                      </div>
                    )}
                  </div>
                )
              })()}
```

### Step F · `handleGenerateNote` 用真实时长

把 `computeAutoInterval(undefined)` 改成 `computeAutoInterval(videoDuration)`（rg 定位那一行）。

### Step G · 测试同步（`AddMaterialModal.test.tsx`）

R4.6 新增了 `probeDuration` 调用（useEffect）→ 测试要 **mock 掉 `probeDuration`**（仿现有 `generateNoteMock`/`sniffUrl` mock 写法，返回 `{ duration_sec: 0 }`），否则会真发请求。现有断言 `generateNote(...)` 第 6 参数（间隔）：`videoDuration=0` 时 `computeAutoInterval(0)=10`，与之前一致，断言应不用改；若挂在 probeDuration 未 mock，按上面补 mock。

---

## 3. 验证

```bash
cd /Users/conan/Desktop/nibi/frontend
npx tsc --noEmit              # EXIT=0
pnpm test AddMaterialModal    # 全绿
```
- 视觉/交互（卡片选中态、帧数随秒数变、时长显示）属动态 UI → **请用户**开「添加素材」看。

---

## 4. 提交 + 红线

提交：`feat(k-10.R4.6): 取画面 UI 卡片化 + 真实时长预估帧数（接 probeDuration）`，带 Co-Authored-By，**不要 push**。

红线：
- ❌ 只改 `AddMaterialModal.tsx` + 它的测试，不碰后端、不碰 R4.5 的 service。
- ❌ 颜色用项目 token（选中 `--accent-warm` 橙）；不要引入新颜色值（`rgba(255,184,76,0.08)` 是 `--accent-warm` 的淡色，可保留）。
- ⚠️ useEffect deps 就写 `[open, effectiveUrl, effectiveSniff?.primary_type]`，别加 `sniffTypes`（数组每次新建会死循环）。
