# 给 Codex 的执行提示词（复制本文件全文使用）

任务：重构结果页导出功能（视频/音频总结结果页）。执行依据是 `docs/plans/2026-08-04-result-page-export-redesign.md`（下称设计文档），分类图谱见 `docs/plans/assets/2026-08-04-export-classification.svg`。请先完整阅读这两个文件再动手。

## 背景

当前导出分散在多个入口且分类重叠。重构为四维正交模型：**导出 = 内容（转写/总结/媒体文件）× 格式 × 选项（说话人/时间轴/语言）× 目的地（本地/飞书/Notion/Obsidian/其他）**。

关键概念：「转写」= 音视频转录出的**文本内容**，不是源文件。场景是视频和音频的总结结果页的导出。

## 已锁定决策（不得更改，详见设计文档 §2 的 D1–D12）

1. SRT/VTT/ASS 必带时间轴，去掉「不带时间轴的 SRT」
2. 转写格式分两组：时间轴格式（SRT/VTT/ASS）+ 文档格式（TXT/Word/Markdown，附带「带时间轴」开关）
3. 说话人是横切开关（开/关），对全部转写格式生效；无说话人数据时禁用并提示
4. 音频只导出音频文件，不可烧录字幕；音频字幕走「转写」导出
5. 语言三选项：双语（默认）/ 仅翻译 / 仅原文，同时适用于转写导出和烧录字幕视频
6. 翻译可用性三态回退：完全可用→三选项都可选；部分缺失→缺失行回退原文并标注；完全缺失→只留「仅原文」
7. 纯文本即 TXT
8. 文件名携带语言和开关信息，如 `发布会_转写_双语_带说话人.srt`
9. 总结的说话人在总结生成时已选定，导出默认包含，不提供开关
10. 本期不做批量导出

## 改动范围（以设计文档 §6 为准）

后端：
- `backend/app/routes/export.py`：转写导出端点扩展 format（srt/vtt/ass/txt/docx/md）、with_speaker、with_timestamp（仅文档格式）、language（bilingual/translation/source）参数
- `backend/app/routes/export.py` 的 `_build_srt`：修复结束时间 bug——现在用 `t_sec + 3` 估算，必须改用 segments 中真实 start/end
- `shared/audio_analyzer.py`：`export_srt/vtt/ass` 增加语言感知（接收 translations + language，双语时合并为多行 cue）
- `backend/app/routes/media_export.py`：`BurnRequest` 新增 `language: Literal["bilingual","translation","source"] = "bilingual"`，烧录前按语言生成对应字幕传给 ffmpeg
- 翻译数据来源：`results.translations[target_lang]`（`workspaces.py` POST translate 端点写入，与转写行索引对齐），用现有 `_translation_filled_count` / `_translation_complete` 判定三态

前端：
- 新建统一导出面板（结果页内），四段式布局：① 内容分区（转写/总结/媒体文件）→ ② 格式 → ③ 选项（说话人开关/时间轴开关/语言三选）→ ④ 目的地；底部文件名实时预览 + 导出按钮
- `frontend/src/pages/result/NoteShell/FeishuExportDialog.tsx`、`NotionExportDialog.tsx` 接入新面板作为云笔记目的地实现，仅暴露转写+总结
- 选择状态按 item 记忆到 localStorage；语言切换不重启播放

## 执行要求

- TDD：先写测试。回退三态（完全可用/部分缺失/完全缺失）× 三种语言选项必须有单测；`_build_srt` 真实时间区间必须有回归测试
- 验证：`pytest tests/backend -q` 和 `cd frontend && pnpm test` 全绿后再提交
- 当前分支 `codex/continue-product-redesign`，禁止 push origin，禁止直接提交 main
- 停点规则：实际代码结构、接口、依赖与设计文档不一致时，立即停下用中文列出事实和选项等我确认，不要擅自扩大范围
- 明确不做：批量导出、媒体文件上传云笔记、总结导出的说话人开关

## 验收标准（设计文档 §7）

1. 转写 3 种时间轴格式 + 3 种文档格式全部可导出，语言/说话人开关对全部格式生效
2. 无说话人数据时开关禁用且有提示；翻译完全缺失时仅「仅原文」可选
3. 部分翻译缺失时缺失行回退原文且导出文件中有可辨识标注
4. 烧录字幕视频支持三种语言选项；音频条目不出现烧录入口
5. `_build_srt` 使用真实 start/end
6. 文件名符合命名规则
7. 云笔记目的地仅出现转写+总结
8. pytest/vitest 全绿，回退三态有单测覆盖

完成后报告：改动文件清单、新增测试数量、pytest/vitest 结果、任何与设计文档的偏差说明。
