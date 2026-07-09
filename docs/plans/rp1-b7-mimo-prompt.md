---
phase: RP1-B · B-7 学习笔记导出菜单
status: ready
owner: xiaomi-mimo-2.5pro
parent: docs/plans/result-pages-redesign-v1.md § RP1-B · B-7
companion: docs/plans/rp1-execution-handoff.md § 3.3 提示词 B-7
prerequisite:
  - ln 页存在（B-1+）；与 B-3~B-6 无强耦合，可在 B-3 之后任意点做
estimated_hours: 2-3
deps_redline: false   # window.print 原生；不引 react-to-print
---

## 0. 前置说明（mimo 必读）

B-7 在学习笔记页顶栏加「导出 ▾」下拉，暴露已有的多格式导出 + 一个浏览器原生打印。**后端导出基本现成**，B-7 主要是前端 dropdown 接线。

### 后端落点已确认（B-7 启动时再 rg 核对一次字段名）

- `backend/app/routes/export.py` 第 598 行附近有 `@router.post("/{workspace_id}/notes/export")`，body 带 `format`（值疑似 `pdf | docx | obsidian`，返回 zip/stream）。
- 视频复刻页 `VideoResultPage.tsx` 顶栏已有一个 `vd-dropdown-menu`（约 504/690 行）可作为 dropdown 样式参考。

---

## 1. mimo 启动提示词（直接复制到 ccswitch CC 终端）

```
RP1-B · B-7 学习笔记导出菜单。
实测 URL: http://localhost:5177/workspaces/{有 ln.md 的 ws}/ln

详细规格: docs/plans/result-pages-redesign-v1.md § RP1-B · B-7
本任务计划: docs/plans/rp1-b7-mimo-prompt.md

【任务 0: 先确认后端导出契约】
  rg -n "notes/export|format|obsidian|pdf|docx|StreamingResponse" backend/app/routes/export.py
  确认：端点路径、format 接受的值、返回类型（zip / 文件流）。

【任务 1: 前端 service】
  frontend/src/services/workspaces.ts 加 exportLnNotes(ws, format) → POST /workspaces/{ws}/notes/export
  （返回 blob，用 responseType blob 或 fetch().blob()；触发浏览器下载）。

【任务 2: 顶栏导出 dropdown】
  - ln-nav 右侧加「导出 ▾」按钮 + 下拉菜单（样式参考 VideoResultPage 的 vd-dropdown-menu）。
  - 三项后端格式：Obsidian / PDF / Word(docx) → 点击调 exportLnNotes(ws, fmt) 下载。
  - 第四项「导出当前页 (HTML)」= window.print()（不引 react-to-print）。
    配一段 @media print CSS：隐藏 nav/视频/字幕轨，只留笔记内容。

【任务 3: 下载体验】
  - 点击后菜单关闭；导出中可给按钮 loading 态；失败 toast。
  - 文件名用 workspace 标题 + 格式后缀（后端若已设 Content-Disposition 则尊重它）。

【范围限制】
- 不改后端导出逻辑（只接现有端点）；若发现某格式后端没实现，记到 COMPLETED_WORK，不在 B-7 补后端。
- 不碰编辑/保存/截图。不装新依赖（window.print 原生）。不留 debug 脚本。

【验证】
- pnpm build + tsc EXIT=0
- 手测三种后端格式各下载一次（文件能打开）+ window.print 预览只含笔记
- playwright 归档 2 张: docs/e2e-test/screenshots/rp1b-b7-{menu,print-preview}.png
- git commit: feat(rp1-b): B-7 学习笔记导出菜单
  Co-Authored-By: xiaomi-mimo-2.5pro <noreply@xiaomi.com>
- 更新 COMPLETED_WORK + EXECUTION_PLAN（加 B-7 条）
- 不要 push
```

## 2. 风险预案

| 风险 | 应对 |
|---|---|
| 后端 format 值与设想不符（不是 obsidian/pdf/docx） | 任务 0 先 rg 确认，按真实值接 |
| 某格式后端未实现 / 报错 | 前端只暴露后端确实支持的；缺的记 COMPLETED_WORK 留给后续，不在 B-7 补后端 |
| @media print 把视频/编辑器也打出来 | print CSS 显式隐藏 .ln-nav / .ln-video-panel / .ln-transcript-panel / toolbar |
| blob 下载在某些浏览器不触发 | 用 a[download] + URL.createObjectURL 标准下载法 |

## 3. 验收清单

- [ ] 任务 0 确认后端导出契约（路径/format/返回类型）
- [ ] exportLnNotes service（blob 下载）
- [ ] 顶栏「导出 ▾」dropdown：3 后端格式 + 打印
- [ ] @media print CSS 只留笔记正文
- [ ] 三格式各下载一次成功（实测）
- [ ] pnpm build + tsc EXIT=0、不碰后端、无新依赖、无 debug 脚本
- [ ] 截图 + COMPLETED_WORK + EXECUTION_PLAN、没 push
