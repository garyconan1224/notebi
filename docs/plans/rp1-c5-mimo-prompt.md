---
phase: RP1-C · C-5 视频复刻页小修汇总（改名 / 重试 / 标签）
status: done
completed_date: 2026-05-31
owner: xiaomi-mimo-2.5pro
parent: docs/plans/result-pages-redesign-v1.md § RP1-C · C-5
companion: docs/plans/rp1-execution-handoff.md § 3.4 提示词 C-5
prerequisite:
  - 复刻页 VideoResultPage 存在；建议作为 RP1-C 收尾
estimated_hours: 2-3
deps_redline: false
note: 三项里"标签展示"疑似已实现，启动先核对，避免重做。
---

## 0. 前置说明（mimo 必读）

C-5 是复刻页三个小修，**不是一个大功能**。逐项先核对现状再动手：

1. **帧标题改名**：大图旁帧标题（如"霓虹巷子氛围"）inline 可改。
2. **失败帧「重试」按钮接通后端**：规格说现在是 stub，要接真实重试端点。**先确认重试端点是否存在**（`rg -n "retry|重试|regenerate|reproduce" backend/app/routes/*.py`）；不存在则补最小端点。
3. **帧标签（SPEC 4.2.5 七维度自动打标）显示在帧卡片底部** —— **疑似已实现**：VideoResultPage 已有 `frame.tags` 的渲染（`Object.values(frame.tags ?? {}).flat()...`，class 类似 `vd-fi-tags`）。**启动先核对是否已展示，已做就跳过此项或只补样式**，别重复造。

> **scope exception**：失败帧「重试」未做（缺 frame status 机制），转 backlog；本期交付 = 帧标题改名 + 标签展示（原已有）。

---

## 1. mimo 启动提示词（直接复制到 ccswitch CC 终端）

```
RP1-C · C-5 复刻页小修（改名 / 重试 / 标签）。
实测 URL: http://localhost:5177/workspaces/{勾画面提示词的视频 ws}/{复刻页路由}

详细规格: docs/plans/result-pages-redesign-v1.md § RP1-C · C-5
本任务计划: docs/plans/rp1-c5-mimo-prompt.md（必读 §0：标签疑似已做、重试端点先确认）

【任务 0: 三项各自核对现状】
  rg -n "frame.tags|vd-fi-tags|title|retry|重试|regenerate" frontend/src/pages/result/VideoResultPage.tsx
  rg -n "retry|regenerate|reproduce|frames.*retry" backend/app/routes/*.py
  → 确认：标签是否已展示（多半已有）；重试端点是否存在；帧标题怎么存。

【任务 1: 帧标题改名】
  - 大图旁标题加 inline edit（点击/✎ → input → 保存）。
  - 保存到帧数据：找现有保存帧的端点（如 saveInlineFrames 或帧 PATCH），rg 确认；没有就补最小 PATCH。

【任务 2: 失败帧重试接通】
  - 失败帧（status 标识，rg 确认字段）显示「重试」按钮。
  - 接后端重试端点；不存在则在复刻相关 router 补 POST .../frames/{i}/retry（触发该帧重新生成提示词）。
  - 重试中 loading，成功刷新该帧。

【任务 3: 标签展示（先核对）】
  - 若 frame.tags 已展示 → 此项跳过（在 COMPLETED_WORK 注明"已存在"），最多微调样式对齐设计稿。
  - 若没展示 → 帧卡片底部渲染 tags（7 维度，每维取代表标签，chip 形态）。

【范围限制】
- 三项都是小修，能复用就复用，不重构复刻页。
- 不碰 C-1 布局 / C-3 批量 / C-4 版本。不接生成 API。不装新依赖。不留 debug 脚本。

【验证】
- 若动后端：pytest 相关用例自己跑过。
- pnpm build + tsc EXIT=0
- 手测：改帧名→刷新仍在；失败帧重试有反馈；标签底部可见
- playwright 归档 2 张: docs/e2e-test/screenshots/rp1c-c5-{rename,tags}.png
- git commit: feat(rp1-c): C-5 复刻页小修（改名/重试/标签）
  Co-Authored-By: xiaomi-mimo-2.5pro <noreply@xiaomi.com>
- 更新 COMPLETED_WORK + EXECUTION_PLAN（加 C-5 条 → 此条完成后 RP1-C 主行可打勾）
- 不要 push
```

## 2. 风险预案

| 风险 | 应对 |
|---|---|
| 标签已实现却重复做 | 任务 0 先核对 frame.tags 渲染，已有就跳过，避免无谓改动 |
| 重试端点不存在 | 补最小 POST retry；若重试涉及 LLM 配额，按现有生成流程调用，单帧失败不阻塞 |
| 帧标题没有持久化端点 | 找现有帧保存机制复用；确实没有再补最小 PATCH，别新建大套数据流 |
| 三项混在一个 commit 颗粒太粗 | 三项同属"小修"可一个 commit；若某项明显独立可拆，但别过度拆 |

## 3. 验收清单

- [ ] 任务 0 三项现状核对（标签是否已做 / 重试端点 / 标题存法）
- [ ] 帧标题 inline 改名 + 持久化
- [ ] 失败帧重试接通（端点存在则接，否则补最小端点）
- [ ] 标签底部展示（已实现则注明跳过/微调）
- [ ] 不重构、不接生成 API、无新依赖、无 debug 脚本
- [ ] pnpm build + tsc（+ pytest 若动后端）EXIT=0
- [ ] 截图 + COMPLETED_WORK + EXECUTION_PLAN（RP1-C 主行此条后打勾）、没 push
```
