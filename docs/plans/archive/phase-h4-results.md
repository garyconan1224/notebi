---
phase: H4
title: Results 结果页 1:1 复刻（4 子页）
status: ready
branch: feat/homepage-h4-results
created: 2026-05-20
priority: P2
estimate_hours: 10-14
depends_on: H3 已合并
---

# H4 Results 结果页 1:1 复刻

> 设计稿源（共 1544 行）：
> - `results.jsx`（208）— 列表/概览（如有用）
> - `video_detail.jsx`（419）— 视频详情
> - `audio_detail.jsx`（437）— 音频详情
> - `image_detail.jsx`（266）— 图片详情
> - `text_detail.jsx`（422）— 文字详情
>
> 现有代码：`frontend/src/pages/result/{Video,Audio,Image,Text}ResultPage.tsx` 各占一页，**要被本 phase 改造**

## 子任务（每个独立 commit）

### H4.1 VideoResultPage 改造
**模型**：⭐ 小米 2.5 Pro
**预计**：3-4h
**抓取源**：`docs/design/components/video_detail.jsx` + 现有 VideoResultPage.tsx + VidMirror.html 中 `.vd-` `.shot-` `.tab-` 类
**改动**：保留路由 `/workspaces/:wid/items/:iid/result`，整页内容重写为设计稿样式
**关键复用**：保持现有的字幕/截帧/AI 分析数据加载逻辑不动

### H4.2 AudioResultPage 改造
**模型**：⭐ 小米 2.5 Pro
**预计**：3-4h
**抓取源**：`docs/design/components/audio_detail.jsx`
**关键复用**：N8 已做的 VAD/说话人/音乐分析数据展示

### H4.3 ImageResultPage 改造
**模型**：⭐ 小米 2.5 Pro
**预计**：2-3h
**抓取源**：`docs/design/components/image_detail.jsx`
**关键复用**：N9 已做的 OCR/4 联想方向/多图对比

### H4.4 TextResultPage 改造
**模型**：⭐ 小米 2.5 Pro
**预计**：2-3h
**抓取源**：`docs/design/components/text_detail.jsx`
**关键复用**：N10 已做的 marker PDF/改写翻译/多文对比

---

## 通用约束（所有子任务都遵守）

1. **保留**路由路径不变，只重写组件内部
2. **保留**数据获取逻辑（API 调用、store 订阅），只换 UI 样式
3. CSS 都加到对应 `*ResultPage/result.css` 文件（不共用），用 H1 已落盘 design-tokens
4. 每个子任务**独立 commit**，便于回滚

## 完工标准

- 4 个 result 页面视觉 1:1 对照设计稿
- 路由不变、数据流不变、用户没注意到 API 变化
- `pnpm build` + `pnpm lint` 新文件零错误
