---
phase: RP1-C · C-2 复刻视图 ↔ 学习笔记视图联动切换
status: ready
owner: xiaomi-mimo-2.5pro
parent: docs/plans/result-pages-redesign-v1.md § RP1-C · C-2
companion: docs/plans/rp1-execution-handoff.md § 3.4 提示词 C-2
prerequisite:
  - 复刻页 VideoResultPage + 学习笔记页 LearningNotesPage 都存在
  - B-2 已完工（ln 页 videoPanelRef.seekTo 可用——切回时恢复播放位置要用）
estimated_hours: 2-3
deps_redline: false
decisions:
  - 已决议（result-pages-redesign-v1.md §333-5）：做，先试。三条底线：
    ① 切换后保留视频播放位置 + 当前帧；② 顶栏一个 toggle，不弹窗不二级菜单；
    ③ UI 参考设计稿 storyboard.jsx 的 sb-tabs 形态。
---

## 0. 前置说明（mimo 必读）

同一个 video item 有两个页面视角：**复刻视图**（VideoResultPage，反推提示词）和**学习笔记视图**（LearningNotesPage，图文笔记）。C-2 让用户在两者间一键切换，且**保留视频播放位置**。

### 切换 = 改路由 + 用 URL hash 传播放位置

- 两页路由名先确认：`rg -n "video_detail|VideoResultPage|LearningNotesPage|/ln|path:" frontend/src/router.tsx`
- 机制：toggle 跳转时把当前 `currentSec` 写进 hash `#t=120.5`；目标页 mount 时读 hash → 设视频 currentTime（复刻页直接设 videoRef，ln 页用 B-2 的 videoPanelRef.seekTo）。
- 设计稿 tab 形态：`docs/design/components/storyboard.jsx` 的 `sb-tabs`。

---

## 1. mimo 启动提示词（直接复制到 ccswitch CC 终端）

```
RP1-C · C-2 复刻视图 ↔ 学习笔记视图联动切换。
实测: 同一个 video ws 在 复刻页 / ln 页 间切换

详细规格: docs/plans/result-pages-redesign-v1.md § RP1-C · C-2
本任务计划: docs/plans/rp1-c2-mimo-prompt.md
已决议三底线: 保留播放位置+当前帧 / 顶栏单 toggle / 参考 storyboard.jsx sb-tabs

【任务 0: 确认两页路由名】
  rg -n "element:|path:|VideoResultPage|LearningNotesPage" frontend/src/router.tsx

【任务 1: 顶栏 toggle（两页都加）】
  - 复刻页 VideoResultPage 顶栏 + 学习笔记页 LearningNotesPage 顶栏，各加一个 segmented toggle：
    [复刻视图 | 学习笔记]，当前页对应项 data-active。
  - 样式照 docs/design/components/storyboard.jsx 的 sb-tabs（不弹窗、不二级菜单）。

【任务 2: 切换跳转 + 带播放位置】
  - 点另一视图 → navigate 到目标页路由，hash 带 #t={当前currentSec}（保留 1 位小数）。
  - 复刻页还可带 &f={activeFrame} 保留当前帧（可选）。

【任务 3: 目标页读 hash 恢复】
  - 两页 mount（视频 loadedmetadata 后）读 location.hash 的 t → 设视频 currentTime：
    * 复刻页：videoRef.current.currentTime = t
    * ln 页：videoPanelRef.current?.seekTo(t)（B-2 已暴露）
  - 复刻页若有 f 参数 → setActiveFrame(f)。

【范围限制】
- 只做这两个视图间切换，不引入第三视图、不做弹窗/菜单。
- 不碰提示词/笔记内容逻辑。不装新依赖。不留 debug 脚本。
- 注意：仅当该 item 同时具备复刻数据(frames)和笔记(ln.md)时显示 toggle；只有一种时可隐藏对侧或置灰（按现状决定，记到说明）。

【验证】
- pnpm build + tsc EXIT=0
- 手测两个方向：复刻页播到 02:00 → 切学习笔记 → 视频停在 ~02:00；反向同理 + 当前帧保留
- playwright 归档 2 张: docs/e2e-test/screenshots/rp1c-c2-{toggle,position-kept}.png
- git commit: feat(rp1-c): C-2 复刻↔学习笔记视图联动切换
  Co-Authored-By: xiaomi-mimo-2.5pro <noreply@xiaomi.com>
- 更新 COMPLETED_WORK + EXECUTION_PLAN（加 C-2 条）
- 不要 push
```

## 2. 风险预案

| 风险 | 应对 |
|---|---|
| 路由名假设错（不是 /video_detail） | 任务 0 先确认真实 path |
| hash 在 loadedmetadata 前读取，seek 失败 | 监听 video loadedmetadata 后再设 currentTime；ln 页同理等视频可播 |
| 某 item 只有复刻没笔记（或反之） | toggle 对侧置灰/隐藏，点击空目标时给提示，别跳到空白页 |
| 切换丢失播放/暂停态 | 本期只保位置不保播放态（规格只要求位置+帧），写注释说明 |

## 3. 验收清单

- [ ] 任务 0 确认两页真实路由
- [ ] 两页顶栏 toggle（sb-tabs 风格，单 toggle 无弹窗）
- [ ] 切换带 #t= 播放位置（复刻可带 &f= 帧）
- [ ] 目标页 mount 恢复播放位置（+帧）
- [ ] 只有一种数据时 toggle 优雅降级
- [ ] 双向手测播放位置保留
- [ ] pnpm build + tsc EXIT=0、无新依赖、无 debug 脚本
- [ ] 截图 + COMPLETED_WORK + EXECUTION_PLAN、没 push
