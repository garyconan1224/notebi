---
phase: RP1-A 四迭 · UI 全面修整 · mimo 启动提示词
status: done
owner: xiaomi-mimo-2.5pro
parent: docs/plans/result-pages-redesign-v1.md § RP1-A
user_source: 2026-05-30 用户在真实数据下提的 4 个 UI 反馈（空 tab 隐藏 / 总结 UI 不行 / Overview 隐藏太多 / 音频时间轴不对）
合并: 同时处理 docs/plans/rp1-a-realdata-mimo-prompt.md 里未做的 2 个项（空 tab + 总结 500 友好报错）
---

## mimo 启动提示词（直接复制到 ccswitch CC 终端）

```
RP1-A 四迭：4 个 UI 反馈一次性修。
真实数据测试 URL（实测用这个）:
  http://localhost:5177/workspaces/c3c63485-3ab5-479d-842b-524aa39824ba/items/989c3520-5a52-467d-83af-4ccba1c56ceb/overview
  http://localhost:5177/workspaces/c3c63485-3ab5-479d-842b-524aa39824ba/items/989c3520-5a52-467d-83af-4ccba1c56ceb/audio_detail

【任务 1: audio_detail 空 tab 隐藏 + 总结 500 友好报错】
文件: frontend/src/pages/result/AudioResultPage.tsx + frontend/src/components/SummariesTab.tsx
做法见 docs/plans/rp1-a-realdata-mimo-prompt.md（核心：
  - tab 数组改 useMemo 按数据条件 filter，规则:
    transcript: result.transcript_segments?.length > 0 → 显示
    summary: 总是显示
    music: result.music_segments?.length > 0 || result.music_mode === true → 显示
    vocal: result.vocal_url || result.vocal_separation → 显示
    music_transcribe: result.music_transcription → 显示
    prompts: result.prompts → 显示
  - activeTab 默认 fallback 到过滤后第一个 tab
  - SummariesTab createSummary catch error.response.data.detail，含"chat model" → toast "请去设置配 LLM model" + "去设置"按钮 → navigate('/settings/models')

【任务 2: 总结 tab UI 重设计】
文件: frontend/src/components/SummariesTab.tsx + summaries-tab.css
当前问题: 空态时左侧"+ 新建"+模板按钮列+右侧大空白，没引导，模板按钮挤一行不直观
改成:
  - 空态时不要左右分栏，居中一个大引导卡片:
    标题: "生成一份内容总结"
    副标题: "选一个模板，AI 帮你把转录文本整理成可读笔记"
    模板选择: 4 大常用模板做成大卡片 grid 2x2（精简/详细/小红书/公众号），每张卡片含图标+模板名+一句话描述
    "+ 更多模板" 链接展开显示其余 5 个
    背景信息: textarea 占满下方
    底部右侧: "生成" 按钮（粉色 var(--accent-pink)）
  - 有总结时:
    左侧列表保留（显示已生成的 N 份总结，每份显示模板名+生成时间+前 30 字预览）
    右侧详情区显示选中的总结全文 + 操作按钮（复制 / 删除 / 重新生成）
    顶部"+ 新建"按钮（小图标 + "新建")
  - 边距和字号对照设计稿 docs/design/components/audio_detail.jsx 的 .ad-summary-* 风格

【任务 3: Overview 整页布局重设计】
文件: frontend/src/pages/result/ResultsOverview/index.tsx + overview.css
当前问题:
  - 时间轴和转录预览功能重复
  - 时间轴时间全 00:00（extractAudioTimelineLines 没把 start → t_sec/t_str 映射）
  - 4 个 action 卡片太占空间
  - 信息太散，需要滚很多
改成:
  布局变 2 列网格（左主 2/3 + 右辅 1/3）:
    左主列 顶到底:
      内容标签（保留）
      内容摘要（保留，但摘要长时加 "展开/收起" 按钮）
      时间轴（仅 audio 用：按任务 4 的新形态）
      ❌ 删掉"转录预览"卡片（与时间轴功能重复）
    右辅列 顶到底:
      时长 / 转录段数（小型 stat 卡片）
      "打开详情 →" 大按钮（蓝紫渐变 var(--accent-pink)→var(--accent-purple)，醒目）
      4 个 action 卡片**改成纵向小列表**（图标+标题+副标题，hover 高亮），不再是大方块
  整页不再需要滚动太多（90% 内容在首屏）

【任务 4: 纯音频时间轴重做】
文件: frontend/src/pages/result/ResultsOverview/index.tsx + overview.css
当前问题:
  - bug: 时间全 00:00（extractAudioTimelineLines 取 t_sec 但实际数据是 start 字段）
  - 形态错: 用了视频缩略图 grid，音频没有视觉缩略图
新形态（仅 audio 使用，video 不变）:
  - 水平时间轴: 一条横向 bar 表示音频总时长（左 00:00 → 右 总时长）
  - 上面叠加圆点标记: 每段转录的 start 时刻按比例定位，hover 显示 popup（时间 + 段文字前 40 字）
  - 下方列表: 按时间顺序显示前 10 段转录（时间戳 + 文本前 50 字），点击跳 audio_detail 对应时间
  - 字段映射修正:
    extractAudioTimelineLines 返回 {t_sec, t_str, text} 三字段
    transcript_segments 元素 {start, end, text} → 映射 {t_sec: start, t_str: formatSec(start), text}
  - "前 10 段" 标签改成 "时间分布 · 共 N 段"

【范围限制】
- 不要碰 LearningNotesPage / 视频复刻 / 图片页 / 文本页
- 不要新装依赖
- 不要留 debug 脚本（每次都强调）
- 视频/图片/文本的 Overview 时间轴/转录预览**保持原样**，只改 audio 分支

【验证】
- pnpm build EXIT=0 + npx tsc --noEmit EXIT=0
- playwright 实测真实 URL（上面给的两个）+ 截图归档:
  docs/e2e-test/screenshots/rp1a-iter4-overview-{light,dark}.png
  docs/e2e-test/screenshots/rp1a-iter4-audio-summary-{empty,filled}.png
  docs/e2e-test/screenshots/rp1a-iter4-audio-tabs-filtered.png
- git commit 一个: feat(rp1-a): 四迭 UI 整修 — 空 tab 隐藏 / 总结 UI 重设计 / Overview 重构 / 音频时间轴重做 + bug 修
  Co-Authored-By: xiaomi-mimo-2.5pro <noreply@xiaomi.com>
- 更新 COMPLETED_WORK.md 末尾追加一段
- 不要 push

预估工作量: 4-5h
```

## 关键技术参考（不在提示词里，mimo 自己 grep）

- `extractAudioTimelineLines` 在 ResultsOverview/index.tsx line 102，简单加 `.map(seg => ({t_sec: seg.start, t_str: formatSec(seg.start), text: seg.text}))`
- 设计稿样式: `docs/design/components/audio_detail.jsx`
- 颜色用 `var(--accent-pink/purple/blue)`，不要硬编码
