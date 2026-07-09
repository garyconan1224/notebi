# 视频笔记流程 · 后续立项（2026-06-22 手测追加）

> 来源：5 条返工（#3/#6/#7/#18/#19）真机手测后，暴露 2 个**超出返工范围**的项，另开立项。
> 本批返工状态见文末。

---

## 反馈1：本地文件「添加素材」弹窗显示时长 + 封面

- **现象**：本地视频在添加弹窗只显示文件名，无时长 / 封面。
- **根因（实测）**：
  1. `/probe-duration` 端点（`workspaces.py:1135`）只用 yt-dlp 取在线 URL 元数据，**本地路径拿不到**。
  2. 本地文件上传后，`AddMaterialModal` 只收到 item ID（`localFile`）+ 文件名，**没有 File 对象 / 本地路径**。
- **用户决策**：做（添加弹窗显示），**时长必须**，封面首帧尽力。时长还要喂「取画面」预估帧数（`estimateFrames`）。
- **方案 A（纯前端，推荐）**：`Composer.tsx` 本地上传 `onChange` 时，用 HTML5 `<video>` 读 `File.duration` + `<canvas>` 截首帧 dataURL，作为新 prop（`localFileDuration` / `localFileCover`）传给 `AddMaterialModal`。不动后端。
- **方案 B（后端）**：`/probe-duration` 支持本地路径（用已新增的 `shared.video_analyzer.probe_duration_seconds` + `extract_first_frame` 返回 cover 的 `/static/` URL），前端本地分支调用。
- **涉及**：`frontend/.../Composer.tsx`、`AddMaterialModal.tsx`（方案 B 另加 `workspaces.py`）。
- **验收**：选完本地视频，弹窗显示时长（+ 封面尽力）；时长能驱动预估帧数。

---

## 反馈3：结果页无图（既有 bug，非本次返工引入）

- **现象**：`note.md` 0 图，却有「## 附：Billy Note 配置界面示例 [04:56]」+「此图为…」这种**有说明无图**的孤立段落。
- **实测定位**：
  - **不是 flv 格式问题**：cv2 截 flv 完全正常（10940 帧、首帧可读）。
  - **不是小米拆图逻辑**：`_split_images_from_headings` 已验证正确（真实样本 + 41 测试过）。
  - 真因：**analyze 轨没产出截图**——分析报告目录空、无 `*_图文分镜.md`。同一视频在 `e2a47734`/`b5b11106` 能成功截帧（整库 30/259 note 有图），疑**偶发 / 特定运行 analyze 0 产出**。
- **待查**：`run_batch_analysis` 为何这次 0 产出（中断？`capture_params`？VLM 全 `embed_decision=skip`？）；且 `summary_generator` 在无真图时**不应保留「此图为…」孤立配图说明**。
- **涉及**：`shared/video_analyzer.py`（`run_batch_analysis`）、`backend/app/services/summary_generator.py`。
- **验收**：正常视频结果页有独立成行的 `![](/static/…)`；无图时不留孤立配图说明。

---

## 本批返工最终状态（已完成）

| # | 处理 | 验证 |
|---|---|---|
| #3 链接封面 | 小米代码达标 | 离线实跑：`_HAS_BILI=True`、sspai `name=og:image` 提取 ✓ |
| #6 删③输出 | 删 `AddMaterialModal:577-588` | 真机：截图确认③输出已无 ✓ |
| #7 图独立成行 | 小米拆图正确 | 真实样本 + 41 测试 ✓（结果页无图另见反馈3） |
| #18 封面/标题/时长 | 后端补 `video_duration` | 真机实测 `result` 有 `cover_thumbnail`+`video_duration=364`+`video_title` ✓（仅处理页显示，→反馈1） |
| #19 进度并行 | 转录·分析并行组同进同出 | 真机：转录 60%·分析 60% 同时 ✓ |
| 反馈2 步骤名 | 转录→「音频转录」、分析→「画面分析」 | 156 测试过 ✓ |
