---
title: Track K · R4.6.2 「生成笔记」做成一体折叠卡（边框包裹·卡内展开）
status: ready
owner: mimo 执行（Claude 已定方案 + 目标代码）
depends_on: R4.6
created: 2026-06-10
---

# Track K · R4.6.2：生成笔记一体折叠卡

> 📌 给 mimo：只改 `AddMaterialModal.tsx` 的「② 生成笔记」section **结构**——套一个边框容器、卡头可点、配图/取画面收进卡内。**配图开关、取画面卡片的内容和逻辑一行都不要动**（只是搬进新容器）。整段替换，1 commit。

---

## 0. 目标

现在「生成笔记」是个灰卡 + 下面**另起一块**的配图/取画面，视觉割裂成两层。改成**一张带边框的折叠卡**：卡头（生成笔记 + 箭头，点击展开/收起）和展开内容在**同一个边框容器内**，像一个完整「板块」。

---

## 1. 现状锚点

- 文件：`frontend/src/components/workspace/AddMaterialModal.tsx`
- 定位：`rg -n "② 生成笔记" frontend/src/components/workspace/AddMaterialModal.tsx` 找到那个 `<div className="m-section">`。
- 现状：`<div className="m-section">` 里是 eyebrow +「button 卡片」+ `{noteExpanded && <div marginTop 内容>}`（button 有自己的 border/bg，body 在 button 外）。
- 不变的东西：`noteExpanded` / `embedFrames` / `captureMode` / `computeAutoInterval` / `estimateFrames` / `videoDuration` 等 state 和 helper **都已存在、不用改**。

---

## 2. 改动：整段替换「② 生成笔记」section

把那个 `<div className="m-section"> … </div>`（从 eyebrow「② 生成笔记」到它的闭合 `</div>`，紧挨着下面的 `<div className="m-foot">`）**整段替换**为：

```tsx
        <div className="m-section">
          <div className="eyebrow" style={{ marginBottom: 10 }}>② 生成笔记</div>

          {/* 一体折叠卡：边框包裹「卡头 + 展开内容」，点击卡头切换 */}
          <div style={{ border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', background: 'var(--bg)' }}>
            <button
              type="button"
              onClick={() => setNoteExpanded((v) => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '14px 16px', border: 'none', background: 'transparent',
                cursor: 'pointer', textAlign: 'left',
                borderBottom: noteExpanded ? '1px solid var(--line)' : 'none',
              }}
            >
              <FileText size={18} style={{ color: 'var(--accent-2)' }} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>生成笔记</span>
                <span className="kw" style={{ fontSize: 11 }}>下载 · 转写 · 整理成图文笔记</span>
              </span>
              <ChevronDown size={16} style={{ transform: noteExpanded ? 'rotate(180deg)' : 'none', transition: 'transform .15s', color: 'var(--ink-3)' }} />
            </button>

            {noteExpanded && (
              <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <label htmlFor="add-material-embed" style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <Switch id="add-material-embed" checked={embedFrames} onCheckedChange={setEmbedFrames} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span className="mono" style={{ fontSize: 12 }}>笔记里配图</span>
                    <span className="kw" style={{ fontSize: 11 }}>打开＝带图笔记（自动挑有信息的画面）；关闭＝纯文字笔记</span>
                  </span>
                </label>

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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
              </div>
            )}
          </div>
        </div>
```

> 关键差异（相对现状）：① 外层多了 `<div style={{ border…borderRadius:12 }}>` 把卡头 + body 包住；② 卡头 button 去掉了自己的 border/background、改 `borderBottom`（展开时显示分隔线）；③ body 由 `marginTop` 改 `padding`、去掉取画面的 `marginLeft:34`（现在靠容器 padding 对齐）。**配图开关、取画面卡片内容完全照旧**。

---

## 3. 验证

```bash
cd /Users/conan/Desktop/nibi/frontend
npx tsc --noEmit              # EXIT=0
pnpm test AddMaterialModal    # 全绿（逻辑没动，断言应不变）
```
- 视觉（一张卡、点击卡头展开/收起、卡内分隔线）属动态 UI → **请用户**开「添加素材」看。

---

## 4. 提交 + 红线

提交：`feat(k-10.R4.6.2): 生成笔记一体折叠卡（边框包裹·卡内展开）`，带 Co-Authored-By，**不要 push**。

红线：
- ❌ 只改「② 生成笔记」section 的结构，不动任何 state / helper / useEffect / `handleGenerateNote`。
- ❌ 不改配图开关、取画面卡片的内容和交互（只是搬进新容器）。
- ❌ 别误删 section 后面的 `<div className="m-foot">`（生成笔记按钮那块）。
