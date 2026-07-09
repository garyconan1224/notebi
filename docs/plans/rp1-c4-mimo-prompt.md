---
phase: RP1-C · C-4 帧提示词在线编辑 + 版本管理
status: ready
owner: xiaomi-mimo-2.5pro
parent: docs/plans/result-pages-redesign-v1.md § RP1-C · C-4
companion: docs/plans/rp1-execution-handoff.md § 3.4 提示词 C-4
prerequisite:
  - 复刻页 VideoResultPage + PromptVersionStack 组件存在
estimated_hours: 2-3
deps_redline: false
---

## 0. 前置说明（mimo 必读）

C-4 让用户在线改帧提示词，保存即生成新版本。**版本机制后端 + 前端组件都已存在**，C-4 主要是补 inline editor 入口接上它。

### 现状（已确认 + 一个必须先查清的不确定点）

- 前端 `frontend/src/components/result/PromptVersionStack.tsx`（243 行）已有：版本列表、diff 对比两版、添加版本（`onAddVersion`）。
- 前端 service 已有 `POST /workspaces/{id}/items/{itemId}/prompts/versions`（约 578 行，追加提示词版本）；类型 `PromptVersion`、字段 `prompt_versions`。
- **必须先查清的不确定点**：提示词版本是 **item 级**（整个视频一套）还是 **frame 级**（每帧独立）？
  VideoResultPage 里 item 级有 `promptVersions`，frame 级有 `prompt_mj/prompt_sd/prompt_video`。
  C-4 规格说"每帧提示词右上角改 → 新版本"。**启动时先确认数据结构，决定版本挂在 item 还是 frame**：
  `rg -n "prompts/versions|prompt_versions|PromptVersion|frames.*prompt" backend/app/routes/*.py frontend/src/services/workspaces.ts`

---

## 1. mimo 启动提示词（直接复制到 ccswitch CC 终端）

```
RP1-C · C-4 帧提示词在线编辑 + 版本管理。
实测 URL: http://localhost:5177/workspaces/{勾画面提示词的视频 ws}/{复刻页路由}

详细规格: docs/plans/result-pages-redesign-v1.md § RP1-C · C-4
本任务计划: docs/plans/rp1-c4-mimo-prompt.md（必读 §0 那个"版本挂 item 还是 frame"的不确定点）

【任务 0: 查清版本数据结构（决定怎么接）】
  rg -n "prompts/versions|prompt_versions|PromptVersion|to_dict" backend/app/routes/workspaces.py backend/app/routes/prompt_formats.py
  确认：版本是 item 级还是 frame 级；POST /prompts/versions 的 body 结构；后端有没有现成的"按帧"版本字段。
  → 若现有机制是 item 级而规格要 frame 级：用最小改动支持（如 body 带 frame_index），不重构。

【任务 1: 每帧提示词 inline editor】
  - 当前帧提示词区右上角加「✎ 改」→ 点开变成可编辑 textarea（预填当前提示词）。
  - 「保存」→ 调追加版本接口（按任务 0 结论：item 级或带 frame_index）→ 成功后刷新版本栈。
  - 「取消」还原。

【任务 2: 版本切换】
  - 复用 PromptVersionStack：保存后新版本进栈，dropdown/列表切换 → 切换显示的提示词。
  - 当前帧切换时版本栈对应更新（若 frame 级）。

【范围限制】
- 复用现有 PromptVersionStack + prompts/versions，不重写版本机制。
- 不做 A/B 提示词对比（明确不做，属 AI 导演）、不接生成 API。
- 不碰 C-1 布局 / C-3 批量 / C-5 小修。不装新依赖。不留 debug 脚本。

【验证】
- pytest（若动后端：追加版本写入 + 读取）→ 自己跑过
- pnpm build + tsc EXIT=0
- 手测：改某帧提示词 → 保存 → 版本栈多一版 → 切回旧版显示旧文 → 刷新仍在
- playwright 归档 2 张: docs/e2e-test/screenshots/rp1c-c4-{edit,version-switch}.png
- git commit: feat(rp1-c): C-4 帧提示词在线编辑 + 版本
  Co-Authored-By: xiaomi-mimo-2.5pro <noreply@xiaomi.com>
- 更新 COMPLETED_WORK + EXECUTION_PLAN（加 C-4 条）
- 不要 push
```

## 2. 风险预案

| 风险 | 应对 |
|---|---|
| 版本 item 级 vs frame 级不明 | 任务 0 必须先查清；按现实接，规格与现实冲突时按"§4 风险求证"停下问用户 |
| 现有 PromptVersionStack 的 onAddVersion 签名不匹配 | 读组件 props 适配，别改组件内部契约 |
| 编辑中切换帧丢未保存内容 | 切帧前提示"未保存"或自动取消编辑态 |

## 3. 验收清单

- [ ] 任务 0 查清版本层级（item / frame）+ 接口 body
- [ ] 帧提示词 inline editor（改/存/取消）
- [ ] 保存 = 新版本，进 PromptVersionStack
- [ ] 版本切换显示对应提示词、刷新持久
- [ ] 复用现有机制未重写、无新依赖、无 debug 脚本
- [ ] pnpm build + tsc（+ pytest 若动后端）EXIT=0
- [ ] 截图 + COMPLETED_WORK + EXECUTION_PLAN、没 push
```
