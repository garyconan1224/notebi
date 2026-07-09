# 笔记合集 / 设置 / 风格模板 / 批量导入接力方案

status: ready-for-implementation
date: 2026-07-01
branch-observed: `feat/exp-redesign-p1`
owner: implementation agent
reviewer: Codex

> 本文来自 Codex 调查结论与用户确认。当前阶段只做接力方案，不包含业务代码改动。

## 0. 接手前对账

先确认当前工作树，避免覆盖他人改动：

```bash
git status --short --branch
git log --oneline -5
git branch --show-current
```

调查时观察到一个未提交改动：

- `frontend/src/pages/SettingPage/TranscriberPage.tsx`

该改动看起来在修设置页 SaveBar 循环，但转写设置页仍可复现崩溃。实现前必须先判断这是不是本轮要接着完成的改动，不要直接覆盖。

## 1. 用户已确认的产品决策

1. 总结版本切换：点击 V0 / V1 / 主笔记就是来回切换，不需要再点“应用”。切换不应额外生成 V2 / V3 / V4。
2. 合集封面：采用主封面优先方案；有真实缩略图则显示主封面，无图再退回预览 / 类型 fallback。
3. 批量下载第一期范围：先做 B 站多 P、YouTube playlist、多 URL 粘贴导入。收藏夹、UP 主全部视频、频道全部视频、需要 cookie 的私有列表放后续阶段。
4. “视频模板”和真实总结提示词是同一个东西，直接改造成新的“风格模板”体系，不保留两套互不打通的入口。

## 2. 推荐执行顺序

1. 修 NoteShell 总结版本切换误写主笔记。
2. 修 `/settings/analysis-defaults` 转写 tab 崩溃。
3. 统一合集封面和合集详情 item 缩略图。
4. 改造“视频模板”为“风格模板”，并打通真实总结 prompt。
5. 做批量来源解析与“导入为合集”一期。

前两项是阻断 bug，范围最清楚；后三项会改产品模型和数据流，建议分提交实现。

## 3. 任务 A：NoteShell 总结版本点击即切换

### 现状 / 根因

`frontend/src/pages/result/NoteShell/index.tsx` 中，点击 summary 版本当前会调用 `handleApplyToNote(summary)`，再调用 `putItemNote(...)`。后端写回主笔记会递增 frontmatter version，所以用户看到点击 V1 / V0 后内容不变，主笔记版本却变成 V2 / V3 / V4。

### 目标行为

- 点击“主笔记”：显示当前主笔记正文。
- 点击某个 summary 版本：显示该 summary 的正文。
- 切换动作不调用 `PUT /workspaces/{workspace_id}/items/{item_id}/note`。
- 切换动作不改变主笔记 version。
- 新建总结完成后可以自动切到新 summary，但不能写回主笔记。
- 如果用户在某个版本里编辑正文，需要明确当前编辑的是哪个目标，不能静默覆盖主笔记。

### 建议实现

- 将“当前查看版本”抽象为 `activeView`：
  - `{ type: "main" }`
  - `{ type: "summary", summaryId: string }`
- summary 下拉选择只更新 `activeView` 和 editor body。
- 删除或改名当前误导性的 `handleApplyToNote` 调用路径。
- 如果仍需要“把 summary 内容写为主笔记”，必须做成独立显式入口，例如“设为主笔记”。但用户本轮确认切换不需要应用，所以第一版可以不暴露该入口。
- 主笔记正文和 summary 正文要分别缓存，切回主笔记时恢复 `note.note_md`，不要沿用上一个 summary 的 `editingBody`。

### 验收

- 在 `/processing/note-95b276e5658f` 或任一可复现 note 页面新建总结。
- 点击 V0 / V1 / 主笔记来回切换，正文随选择变化。
- 版本标签不会因切换变成 V2 / V3 / V4。
- Network 面板中切换版本时没有 `PUT /workspaces/.../note`。

## 4. 任务 B：设置页转写 tab 崩溃

### 现状 / 根因

`/settings/analysis-defaults` 默认能打开，但点击“转写”tab 会复现 React Router 错误页：

```text
Maximum update depth exceeded
```

调查时已有未提交改动在 `TranscriberPage.tsx` 中调整 SaveBar cleanup，但崩溃仍存在。疑点包括：

- `AnalysisDefaultsPage` 让多个子页同时向全局 `settingsShellStore` 注册 SaveBar。
- 多个设置子页的 effect cleanup 可能在依赖更新时 reset，再 set，再触发循环。
- `TranscriberPage` 里 Radix Select item 的 children 比较复杂，`SelectPrimitive.ItemText` 内嵌 badge / span 等节点，运行时栈里出现 `setRef`。

### 建议实现

先做最小修复：

1. 保留当前 `TranscriberPage.tsx` 的 unmount-only `resetSaveBar` 思路，继续检查同页其他 effect 是否重复 set/reset。
2. 将 `SelectItem` 的 `ItemText` 内容简化为纯文本；状态 badge 放到 `ItemText` 外侧或不用 badge。
3. 在 `AnalysisDefaultsPage` 切换 tab 时，确保只有当前 tab 注册 SaveBar，卸载时再 reset。

随后做结构清理：

- 不要让“分析默认偏好”大页混合多个互相独立的保存流。
- 每个 tab 的保存逻辑应有明确 owner：要么父级聚合表单保存，要么子页独立保存，不要混用。

### 验收

- 访问 `/settings/analysis-defaults`。
- 依次点击：性能、显示偏好、截图、转写、提示词格式、任务默认勾选。
- 页面不崩溃，控制台无 Maximum update depth。
- 修改转写设置后保存成功；离开再回来值保持。

## 5. 任务 C：合集封面和合集详情 item 缩略图

### 现状 / 根因

`/notes` 使用 `LibraryPage kind="note"`。后端 `/workspaces/library` 已返回：

- `items[].thumbnail`
- `workspaces[].cover_thumbnail`

但前端 `WorkspaceCard.tsx` 主要用合集内 item 的四宫格预览，没有优先使用 `workspace.cover_thumbnail`。同时后端 `_cover_thumbnail` 比 `_item_thumbnail` 弱，漏掉 `video_thumbnail_url`、图片结果、音频封面等，所以很多合集 cover 是 null。

合集详情页 `TaskboardPage/MaterialCard.tsx` 又自己从 `item.results` 猜缩略图，漏掉大量真实字段；笔记页和复刻页能显示封面，是因为它们使用的是 `/workspaces/library` 的 `item.thumbnail`。

### 建议实现

后端优先：

- 让 `_cover_thumbnail` 复用 `_item_thumbnail(item, results)`，或抽出统一 thumbnail resolver。
- `/workspaces/{workspace_id}` 的 item 返回也补 `thumbnail` 字段，保持与 `/workspaces/library` 一致。
- 保留兼容字段，不删除旧字段。

前端：

- `WorkspaceCard` 优先展示 `workspace.cover_thumbnail` 作为主封面。
- 无主封面时，再使用合集内前 4 个 item 的缩略图预览。
- `MaterialCard` 优先使用 `item.thumbnail`。
- 无图时按类型展示 fallback：video / audio / image / text / replica。

### UI 方向

- `/notes` 合集卡：主封面图 + 合集名 + 条目数 + 更新时间。避免空文件夹感。
- 合集详情页：参考笔记页卡片封面比例，但保持详情页 material card 的操作入口。
- 复刻合集也走同一 thumbnail 逻辑。

### 验收

- `/notes` 中有内容的合集显示主封面。
- 打开合集后，内部每条具体内容有封面或类型 fallback。
- `/notes`、`/replicas`、`/workspaces/:id` 三处同一条内容封面一致。
- 无缩略图数据的老内容不报错，有稳定 fallback。

## 6. 任务 D：“视频模板”改造成“风格模板”

### 现状 / 根因

当前存在两套模板系统：

1. 设置页“视频模板”：`frontend/src/pages/SettingPage/VideoTemplatesPage.tsx` + `/templates` + `shared/template_store.py`。
2. 真实总结风格：`frontend/src/components/workspace/AddMaterialModal.tsx` 的 hardcoded style id + `backend/app/services/summary_templates.py`。

真实生成链路走 `summary_templates.py` 和 `summary_generator.py`，所以用户在设置页新增或修改“视频模板”，不会自然影响生成总结。

### 目标

“视频模板”直接升级为“风格模板”，成为真实总结 prompt 的配置入口。新增、编辑、重置后的模板，生成笔记时可以选择并实际生效。

### 分类

第一版建议分类如下：

- 视频笔记提示词（带图）
- 视频笔记提示词（不带图）
- 音频笔记提示词
- 图文笔记提示词
- 复刻提示词
- 文本 / 网页笔记提示词

每个模板建议包含：

- `id`
- `name`
- `category`
- `description`
- `system_prompt`
- `user_prompt`
- `output_format`
- `built_in`
- `default_system_prompt`
- `default_user_prompt`
- `enabled`
- `sort_order`

### 建议实现

后端：

- 将 `summary_templates.py` 的内置模板 seed 到可持久化 store。
- `get_template(template_id)` 优先读 store，找不到再回退内置模板。
- 提供 list / create / update / reset API。
- `_ensure_valid_template` 不应只认硬编码 id，也要接受用户新增模板。
- 图文、复刻、视频带图等特殊 prompt builder 要明确走 category 或 capability，而不是只靠 template id 特判。

前端：

- 设置导航“视频模板”改名“风格模板”。
- 页面按 category 分组。
- AddMaterialModal / NewSummaryModal 的风格选择改为从 API 读取。
- 新增模板后，生成笔记时立即可选。
- 重置按钮只对内置模板可用。

### 验收

- 设置里新增一个“视频笔记（不带图）”风格。
- 添加素材 / 新建总结时能选择该风格。
- 后端日志或生成产物证明实际使用的是新增 prompt。
- 修改内置 prompt 后生成结果使用修改后的 prompt。
- 点击重置后恢复默认 prompt。

## 7. 任务 E：批量来源导入合集一期

### 当前状态

已有 `docs/plans/batch-platform-download-to-collections.md`，但执行层未打通。当前下载链路仍是单视频导向：

- `shared/video_download_ytdlp.py` 中有 `noplaylist = True`。
- B 站 no-cookie 下载器按单 BV / 单 cid 处理。
- `WorkspaceRecord.source` 已预留 `bilibili_favorites`、`bilibili_multipart`、`bilibili_uploader` 等 source 类型。

### 一期范围

用户已确认第一期只做：

- B 站多 P
- YouTube playlist
- 多 URL 粘贴导入

后续再做：

- B 站收藏夹
- UP 主全部视频
- YouTube channel / user 全量
- 需要 cookies 的私有列表

### 推荐架构

不要把 playlist 作为一个下载任务交给 yt-dlp 直接跑完。应拆成：

1. Resolve：解析批量来源，返回条目列表。
2. Preview：前端展示待导入列表，允许用户全选 / 取消 / 去重 / 改合集名。
3. Import：创建一个 workspace collection。
4. Enqueue：每个条目创建一个 item / task，沿用现有单条 pipeline。
5. Collection：所有内容天然聚合到同一合集。

### 建议 API

```text
POST /workspaces/batch-sources/resolve
POST /workspaces/batch-sources/import
```

Resolver 返回示例：

```json
{
  "source_type": "bilibili_multipart",
  "title": "合集标题",
  "items": [
    {
      "source_url": "https://...",
      "title": "P1 标题",
      "platform": "bilibili",
      "index": 1,
      "duration_seconds": 123,
      "thumbnail": "https://...",
      "external_id": "BV...:p1"
    }
  ]
}
```

### B 站多 P

- 使用 B 站 view API 中的 `pages`。
- 每个 page 生成一个 item，保留 `bvid`、`cid`、`page`、`part`。
- 如果现有下载器只接受 BV URL，可生成带 `?p=N` 的 source_url，并在后端 download 阶段保留 page/cid。

### YouTube playlist

- 使用 yt-dlp metadata extraction，不下载媒体。
- 保留 playlist title、playlist_index、webpage_url、thumbnail、duration。
- 导入时每个 entry 独立入队。

### 多 URL 粘贴

- 前端输入框支持粘贴多行文本。
- 后端或前端提取 URL，去重。
- 解析为 `source_type = "manual_url_list"`。

### 验收

- 粘贴一个 B 站多 P 链接，解析出多个 P。
- 粘贴一个 YouTube playlist，解析出 playlist 条目。
- 粘贴多行 URL，解析为多个条目。
- 确认导入后创建一个合集，合集内每个条目有单独任务。
- 单条失败不阻塞整个合集。

## 8. 设置页重新分类

建议导航结构：

- 模型与渠道：LLM provider、模型、API key、代理相关。
- 下载与账号：yt-dlp、cookie、B 站 / YouTube、下载文件命名。
- 分析默认值：性能档位、截图、转写、任务默认勾选。
- 风格模板：所有真实生成 prompt。
- 资料库与显示：库页密度、默认视图、卡片显示偏好。
- 系统维护：监控、垃圾桶、关于。

注意：重分类不要一次性改所有设置数据结构。先改导航与页面聚合，再逐步迁移保存逻辑。

## 9. 红线

- 不覆盖当前未提交的 `TranscriberPage.tsx` 改动，先确认归属。
- 不让版本切换触发主笔记写入。
- 不保留两套互不打通的模板系统。
- 批量导入一期不要直接支持需要 cookie 的私有收藏夹。
- 不把 playlist 当作一个长下载任务；要拆成 item 进入现有队列。
- 不改现有单条素材处理契约，除非有明确迁移说明。

## 10. 建议验证命令

```bash
pytest tests/backend -q
cd frontend && pnpm test
cd frontend && pnpm build
```

需要真实 UI 验证：

```bash
./dev.sh
```

重点手测页面：

- `http://localhost:5177/notes`
- `http://localhost:5177/replicas`
- `http://localhost:5177/workspaces/<workspace_id>`
- `http://localhost:5177/settings/analysis-defaults`
- `http://localhost:5177/settings/video-templates` 或新路由
- `http://localhost:5177/processing/<note_id>`

