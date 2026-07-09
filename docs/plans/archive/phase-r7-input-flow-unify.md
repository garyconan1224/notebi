---
name: phase-r7-input-flow-unify
status: done
branch: feat/phase-r7-input-flow-unify
baseline_commit: e79a384
owner: ds (claude code + ccswitch deepseek-v4-pro)
created_date: 2026-05-25
completed_date: 2026-05-25
commits: docs + R7.1~R7.5, merged via feat/phase-r8-preflight-remix
---

# Phase R7 — 输入流统一 + 1:1 复刻收尾

## 背景

上次 claude design 会话只做完了 4 项需求的开头（已合入 baseline commit `e79a384`）。本 phase 把剩余 4 项做完，并把首页和 modal 的视觉/语义对齐到设计稿 `/Users/conan/Downloads/vidmirror (Remix)/components/workbench.jsx`。

**重要现状**（DS 开工前必读）：
- `Hero.tsx` 与 `workbench.jsx` L83-99 已 1:1 对齐 — **不要重写**
- `Composer.tsx` (387 行) 与 `workbench.jsx` L100-205 已对齐 — **不要重写整体结构**
- `AddMaterialModal.tsx` (692 行) 已**没有 ⑤ 模型选择 section** — option (b) 实际已生效，R7.1 只需扫尾
- 真正缺的是 R7.4（统一 execute 出口）和 R7.3 / R7.2 的语义细节

## 子任务

每个子任务做完跑一次 `cd frontend && pnpm lint && pnpm build`，通过后单独 commit。

---

### R7.1 — 删除视觉大模型残留

**范围**：
```bash
grep -rn "视觉大模型\|visual_model\|visualModel" frontend/src backend/app
```
- 找到任何残留就删
- `AddMaterialModal.tsx` 我已确认无 ⑤ section，跳过
- `PreflightDrawer.tsx` / `PreflightConfigPanel.tsx` 模型档位列若仍有 `视觉`，删该列
- 后端 `savePreflight` 的 `models` payload 若带 `visual` key，前端不再传；后端字段保留兼容（不删 schema）

**验收**：grep 无残留；`pnpm build` 通过。

**commit**：`feat(phase-r7): R7.1 删除视觉大模型残留档位`

---

### R7.2 — 单 URL 多类型默认全勾

**文件**：`frontend/src/components/workspace/AddMaterialModal.tsx`

**改动**：
- `resolveInitialTypes` (L72-83)：当 `sniffResult.possible_types.length > 1` 时返回**全部** possible types，不再只用第一个
- `toggleType` 行为保持不变（仍允许在 sniffTypes 范围内增减）
- 注意 ③ 分析任务 section 已经按 `selectedTypes.map` 渲染 — 多类型时会自动展开多组 chip，无需改

**验收**：新增 vitest 用例（写在 `frontend/src/__tests__/AddMaterialModal.test.tsx`，没有就新建）：
- 传 `sniffResult={possible_types:['image','text'], ...}` → 断言 `selectedTypes.length===2` 且 ③ section 渲染两个类型标题

**commit**：`feat(phase-r7): R7.2 单 URL 多类型 sniff 默认全勾`

---

### R7.3 — Composer 传入 URL 时 modal 不再重复输入框

**文件**：`AddMaterialModal.tsx` ② 输入源 section (L418-453)

**改动**：
- 当 `urlValue` 由 props 传入（即从 Composer 走过来），把 ② section 简化为一行只读 chip：
  - 保留 `composer-url` 容器维持视觉节奏
  - 只显示 platform icon + url + 一个 `Composer 传入` kw
  - 去掉下方 `modal-kw-row` 三个 kw 提示（`支持网络链接` / `本地版无大小限制` / `已识别`）
- 当 `urlValue` 未传（独立打开 modal 的兜底场景）保持现状

**验收**：跑 `scripts/browser_smoke.py`：从工作台输 URL → 点添加素材 → 截图确认 ② section 只有一行 chip，没有 input 和提示 kw 行。

**commit**：`feat(phase-r7): R7.3 Composer 已传 URL 时 modal 不再显示输入框`

---

### R7.4 — 统一解析出口（细调回写而非 execute）⭐ 核心

**用户已决议**：保留两个入口按上下文切换。
- **入口 A（从 AddMaterialModal 进细调）**：抽屉「开始分析」→ 改成「保存配置 & 返回」→ 回写 staged → 关抽屉 → 重开 AddMaterialModal（带入参数）→ 用户点「一键解析」才真正 execute
- **入口 B（从任务详情/重跑场景进细调）**：保留「开始分析」直接 execute 的能力

**实现方式 — 用一个 prop 控制行为**：

#### Step 1: `PreflightDrawer.tsx`
- 新增 prop：`mode?: 'execute' | 'stage'`（默认 `'execute'` 维持向后兼容）
- 新增 prop：`onSaveStaged?: (staged: StagedConfig) => void`
- 主按钮文案与 onClick 根据 mode 切换：
  - `mode === 'execute'`：保留现在的 savePreflight + startItemPipeline + navigate 路径
  - `mode === 'stage'`：按钮文案 `保存配置 & 返回`，onClick 收集当前抽屉所有字段成 `StagedConfig` → 调 `onSaveStaged(staged)` → 不动后端，不 navigate

#### Step 2: `Composer.tsx`
- 在 `<PreflightDrawer>` 传入 `mode="stage"` 和：
  ```ts
  onSaveStaged={(staged) => {
    setPreflightStaged(staged)
    setPreflightOpen(false)
    setUploadOpen(true)  // 重开 modal
  }}
  ```
- 删 / 改 Composer 当前 `<PreflightDrawer>` 的 `onCreated` 分支（stage 模式不再触发 onCreated；保留 prop 给入口 B 用）

#### Step 3: `AddMaterialModal.tsx`
- 新增 prop：`initialStaged?: StagedConfig`
- open 时如果有 `initialStaged`，用它覆盖 `selectedTypes` / `features` / `bgOverrides`（替换 L138-149 reset effect 中的初值）
- Composer 把 `preflightStaged` 透传为 `initialStaged`

#### Step 4: 入口 B 验证
- 任务详情页 / 重跑场景调用 `<PreflightDrawer>` 处**不传 mode**（用默认 `'execute'`），行为不变
- grep 一下 `<PreflightDrawer` 所有调用点：
  ```bash
  grep -rn "PreflightDrawer" frontend/src
  ```
- 确认除 Composer 外的调用点不破坏

**验收**：
- 单测：`frontend/src/__tests__/PreflightDrawer.test.tsx` 已存在，加 1 条 `mode="stage"` case 断言 onClick 不调 startItemPipeline 而是调 onSaveStaged
- 手测链路：Composer → 添加素材 → 细调 → 改任意字段 → 保存配置 & 返回 → modal 重开且参数生效 → 一键解析 → 任务创建成功
- 入口 B 链路（任务详情打开 PreflightDrawer）保持原有 execute 行为

**commit**：`feat(phase-r7): R7.4 PreflightDrawer 增加 stage 模式，统一 execute 出口到一键解析`

---

### R7.5 — Hero 文案精简

**文件**：`frontend/src/pages/WorkbenchPage/Hero.tsx`

**改动**：把 L31-34 长 lede 改成一句话：
```tsx
<p className="lede">
  粘贴链接或拖入文件 — VidMirror 自动识别类型并提取创作蓝图。
</p>
```
其余（`hero-eyebrow` / `display` 标题）保持不变。

**验收**：截图前后对比；不破坏排版（display 标题不应因 lede 缩短而上跳过多）。

**commit**：`feat(phase-r7): R7.5 Hero lede 精简为一句话`

---

## 收尾

5 个 commit 已完成。本阶段随 R8 分支一起收口并等待本地 merge 授权。

验证记录：
1. `cd frontend && pnpm test --run` 通过。
2. `cd frontend && pnpm build` 通过。
3. `.venv/bin/python -m pytest tests/backend -q` 通过。
4. `pnpm lint` 仍被项目存量 baseline 拦截；R7/R8 改动文件已单独排查。

## 禁止事项

- ❌ 不要重写 `Hero.tsx` / `Composer.tsx` / `workbench.css` 整体结构（已 1:1 对齐设计稿）
- ❌ 不要顺手 refactor PreflightDrawer 其它逻辑，只动按钮 onClick 与 mode 分支
- ❌ 不要删后端 `models.visual` 兼容字段
- ❌ 不要动 `.env` / 端口 / CORS
- ❌ 不要 `git push`（CLAUDE.md 明令暂缓所有 push 到 [D] 阶段）
