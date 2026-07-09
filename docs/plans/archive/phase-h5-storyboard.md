---
phase: H5
title: Storyboard 分镜页面 1:1 复刻 + 后端能力评估
status: ready
branch: feat/homepage-h5-storyboard
created: 2026-05-20
priority: P3
estimate_hours: 6-10
depends_on: H4 已合并
---

# H5 Storyboard 分镜页面

> 设计稿源：`docs/design/components/storyboard.jsx`（186 行）
> ⚠️ **后端能力薄**：Pipeline 第 6 步「分镜 Storyboard」当前默认关，N7 未集成 storyboard 输出

## 风险点

1. 后端 `storyboard_generator.py` 存在但**未必能直接对接**——需要先评估输出格式
2. 设计稿里的"生成卡片"按钮如果要接生成模型 API（Midjourney/Flux/SD），属于 `[C] AI 导演` 范畴
3. H5 可能只能做"展示已有 storyboard 数据"，**生成功能押后**

---

## H5.1 Spike 决议（2026-05-20，Opus 4.7 完成）

**后端现状摸清**：
- `shared/storyboard_generator.py` (292 行) 已实现，注册为 `storyboard` 任务类型
- 输入：product_name + core_features + 8 张参考图 + RAG 知识库 + web 检索
- 输出：3 个 markdown plan（A / B / C），写到 `runtime_dir/last_storyboard_result.json`
- 模型流程：vision 分析图片 → text LLM 生成 3 方案 markdown

**设计稿语义对照**：
- 设计稿要：3 个 tab（方案 A/B/C），每个 tab 是 shot-by-shot 网格（镜号 / 时长 / 视觉提示 / 字幕 / 参考帧）
- 后端实际：3 个 markdown blob，**无结构化 shot 字段**

**决议**（用现实优先，不为完美设计返工后端）：

- **D1 = 仅展示**（generation 留按钮触发，不在 StoryboardPage 内重建生成 UI；生成入口走现有 Taskboard 的 "添加素材 → storyboard 任务" 或单独按钮）
- **D2 = 方案 A（markdown 直展）**：3 个 tab 各渲染对应 plan 的 markdown，**不在前端尝试解析成 shot 网格**——markdown 结构无保证，正则解析会脆
  - 视觉**保留设计稿的 sb-tabs / sb-tab / 头部 hero / 按钮组**布局
  - 设计稿的 sb-grid + sb-shot 替换为 markdown 渲染区（用 react-markdown）
  - 用 lede 文字告诉用户"完整结构化分镜图开发中（Phase [C]）"
- **D3 = 重用现有 storyboard 任务**：「生成预览」按钮可触发新一次 storyboard 任务；「导出 .fcpxml」直接禁用 + tooltip "Phase [C]"

**影响范围**：
- ✅ 不动后端，零 schema 风险
- ✅ 前端纯新增，路由 `/storyboard` 启用
- ✅ 工作量从原估 6-10h 降到 **4-6h**
- ⚠️ 视觉对设计稿 ~70% 还原（shot 网格替换为 markdown）—— 等 [C] 时再升级

## 子任务

### H5.1 后端能力 spike + 决策
**模型**：**Opus 4.7**（架构决策 + 后端代码评估）
**预计**：2-3h
**操作**：
1. 读 `shared/storyboard_generator.py` 看输出 schema
2. 跑一次现有 storyboard 任务（如有），看产物长啥样
3. 对照设计稿字段：分镜号 / 时长 / 提示词（视觉+文本）/ 参考帧 / 风格参数
4. **决议**写进本文件 D1/D2/D3：
   - D1：H5 只做展示 vs 也做生成？
   - D2：后端 storyboard 数据是否需要重新设计 schema？
   - D3：生成按钮接谁的 API？（押后到 [C] vs 现在用 Qwen-VL 凑合）

### H5.2 StoryboardPage 骨架（视觉 1:1）
**模型**：**Opus 4.7**（跨前后端，需要状态机推理）
**预计**：4-7h
**前置**：H5.1 决议完成
**抓取源**：`docs/design/components/storyboard.jsx` + VidMirror.html `.sb-` `.shot-card` 类
**产出**：
1. `frontend/src/pages/StoryboardPage/index.tsx`
2. 接侧边栏：`/storyboard` 路由从禁用变可用（AppShell 改 disabled: false）
3. 数据加载：从 workspace items 中筛 storyboard 任务的产物

### H5.3 生成按钮（条件可选）
**模型**：**Opus 4.7**
**预计**：可选，2-3h
**前置**：H5.1 D3 决议 = "现在接"
**否则**：留禁用 + tooltip "Phase [C]"

---

## 完工标准

- 用户能从侧边栏「分镜」进入 StoryboardPage
- 显示当前 workspace 已生成的所有分镜任务
- 视觉 1:1 对照设计稿
- 生成按钮若决议押后则禁用 + tooltip
- 后端 `pytest tests/backend -q` 全绿

## 与 [C] AI 导演的关系

- H5 是 [C] 的"前菜"——把展示层先做出来
- 生成模型 API 接入留给 [C]
- 完成 H5 后 [C] 阶段主要做：生成模型 API + 收藏帧的提示词版本 UI + A/B 对比 + 风格 DNA 报告
