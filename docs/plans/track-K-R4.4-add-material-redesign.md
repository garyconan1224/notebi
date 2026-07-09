---
title: Track K · R4.4 添加素材弹窗改造（板块化 + 配图开关 + 智能截帧 + 去 OCR + 人话命名）
status: ready
owner: mimo 执行（Claude 已定设计 + 目标代码）
depends_on: R4 §2（完整设置·第一步）
created: 2026-06-10
---

# Track K · R4.4：添加素材弹窗改造

> 📌 给 mimo：只改前端 1 个组件 + 它的测试，**不碰后端**。目标代码已写好照抄。1 个 commit。

---

## 0. 目标（用户拍板的交互）

把「② 生成笔记」区改成：
1. **先一个「生成笔记」板块卡片**，点击才展开配置（渐进式，以后可加 复刻/AI 导演 等板块）。
2. **配图开关**：关 = 纯文字笔记，开 = 带图笔记，开了才显示下面。
3. **取画面方式**（配图打开后）：智能（按视频时长自动）/ 手动（每隔 N 秒）。
4. **去掉 OCR**：删掉「提取模式 vision/ocr」下拉，固定用视觉模型。
5. **文案全改人话**（见 §3）。

> 本版**不做模型选择下拉**（用全局默认，以后随全局设置一起做）；**不改后端**（`image_mode` 仍传、固定 `'vision'`）。

---

## 1. 现状锚点（`frontend/src/components/workspace/AddMaterialModal.tsx`）

- state（:80–82）：`embedFrames` / `imageMode` / `frameInterval`
- 「② 生成笔记」section（**:239–289**）：eyebrow + 嵌图 Switch + 提取模式下拉(vision/ocr) + 截帧间隔
- `handleGenerateNote` 里调 `generateNote(...)`（约 **:148**）：`(wsId, url, title, embedFrames, imageMode, frameInterval)`
- 测试 `frontend/src/__tests__/AddMaterialModal.test.tsx`（:105 / :138）断言了 `generateNote` 调用参数 → 改了要同步

---

## 2. 改动（只改这 1 个组件 + 它的测试）

### Step A · 改 state（:80–82 区域）

```tsx
  const [embedFrames, setEmbedFrames] = useState(true)
  const [frameInterval, setFrameInterval] = useState(5)
  const [noteExpanded, setNoteExpanded] = useState(false)              // 新增：板块是否展开
  const [captureMode, setCaptureMode] = useState<'auto' | 'manual'>('auto')  // 新增：智能/手动
```

> **删掉** `const [imageMode, setImageMode] = useState('vision')`（不再让用户选）。

### Step B · 加 import（文件顶部 lucide 那行，补两个图标）

```tsx
import { /* …现有的… */, FileText, ChevronDown } from 'lucide-react'
```
> 现有已 import 了 `Wand2`/`Link2`/`Switch` 等，照加 `FileText`、`ChevronDown` 即可（具体看现有 import 行，别删现有的）。

### Step C · 整段替换「② 生成笔记」section（:239–289）

```tsx
        <div className="m-section">
          <div className="eyebrow" style={{ marginBottom: 10 }}>② 生成笔记</div>

          {/* 笔记板块卡片：点击展开配置（以后可加 复刻 / AI 导演 等板块）*/}
          <button
            type="button"
            onClick={() => setNoteExpanded((v) => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              padding: '12px 14px', borderRadius: 10,
              border: '1px solid var(--line)', background: 'var(--bg)',
              cursor: 'pointer', textAlign: 'left',
            }}
          >
            <FileText size={18} style={{ color: 'var(--accent-2)' }} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>生成笔记</span>
              <span className="kw" style={{ fontSize: 11 }}>下载 · 转写 · 整理成图文笔记</span>
            </span>
            <ChevronDown
              size={16}
              style={{ transform: noteExpanded ? 'rotate(180deg)' : 'none', transition: 'transform .15s', color: 'var(--ink-3)' }}
            />
          </button>

          {/* 点开后的配置 */}
          {noteExpanded && (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* 配图开关：关=纯文字笔记，开=带图笔记 */}
              <label htmlFor="add-material-embed" style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <Switch id="add-material-embed" checked={embedFrames} onCheckedChange={setEmbedFrames} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span className="mono" style={{ fontSize: 12 }}>笔记里配图</span>
                  <span className="kw" style={{ fontSize: 11 }}>打开＝带图笔记（自动挑有信息的画面）；关闭＝纯文字笔记</span>
                </span>
              </label>

              {/* 配图打开后才出现：取画面方式 */}
              {embedFrames && (
                <div style={{ marginLeft: 34, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <span className="mono" style={{ fontSize: 12 }}>取画面</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="radio" name="capture-mode" checked={captureMode === 'auto'} onChange={() => setCaptureMode('auto')} />
                    <span className="kw" style={{ fontSize: 12 }}>智能（按视频时长自动）</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="radio" name="capture-mode" checked={captureMode === 'manual'} onChange={() => setCaptureMode('manual')} />
                    <span className="kw" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                      手动每隔
                      <input
                        type="number" min={1} max={60} value={frameInterval}
                        disabled={captureMode !== 'manual'}
                        onChange={(e) => setFrameInterval(Number(e.target.value) || 5)}
                        style={{ fontSize: 12, width: 50, padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--ink-1)' }}
                      />
                      秒一张
                    </span>
                  </label>
                </div>
              )}
            </div>
          )}
        </div>
```

### Step D · 改 `generateNote` 调用（约 :148）+ 加智能间隔 helper

把原来的 `generateNote(..., imageMode, frameInterval)` 改成：

```tsx
      const effInterval =
        captureMode === 'auto' ? computeAutoInterval(effectiveSniff?.duration) : frameInterval
      const result = await generateNote(
        wsId, effectiveUrl, effectiveSniff?.title ?? undefined, embedFrames, 'vision', effInterval,
      )
```

在组件函数**外面**（文件靠上，与其它 helper 同级）加：

```tsx
/** 智能截帧间隔：按时长取约 25 张画面，clamp 到 5~60 秒；拿不到时长默认 10 */
function computeAutoInterval(durationSec?: number): number {
  if (!durationSec || durationSec <= 0) return 10
  return Math.min(60, Math.max(5, Math.round(durationSec / 25)))
}
```

> ⚠️ `effectiveSniff?.duration` 字段名要核对 `SniffResult` 类型（`rg "interface SniffResult" frontend/src`）。**若该类型没有 duration 字段**：先传 `computeAutoInterval(undefined)`（兜底 10），并停下来告诉用户「sniff 没有时长字段，智能档暂用默认 10 秒，未来需接后端 PROBE 时长」——不要自己去改 sniff 类型。

### Step E · 同步测试

`AddMaterialModal.test.tsx`（:105 / :138）的 `generateNote` 断言：第 5 个参数现在恒为 `'vision'`，第 6 个参数是算出的间隔（无 sniff 时长时 = 10）。按新调用更新断言（`toHaveBeenCalledWith(...)` 补上后两个参数或改用 `expect.any(Number)`）。

---

## 3. 文案对照（改人话）

| 旧（技术黑话）| 新（人话）|
|---|---|
| 智能嵌入关键画面配图 | 笔记里配图 |
| 提取模式 · 视觉模型/OCR | （整块删除）|
| 截帧间隔 · 秒/帧 | 取画面 · 智能（按时长）/ 手动每隔 N 秒一张 |
| note task / VLM / OCR | 不出现在 UI 文案里 |

---

## 4. 验证

```bash
cd /Users/conan/Desktop/nibi/frontend
npx tsc --noEmit              # 期望 EXIT=0
pnpm test AddMaterialModal    # 期望全绿
```
- 交互观感（点板块展开、配图开关联动、智能/手动切换）属动态 UI → **请用户**开「添加素材」看，你不用截图。

---

## 5. 提交 + 红线

提交：`feat(k-10.R4.4): 添加素材弹窗改造 — 笔记板块化 + 配图开关 + 智能截帧 + 去 OCR + 人话命名`，带 Co-Authored-By，**不要 push**。

红线：
- ❌ 只改 `AddMaterialModal.tsx` + `AddMaterialModal.test.tsx`，**不碰后端、不碰 `generateNote` 的 service 签名**（`image_mode` 仍传，固定 `'vision'`）。
- ❌ 不做模型选择下拉（本版不要）。
- ⚠️ `SniffResult` 没 duration 字段时按 §2 Step D 的兜底处理 + 停下问，别擅自改类型。
