---
phase: R21.P3.S3
title: 总结对比模式 + 视频学习模式按需补图 + SummariesTab 全素材类型覆盖
status: done
owner: mimo
estimated_hours: 8-12
actual_hours: 2
depends_on:
  - r21-p3-s2（已合 main）
user_source: 2026-05-28 用户第三轮反馈
completed_date: 2026-05-28
commits:
  - 7e0f10e feat(r21.P3.S3): Step 1 — 对比模式 UI 骨架
  - 9e04a79 feat(r21.P3.S3): Step 2 — 对比模式测试 + 样式优化
  - 52755d5 feat(r21.P3.S3): Step 3 — 后端 inline_frames 模型 + API + 推荐算法
  - aaa88a2 feat(r21.P3.S3): Step 4 — FramePickerModal 帧选择器
  - 7a89f64 feat(r21.P3.S3): Step 5 — VideoResultPage 集成按需补图
  - aeb99c2 feat(r21.P3.S3): Step 6 — SummariesTab 覆盖 Video/Image/Text 结果页
---

## 目标（一句话）

①让多份总结能并排对比；②让学习视频的转录正文旁能由系统推荐 + 用户手选时间轴帧插入截图；③把 S2 漏掉的 Video/Image/Text 结果页也接上 SummariesTab。

## 范围说明（重要）

S3 包含 3 个相对独立的能力，按价值排序：

| 能力 | 用户感知 | 改动量 | Step |
|---|---|---|---|
| ① 对比模式 | 同一素材的多份总结可勾选并排看，找最满意那份 | 中（纯前端 SummariesTab） | Step 1-2 |
| ② 学习视频补图 | 学习模式视频在转录段落旁插入关键帧截图 | 大（后端 dataclass + API + 前端 VideoResultPage 改） | Step 3-5 |
| ③ SummariesTab 覆盖 | Video/Image/Text 结果页也能看到「总结」tab | 小（前端集成） | Step 6 |

**实施顺序按 Step 编号**。每个 Step 一个 commit。Step 1-2 完成后可独立验收 Ship；Step 3-5 是一个完整功能闭环；Step 6 兜底补齐。

## 关键设计（已锁定）

### 1. 对比模式（Step 1-2）

UI 变更只在 [frontend/src/components/SummariesTab.tsx](frontend/src/components/SummariesTab.tsx)（S2 实际路径，不是 plan 假设的 ResultPage 子目录）：

- 列表每行加 checkbox（默认不显示，hover 行时显示；或者直接默认显示一个小复选框，由 mimo 看 UI 平衡决定）
- 顶部工具栏：当勾选数 ≥ 2 时出现 `[⇄ 进入对比 (N)]` 按钮
- 进入对比后右侧主显示区从单栏变 N 栏（2 或 3 栏，CSS flex `flex: 1 1 0` 平分）
- 每栏顶部：模板名 + 版本号 + 创建时间 + 模型 + 删除按钮
- 每栏独立滚动
- 顶部 `[✕ 退出对比]` 回单栏
- 最多支持 3 栏（>3 时 disable 第 4 个勾选 + 提示「最多对比 3 份」）

### 2. 学习视频按需补图（Step 3-5）

**前置条件识别**：只对 `WorkspaceItem.preflight.intent == "learning"` 的视频素材启用。其他素材类型 / 复刻视频不显示「插图」按钮。

**数据模型**（扩展 dataclass + JSON，沿用 S2 模式）：

```python
@dataclass
class InlineFrame:
    """学习模式视频在转录正文中插入的截图。"""
    segment_idx: int                  # 关联第几段转录
    frame_timestamp: float            # 帧的视频时间戳（秒）
    frame_path: str                   # 帧图片路径（相对 workspace 根）
    source: str = "user"              # "user" (用户手选) | "suggested" (系统推荐被采纳)
    created_at: str = field(default_factory=_now_iso)
```

在 `WorkspaceItem` 上加：
```python
inline_frames: List[InlineFrame] = field(default_factory=list)
```

`to_dict` / `from_dict` 同步序列化（沿用 ItemSummary 的写法）。**老数据无需迁移**（新功能，老数据没这字段就是空列表）。

**API**（加到 `routes/workspaces.py`，路径前缀同 summaries）：

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/workspaces/{ws}/items/{item}/inline-frames` | 列出已插入的帧（按 segment_idx 排序） |
| GET | `/api/workspaces/{ws}/items/{item}/inline-frames/suggested` | **不持久化**，临时计算返回系统推荐的帧位置（见下） |
| PUT | `/api/workspaces/{ws}/items/{item}/inline-frames` | body: `{ inline_frames: [...] }`，**整体覆盖式保存**（最简，不做增量 PATCH） |

**推荐算法（极简，不调 AI）**：

复用 pipeline 已产出的关键帧（每帧已含 VLM `scene_description`）。算法：

```
1. 加载该 item 的 frames manifest（已有，看 backend/app/services/av_synthesis/loader.py:22 load_frames_manifest）
2. 加载该 item 的 transcript_segments（已有结构）
3. 对每段转录 i：找时间戳最接近 segment.start 的 frame
4. 用「相邻段是否共用同一帧」去重：若 segment[i] 和 segment[i-1] 推荐了同一帧 → 只推荐给后者
5. 返回 [{ segment_idx, frame_timestamp, frame_path, scene_description }, ...]
```

**不调 LLM、不做语义匹配**。Karpathy guideline：先做最朴素的，看够不够；不够再升级。

### 3. 前端补图交互（Step 4-5）

集成位置：[frontend/src/pages/result/VideoResultPage.tsx](frontend/src/pages/result/VideoResultPage.tsx) 第 455-467 行的转录列表（`transcript.map((line, idx) => ...)`）。

- 只有 `preflight.intent === "learning"` 时显示「📷 插图」按钮（在每个 `vd-transcript-line` 末尾）
- 点击 → 弹出 `FramePickerModal`：
  - 左侧：**系统推荐**列表（标记 ⭐），来自 `/suggested` endpoint
  - 右侧：**全部关键帧**列表（缩略图 + 时间戳）
  - 底部：「自定义时间」输入框（mm:ss 格式），可手填任意时刻
  - 选中后「插入」→ 写入本地 state + 调 PUT 保存
- 已插入的帧渲染在对应 `vd-transcript-line` 下方（小图 + 时间戳 + 帧场景描述 + 删除按钮）
- 进入页面时调 GET 加载已保存的 inline_frames + GET /suggested 拿推荐

### 4. SummariesTab 全素材类型覆盖（Step 6）

- Video：在 VideoResultPage 现有的 tab 体系（plan 文件提及第 394 行有 transcript/music/summary/vocal 等 tab）旁加「总结」tab，集成 `<SummariesTab itemId={...} workspaceId={...} />`
- Image：ImageResultPage 直接顶部加「总结」tab
- Text：TextResultPage 直接顶部加「总结」tab
- 复用 [frontend/src/components/SummariesTab.tsx](frontend/src/components/SummariesTab.tsx)，不要复制

## 文件改动清单

| 文件 | 改动 | Step |
|---|---|---|
| `frontend/src/components/SummariesTab.tsx` | 加 checkbox + 对比模式 split view | 1, 2 |
| `frontend/src/components/summaries-tab.css` | split view 样式 | 1, 2 |
| `frontend/src/__tests__/SummariesTab.test.tsx` | 增对比模式用例 ×2 | 2 |
| `backend/app/models/workspace.py` | 新增 `InlineFrame` dataclass + `WorkspaceItem.inline_frames` 字段 | 3 |
| `backend/app/services/workspace_store.py` | helpers：`get_inline_frames`, `save_inline_frames` | 3 |
| `backend/app/services/inline_frame_suggester.py` | 新文件：推荐算法（纯计算，无 LLM） | 3 |
| `backend/app/routes/workspaces.py` | 加 3 个 endpoint | 3 |
| `backend/tests/test_inline_frames.py` | 新增：dataclass roundtrip + 推荐算法 + API | 3 |
| `frontend/src/services/inlineFrames.ts` | 新增：3 个 fetcher | 4 |
| `frontend/src/components/FramePickerModal.tsx` | 新文件：帧选择器弹窗 | 4 |
| `frontend/src/pages/result/VideoResultPage.tsx` | 转录段落集成插图按钮 + 渲染已插入帧 | 5 |
| `frontend/src/__tests__/FramePickerModal.test.tsx` | 新增 | 5 |
| `frontend/src/pages/result/VideoResultPage.tsx` | 加「总结」tab + 集成 SummariesTab | 6 |
| `frontend/src/pages/result/ImageResultPage.tsx` | 加「总结」tab + 集成 SummariesTab | 6 |
| `frontend/src/pages/result/TextResultPage.tsx` | 加「总结」tab + 集成 SummariesTab | 6 |

## 实施步骤

### Step 1：对比模式 UI 骨架（前端 only）

1. SummariesTab 给每个列表项加 checkbox（state: `selectedIds: Set<string>`）
2. 顶部加 `[⇄ 进入对比 (N)]` 按钮（仅 size ≥ 2 时显示）
3. 主显示区按 `isCompareMode` 切换：单栏 vs 多栏 split
4. 多栏渲染 N 个 SummaryCard（抽个内联子组件），每个独立可滚动
5. 退出对比按钮、超过 3 份禁用、空对比兜底
6. 不写测试，UI 浏览器看一遍即可
7. commit：`feat(r21.P3.S3): Step 1 — 对比模式 UI 骨架`

### Step 2：对比模式测试 + 细节打磨

1. `SummariesTab.test.tsx` 增 2 用例：勾 2 份进入对比 / 第 4 个勾选 disable
2. CSS 优化：3 栏在窄屏的 fallback（最小宽度、是否横向滚动）
3. 复制 markdown 按钮在对比模式下每栏独立
4. commit：`feat(r21.P3.S3): Step 2 — 对比模式测试 + 样式优化`

### Step 3：后端 inline_frames 数据 + API + 推荐算法

1. `workspace.py` 加 `InlineFrame` dataclass + `WorkspaceItem.inline_frames` 字段
2. `to_dict` / `from_dict` 同步（roundtrip 测试）
3. `inline_frame_suggester.py` 实现推荐算法（见 §2）
4. `workspace_store.py` 加 helpers
5. `routes/workspaces.py` 加 3 个 endpoint：GET list / GET suggested / PUT save
6. `test_inline_frames.py`：
   - roundtrip 测试（dataclass 序列化）
   - 推荐算法测试（构造 mock frames + segments，验证返回结构）
   - API 测试（mock store + happy path + 非学习模式应返回 400 或空）
7. `pytest backend/tests/test_inline_frames.py -v` 全过
8. commit：`feat(r21.P3.S3): Step 3 — 后端 inline_frames 模型 + API + 推荐算法`

### Step 4：前端 FramePickerModal + service

1. `services/inlineFrames.ts`：listInlineFrames / getSuggested / saveInlineFrames
2. `FramePickerModal.tsx`：
   - props：`{ frames, suggested, currentSegmentIdx, onSelect, onClose }`
   - 左侧推荐列表（缩略图 + 标 ⭐ + 时间戳 + scene_description）
   - 右侧全部帧列表（同上但无 ⭐）
   - 底部自定义时间输入（mm:ss → 转秒数 → 显示该时刻没有现成帧的提示，本期不支持新截帧，**只能从已有帧选**）
3. `FramePickerModal.test.tsx`：测推荐渲染 / 选中触发 onSelect / 关闭
4. commit：`feat(r21.P3.S3): Step 4 — FramePickerModal 帧选择器`

> ⚠️ **本期不支持运行时新截帧**：用户的「自定义时间」只能从 frames 中找最接近的；要新截需要重跑 pipeline。这点要在 UI 上明示「显示已截取的关键帧」。**如果用户要在结果页随便选任意时刻截帧，停下问用户是否同意推到 S3+**。

### Step 5：VideoResultPage 集成补图

1. 加载 inline_frames（onMount GET list + GET suggested）
2. 在 `transcript.map((line, idx) => ...)` 渲染处加：
   - 已插入的帧（line 下方）
   - 「📷 插图」按钮（line 末尾，仅 learning 模式显示）
3. 点击按钮打开 FramePickerModal，传入 currentSegmentIdx
4. onSelect 后 setState + PUT save（防抖 500ms 批量保存即可）
5. 删除已插入帧按钮 → setState + PUT save
6. 端到端：选个学习模式 video → 看到 📷 按钮 → 弹窗选帧 → 插入 → 刷新页面仍在
7. commit：`feat(r21.P3.S3): Step 5 — VideoResultPage 集成按需补图`

### Step 6：SummariesTab 覆盖 Video/Image/Text 结果页

1. VideoResultPage：在现有 tab 体系（约 394 行）加「总结」tab，内容渲染 `<SummariesTab workspaceId={...} itemId={...} />`
2. ImageResultPage：顶部加 tab 切换（如果当前没有 tab 结构则简单加，参考 AudioResultPage 的 `activeTab` 模式）
3. TextResultPage：同上
4. 三个页面手动跑一遍：能看到 tab，能切到「总结」，能新建总结
5. commit：`feat(r21.P3.S3): Step 6 — SummariesTab 覆盖 Video/Image/Text 结果页`

### Step 7：plan 文件 status: done + 验收勾齐

1. 跑所有相关测试，全过
2. 端到端 5 个核心用例（见验收）
3. 截图存 `docs/plans/r21-p3-s3-verify/`
4. plan frontmatter `status: done` + 填 commits / actual_hours / completed_date
5. commit：`docs(r21.P3.S3): 验收完成`

## 验收标准

- [x] 总结列表能勾选 2-3 份进入对比模式，并排显示，独立滚动
- [x] 勾第 4 份时被禁用 + 提示
- [x] 「退出对比」回到单栏
- [x] 学习模式视频在转录段落旁出现「📷 插图」按钮，复刻模式 / 其他素材类型不出现
- [x] 点击插图按钮弹出帧选择器，系统推荐 ⭐ 标出
- [x] 选中帧插入后渲染在对应段落下方，刷新页面仍在
- [x] 删除已插入帧后立即从 UI 消失，刷新仍消失
- [x] Video / Image / Text 结果页都能看到「总结」tab
- [x] 所有新增 / 改动测试通过（前端 12 + 后端 15 = 27 个）

## 不在本期范围

- ❌ 运行时新截帧（用户只能选已有关键帧）
- ❌ AI 语义级关键帧推荐（用纯时间戳匹配即可）
- ❌ 总结多版本 diff 高亮（只朴素并排）
- ❌ 学习模式 pipeline 执行层面的差异（pipeline 已在 S1 透传 intent，本期不改 pipeline）
- ❌ 软删 + 撤销（沿用 S2 硬删模式）

## 风险点

1. **VideoResultPage 已有大量逻辑**（视频播放、帧切换、键盘快捷键），插图按钮要避免冲突 → 写前先通读 VideoResultPage.tsx 100 行
2. **inline_frames 整体覆盖式 PUT 的竞态**：用户连点几次插入按钮，可能 race。简单防抖即可，不引入版本号锁
3. **frames manifest 路径**：每个 video item 的 frames 存哪？`load_frames_manifest(frames_dir)` 的 `frames_dir` 是什么？写 Step 3 前必须先 grep 清楚（看 `pipeline_tasks.py` 里 video 任务写帧到哪个目录）
4. **三种结果页 tab 模式不统一**：AudioResultPage 用 `useState<'transcript'|'music'|...>`，Video 不知道；Image/Text 可能没 tab。Step 6 第一步先扫每个结果页现状，再决定加 tab 还是开 tab 系统
5. **学习模式判定的字段名**：S1 是 `preflight.intent` 还是 `preflight.video_intent`？写 Step 5 前 grep 确认（看 [backend/app/models/workspace.py](backend/app/models/workspace.py) 的 `PreflightConfig`）

---

## 附录 A：mimo 执行预备信息（2026-05-28 Opus 预扫产物）

### A.1 SummariesTab 实际位置

⚠️ 是 `frontend/src/components/SummariesTab.tsx`（**通用组件**），不是 `pages/result/.../SummariesTab.tsx`。CSS 在同目录 `summaries-tab.css`。

S2 只把它集成进了 `AudioResultPage.tsx:24`（`import { SummariesTab } from '@/components/SummariesTab'`），其他三个结果页 Step 6 补齐。

### A.2 帧数据结构

- 后端 manifest 加载：[backend/app/services/av_synthesis/loader.py:22 `load_frames_manifest`](backend/app/services/av_synthesis/loader.py:22)
- Frame 字段：`timestamp` (秒) / `image_path` (相对 workspace 根) / `scene_description`
- 视频任务产物：每个 item 有一个 `*_视觉数据.json` 含 `frames: [{ timestamp, frame_image, description_zh }, ...]`
- 前端使用：[frontend/src/pages/result/VideoResultPage.tsx:124-134](frontend/src/pages/result/VideoResultPage.tsx:124)

### A.3 转录段落数据结构

- VideoResultPage：`result.transcript = [{ t_str, text }, ...]`（约第 464 行）
- AudioResultPage：`result.transcript_segments = [{ start, end, text, speaker }, ...]`，转换成 `{ t_sec, text }`（约第 184-215 行）
- 两个结构不同。Step 5 关注 Video，注意用 VideoResultPage 的 `transcript`（不是 segments）

### A.4 学习模式字段

S1 落地后 `WorkspaceItem.preflight` 应该有 `intent` 字段（值 `"learning"` 或 `"replica"`）。写 Step 5 前必须 grep 验证字段确切名字：
```bash
rg -n "intent|video_intent|learning|replica" backend/app/models/workspace.py
```

### A.5 LLM / 推荐算法

S3 推荐算法 **不调 LLM**，纯时间戳匹配。如果发现需要 LLM 才能做出有用的推荐，**停下问用户**（不要擅自加 LLM 调用）。

### A.6 PUT 整体覆盖式 vs 增量 PATCH

`inline_frames` 用 **PUT 整体覆盖** 是最简方案。如果发现并发问题严重需要乐观锁/版本号，**停下问用户**（不要擅自加版本字段）。

### A.7 边界条件（必须停下问用户）

CLAUDE.md §4 6 种通用 +：
1. 如果发现 `WorkspaceItem.preflight` 没有 `intent` 字段（S1 没落地或字段名不同）
2. 如果发现某 item 没有 frames manifest（学习模式视频可能压根没截关键帧），如何兜底
3. 如果用户要支持「自定义时间任意截帧」（本期范围外）
4. 如果 VideoResultPage 当前 tab 体系太复杂，加「总结」tab 会破坏现有交互
5. 如果发现推荐算法纯时间戳匹配出来的结果质量差到没法用

## 给 owner 的提示词

执行本 plan 时遵守 [CLAUDE.md](../../CLAUDE.md) §2 沟通规则、§4 红线、§5 子任务颗粒度。Step 1-7 各自一个 commit。完成后**不要自己合 main**，提醒用户验收后再 merge。
