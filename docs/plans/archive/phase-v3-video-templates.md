---
name: phase-v3-video-templates
status: done
phase: V3 (视频类型模板库)
commits: [702177d, c040c70]
completed_date: 2026-05-23
track: V (Video)
prerequisite: V2.2/V2.3 已完成（3b43a59）
model: V3.1 已隐式完成 / V3.2 Sonnet 4.6 / V3.3 ⭐ deepseek v4-pro
branch: 可直接打 main
created: 2026-05-22
---

# Phase V3 — 视频类型模板库

## 前置发现（重要！）

**V3.1 已隐式完成**，不需要做：
- `backend/app/services/pipeline_tasks.py:54` 的 `_VIDEO_TEMPLATE_PROMPTS` 已含 6 类（教程 / Vlog / 访谈 / 影视点评 / 产品评测 / 其它）
- 每类有结构化 system prompt（摘要 / 列表 / 金句 / 建议）
- 前端 `frontend/src/lib/preflightTasks.ts:30` `VIDEO_TEMPLATE_OPTIONS` + PreflightDrawer dropdown 已接好
- 后端 `_build_video_summary_prompt(template, output_format, ...)` 已按 template 分发

✅ 用户现在选 template + V2.3 的 output_format → 已经能拿到差异化总结。

**V3 实际范围**：V3.2 + V3.3 两个子任务。

---

## 目标与价值

- **V3.2**：让用户能自定义模板 prompt（power user feature；解锁内部团队接入小众视频类型，如「学术讲座」「直播切片」）
- **V3.3**：粘 URL → 不点 PreflightDrawer dropdown → 系统自动检测类型 → 节省 1 步操作（普通用户最常路径的体验提升）

---

## 子任务拆分（2 个，每个一 commit）

### V3.2 — 设置页模板编辑

**模型**：Sonnet 4.6（涉及前后端 + 持久化 + 与已存在硬编码模板合并，颗粒度中等）
**预计**：半天

**改动文件**（≤6）：
- 新增 `backend/app/routes/templates.py`：CRUD `/video-templates`
- 改 `backend/app/services/pipeline_tasks.py`：`_load_video_template_prompts()` 合并硬编码 + 用户自定义，返回 dict
- 新增 `shared/template_store.py`：持久化用户模板（仿 `shared/settings_store.py`，写 JSON）
- 新增 `frontend/src/pages/SettingPage/VideoTemplatesPage.tsx`
- 改 `frontend/src/router.tsx` + `SettingPage/index.tsx`：注册 `/settings/video-templates` 入口
- 改 `frontend/src/lib/preflightTasks.ts`：`VIDEO_TEMPLATE_OPTIONS` 改为从 API 拉（缓存到 zustand）
- 必要时改 `frontend/src/services/templates.ts` 新增

**数据模型**：
```python
class VideoTemplate(BaseModel):
    template_id: str           # uuid
    name: str                  # 用户可见名，如 "学术讲座"
    prompt: str                # system prompt
    is_builtin: bool           # 内置 6 类标 True，不可删/不可改
    created_at: datetime
    updated_at: datetime
```

**端点**（5 个）：
| Method | Path | 用途 |
|---|---|---|
| GET | /video-templates | 拉全部（内置 + 用户） |
| POST | /video-templates | 新建用户模板（is_builtin=False） |
| PUT | /video-templates/{id} | 编辑（builtin 拒绝 403） |
| DELETE | /video-templates/{id} | 删（builtin 拒绝 403） |
| POST | /video-templates/{id}/duplicate | 把 builtin 复制成可编辑副本 |

**UI（VideoTemplatesPage）**：
- 列表：每行 `name (badge: 内置/自定义) | prompt 预览前 80 字 | [编辑] [删除] [复制]`
- 新建按钮 → 弹模态：name + prompt textarea（textarea 给个 placeholder 示例）
- 内置模板：[编辑]/[删除] 灰禁用，只能 [复制]
- 保存后 toast 提示并刷新

**测试**：
- happy：POST + GET 回来字段对
- error：PUT builtin 返 403
- 合并：自定义模板出现在 PreflightDrawer dropdown 里

**commit**：`feat(V3.2): 视频模板设置页 CRUD + 后端持久化 + Preflight 集成`

---

### V3.3 — LLM 自动检测模板

**模型**：⭐ deepseek v4-pro（颗粒度小，纯加一个分类调用 + dropdown 加 "auto" 选项）
**预计**：2~3 小时

**改动文件**（≤4）：
- 改 `backend/app/services/pipeline_tasks.py`：新增 `_detect_video_template(title: str, transcript_preview: str) -> str`，用现有 LLM provider 单轮分类
- 改 `_build_video_summary_prompt` / `_run_subtitle_summary`：当传入 `video_template="auto"` 时先调 detect 再分发
- 改 `frontend/src/lib/preflightTasks.ts`：`VIDEO_TEMPLATE_OPTIONS` 第一位加 `'auto'`（显示 "🤖 自动识别"）
- 改 `frontend/src/lib/preflightTasks.ts:131`：默认值从 `'其它'` 改为 `'auto'`（让新用户默认走自动）

**检测 prompt**（写在 `pipeline_tasks.py` 模块顶部）：
```
你是视频内容分类助手。给定视频标题和转写前 500 字，从以下类别中选一个最匹配的：
教程 / Vlog / 访谈 / 影视点评 / 产品评测 / 其它

仅返回类别名（中文），不解释。如果是用户自定义模板（下面列出），优先匹配它们：
{custom_template_names}

标题：{title}
转写片段：{transcript_preview}
```

**实现要点**：
1. 调用现有默认 LLM（`shared/api_key_resolver` + `chat_completion`），不引入新 provider
2. 超时 / 失败 / 返回值不在白名单 → 兜底 `"其它"`，**不阻塞主流程**，日志 warn
3. 检测结果写回 `task.result.detected_template`，前端 Results 页能显示「自动识别为：教程」
4. 缓存不纳入 V3.3 验收：当前每次重新执行会重新检测，已在 `docs/COMPLETED_WORK.md` 记录为后续增强项

**测试**：
- mock LLM 返回 "教程" → prompt builder 用教程模板
- mock LLM 返回 "未知词" → 兜底 "其它"
- mock LLM raise → 兜底 "其它" + log warning
- V3.2 用户模板存在时，prompt 包含自定义名称

**commit**：`feat(V3.3): 视频模板 LLM 自动检测 + auto 选项 + 兜底其它`

---

## 完工标准

- [x] V3.2：设置页能 CRUD 自定义模板，PreflightDrawer dropdown 实时反映
- [x] V3.3：选 "auto" → 后台 LLM 检测 → 用对应模板出总结
- [x] V3.3 后端 pytest 全绿（265 passed, 2 skipped）
- [x] V3.3 前端 build + vitest 通过；full lint 仍被项目存量规则挡住
- [x] ROADMAP V3.3 打 [x] + commit hash (c040c70)
- [x] AI_HANDOFF 更新 V3.3 完成状态与下一步建议

---

## DS / Sonnet 接力 Prompt

### 开 V3.2 时（Sonnet 4.6）

```
你是 Sonnet 4.6，做 Nibi 项目 V3.2 视频模板设置页。
读 CLAUDE.md + docs/plans/phase-v3-video-templates.md，执行 §V3.2。

V3.1 已隐式完成（pipeline_tasks.py:54 _VIDEO_TEMPLATE_PROMPTS 已 6 类）。
你要做的是让用户能在设置页 CRUD 自定义模板，并与内置 6 类合并。

完成后跑 .venv/bin/python -m pytest tests/backend -q + cd frontend && pnpm build && pnpm lint，
全绿再 commit。做完停下等我开 V3.3。
```

### 开 V3.3 时（deepseek v4-pro）

```
你是 deepseek v4-pro，做 Nibi 项目 V3.3 LLM 自动检测视频模板。
读 CLAUDE.md + docs/plans/phase-v3-video-templates.md，执行 §V3.3。

V3.2 已合并（commit 见 git log），_load_video_template_prompts 能拿到所有模板名。
你要做的是在 PreflightDrawer 加 "auto" 选项 + 后端 _detect_video_template 函数。

LLM 调用用现有默认 provider（看 shared/api_key_resolver + chat_completion 现成函数）。
完成后跑 pytest，做完停下等我验证端到端效果。
```

---

## 边界与禁区

- ❌ 不引入新 LLM provider（用现有默认）
- ❌ V3.3 检测失败不能阻塞主流程，必须兜底「其它」
- ❌ 不动 _VIDEO_TEMPLATE_PROMPTS 内置 6 类的硬编码内容（用户改的走 template_store）
- ❌ 内置模板不可删/不可改，只能复制成副本
- ❌ 不要做模板版本历史 / 导入导出（YAGNI）

## 升档触发

- 涉及 ≥5 文件改动且复杂度高
- 需要改 task 状态机或 SSE 协议
- 模板合并逻辑出现 race condition
- DS / Sonnet 自己不确定

遇到立刻停，让用户升 Opus。
