---
phase: RP1-A · A-4 技术分析
title: 音乐分析"全家桶"sub-tab 报告 → 图表库选型 + 数据契约 + 组件骨架
status: ready
owner: Opus 4.7 出方案，mimo 2.5pro 实现
parent_plan: docs/plans/result-pages-redesign-v1.md § RP1-A · A-4
companion: docs/plans/rp1-execution-handoff.md § 3.2 提示词 A-4
---

## 0. 核心结论（mimo 看这一段就够开工）

1. **图表库选 [recharts](https://recharts.org/)** — `pnpm add recharts`（已授权）。
2. **报告 sub-tab 只做 4 张图，删掉规划里其它图**（后端没数据，硬上是空图）。
3. **三 sub-tab 组件骨架在 §3 给出**，按图实现即可。
4. **不要新建后端字段**。前端按现有 `MusicSegmentData` 用，缺字段就在 UI 显示「—」或跳过该图。
5. 不要在 A-4 里改 audio_analyzer。

---

## 1. 图表库选型：recharts vs echarts vs chart.js

| 维度 | recharts | echarts | chart.js |
|---|---|---|---|
| 包大小（gzip） | ~85 KB | ~330 KB | ~50 KB |
| React 友好度 | ⭐⭐⭐⭐⭐ 原生 React 组件 | ⭐⭐ 命令式 API + react-echarts wrapper | ⭐⭐⭐ 需要 react-chartjs-2 |
| 4 张目标图覆盖 | ✅ 全部 | ✅ 全部 | ✅ 全部 |
| 样式定制（设计稿对齐） | ⭐⭐⭐⭐ JSX 直接覆盖 | ⭐⭐⭐ option 对象 | ⭐⭐ |
| 维护活跃度 | ✅ | ✅ | ✅ |

**结论：选 recharts**。理由：React 组件式 API 与项目栈一致；体积小；和 Tailwind 配合容易（直接传 className 给 SVG）；本期 4 张图全部支持。

**安装**：
```bash
cd /Users/conan/Desktop/nibi/frontend
pnpm add recharts
# recharts 自带 TS 类型，不需要 @types/recharts
```

---

## 2. 后端实际数据契约（铁律：前端不要假设字段存在）

### 2.1 真实情况

来自 [shared/audio_analyzer.py](../../shared/audio_analyzer.py) 实际产出：

| 字段 | 来源 | 真实数据 |
|---|---|---|
| `start`, `end` | `segment_audio()` 边界 | ✅ 总是有 |
| `bpm` | librosa.beat.beat_track | ✅ 总是有（每段一个 float） |
| `key` | chroma + Krumhansl-Schmuckler 简化判定 | ✅ 总是有（如 "C major"） |
| `music_prompt` | LLM 二次推断 | ⚠️ 仅勾选音乐分析 + LLM 成功才有 |
| `similar_references` | LLM 推断 | ⚠️ 同上 |
| `scenarios` | LLM 推断 | ⚠️ 同上 |
| `genre` | **前端 type 有定义但后端从不填** | ❌ 永远是空字符串 |
| `mood` | 同上 | ❌ |
| `instruments` | 同上 | ❌ |
| `loudness` | 后端无 | ❌ |
| `spectrogram` | 后端无 | ❌ |

### 2.2 报告 sub-tab 能做的 4 张图（精简版）

| 图 | 字段 | 数据足够吗 |
|---|---|---|
| 1. **BPM 走势线图**（X=段序号，Y=bpm） | `bpm` | ✅ |
| 2. **调性分布饼图**（按 key 聚合） | `key` | ✅ |
| 3. **段时长条形图**（X=段序号，Y=end-start） | `start`, `end` | ✅ |
| 4. **节奏热度散点图**（X=段中点时刻，Y=bpm，大小=时长） | `bpm`, `start`, `end` | ✅ |

**~~删掉~~ 的图**（后端没数据）：
- ~~乐器占比饼图~~ → 需要 instruments，永远空
- ~~情绪走势线~~ → 需要 mood，永远空
- ~~音量曲线~~ → 需要 loudness，后端无
- ~~频谱热图~~ → 需要 spectrogram，后端无

> 如果未来后端补了这些字段，再扩 5/6/7/8 张图。本期严格 4 张。

---

## 3. 三 sub-tab 组件骨架

文件位置全部在 `frontend/src/components/result/audio/` 下（mimo 自行新建目录）。

### 3.1 MusicTab.tsx（容器，复用现有 `<button>` tab 模式）

```tsx
// frontend/src/components/result/audio/MusicTab.tsx
import { useState } from 'react'
import type { MusicSegmentData } from '@/services/workspaces'

type SubTab = 'material' | 'report' | 'breakdown'

interface Props {
  segments: MusicSegmentData[]
  onSeek: (sec: number) => void  // 教学拆解 sub-tab 点段跳转用
}

export function MusicTab({ segments, onSeek }: Props) {
  const [sub, setSub] = useState<SubTab>('material')
  // segmented control：素材库 / 报告 / 拆解
  // 复用 AudioResultPage 现有 tab 样式
}
```

### 3.2 MusicMaterialLibrary.tsx（sub-tab 1：派生二创素材库）

```tsx
// 输入：segments
// 渲染：每段 1 张大卡片，含：
//   - 头部：段时刻 + BPM + key
//   - 中部 3 列：Suno / Udio / 即梦 三个平台的提示词卡片
//     - Suno：直接用 segments[i].music_prompt（已有）
//     - Udio：基于 music_prompt 前端拼接 "Udio style: " + 加 BPM / key 后缀
//     - 即梦：基于 music_prompt 前端拼接 + 加中文风格描述
//   - 底部：动态画面提示建议（按 BPM 档位映射：
//     <80 慢镜头 / 80-120 自然节奏 / >120 快剪辑）
//   - 每张卡片右下角：📋 复制按钮（navigator.clipboard.writeText）
//   - 卡片底部 1 行：「复制 → 去 Suno 生成同风格音乐 ↗」（仅外链 https://suno.com/create，不调 API）
```

**关键代码片段**（拼接 Udio/即梦提示词）：

```ts
function buildUdioPrompt(seg: MusicSegmentData): string {
  return `${seg.music_prompt}, ${seg.bpm} BPM, key of ${seg.key}, high quality production`
}

function buildJimengPrompt(seg: MusicSegmentData): string {
  // 即梦中文提示词风格
  return `${seg.music_prompt}\n节奏：${seg.bpm} BPM\n调性：${seg.key}\n时长：${Math.round((seg.end ?? 0) - (seg.start ?? 0))}秒`
}

function suggestVisual(bpm: number): string {
  if (bpm < 80) return '建议：慢镜头 / 长镜头 / 大景深'
  if (bpm < 120) return '建议：标准节奏 / 中景切换'
  return '建议：快剪 / 卡点 / 短镜头堆叠'
}
```

### 3.3 MusicReport.tsx（sub-tab 2：可视化报告）

```tsx
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend
} from 'recharts'

interface Props { segments: MusicSegmentData[] }

export function MusicReport({ segments }: Props) {
  // 4 张图按 2×2 网格排
  // 图 1：BPM 走势线图
  const bpmData = segments.map((s, i) => ({ idx: i + 1, bpm: s.bpm ?? 0 }))
  // 图 2：调性分布饼图（按 key 聚合）
  const keyCount = new Map<string, number>()
  segments.forEach(s => keyCount.set(s.key || '未知', (keyCount.get(s.key || '未知') || 0) + 1))
  const keyData = Array.from(keyCount).map(([name, value]) => ({ name, value }))
  // 图 3：段时长条形图
  const durData = segments.map((s, i) => ({
    idx: i + 1,
    duration: Math.round((s.end ?? 0) - (s.start ?? 0))
  }))
  // 图 4：节奏热度散点（X=段中点时刻，Y=BPM，大小=duration）
  const scatterData = segments.map(s => ({
    t: ((s.start ?? 0) + (s.end ?? 0)) / 2,
    bpm: s.bpm ?? 0,
    z: Math.round((s.end ?? 0) - (s.start ?? 0))
  }))

  // 用 ResponsiveContainer 自适应；颜色用 var(--accent) 等设计 token
  // 每张图右上角加「导出 PNG」按钮（recharts 自带 saveAs，可用 html-to-image）
}
```

**颜色规范**：所有图表用 CSS 变量保持与设计稿一致：
- 主色：`var(--accent)`（饼图主色 / 线图主色）
- 副色：`var(--accent-soft)` / `var(--ink-3)` / `var(--ink-4)`
- 网格：`var(--border)`

**降级文案**：当 `segments.length === 0` 时显示「未勾选音乐分析 或 暂无段数据」。

### 3.4 MusicBreakdown.tsx（sub-tab 3：教学拆解）

```tsx
interface Props {
  segments: MusicSegmentData[]
  onSeek: (sec: number) => void
}

// 每段 1 张教学卡片，时间轴纵向排列
// 卡片字段：
//   - 时刻范围（点击 → onSeek）
//   - 风格判断：基于 BPM + key 的规则文案
//     如 "C major + 90 BPM 倾向 mellow / chillout 风格"
//   - 为什么动人：调 LLM 实时生成（首次访问时调，缓存到 localStorage）
//   - 使用场景：来自 segments[i].scenarios（LLM 已推断）
//   - 类似作品：来自 segments[i].similar_references（LLM 已推断）
```

**LLM 调用端点**（新加，但很轻）：

```python
# backend/app/services/music_teaching_prompts.py（新建）
SYSTEM = "你是音乐教学专家，用 2-3 句中文解释一段音乐为什么动人，从节奏/调性/情绪角度。不要废话。"

def build_teaching_prompt(seg: dict) -> str:
    return f"BPM={seg['bpm']}, key={seg['key']}, prompt={seg.get('music_prompt','')}"

# backend/app/routes/workspaces.py 加路由
@router.post("/{workspace_id}/items/{item_id}/music-teaching/{seg_idx}")
def music_teaching(workspace_id, item_id, seg_idx):
    # 取 seg → 调 chat_runner 一次 → 返回 {explanation: "..."}
```

前端在 `MusicBreakdown` 里首次展开某段时 fetch 一次，存 localStorage `music-teaching-{workspace_id}-{item_id}-{seg_idx}`。

---

## 4. 路由 / 状态 / 持久化

- **路由不动**。MusicTab 仍在 AudioResultPage 内，作为 6 个主 tab 中的「音乐分析」。
- **子 tab state 用 localStorage**：`audio-music-subtab-{workspace_id}-{item_id}` = 'material' | 'report' | 'breakdown'，默认 'material'。
- **复制按钮反馈**：用现有 `toast.success('已复制到剪贴板')`（项目已用 sonner）。

---

## 5. 验证清单（mimo 写完后逐项跑）

- [ ] `pnpm add recharts` 成功，无 peer dep 警告
- [ ] AudioResultPage 切到「音乐分析」tab → 看到三 sub-tab 切换
- [ ] sub-tab 1：每段 3 个平台提示词都能复制
- [ ] sub-tab 2：4 张图渲染正常（demo 数据：6 段；真实数据：变长段）
- [ ] sub-tab 2：段为 0 时显示空态
- [ ] sub-tab 3：点段卡片能跳转音频对应位置
- [ ] sub-tab 3：「为什么动人」首次调 LLM，第二次走 localStorage（看 Network 面板）
- [ ] sub-tab 切换状态刷新页面后保留
- [ ] `pnpm build` EXIT=0
- [ ] `.venv/bin/python -m pytest backend/tests/services -q -k "music_teaching"` 至少 1 pass（新加端点 happy path）

---

## 6. 不在 A-4 范围（mimo 不要顺手做）

- ❌ 不要改 audio_analyzer 加 genre/mood/instruments（属后端能力扩展，单独 phase）
- ❌ 不要接 Suno/Udio/即梦 生成 API（属 AI 导演范畴，[C] 延后阶段）
- ❌ 不要做音频频谱可视化（后端无数据，硬上是假数据）
- ❌ 不要重做转录/总结等其它 tab
