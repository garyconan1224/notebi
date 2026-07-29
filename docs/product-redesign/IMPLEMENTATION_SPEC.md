# NoteBi 实施规格

版本：第二轮定点校准 · 2026-07-29

## 数据合同

- 首页与 `/notes` 共用 `GET /workspaces/library`。
- 持久笔记至少携带 `workspace_id`、`item_id`、`type`、`name`、`source`、`status`、`updated_at` 和 `related_task_ids`。
- 任务活动层拥有 `task_id`、`batch_id?`、`workspace_id?`、`item_id?`、`status`、`stage`、`progress`、`updated_at`。
- 总结任务不参与既有笔记可读状态计算。
- `/tasks` 默认显示批次；单条任务进入二级视图。

## 页面与验收

### 首页

最近任务与最近笔记分层。任务运行不改变笔记数量；成功且 `workspace_id + item_id` 不重复时才增加持久笔记；总结失败不隐藏已有笔记。

### `/notes`

搜索、内容过滤、短排序、网格/列表切换和固定底部多选栏。合集选择器可搜索、分页；加载、空、失败和重试状态齐全；390px 无横向滚动。

### `/tasks`

四统计卡：进行中、已完成、需处理、等待中。基础过滤：全部、进行中、已完成、异常。批次卡显示进度、成功/失败/等待计数、耗时、来源和更新时间。单任务与批次不混排。

任务详情显示九阶段轨道、公开阶段摘要、生成预览、批次项和暂停/继续/重试。成功项可打开真实笔记路由。

### `/collections`

空、1 项、多项使用稳定实体与同一路由。详情支持网格/列表。移动/复制语义未确认前不写死 API。

### NoteShell

媒体、章节/说话人时间轴、字幕、身份绑定、总结版本、输出语言、富文本编辑器、AI 工具和问 AI 组成单一工作台。新总结只增加版本；AI 工具保存为独立派生产物。

## 导出

第一步单选来源，第二步选择格式，整包导出为独立动作。单项导出 payload 不混合来源 checkbox 与格式 checkbox。所有格式默认导出当前屏幕内容。

## 设置

六组设置共享 PageHeader、Section、Field、SaveBar、Status 和 EmptyState。保存链路必须是“写入 → GET/readback → 更新 UI”，不能只修改前端局部状态。

## 本地模型 API

```text
GET    /local-models
POST   /local-models/:id/download
POST   /local-models/:id/activate
DELETE /local-models/:id
```

下载响应返回真实 `task_id`，任务中心可读取。正在使用或启用的模型不能删除。外部运行时只显示连接状态。

## 设计验收

- 动态标题、BrandMark/Lockup、favicon 和 browser icon 同源。
- 原始日志只在高级诊断；普通监控按阶段和来源聚合。
- 响应式固定检查 1440、1280、1024、768、390px。
- Open Design 原型用于交互对照；生产 token 只来自 `nibi-tokens.css`。
