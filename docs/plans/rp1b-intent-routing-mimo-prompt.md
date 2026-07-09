---
phase: RP1-B+ · 方案 B —— 按 intent 分流入口 + 学习/复刻顶栏 toggle
status: ready
owner: xiaomi-mimo-2.5pro
parent: docs/plans/result-pages-redesign-v1.md § RP1-C · C-2（本方案整合并取代原 C-2 toggle）
supersedes: docs/plans/rp1-c2-mimo-prompt.md（C-2 的 toggle 并入这里，按 intent 默认落地页）
companion: 记忆 project_rp1b_data_source_gap
estimated_hours: 3-4
deps_redline: false
decisions:
  - 2026-05-31 用户拍板方案 B（调研竞品后定）：总结(md)归 /ln、复刻提示词归 video_detail，按 intent 分默认入口 + 顶栏 toggle 互切。不在 video_detail 重复造总结视图。
---

## 0. 背景（mimo 必读）

视频复刻页 video_detail 现在**所有视频都直接进**（router.tsx:71 + :96 旧 /result 重定向），不看 intent。导致 `intent=learning` + `summary_path=av_combined`（文案总结·路径2）的视频也掉进**复刻提示词布局**——右栏全是逐帧 MJ/SD 提示词、密密麻麻，而它本该看的 **md 总结**（图文分镜）没有入口。

**md 总结视图已经存在**：阶段 1+2 后 `/ln`（LearningNotesPage）已接入图文分镜 md。所以**不要在 video_detail 重复造总结视图**，而是按用途分流：

- **学习（消费）= `/ln`**（md 总结，已就绪）
- **复刻（生产）= `video_detail`**（图片提示词，保持现状）
- 两页顶栏 toggle 互切，learning 视频默认落 `/ln`，replica 默认落 `video_detail`

竞品依据：视频 AI 笔记类（tl;dv / 通义听悟 / 飞书妙记）一律「总结默认主位」；一个对象两种用途用「顶部模式切换」（Figma/Notion 式），不堆一屏。

## 1. 方案要素

1. **入口按 intent 分流**：视频 item「打开」时，`intent==='learning'` → 去 `/ln`；否则（replica/空）→ 去 `video_detail`。
2. **两页顶栏 toggle**：`[学习笔记 | 复刻]` segmented，当前页高亮，点另一个切过去。
3. **video_detail 复刻布局不动**（只加 toggle）。

## 2. mimo 启动提示词（直接复制）

```
RP1-B+ 方案 B：按 intent 分流入口 + 学习/复刻顶栏 toggle。
背景必读: docs/plans/rp1b-intent-routing-mimo-prompt.md §0
实测:
  learning 视频(应进 /ln): ws 484d8bb6-7424-4ba9-9e2a-7889e04df667 / item 1fcfdb4b-9cee-46b1-823c-5631953dcdee（intent=learning, av_combined）
  /ln 已就绪 ws: 0243af4c-3fec-4e2e-a214-f4dbd31d804b

【任务 0: 定位所有"打开视频 item"的跳转点】
  rg -rn "video_detail|items/\$\{.*\}/result|/result\b" frontend/src --glob '*.tsx' | grep -iE "navigate|to=|Link|push|href"
  常见处：TaskboardPage 素材卡片 / ResultsOverview / 结果卡片的"打开/查看"按钮。
  确认它们怎么决定跳 video_detail（多半写死）。

【任务 1: 入口按 intent 分流】
  每个"打开视频 item"的跳转改为按 item.intent（WorkspaceItem.intent 直接可得，types/workspace.ts:104）：
    - intent === 'learning' → navigate(`/workspaces/${ws}/ln`)
    - 否则（replica / 空 / 其它）→ navigate(`/workspaces/${ws}/items/${itemId}/video_detail`)
  抽一个小 helper 避免多处重复，如 resolveVideoItemRoute(ws, item) → string。
  router.tsx:96 旧 /result 静态重定向：若仍有人用，也改成按 intent（或留着，因新入口不再走它）。

【任务 2: 两页顶栏 toggle（[学习笔记 | 复刻]）】
  - LearningNotesPage（/ln）顶栏 ln-nav 加 toggle；它已 find 到 video item（pageState.videoItem.item_id），
    切「复刻」→ navigate(`/workspaces/${ws}/items/${videoItem.item_id}/video_detail`)。
  - VideoResultPage（video_detail）顶栏 vd-nav 加 toggle；
    切「学习笔记」→ navigate(`/workspaces/${ws}/ln`)。
  - 样式参考设计稿 storyboard.jsx 的 sb-tabs（segmented，不弹窗）；当前页对应项 data-active。
  - 注意路由结构差异：/ln 是 ws 级（无 itemId），video_detail 是 item 级——上面已用 videoItem.item_id 解决。

【任务 3: toggle 的可用性（优雅降级）】
  - 一个 ws 可能只有总结(无复刻帧) 或 只有复刻(无 ln/图文分镜)。
  - 切过去若目标页无数据，对应页本就有空态（/ln 的 404 引导 / video_detail 的空态），不另做。
  - 可选：目标侧无数据时 toggle 那一项置灰 + tooltip。时间紧可跳过，先保证切换能用。

【范围】
- 不动 video_detail 复刻布局内部（帧/提示词/版本栈）、不动 /ln 笔记功能。
- 不在 video_detail 重复实现 md 总结视图（这正是方案 B 要避免的）。
- 不装新依赖。不留 debug 脚本。

【验证】
- pnpm build + tsc EXIT=0
- 手测：
  * learning 视频(484d8bb6…)「打开」→ 进 /ln 看 md 总结（不再是复刻提示词布局）
  * /ln 顶栏点「复刻」→ 切到 video_detail（同 item）；video_detail 点「学习笔记」→ 切回 /ln
  * replica/普通视频「打开」→ 仍进 video_detail
- playwright 归档 2 张: docs/e2e-test/screenshots/rp1b-intent-{ln-default,toggle}.png
- git commit: feat(rp1-b+): 按 intent 分流入口 + 学习/复刻顶栏 toggle（方案B/整合C-2）
  Co-Authored-By: xiaomi-mimo-2.5pro <noreply@xiaomi.com>
- 更新 COMPLETED_WORK + EXECUTION_PLAN（C-2 可打勾，注明并入方案B）；不 push
```

## 3. 技术参考

```bash
# intent 字段（入口分流用，无需加载 result）
rg -n "intent" frontend/src/types/workspace.ts
# 路由定义（/ln ws 级、video_detail item 级）
sed -n '70,98p' frontend/src/router.tsx
# LearningNotesPage 怎么拿 video item（toggle 切 video_detail 要 itemId）
rg -n "videoItem|item_id|find.*video" frontend/src/pages/results/LearningNotesPage/index.tsx
# storyboard sb-tabs 样式参考
rg -n "sb-tabs" docs/design/components/storyboard.jsx
```

## 4. 验收清单

- [ ] 入口分流 helper：learning→/ln，其它→video_detail（覆盖所有打开视频的跳转点）
- [ ] /ln 顶栏 toggle → 切 video_detail（用 videoItem.item_id）
- [ ] video_detail 顶栏 toggle → 切 /ln
- [ ] learning 视频实测默认进 /ln；replica 仍进 video_detail；双向 toggle 通
- [ ] 不重复造总结视图、不动两页内部功能、无新依赖
- [ ] pnpm build + tsc EXIT=0；截图 + COMPLETED_WORK + EXECUTION_PLAN；不 push
```
