---
phase: N10
title: 文字分支补全
status: in_progress
model: Sonnet 4.6
branch: feat/phase-n10-text-branch
worktree: /Users/conan/Desktop/nibi-n10
created: 2026-05-19
---

# N10 文字分支补全

> 来源：`docs/SPEC.md` §7 模块 7：文字分支
> 前置：N9 已合并 main

## 目标

补齐文字分支的后端分析能力 + 前端结果展示，使文字素材的分析流水线与 SPEC §7 对齐。

## 子任务

### N10.1 marker PDF 解析集成（shared/text_loader.py）

**改动文件**：`shared/text_loader.py`、`requirements.txt`

- 装 `marker-pdf` 依赖（用户已授权）
- 修改 `load_pdf()`：marker 优先，失败 fallback 到 pypdf
- marker 输出 Markdown，保留图片占位符
- `TextDocument.meta` 增加 `parser: "marker" | "pypdf"` 字段

### N10.2 Preflight 参数透传（backend/app/routes/workspaces.py）

**改动文件**：`backend/app/routes/workspaces.py` `_bridge_to_pipeline_payload` text 分支

当前 text 分支只传 `source` + `source_type`，需补齐：
- `summary`（摘要长度参数）
- `association`（联想 4 方向）
- `rewrite`（改写风格）
- `translate`（翻译目标语言）
- `multi_compare`（多文对比开关）
- `text_model` / `api_key`（模型选择）

参考 image 分支（第 811-827 行）的透传模式。

### N10.3 handle_text_task 增强（backend/app/services/pipeline_tasks.py）

**改动文件**：`backend/app/services/pipeline_tasks.py`

当前 `handle_text_task`（第 611 行）只做：load_auto → _summarize_text → 落盘。需增加：

1. **摘要参数化**：读 `payload.summary` 调整摘要长度（50/100/200 字）
2. **联想归纳**：读 `payload.association`，4 方向（深度解读/观点提炼/趋势判断/行动建议），LLM 生成
3. **改写/润色**：读 `payload.rewrite`，4 风格（正式/口语/简洁/丰富），LLM 生成
4. **翻译**：读 `payload.translate`，目标语言，LLM 生成
5. **产物扩展**：JSON 产物增加 `associations` / `rewrites` / `translations` 字段

状态机扩展：FETCH → PARSE → EXTRACT → SUM → ASSOCIATE → REWRITE → TRANSLATE → STORE → SUCCESS

### N10.4 多文对比端点（backend/app/routes/workspaces.py）

**改动文件**：`backend/app/routes/workspaces.py`

参考 `image_compare`（第 1169 行），新增：
```
GET /workspaces/{workspace_id}/items/{item_id}/text_compare
```

逻辑：
1. 收集同 workspace 内所有已完成分析的 text 素材
2. 结构化对比：摘要 / 要点 / 联想归纳
3. LLM 生成对比总结（best-effort）
4. 返回 `{ workspace_id, current_item_id, texts: [...], llm_summary }`

### N10.5 前端类型 + 结果页升级（frontend/src/）

**改动文件**：
- `frontend/src/services/workspaces.ts`（TextResult 类型扩展）
- `frontend/src/pages/result/TextResultPage.tsx`（结果页 UI 升级）

**TextResult 类型扩展**：
```typescript
associations?: Record<string, string>  // { 深度解读: "...", 观点提炼: "...", ... }
rewrites?: Record<string, string>      // { formal: "...", casual: "...", ... }
translations?: Record<string, string>  // { en: "...", ja: "...", ... }
```

**TextResultPage UI 升级**（SPEC §7.6 布局）：
- 右侧面板增加「联想归纳」折叠区
- 右侧面板增加「改写/翻译」折叠区，原文与结果逐段对照
- 顶部增加「多文对比」按钮（text_compare 弹窗）

## 不做的事

- ❌ N11 UI 清理
- ❌ PDF 内图片走图片分支分析（SPEC §7.3 第 4 点，留到后续）
- ❌ 超长文本自动分段（SPEC §7.4，当前 LLM 上下文够用，后续按需加）

## 验证

- `pytest tests/backend -q` 通过
- `cd frontend && pnpm tsc -b --noEmit` 无新增错误
- marker 解析 PDF 真实文件测试
