---
phase: A2
title: 说话人编辑修正 UI（N8b 核心）
status: ready
priority: P2
estimate_hours: 6-8
model: Sonnet 4.6（多文件 CRUD + 组件级前端）
branch: feat/a2-speaker-edit
depends_on: [N8, A3, A4]
spec_ref: docs/SPEC.md §5 + docs/flows/audio.md
roadmap_ref: docs/ROADMAP.md §5 A2
---

## 目标

在音频结果页（`AudioResultPage.tsx`）实现说话人轨道交互：
- 转录行显示说话人标签 + 颜色区分
- 侧边栏显示说话人列表 + 发言占比统计
- 用户可重命名说话人标签（`SPEAKER_00` → `张三`）
- speaker mapping 持久化到 item.results + 字幕导出自动应用

## 现状分析

### ✅ 已就绪

| 组件 | 位置 | 状态 |
|---|---|---|
| pyannote 说话人分离 | `shared/audio_analyzer.py::run_diarization()` | ✅ 完整实现，graceful skip |
| 说话人 → 转录映射 | `shared/audio_analyzer.py::assign_speakers_to_segments()` | ✅ 按时间重叠匹配 |
| 字幕导出 speaker_map 参数 | `export_srt()`、`export_vtt()`、`export_ass()` | ✅ 已支持 `speaker_map` 参数 |
| handle_audio_task 回写 diarization | `pipeline_tasks.py:1887-1898` | ✅ diarization_dict + transcript_segments 含 speaker 字段 |
| audio_result 端点 | `workspaces.py:1734` | ✅ 透传 item.results 含 diarization |
| CSS 样式骨架 | `audio-result.css` L167-206 | ✅ `.ad-speaker-side`、`.ad-speaker-card`、`.ad-speaker-avatar`、`.ad-speaker-bar` 预留 |
| 前端类型 AudioResult | `services/workspaces.ts:375-408` | ✅ 已有 `transcript_segments` 字段 |
| WorkspaceStore.update_item | `workspace_store.py:174` | ✅ 支持 kwargs 任意字段更新 |

### ❌ 缺失

1. **后端**：无 speaker_map 保存端点——用户编辑的标签无处持久化
2. **后端**：字幕导出端点 `export_subtitles()` 未读取 `speaker_map` 应用到导出
3. **前端**：AudioResultPage 转录行未展示 `speaker` 字段
4. **前端**：侧边栏仅显示「转录统计」，缺少说话人列表和重命名交互
5. **前端**：AudioResult 类型缺少 `diarization` 和 `speaker_map` 字段定义
6. **前端**：无 API 函数调用 speaker_map 保存端点

---

## 子任务拆分

### A2.1 后端补 PATCH speaker_map endpoint

**改动文件**：`backend/app/routes/workspaces.py`

在 tags 相关端点（L1938~1979）附近新增：

```python
# ── A2: 说话人标签编辑 ────────────────────────────────────

class SpeakerMapRequest(BaseModel):
    speaker_map: Dict[str, str]  # {"SPEAKER_00": "张三", "SPEAKER_01": "李四"}

@router.patch("/{workspace_id}/items/{item_id}/speaker_map")
def update_speaker_map(
    workspace_id: str, item_id: str, req: SpeakerMapRequest,
) -> Dict[str, Any]:
    """保存用户重命名的说话人标签到 item.results.speaker_map。"""
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)
    # 合并到 results
    results = dict(item.results or {})
    results["speaker_map"] = dict(req.speaker_map)
    _store.update_item(workspace_id, item_id, results=results)
    return {"speaker_map": req.speaker_map}
```

**设计决策**：
- speaker_map 存在 `item.results["speaker_map"]` 而非新增 model 字段——与现有存储契约 (`Dict[str, Any]`) 一致，零 schema 改动
- key 是 pyannote 原始 ID（如 `SPEAKER_00`），value 是用户自定义名称
- 非终结态 item 也可编辑——编辑不依赖分析完成

---

### A2.2 字幕导出端点应用 speaker_map

**改动文件**：`backend/app/routes/export.py`（`export_subtitles` 函数，L450-512）

**改动内容**：在构建 segments 后、调用 `export_srt()` / `export_vtt()` / `export_ass()` 前，从 results 读取 `speaker_map` 并转换为导出函数期望的格式。

```python
# 在 segments 归一化完成后，读取 speaker_map
raw_speaker_map = results.get("speaker_map") or {}

# 将 {"SPEAKER_00": "张三"} 转换为 export_srt 期望的 {(start, end): "张三"} 格式
# 但这里更简洁的做法是：先把 segments 中的 speaker 字段按 map 替换
if raw_speaker_map:
    for seg in segments:
        original_speaker = seg.get("speaker", "")
        if original_speaker and original_speaker in raw_speaker_map:
            seg["speaker"] = raw_speaker_map[original_speaker]
```

这样 `export_srt(segments)` 直接使用已替换的 speaker 名称，无需修改 export 函数签名。

---

### A2.3 前端类型定义 + API 函数

**改动文件**：`frontend/src/services/workspaces.ts`

1. **AudioResult 类型补充**（L375-408）：

```typescript
/** N8: 说话人分离结果 */
diarization?: {
  num_speakers: number
  segments: Array<{start: number; end: number; speaker: string}>
}
/** A2: 用户自定义说话人映射 */
speaker_map?: Record<string, string>
```

2. **新增 API 函数**：

```typescript
/** PATCH /workspaces/{id}/items/{itemId}/speaker_map — 保存说话人标签映射 */
export async function updateSpeakerMap(
  workspaceId: string,
  itemId: string,
  speakerMap: Record<string, string>,
): Promise<void> {
  await http.patch(`${BASE}/${workspaceId}/items/${itemId}/speaker_map`, {
    speaker_map: speakerMap,
  })
}
```

---

### A2.4 AudioResultPage 转录行展示说话人

**改动文件**：`frontend/src/pages/result/AudioResultPage.tsx`

**改动范围**：转录 tab 的行渲染（L342-382）

**设计**：
1. 从 `result.transcript_segments`（若存在）或 `result.transcript` 中读取带 `speaker` 字段的行数据
2. 以 `result.speaker_map` 为映射优先显示用户自定义名称
3. 头像区域（`.ad-tr-avatar`）改为：
   - 有 speaker 时：显示说话人名称首字 + 基于 speaker ID 哈希的背景色
   - 无 speaker 时：保持当前行号显示
4. 行头加 speaker 名称标签（仅在有多说话人时显示）

**颜色方案**（确定性哈希，不依赖随机）：
```typescript
const SPEAKER_COLORS = [
  'hsl(210, 65%, 55%)',  // 蓝
  'hsl(340, 60%, 55%)',  // 粉红
  'hsl(160, 55%, 45%)',  // 绿
  'hsl(30,  70%, 55%)',  // 橙
  'hsl(270, 55%, 55%)',  // 紫
  'hsl(50,  65%, 48%)',  // 金
]
function speakerColor(speakerId: string): string {
  let hash = 0
  for (const ch of speakerId) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return SPEAKER_COLORS[Math.abs(hash) % SPEAKER_COLORS.length]
}
```

---

### A2.5 侧边栏说话人面板

**改动文件**：`frontend/src/pages/result/AudioResultPage.tsx`（L366-380 `.ad-speaker-side` 区域）

**设计**：替换当前「转录统计」占位为完整说话人控制面板。

**组件结构**：
```
.ad-speaker-side
  ├── eyebrow "说话人"
  ├── 说话人卡片 × N
  │     ├── .ad-speaker-row
  │     │     ├── .ad-speaker-avatar  [颜色圆 + 首字]
  │     │     ├── 名称（可编辑）
  │     │     └── 编辑按钮（Pencil icon）
  │     ├── .ad-speaker-bar [发言占比进度条]
  │     └── 统计文字 "XX 段 · XX:XX 总时长"
  ├── hr
  └── 转录统计（行数 + 总时长，保留）
```

**发言占比计算**：
```typescript
// 从 transcript_segments 统计每个 speaker 的段数 + 时长
const speakerStats = useMemo(() => {
  const map = new Map<string, {count: number; durationSec: number}>()
  for (const seg of transcriptSegments) {
    const spk = seg.speaker || 'unknown'
    const prev = map.get(spk) || {count: 0, durationSec: 0}
    const dur = (seg.end || seg.start || 0) - (seg.start || 0)
    map.set(spk, {count: prev.count + 1, durationSec: prev.durationSec + dur})
  }
  return map
}, [transcriptSegments])
```

**重命名交互**：
- 点击编辑按钮 → 行内编辑（input 替换名称 span）
- 回车 / 失焦 → 调用 `updateSpeakerMap()` 保存
- toast 提示成功/失败
- 更新本地 state（乐观更新）

---

### A2.6 AudioResult transcript_segments 数据源适配

**改动文件**：`frontend/src/pages/result/AudioResultPage.tsx`

**问题**：当前 `transcript` 是 `VideoResultTranscriptLine[]`（仅 `t_sec`/`t_str`/`text`），不含 `speaker`/`start`/`end`。而后端 `handle_audio_task` 实际存的是 `transcript_segments`（含 `start`/`end`/`text`/`speaker`）。

**方案**：
1. 优先读 `result.transcript_segments`（后端真实数据源，含 speaker）
2. 回退 `result.transcript`（demo fixture 兼容）
3. 统一归一化为内部类型 `TranscriptLine`

```typescript
interface TranscriptLine {
  t_sec: number
  t_str: string
  text: string
  start?: number
  end?: number
  speaker?: string
}
```

---

### A2.7 测试

**后端测试**（`tests/backend/test_speaker_map.py`，新文件）：

1. `test_patch_speaker_map_saves_to_results`：创建 workspace + item → PATCH speaker_map → GET audio_result 确认 speaker_map 存在
2. `test_patch_speaker_map_returns_404`：不存在的 workspace/item → 404
3. `test_export_subtitles_applies_speaker_map`：item.results 含 speaker_map + transcript_segments(带 speaker) → GET subtitles → 验证导出内容中 speaker 已替换

**前端测试**（可选扩展现有 vitest）：
- `updateSpeakerMap` API 函数 mock 测试

---

### A2.8 收尾文档更新

- `docs/EXECUTION_PLAN.md`：N8b 行标注「A2 说话人编辑已完成」
- `docs/AI_HANDOFF.md`：「下一步」区更新 A2 为 ✅ + 新推荐
- `docs/ROADMAP.md`：A2 子任务打 `[x]`
- `docs/COMPLETED_WORK.md`：追加 A2 记录
- plan frontmatter `status: done`

---

## 改动文件清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `backend/app/routes/workspaces.py` | MODIFY | 新增 PATCH speaker_map 端点（~20 行） |
| `backend/app/routes/export.py` | MODIFY | export_subtitles 读取 speaker_map 替换 speaker（~8 行） |
| `frontend/src/services/workspaces.ts` | MODIFY | AudioResult 类型补 diarization + speaker_map + 新增 updateSpeakerMap 函数（~15 行） |
| `frontend/src/pages/result/AudioResultPage.tsx` | MODIFY | 转录行 speaker 展示 + 侧边栏说话人面板 + 重命名交互（~120 行） |
| `frontend/src/pages/result/audio-result.css` | MODIFY | 微调已有样式 + 新增编辑态样式（~20 行） |
| `tests/backend/test_speaker_map.py` | NEW | 3 个测试用例 |

**总变动**：~6 个文件，~200 行新增/修改

---

## 不要做的事

- ❌ 不要改 `shared/audio_analyzer.py`——说话人分离逻辑已完备
- ❌ 不要改 `handle_audio_task`——后端产出 `diarization` + `transcript_segments.speaker` 已正确
- ❌ 不要增加新的 npm 依赖——重命名用行内 `<input>` 即可，无需模态/第三方编辑组件
- ❌ 不要做说话人合并（将两个 SPEAKER 合并为一个）——那是 A2 的后续增强
- ❌ 不要做 demo fixture 的 speaker 数据——pyannote 有 HF_TOKEN 时才有真数据，无 token 时侧边栏显示「未启用说话人分离」即可

## 风险点

1. **pyannote 未安装/无 HF_TOKEN**：大多数开发环境没装 pyannote → `diarization` 为 null / `transcript_segments` 无 speaker 字段。前端必须做好空态处理，不能因为没数据就报错。
2. **transcript vs transcript_segments 数据不一致**：后端 result 中 `transcript` 是纯字符串或 display 格式，`transcript_segments` 才是 whisper 原始结构。必须以 `transcript_segments` 为主数据源。
3. **乐观更新 vs 保存失败回滚**：speaker_map 保存失败时需 rollback 本地 state，用 toast 提示用户。

---

## 验证计划

### 自动化测试
```bash
# 后端
.venv/bin/pytest tests/backend -q

# 前端
cd frontend && npx vitest run && pnpm build
```

### 人工验证（需用户参与）
1. 启动 `./start.sh`
2. 提交一段含多说话人的音频（如访谈/播客），**勾选「说话人音色区分」**
3. 等待分析完成 → 进入音频结果页
4. 确认：转录行有 speaker 标签 + 颜色区分
5. 确认：侧边栏显示说话人列表 + 发言占比
6. 点击编辑 → 重命名 → 确认持久化（刷新后仍在）
7. 导出字幕（.srt）→ 确认导出文件中 speaker 已替换为自定义名称
