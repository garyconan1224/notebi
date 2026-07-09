---
phase: IP.9
title: Flow Gaps — 补齐流程图与代码的关键缺口
status: done
branch: feat/ip9-flow-gaps（已合并入 main）
created: 2026-05-21
completed_date: 2026-05-21
priority: P1
estimate_hours: 18-25
actual_hours: ~6（仅 Tier A UI 层）
depends_on: IP.8 已合并
commits: 235be39, 9886826, cb27dd5, e618d1a, d9d3836
---

# IP.9 流程图缺口补齐

## 来源

用户提供的流程图已有文本镜像：`docs/flows/overview.md / video.md / audio.md / image.md / text.md / remix.md`。Claude Code 终端先读文本镜像，再按需回看源图（`docs/conversation-inputs/2026-05-18-spec-merge/*.png`）对照代码现状，发现 6 处缺口。

## 用户决议（2026-05-21）

- Q1 = 方案 A：先 UI 层（IP.9.1/9.2/9.3），后端层（9.4~9.6）后做
- Q2 = Gemini 先接（视频路径 3 的视频大模型）
- Q3 = 字幕清洗：规则 + LLM 混合（规则先过快速过滤，LLM 后润色）

---

## 子任务清单

### Tier A：UI 层（先做）

#### IP.9.1 Results 总览页（s05）

**模型**：⭐ 小米 2.5 Pro
**预计**：3-4h

**修复**：Processing 完成跳转 bug + 补设计稿 s05 总览页

**改动文件**：
- 新建 `frontend/src/pages/result/ResultsOverview/index.tsx`
- 新建 `frontend/src/pages/result/ResultsOverview/overview.css`
- `frontend/src/pages/result/ProcessingPage/index.tsx`（line 44 + 104：跳转路由改成总览页）
- `frontend/src/router.tsx`（加新路由）

**路由设计**：
```
旧：/workspaces/:wid/items/:iid/result        → VideoResultPage（写死）
新：/workspaces/:wid/items/:iid/overview      → ResultsOverview（按 type 分流）
    /workspaces/:wid/items/:iid/video_detail  → VideoResultPage（原 /result 改名）
    /workspaces/:wid/items/:iid/audio_detail  → AudioResultPage（原 /audio_result）
    /workspaces/:wid/items/:iid/image_detail  → ImageResultPage（原 /image_result）
    /workspaces/:wid/items/:iid/text_detail   → TextResultPage（原 /text_result）
```

⚠️ 路由改名要兼容：旧路由保留作为 alias（用 React Router redirect）一个 release，避免回归

**ResultsOverview 内容**（参考 docs/design/components/results.jsx）：
- 顶部：标题 + 类型 chip + 任务状态
- 摘要卡（如 results.summary 存在）
- 时间轴卡（仅 video/audio 类型，渲染前 10 个时间点）
- 转录预览（前 500 字 + "查看全部"按钮）
- 底部 3-4 个大入口卡：
  - 「{Type} 详情」按 type 跳对应 detail 页
  - 「进入分镜」跳 `/storyboard?workspace=X&item=Y`
  - 「LLM 对话」跳 Taskboard Chat Tab
  - 「导出工作包」直接触发 downloadExport

**ProcessingPage 改动**：
- 第 44 行 `navigate('${wid}/items/${taskId}/result')` 改成 `navigate('${wid}/items/${itemId}/overview')`
- 注意 taskId ≠ itemId，要先从 task store 取出 item_id

commit: `feat(IP.9.1): Results 总览页（s05）+ 修跳转 bug`

---

#### IP.9.2 N8b 音频前端交互

**模型**：⭐ 小米
**预计**：4-6h

**流程图依据**：`docs/flows/audio.md`（源图：`docs/conversation-inputs/.../音频.png`）列出 6 个任务勾选项：
1. 人声内容总结（asr_summary）
2. 输出人声音频（vocal_separation）
3. 生成字幕文件（subtitle_file）
4. 音乐分析（music_analysis）
5. 音乐转写（music_transcribe）
6. 提示词输出（prompt_generation）

**改动文件**：
- `frontend/src/components/workspace/PreflightConfigPanel.tsx`（audio 分支补 6 个 checkbox）
- `frontend/src/lib/preflightTasks.ts`（audio TASKS_BY_TYPE 数组补缺失项）
- `frontend/src/pages/result/AudioResultPage.tsx`（按勾选展示对应区块）

**对照后端**：grep `tasks.get(` workspaces.py:920 附近，看后端 audio 分支当前接哪些字段：
- 已接：`asr` / `speaker_diarization` / `subtitle_file` / `music_analysis`（IP.7.3 加的）
- 待接：`vocal_separation` / `music_transcribe` / `prompt_generation`（若 N8 后端没做，留 TODO，本子任务只补前端）

**操作步骤**：
1. 先 grep 现有 audio 任务定义看 id 命名
2. 补齐 6 个任务定义到 preflightTasks.ts
3. PreflightConfigPanel audio 分支渲染 6 个 checkbox（参考视频分支的 N7 现有写法）
4. AudioResultPage 按 results 字段存在性展示对应区块（vocal/music_prompt 等）
5. 默认勾选与设计稿对齐：人声内容总结 + 生成字幕文件 默认勾，其它默认不勾

commit: `feat(IP.9.2): N8b 音频前端 6 任务勾选 + 结果页对应区块`

---

#### IP.9.3 N7b 视频路径选择 UI

**模型**：⭐ 小米
**预计**：2-3h

**流程图依据**：`docs/flows/video.md`（源图：`视频.png`）画了 3 条总结路径

**改动文件**：
- `frontend/src/components/workspace/PreflightConfigPanel.tsx`（video 分支加"路径"单选区）
- `frontend/src/lib/preflightTasks.ts`（加 summary_path + video_template 字段定义）

**UI 设计**：
```
摘要路径
○ 路径 1：字幕直接总结（便宜快，适合口播/访谈）
○ 路径 2：详细总结（套视频类型模板，推荐）   [默认]
○ 路径 3：视频大模型直传（Gemini，~$0.05/min）

视频类型模板（路径 2 时显示）
[教程 ▼] [Vlog] [访谈] [影视点评] [产品评测] [其它]
```

**字段定义**（preflightTasks.ts）：
```typescript
{
  id: 'summary_path',
  type: 'radio',
  options: [
    { id: 'subtitle_only', label: '字幕直接总结' },
    { id: 'detailed', label: '详细总结（套模板）', default: true },
    { id: 'video_llm', label: '视频大模型直传' },
  ],
},
{
  id: 'video_template',
  type: 'select',
  visibleWhen: { summary_path: 'detailed' },
  options: ['教程','Vlog','访谈','影视点评','产品评测','其它'],
  default: '其它',
},
```

**后端字段透传**：
- summary_path → payload.summary_path
- video_template → payload.video_template
- 后端 handle_analyze_task 暂时只读 summary_path='detailed'（路径 2 当前行为），其它两路径在 Tier B 加 handler

**临时提示**：路径 1 / 路径 3 选中时显示 toast "后端能力开发中（IP.9.4 / IP.9.5）"，但**前端字段仍透传**，方便后端做完后立刻生效

commit: `feat(IP.9.3): N7b 视频路径选择 UI（3 路径 + 视频类型模板）`

---

### Tier B：后端层（UI 验收后再做）

#### IP.9.4 N7b 路径 1 后端：字幕直接总结

**模型**：Sonnet 4.6
**预计**：3-4h

后端在 handle_analyze_task 加 summary_path 分支：
- `path == 'subtitle_only'`：跳过 vision 流程，字幕抽取后直接走 text LLM 总结
- 提示词换成"基于字幕生成视频内容总结，包含标题/摘要/要点/金句"
- 输出落地到 item.results.subtitle_summary（与现有 vision summary 区分）

---

#### IP.9.5 N7b 路径 3 后端：Gemini 集成（用户决议先只接 Gemini）

**模型**：Opus 4.7（外部 API 集成 + 决策）
**预计**：4-5h

1. 新建 `shared/video_llm_gemini.py` Gemini 1.5 Pro 视频输入封装
2. handle_analyze_task `path == 'video_llm'` 分支：上传视频文件给 Gemini → 拿回总结
3. 配置：env GEMINI_API_KEY，settings 页加 Gemini provider 入口
4. 单测：mock Gemini API，断言 payload 构造对

---

#### IP.9.6 字幕清洗（规则 + LLM 混合）

**模型**：Sonnet 4.6
**预计**：2-3h

1. 新建 `shared/transcript_cleaner.py`
2. 规则层：去填充词（嗯/啊/这个/那个/就是/然后）/ 去重复段 / 时间戳合并
3. LLM 层：rule 后的字幕过一次 LLM 润色（修正错字 + 标点）
4. ASR 完成 → cleaner → 进 summarize（替换现有的"裸 ASR 输出直接总结"）

---

## 完工标准

- 6 子任务独立 commit
- pytest 全绿
- 真粘 B 站 URL -> 走完整流程图：Workbench -> Preflight（含 6 音频任务/视频路径）-> Processing -> Results 总览 -> 详情 -> 分镜
- 需求对照 `docs/flows/*.md`；只有需要视觉布局判断时再对照源 PNG

## 与下一阶段的关系

完成后整个流程图 100% 落地。然后 [C] AI 导演 / [D] 开源 / 收尾任意。
