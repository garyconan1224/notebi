# 批量平台内容导入合集方案

## 目标

把 B 站多 P、收藏夹、UP 主视频列表，以及 YouTube playlist / channel 这类批量来源，统一转成一个合集。

核心流程不直接等同于“批量下载文件”，而是：

1. 解析来源清单。
2. 展示待导入列表，允许用户筛选、改名、去重。
3. 用户确认后创建或选择合集。
4. 每条内容按现有 item pipeline 入队。
5. 完成后在合集内做对比、融合、导出。

## 推荐实现层

### 1. Source Resolver

新增 `batch_source_resolver`，只负责把一个批量链接解析成标准条目：

```ts
type BatchSourceItem = {
  source_url: string
  title: string
  platform: 'bilibili' | 'youtube'
  index?: number
  duration_seconds?: number
  thumbnail?: string
  uploader?: string
}
```

需要支持：

- B 站多 P：BV 页面下的 pages。
- B 站合集/系列：space 或合集链接解析出列表。
- B 站收藏夹：需要 cookie 或用户登录态，先作为受限能力。
- YouTube playlist。
- YouTube channel/videos。

### 2. Import Preview UI

在添加素材弹窗里新增“批量来源”模式：

- 输入一个批量链接。
- 点击“解析清单”。
- 右上角状态浮窗显示“正在解析批量来源…”。
- 弹出清单预览：缩略图、标题、时长、来源、是否已存在。
- 用户可全选/反选/按关键词过滤。
- 确认后选择“新建合集”或“加入当前合集”。

### 3. Queue Integration

确认后不要一次性下载所有媒体文件，而是逐条创建 item，再交给现有 pipeline：

- 每条 item 保留原始 URL。
- 下载、转写、截帧、总结沿用当前单条处理逻辑。
- 任务队列展示总进度：`已完成 x / 共 y`。
- 单条失败不阻断整个批次，合集里显示失败条目和重试入口。

### 4. Downloader Adapter

建议先以 `yt-dlp` 作为通用下载器适配层，因为它仍在维护，且支持大量站点、playlist/channel、字幕、封面等参数。

B 站下载不要强绑定 BBDown 作为唯一依赖。BBDown GitHub 仓库已在 2026-05-14 归档，后续不应作为主路线；可以作为“高级用户本地已安装时的可选适配器”。

### 5. 合规与限制

- 只允许用户导入自己有权限访问的内容。
- 对需要登录/cookie 的收藏夹、私有列表，必须明确提示风险和来源。
- 默认保存为分析缓存，不提供绕过平台规则的公开下载工具定位。

## 第一阶段可交付

1. 添加素材弹窗增加“批量来源”入口。
2. 后端增加 `POST /workspaces/batch-sources/resolve`。
3. 先支持 YouTube playlist/channel 与 B 站多 P。
4. 解析结果生成预览，不自动下载。
5. 确认后批量创建 item 并进入现有任务队列。

## 后续阶段

1. B 站合集/收藏夹/UP 主视频列表。
2. Cookie 管理与登录态检查。
3. 批量失败重试、暂停、取消。
4. 合集级“批量总结 / 对比 / 融合”一键任务。
