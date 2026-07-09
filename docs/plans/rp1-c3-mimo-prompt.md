---
phase: RP1-C · C-3 帧批量操作（多选 + 批量复制 + 导出复刻包）
status: ready
owner: xiaomi-mimo-2.5pro
parent: docs/plans/result-pages-redesign-v1.md § RP1-C · C-3
companion: docs/plans/rp1-execution-handoff.md § 3.4 提示词 C-3
prerequisite:
  - 复刻页 VideoResultPage 存在；建议 C-1 布局重构之后（缩略图轨道上加 checkbox 更自然）
estimated_hours: 2-3
deps_redline: false   # 后端 zipfile 是 Python 内置，无新依赖
---

## 0. 前置说明（mimo 必读）

C-3 给视频复刻页加帧多选 → 批量复制提示词 / 导出"复刻工作包"（zip）。

- 前端：帧卡片/缩略图加 checkbox（Shift 连选），工具栏「复制 N 帧提示词」「导出复刻包」。
- 后端新端点：`POST /workspaces/{ws}/items/{item}/reproduce/export`，打包 zip 流式返回。zip 内容：`frames/*.jpg` + `prompts.txt` + `styles.json` + `manifest.json`。用 Python 内置 `zipfile`，**不装新依赖**。

启动先确认帧/提示词数据结构：`rg -n "VideoResultFrame|prompt_mj|prompt_sd|prompt_video|frames" frontend/src/services/workspaces.ts`。

---

## 1. mimo 启动提示词（直接复制到 ccswitch CC 终端）

```
RP1-C · C-3 帧批量操作（多选 + 批量复制 + 导出复刻包）。
实测 URL: http://localhost:5177/workspaces/{勾画面提示词的视频 ws}/{复刻页路由}

详细规格: docs/plans/result-pages-redesign-v1.md § RP1-C · C-3
本任务计划: docs/plans/rp1-c3-mimo-prompt.md

【任务 1: 帧多选 UI】
  - 帧卡片/缩略图加 checkbox；支持按住 Shift 连续多选（记 lastClickedIdx 算区间）。
  - 顶部/轨道旁工具栏显示「已选 N 帧」+ 两个操作按钮 + 全选/清空。

【任务 2: 批量复制提示词】
  - 「复制 N 帧提示词」→ 把选中帧的提示词按帧拼成文本（每帧一段，带帧序号/时间戳）→ navigator.clipboard.writeText。
  - 提示词字段按数据结构取（prompt_mj / prompt_video 等，先确认）。

【任务 3: 后端导出复刻包端点】
  backend/app/routes/ 合适文件（复刻相关，rg 找 reproduce/frames 所在 router）加：
    @router.post("/{workspace_id}/items/{item_id}/reproduce/export")
    - body: { frame_indices: int[] }
    - 用 zipfile 打包（内存 BytesIO）：
        frames/{idx}.jpg（从帧 url/本地路径读）、prompts.txt（每帧提示词）、
        styles.json（风格清单）、manifest.json（帧元信息汇总）
    - StreamingResponse(media_type="application/zip") + Content-Disposition 文件名

【任务 4: 前端触发下载】
  - service: exportReproducePackage(ws, item, indices) → POST 拿 blob → a[download] 下载。
  - 导出中 loading 态，失败 toast。

【范围限制】
- 不做"接 MJ/SD API 生成新图"（属 AI 导演，明确不做）。
- 不引 zip 前端库（用后端打包 + blob 下载）。不装新依赖。
- 不碰 C-1 布局/ C-4 版本逻辑。不留 debug 脚本。

【验证】
- pytest（新写：POST reproduce/export 返回 zip，校验 zip 内含 frames/ + prompts.txt + manifest.json）→ 自己跑过
- pnpm build + tsc EXIT=0
- 手测：多选 3 帧 → 复制提示词（粘贴检查）→ 导出复刻包（解压检查内容）
- playwright 归档 2 张: docs/e2e-test/screenshots/rp1c-c3-{multiselect,export}.png
- git commit: feat(rp1-c): C-3 帧多选 + 批量复制 + 导出复刻包
  Co-Authored-By: xiaomi-mimo-2.5pro <noreply@xiaomi.com>
- 更新 COMPLETED_WORK + EXECUTION_PLAN（加 C-3 条）
- 不要 push
```

## 2. 风险预案

| 风险 | 应对 |
|---|---|
| 帧图是远程 url 不是本地文件 | 后端打包时若本地无文件则按 url 下载或跳过并在 manifest 标注；优先用本地 /static 路径 |
| Shift 多选区间算错 | 记 lastClickedIdx，Shift 时选 [min,max] 区间；普通点击单选 toggle |
| 大量帧打包内存占用 | 帧数通常有限；用 BytesIO 流式；超大可记 TODO，不本期优化 |
| 提示词字段名不确定 | 任务前 rg VideoResultFrame 确认 prompt_* 字段 |

## 3. 验收清单

- [ ] 帧 checkbox + Shift 连选 + 已选计数 + 全选/清空
- [ ] 批量复制提示词（粘贴可验证）
- [ ] 后端 reproduce/export 端点（zipfile，pytest 校验 zip 内容）
- [ ] 前端 blob 下载
- [ ] 不接生成 API、无新依赖、无 debug 脚本
- [ ] pnpm build + tsc + pytest EXIT=0
- [ ] 截图 + COMPLETED_WORK + EXECUTION_PLAN、没 push
