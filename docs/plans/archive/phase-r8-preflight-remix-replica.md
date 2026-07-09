---
name: phase-r8-preflight-remix-replica
status: done
branch: feat/phase-r8-preflight-remix
baseline_commit: 5d81753  # R7.5 之后
owner: ds (claude code + ccswitch deepseek-v4-pro)
created_date: 2026-05-25
completed_date: 2026-05-25
commits: docs + R8.1~R8.7 + follow-up merge blocker fix
---

# Phase R8 — PreflightDrawer 1:1 复刻 Remix 设计稿

## 目标

把 `frontend/src/pages/WorkbenchPage/PreflightDrawer.tsx` 重写成与 `/Users/conan/Downloads/vidmirror (Remix)/components/preflight.jsx` 视觉 + 交互 1:1 对齐。**只动 PreflightDrawer 一个文件**（含相关 CSS / 测试），其它不碰。

## 设计稿真相源

- 视觉/交互：`/Users/conan/Downloads/vidmirror (Remix)/components/preflight.jsx`（510 行）
- 样式 token：`/Users/conan/Downloads/vidmirror (Remix)/styles-preflight.css` 和 `styles.css`
- 业务规则：CLAUDE.md「业务规格与运行时交互契约」+ docs/flows/*.md

## 范围（12 项差距）

按设计稿差距清单 #1-#12 全部补齐。

### 顶层结构

```
.pf-drawer  (520px width)
├── .pf-drawer-head
│   ├── eyebrow "Preflight · 前置配置 · §4"
│   ├── display 标题 "开始解析前"
│   └── mono 来源行：url · platform
├── media-kind-tabs   ← #1 新增
│   └── 4 个 button (video/audio/image/text)，仅 sniffTypes 中的可点；默认高亮第一个
├── .pf-drawer-body
│   ├── PFSection num="01" title="背景信息" sub="Context · 注入到所有 AI 调用"
│   │   ├── PFGrid 2 cols: 内容类型 select | 分析目的 select
│   │   ├── 参与人员 input        ← #3
│   │   ├── 主题背景 input
│   │   └── 专有名词 input        ← #3
│   ├── PFSection num="02" title="模型选择" extra=管理模型按钮
│   │   ├── 文本大模型（保留 R7.1 后的状态，无视觉档）
│   │   └── 视频大模型 select（条件：currentKind===video && summary_path==='视频模型直接分析'）  ← #8
│   └── PFSection num="03" title="任务勾选" sub="Tasks · 已选 N/M · 依赖级联自动锁定"
│       ├── PresetBar (R8 简化版：自定义/标准/极简 三个 chip，不接业务，纯 UI)  ← #7
│       └── PFTaskCard × N（按 currentKind 渲染下列任务组）  ← #4
└── footer
    ├── 左：mono 状态 pill "● 配置已就绪 · N 项分析任务"  ← #12
    └── 右：取消 + 开始分析 / 保存配置 & 返回（保留 R7.4 mode 分支）
```

### 任务组数据（从 preflight.jsx L21-97 抄）

按 `currentKind` 渲染对应 TASK_GROUPS：

- **video**: frame_prompt（截帧模式 radio + 子参数）/ summary（路径 radio + 深度 radio）/ music / srt
- **audio**: asr（语言 radio + 说话人分离 check）/ voiceprint / srt / music（Suno 子项）
- **image**: describe / ocr / prompt（输出格式 radio）/ assoc（联想方向 radio）/ compare
- **text**: summary（长度 radio）/ assoc（方向 radio）/ rewrite（风格 radio）/ translate（目标语言 text）/ multi

数据结构 1:1 复制 Remix 的 `TASK_GROUPS` 常量。

### 级联规则（#5）

按 preflight.jsx L106-143 的 `applyCascades` 函数复制：

1. **video**: `summary.on && summary_path === '音视频合并 · 最详细'` → 强制 `frame_prompt.on = true`，lock reason: "路径 2 复用截帧 · 强制开启"
2. **audio**: `voiceprint.on` → 强制 `asr.on = true`，lock reason: "说话人区分需要先转写"
3. **audio**: `srt.on` → 强制 `asr.on = true`，lock reason: "字幕导出需要转写"
4. **image**: `compare.on && materialCount < 2` → 强制 `compare.on = false`，disabled reason: `仅 ${materialCount} 张图片 · 至少需要 2 张`
5. **text**: `multi.on && materialCount < 2` → 同上

返回 `{ state, locks, disabled }`，UI 上：
- locked 项：边框 `var(--accent)`，pill `依赖锁定` + 锁形 svg
- disabled 项：背景 `var(--bg-sunken)`，opacity 0.55，pill `条件不满足`

`materialCount` 当前从 props 拿（先固定传 1，多素材场景 R9 再处理）。

### 子组件（设计稿已有，直接复制）

- `PFSection({ num, title, sub, extra, children })` — preflight.jsx L341-357
- `PFGrid` — L359-361
- `PFField({ label, hint, children })` — L363-371
- `PFTaskCard({ group, state, setState, lockedReason, disabledReason })` — L373-508
- `PresetBar`（简化版，3 个 chip 切换 activePreset，应用 preset 时把 tasks[kind] 整体 patch；preset 数据自己写一份最简单的，video/audio/image/text 各 1-2 个）

样式：
- 抄 `styles-preflight.css` 里的 `.pf-*` class（如果项目里没有，落到 `workbench.css` 同文件追加 R8 段落）
- 不要新写 hardcoded color/border/radius，全部走 `var(--*)` token

---

## 数据落地（task 参数怎么传后端）

后端 schema **不动**。所有子参数挤进 `savePreflight({ tasks })` 字段：

```ts
tasks: {
  material_type: 'video',        // 多类型时按当前 kind 拆多次调用 savePreflight，保留 R7.2 行为
  enabled_features: ['frame_prompt', 'summary', 'srt'],
  frame_prompt: { enabled: true, frame_mode: 'AI 镜头分析', shot_frames: '3 帧 · 首+中+尾' },
  summary: { enabled: true, summary_path: '音视频合并 · 最详细', summary_depth: '详细' },
  // ... 其它 group
}
```

后端 `task_store` / `task_runner` 当前对未知字段是宽容的（已确认）。R8 只让 UI 把字段传下去；后端真正消费这些字段是 R9 的事。

---

## 子任务切分（DS 按序做，每个独立 commit）

| 子任务 | 描述 | 文件 |
|---|---|---|
| R8.1 | 抽出 `TASK_GROUPS` 常量 + `applyCascades` 工具函数到独立模块 `frontend/src/pages/WorkbenchPage/preflightTasks.ts`；加单测覆盖 4 条级联 | 新建 ts + test |
| R8.2 | 重写 PreflightDrawer body 结构：加 media kind tabs + 编号 PFSection + 补全背景 5 字段 + PresetBar 简化版 | PreflightDrawer.tsx |
| R8.3 | 实现 PFTaskCard 卡片渲染（含 children radio/number/check/text）+ lock/disabled UI | PreflightDrawer.tsx + workbench.css |
| R8.4 | 接级联：`applyCascades` 在 `currentTasks` 之上每次渲染前算，UI 用 effState；setTask 时检查 locks/disabled 阻止非法切换 | PreflightDrawer.tsx |
| R8.5 | footer 改成 mono 状态 pill；提交时把 `tasks[kind]` 序列化进 savePreflight；stage 模式同步回 StagedConfig | PreflightDrawer.tsx |
| R8.6 | 视频大模型 select 条件出现（仅 video + summary_path 路径 3）；保留 R7.1 已删的 vision 状态 | PreflightDrawer.tsx |
| R8.7 | 旧的 "视频分析路径" / "文本处理选项" ad-hoc section 删掉（已被 task card 覆盖）；保留 R7.4 mode='stage' 行为不变 | PreflightDrawer.tsx |

每个子任务做完跑 `pnpm lint && pnpm build && pnpm test --run`，通过再 commit。

---

## 验收

1. 截图 (`scripts/browser_smoke.py --screenshot`) 对比 Remix preflight.jsx 渲染效果：编号 section、tab、卡片、lock pill 全部对上
2. 手测 4 条级联：
   - video 选路径 2 → frame_prompt 自动锁亮
   - audio 勾 voiceprint → asr 自动锁亮
   - audio 勾 srt → asr 自动锁亮
   - image 1 张时 compare 灰；2 张时可勾
3. stage 模式：保存配置 & 返回 → modal 重开 → 一键解析 → 提交的 payload 里 tasks 字段带着所有子参数
4. execute 模式：从任务详情打开 → 开始解析直接走原 startItemPipeline，不受影响

---

## 禁止事项

- ❌ 不改 `AddMaterialModal.tsx` / `Composer.tsx` / `Hero.tsx`
- ❌ 不动后端 schema / Pydantic model
- ❌ 不写 hardcoded hex / px / border，全走 token
- ❌ 不顺手 refactor 其它 ad-hoc UI 文件（按 CLAUDE.md「不要主动重构无关代码」）
- ❌ 不 push 远端
- ❌ 实现完不要自动 merge，停下来问用户

---

## 收尾

7 个 R8 commit 已完成，并补了 merge 前阻塞修复：
1. stage 模式回写 R8 tasks/models，避免细调参数丢失。
2. execute / modal 一键解析保存同一份 R8 tasks payload。
3. 移除 PreflightDrawer 视觉大模型残留，路径 3 视频大模型写入 `models.video`。
4. 全套验证见 `docs/COMPLETED_WORK.md` 的 R7/R8 记录。
