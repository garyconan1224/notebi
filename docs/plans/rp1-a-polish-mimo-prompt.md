---
phase: RP1-A 二次迭代 · UI 设计稿对齐（mimo 启动提示词）
status: ready
owner: xiaomi-mimo-2.5pro
parent: docs/plans/result-pages-redesign-v1.md § RP1-A
prerequisite:
  - Opus 4.7 已修 CSS token 冲突（commit 待 user 提交）
  - var(--accent) 全局替换为 var(--accent-pink)
user_source: 2026-05-30 用户反馈"黑白颜色显示有问题，UI 没参考设计稿"
---

## mimo 启动提示词（直接复制到 ccswitch CC 终端，选 Sonnet 角色）

```
RP1-A 二次迭代：把音频结果页（含三 tab：转录 / 音乐分析 / 总结）UI 全面对齐设计稿。

【前置事实】
- Opus 4.7 已修全局 CSS token 冲突：var(--accent) → var(--accent-pink)（37 文件）
- 设计稿权威来源：docs/design/components/audio_detail.jsx + docs/design/styles.css
- 设计 token 看 frontend/src/styles/design-tokens.css（这是事实源）

【三个明确问题】

问题 1：MusicReport.tsx 第 14-21 行用了硬编码 indigo 色板（#6366f1 等 6 个紫色）。
  → 改用设计稿语义：--accent-pink / --accent-purple / --accent-blue / --accent-warm / --accent-green
  → 5 个颜色对应 5 个 Cell，超过 5 段就轮转复用

问题 2：音频页字号 / 留白偏紧，跟设计稿 audio_detail.jsx 不一致。
  对照 docs/design/components/audio_detail.jsx 检查并修正：
  - 段卡片字号（设计稿用 mono 11px 时间戳 + sans 14px 正文 + serif display 标题）
  - 段卡片留白（设计稿用 padding: 12px 16px，圆角 var(--radius-sm) = 10px）
  - 说话人芯片样式（设计稿是 background: spk.color, color: #fff, padding: 2-4px 8px）
  - tab nav 用设计稿的 ad-tabs 风格（borderBottom: 2px solid 高亮色 + 14px font-weight 600）

问题 3：数据空态文案 + 提示。
  音频任务从未跑通真实数据（demo fallback 永远生效），所以：
  - 在音频页顶部显示一个 dismiss 友好提示条："当前为示例数据（任务未完成 / 未上传）。
    完成上传或处理后将自动显示真实结果。"
  - localStorage 记忆 dismiss 状态（key: 'audio-demo-banner-dismissed'）

【范围限制（不要做的）】
- 不要碰 CSS token 定义（design-tokens.css 已对，是事实源）
- 不要改任何 backend
- 不要重写 MusicTab 的 sub-tab 切换逻辑（已实现）
- 不要重写 SummariesTab 的多版本管理逻辑（已实现）
- 不要新装依赖

【验收】
- pnpm build EXIT=0
- 自己用 playwright 跑一次音频页 → 截 3 张图（转录 / 音乐分析-报告 / 总结），
  放到 docs/e2e-test/screenshots/rp1a-polish-{tab}.png
- git commit 一个：feat(rp1-a): 二次迭代 UI 对齐设计稿（颜色 / 字号 / 留白 / 空态提示）
  Co-Authored-By: xiaomi-mimo-2.5pro <noreply@xiaomi.com>
- 更新 COMPLETED_WORK.md 末尾追加这次迭代的 1 段记录
- 不要 push

预估工作量：2-3h。
```
