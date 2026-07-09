---
phase: RP1-C · C-1 视频复刻页主帧大视图 + 缩略图轨道
status: done
owner: xiaomi-mimo-2.5pro
parent: docs/plans/result-pages-redesign-v1.md § RP1-C · C-1
companion: docs/plans/rp1-execution-handoff.md § 3.4 提示词 C-1
prerequisite:
  - 视频复刻页 VideoResultPage.tsx 已存在且成熟（帧数据 / activeFrame / jumpFrame / 提示词 tab 都有）
estimated_hours: 4-5
deps_redline: false   # lightbox 原生自写，不引库
---

## 0. 前置说明（mimo 必读）

C-1 重构视频复刻页 `frontend/src/pages/result/VideoResultPage.tsx`（1002 行）的**布局**：从"视频播放器为主 + 帧信息 overlay"改成"**主帧大图为主 + 缩略图轨道 + 视频次要**"。

### 现状（启动时先读关键段确认，别照本文件想当然）

数据层**已就绪，不用动**：
- `frames = result.frames`、`activeFrame = nearestFrameIdx(frames, currentSec)`（约 214 行）、`frame = frames[activeFrame]`
- 键盘帧切换 `jumpFrame(delta)`（约 415 行）、`seekTo`（约 303 行）
- 当前渲染（约 665+ 行）：`vd-left` / `vd-player-wrap` / `vd-player` / `<video>` / `vd-overlay`（显示 frame.ts / shot_type / title）

当前**没有**：缩略图轨道、主帧大图、lightbox。这就是 C-1 要加的。

```
布局目标（规格草图）：
┌ 主帧大图 ~400×300（frames[activeFrame].image_path，点击 lightbox 放大）┐
├ 缩略图轨道（80×60 一张，跟随 activeFrame 高亮，点击切帧+seek）  ┤
└ 视频播放器（缩小，移到次要位置）                               ┘
```

---

## 1. mimo 启动提示词（直接复制到 ccswitch CC 终端）

```
RP1-C · C-1 视频复刻页主帧大视图 + 缩略图轨道。
实测 URL: http://localhost:5177/workspaces/{勾了画面提示词的视频 ws}/{复刻页路由}

详细规格: docs/plans/result-pages-redesign-v1.md § RP1-C · C-1（含布局草图）
本任务计划: docs/plans/rp1-c1-mimo-prompt.md

【任务 0: 先读现状】
  sed -n '660,820p' frontend/src/pages/result/VideoResultPage.tsx  # 看 vd-left / vd-player / vd-overlay 现布局
  确认 frame 字段：rg -n "VideoResultFrame" frontend/src/services/workspaces.ts（url/ts/shot_type/title/tags）

【任务 1: 主帧大图】
  - 左侧主区显示 frames[activeFrame] 的大图（~400×300，object-fit contain，圆角 var(--radius-sm)）。
  - 点击 → lightbox 全屏遮罩查看（自写：fixed 遮罩 + 居中大图 + Esc/点遮罩关闭，不引库）。
  - 大图旁保留 frame 信息（ts / shot_type / title），即现有 vd-overlay 内容挪过来。

【任务 2: 缩略图轨道】
  - 主图下方横向滚动轨道，每帧 80×60 缩略图。
  - data-active={i === activeFrame} 高亮；点击 → seekTo(frame.sec)（activeFrame 由 currentSec 派生，不新增 setActiveFrame）。
  - activeFrame 变化时 scrollIntoView({inline:'center'}) 让当前缩略图居中。

【任务 3: 视频次要化】
  - 现有 vd-player 缩小，移到次要位置（如主图上方小窗 或 轨道下方），保留播放/暂停能力。
  - 播放时 activeFrame 仍随 currentSec 派生（现有逻辑不动），主图跟着换。

【任务 4: CSS】
  - .vd-main-frame / .vd-lightbox / .vd-thumb-track / .vd-thumb[data-active]，全 nibi token，light/dark。

【范围限制】
- 只重构布局，不动数据加载 / 提示词 tab / 版本栈 / 收藏 逻辑。
- 不做帧批量操作（C-3）、不做联动 toggle（C-2）、不做改名/重试（C-5）。
- 不引 lightbox 库、不装新依赖。不留 debug 脚本。
- 注意复刻页可能有 learning / replica 两个 intent 分支（isLearning），确认改的是复刻（replica）分支，别误改学习分支。

【验证】
- pnpm build + tsc EXIT=0
- 手测：主图随播放/点缩略图切换；缩略图高亮跟随并居中；点主图开/关 lightbox
- playwright 归档 3 张: docs/e2e-test/screenshots/rp1c-c1-{main-frame,thumb-track,lightbox}.png
- git commit: feat(rp1-c): C-1 复刻页主帧大视图 + 缩略图轨道
  Co-Authored-By: xiaomi-mimo-2.5pro <noreply@xiaomi.com>
- 更新 COMPLETED_WORK + EXECUTION_PLAN（加 RP1-C / C-1 条）
- 不要 push
```

## 2. 风险预案

| 风险 | 应对 |
|---|---|
| 误改 learning intent 分支 | 先确认 isLearning 两个 return 分支，C-1 只改复刻（replica）那个 |
| 帧无 url / 加载失败 | 缩略图/主图加 onError 占位；frames 为空走复刻页空态（依赖"勾画面提示词"，未勾显示引导） |
| 缩略图多导致轨道卡 | 轨道用横向 overflow + 懒加载 loading="lazy"，不一次性全渲染大图 |
| 布局重构碰坏提示词面板 | 提示词区/版本栈是右侧独立区，C-1 不动它，只重排左侧 |

## 3. 验收清单

- [ ] 任务 0 读懂现状（vd-left/player/overlay + frame 字段）
- [ ] 主帧大图 + lightbox（自写，Esc/点遮罩关）
- [ ] 缩略图轨道（高亮跟随 + 居中 + 点击切帧 seek）
- [ ] 视频次要化、activeFrame 派生逻辑不变
- [ ] 只改 replica 分支、未碰提示词/版本/收藏
- [ ] pnpm build + tsc EXIT=0、无新依赖、无 debug 脚本
- [ ] 截图 + COMPLETED_WORK + EXECUTION_PLAN、没 push
