---
phase: RP1-B · B-4 学习笔记在线编辑 + 自动保存
status: done
commits: 07ae2b6
completed_date: 2026-05-30
owner: xiaomi-mimo-2.5pro
parent: docs/plans/result-pages-redesign-v1.md § RP1-B · B-4
companion: docs/plans/rp1-execution-handoff.md § 3.3 提示词 B-4
prerequisite:
  - B-3 已完工（CodeMirror MdView + HtmlView + index.tsx 的 markdown state 可编辑）
estimated_hours: 3-4
deps_redline: false   # 无新依赖（debounce 自写或用现有 util）
decisions:
  - last-write-wins，本期不做并发冲突检测（单机用户）。
---

## 0. 前置说明（mimo 必读）

B-3 之后，右栏笔记已可在 HTML/MD 视图编辑，但**改动只在前端内存，刷新就丢**。B-4 把编辑结果**持久化回 `ln.md`**：编辑 → debounce 1500ms → `PATCH /workspaces/{ws}/ln` → 写盘 + bump version。顶栏显示保存状态。

### 后端落点已确认

- `backend/app/routes/export.py` 第 570-598 行是「学习笔记 (ln.md)」区：
  - `@router.get("/{workspace_id}/ln")`（B-1 已加，读 `get_workspace_root(ws)/ln.md`）
  - B-4 在它旁边加 `@router.patch("/{workspace_id}/ln")`。
- version 机制：写盘后在 workspace 的 item.results 里 bump 一个 `ln_version`（整数 +1）。**这是 results JSON 字段，不是 DB schema 迁移**，不触发红线。先 `rg -n "ln_version|results\[" backend/app/routes/export.py backend/app/services` 确认是否已有该字段，没有就新建。

---

## 1. mimo 启动提示词（直接复制到 ccswitch CC 终端）

```
RP1-B · B-4 学习笔记在线编辑 + 自动保存。
实测 URL: http://localhost:5177/workspaces/{有 ln.md 的 ws}/ln

详细规格: docs/plans/result-pages-redesign-v1.md § RP1-B · B-4
本任务计划: docs/plans/rp1-b4-mimo-prompt.md

【任务 1: 后端 PATCH /ln】
  backend/app/routes/export.py 第 570 行「学习笔记」区，在 GET /ln 旁边加：
    @router.patch("/{workspace_id}/ln")
    - body: { markdown: str }
    - 写 get_workspace_root(ws)/ln.md（覆盖写，utf-8）
    - bump version：item.results['ln_version'] = (旧值 or 0) + 1，落盘
      （先 rg 确认 ln_version 是否已存在；workspace item 怎么存 results 看 GET /ln 同文件的写法）
    - 返回 { saved_at: ISO字符串, version: int }
    - 找不到 workspace → 404

【任务 2: 前端 service】
  frontend/src/services/workspaces.ts 加：
    export async function patchLnMarkdown(ws, markdown): Promise<{ saved_at: string; version: number }>
    → http.patch(`/workspaces/${ws}/ln`, { markdown })

【任务 3: index.tsx 自动保存】
  - markdown state 变化 → debounce 1500ms → patchLnMarkdown(ws, markdown)
    （debounce 用现有 util；没有就自写一个 useDebouncedEffect / setTimeout+clear，不要装新依赖）
  - 维护 saveState: 'idle' | 'saving' | 'saved'，记 lastSavedAt
  - 首次加载 setMarkdown 那一次不要触发保存（用 ref 标记 isInitialLoad，跳过第一次）
  - 顶栏（ln-nav 区）显示：'保存中…' / '已保存 HH:MM' / 出错时 '保存失败，重试'

【任务 4: CSS】
  - ln-nav 里加一个 .ln-save-status（var(--ink-4) + var(--mono) 小字），不抢视觉。

【范围限制】
- last-write-wins，不做冲突检测 / 版本对比 / 撤销历史。
- 不碰 LNVideoPanel / LNTranscriptPanel / HtmlView / MdView 的内部逻辑（只在 index 容器接保存）。
- 不做截图（B-5）、不做导出（B-7）。不装新依赖。不留 debug 脚本。

【验证】
- pytest（新写一个：PATCH /ln 写文件成功 + version +1 + 返回体）→ 自己跑过再 commit
- pnpm build + tsc EXIT=0
- 手测：编辑笔记 → 等 1.5s 看到「已保存」→ 刷新页面 → 内容还在
- playwright 归档 2 张: docs/e2e-test/screenshots/rp1b-b4-{saving,saved}.png
- git commit: feat(rp1-b): B-4 学习笔记在线编辑 + 自动保存
  Co-Authored-By: xiaomi-mimo-2.5pro <noreply@xiaomi.com>
- 更新 COMPLETED_WORK + EXECUTION_PLAN（B-3 子条下加 B-4 条）
- 不要 push
```

## 2. 技术参考（mimo 自己 grep）

```bash
# GET /ln 现有写法（PATCH 照它读 workspace + 文件路径的方式反向写）
sed -n '570,600p' backend/app/routes/export.py
# item.results 怎么读写 + 是否已有 version 字段
rg -n "ln_version|update_item|\.results\b" backend/app/routes/export.py backend/app/services/*store*.py
# 前端是否已有 debounce util
rg -rn "debounce|useDebounce" frontend/src/utils frontend/src/hooks 2>/dev/null
```

## 3. 风险预案

| 风险 | 应对 |
|---|---|
| 初始加载触发一次空保存把 ln.md 清空 | 用 isInitialLoad ref 跳过第一次 markdown 变化；或仅在 markdown !== 加载值时保存 |
| HTML 视图 blur 后 turndown 产生噪声，保存了"脏" md | 这是 B-3 同步质量问题，B-4 只负责存；如发现严重噪声记到 COMPLETED_WORK 留给 B-3 复盘 |
| 并发标签页同时编辑 | last-write-wins，本期不处理（写注释说明） |

## 4. 验收清单

- [ ] 后端 PATCH /ln：写盘 + version +1 + 返回 saved_at/version
- [ ] 前端 patchLnMarkdown service
- [ ] debounce 1500ms 自动保存（首次加载不触发）
- [ ] 顶栏保存状态文案
- [ ] 编辑→刷新仍在（实测）
- [ ] pytest 新增并通过 + pnpm build + tsc EXIT=0
- [ ] 不碰 B-2/B-3 组件内部、无新依赖、无 debug 脚本
- [ ] 截图 + COMPLETED_WORK + EXECUTION_PLAN 更新、没 push
