---
phase: R21.P2-revisions
title: 模型选择 + 截帧模式 UI 修订 · 分散到任务旁 + 记忆
status: ready
owner: mimo (deepseek v4-pro)
estimated_hours: 4-6
depends_on:
  - 98e5f9d (R21.P2 初版：模型选择 + 截帧模式整体挪到主界面)
user_source: 2026-05-28 用户反馈 (P2 初版方向错了)
---

## 背景：P2 初版的问题

98e5f9d commit 把模型选择和截帧模式集中放在主界面的「⑤ 模型选择」「⑥ 截帧模式」两个独立区块。**用户验证后认为这个方向错了**：

> 「图片的模型选择放在图片旁边（这里不介入视频大模型了所以这里还是图片模型），音频转写这里选择什么转写模型，下面再加个文字模型选择。选择模型要有记忆，上一次选择什么这次还会默认加载的。截帧模式应该是点击画面分析就出现，而且也在旁边的，直接选择多少帧之类细节也在都这里显示。」

正确的设计：**每个分析任务旁边带它需要的模型/参数选择**，而不是集中区块。

## 用户诉求拆解

### A. 模型分散到任务旁

| 任务 chip | 旁边显示的模型选择 | 后端字段 |
|---|---|---|
| 综合笔记 / 视频文案总结 / 字幕总结 | **文字大模型**（chat capability） | `preflight.models.text` |
| 画面分析（视觉分析 / 图片分析） | **图片模型**（vision capability，即 VLM） | `preflight.models.vision` |
| 人声转写+总结（音频侧 ASR） | **转写模型**（见下 §C 待定） | （待定，见下） |

**明确删除**：原 P2 初版里的「视频大模型」下拉框（用户："这里不介入视频大模型了"），从 AddMaterialModal 和 PreflightDrawer 都删干净。后端 `models.video` 字段保留兼容但前端不再写入。

### B. 截帧模式贴在「画面分析」旁

- 截帧模式不再是 ⑥ 独立区块
- **勾选「画面分析」后**，在「画面分析」chip 下方展开一组配置：
  - 截帧模式：`AI 镜头分析（PySceneDetect）` / `按秒截帧`
  - 选「AI 镜头分析」时：附「每镜头取几帧」（2 帧 首+尾 / 3 帧 首+中+尾，默认 3）
  - 选「按秒截帧」时：附「间隔秒数」（数字输入，默认 2）+「最大帧数」（数字输入，默认 120）
- 不勾「画面分析」时整组隐藏
- 字段映射后端 `preflight.tasks.frame_prompt.{frame_mode, shot_frames, sec_per_frame, max_frames}`（已存在）

### C. 模型记忆

- **localStorage** 记下上一次选的：text model id / vision model id / ASR 选项
- AddMaterialModal 打开时从 localStorage 回填默认值
- 用户每次提交时把当前选择写回 localStorage
- key 约定：`nibi:preflight:last:textModelId`、`nibi:preflight:last:visionModelId`、`nibi:preflight:last:asrChoice`（如有）
- 优先级：`initialStaged > localStorage > 空`（已配过细调的优先用细调结果）

### D. ASR 转写模型选择 ⚠️ 待定

**现状**：后端 [asr_router.py](backend/app/services/asr_router.py) 自动选优先级 `mlx-whisper > fast-whisper > remote`，前端目前没暴露任何 ASR 配置。`model_name`（base / medium / large）参数前端没传。

**mimo 需要决定的事**：
- **选项 A**（最小）：不暴露 ASR 模型选择，「人声转写+总结」chip 旁不加任何下拉。
- **选项 B**（推荐 mimo 选）：暴露 ASR 模型 size（base/medium/large/large-v3），backend 引擎仍 auto，下拉默认 medium。字段 `preflight.tasks.srt.asr_model_size`（后端需要 1 处接住，asr_router.run_local_asr_with_fallback 已经有 `model_name` 入参，把它从 srt 配置里拿即可）。
- **选项 C**（最重）：完整暴露引擎 + size。改动大不推荐。

**mimo 先用选项 A 开工**——AddMaterialModal「人声转写+总结」旁不放模型选择，注释里写 TODO。等用户反馈再决定 B/C。**这点 mimo 自己拍板，不要因为这个等用户。**

## 当前代码现状（mimo 必读）

- `frontend/src/components/workspace/AddMaterialModal.tsx`：98e5f9d 加了独立的「⑤ 模型选择」「⑥ 截帧模式」section，**整段要删了重做**
- `frontend/src/pages/WorkbenchPage/PreflightDrawer.tsx`：98e5f9d 删了 Section 02 模型选择，**保持现状不动**（细调里不再放模型选择，主界面唯一入口）
- `frontend/src/store/providerStore.ts`：已有 capabilities `chat` / `vision` 区分，可直接用
- `frontend/src/lib/featuresToSteps.ts` + `FEATURES_BY_SCOPE_V2 / FEATURES_BY_TYPE`：定义了 chip 列表，**模型选择 UI 紧贴 chip 渲染**

## 实施步骤

### Step 1：删 98e5f9d 加的 ⑤ ⑥ 两个独立 section

`AddMaterialModal.tsx` 里把两个 `m-section` 整段删掉（带 `R21.P2` 注释那两块），不影响 ④ 背景信息。

### Step 2：每个 chip 渲染下方挂载「附属配置」

`renderChip` 现在只渲染一个 button。改造为：

```tsx
const renderChip = (feat: FeatureDef) => (
  <div className="task-chip-with-config">
    {/* 原 chip button 不变 */}
    <button ... />
    {/* 仅在 chip 勾选时显示对应附属配置 */}
    {on && featConfigSlot(feat.id, type)}
  </div>
)

function featConfigSlot(featId: string, type: ItemType): ReactNode {
  // av_synthesis / video_summary / subtitle_export 这种文字总结类 → 文本大模型下拉
  if (TEXT_MODEL_FEATURES.has(featId)) return <TextModelPicker ... />
  // visual_analysis / visual_prompt → 图片模型下拉 + 截帧模式细节
  if (VISION_FEATURES.has(featId)) return (
    <>
      <VisionModelPicker ... />
      <FrameModePicker frameMode={frameMode} ... />
    </>
  )
  // transcribe_summary → TODO（选项 A 暂时不加）
  return null
}
```

**TEXT_MODEL_FEATURES** = `new Set(['av_synthesis', 'video_summary', 'transcribe_summary', 'visual_prompt'])`（综合笔记 / 视频总结 / 转写总结 / 提示词生成都要走 LLM）

**VISION_FEATURES** = `new Set(['visual_analysis', 'image_analysis'])`

> ⚠️ 同一类型可能多个 chip 都要走文本模型——**只显示一次 TextModelPicker**（放在第一个文本类 chip 下方），避免重复。或者只在 av_synthesis（综合笔记）下显示（它是 highlight 项）。mimo 自己看 UI 紧凑度选。

### Step 3：抽出 picker 组件（同文件内 function 即可）

```tsx
function TextModelPicker({ providerId, modelId, onPickProvider, onPickModel, ... }) { ... }
function VisionModelPicker({ providerId, modelId, ... }) { ... }
function FrameModePicker({ frameMode, sceneFrames, intervalSec, maxFrames, onChange }) { ... }
```

FrameModePicker 内含截帧模式 radio + 条件子字段（每镜头帧数 / 间隔秒数 / 最大帧数）。

### Step 4：state 重组

`AddMaterialModal` 里的 state：

```ts
// 原 P2 初版的 textProviderId / textModelId / videoModelId 保留 text + vision
const [textProviderId, setTextProviderId] = useState('')
const [textModelId, setTextModelId] = useState('')
const [visionProviderId, setVisionProviderId] = useState('')
const [visionModelId, setVisionModelId] = useState('')

// 截帧模式扩展为完整结构
const [framePromptParams, setFramePromptParams] = useState<{
  frame_mode: '按秒截帧' | 'AI 镜头分析'
  shot_frames: '2 帧 · 首+尾' | '3 帧 · 首+中+尾'
  sec_per_frame: number
  max_frames: number
}>({
  frame_mode: 'AI 镜头分析',
  shot_frames: '3 帧 · 首+中+尾',
  sec_per_frame: 2,
  max_frames: 120,
})

// 删除原 videoModelId state
```

### Step 5：localStorage 记忆

新建 `frontend/src/lib/modelMemory.ts`：

```ts
const KEYS = {
  textProvider: 'nibi:preflight:textProvider',
  textModel: 'nibi:preflight:textModel',
  visionProvider: 'nibi:preflight:visionProvider',
  visionModel: 'nibi:preflight:visionModel',
} as const

export function loadModelMemory() {
  return {
    textProviderId: localStorage.getItem(KEYS.textProvider) ?? '',
    textModelId: localStorage.getItem(KEYS.textModel) ?? '',
    visionProviderId: localStorage.getItem(KEYS.visionProvider) ?? '',
    visionModelId: localStorage.getItem(KEYS.visionModel) ?? '',
  }
}

export function saveModelMemory(s: { textProviderId, textModelId, visionProviderId, visionModelId }) {
  localStorage.setItem(KEYS.textProvider, s.textProviderId)
  localStorage.setItem(KEYS.textModel, s.textModelId)
  localStorage.setItem(KEYS.visionProvider, s.visionProviderId)
  localStorage.setItem(KEYS.visionModel, s.visionModelId)
}
```

- 在 AddMaterialModal `open` effect 里：`initialStaged?.models?.text ?? loadModelMemory().textModelId ?? ''`
- 在 handleSubmit 成功后：`saveModelMemory({...})`

### Step 6：handleSubmit 写入 preflight

保留 98e5f9d 已有的 `mergedModels.text / mergedModels.vision`，删 `mergedModels.video`（不写入了）。

frame_prompt 写入：
```ts
if (isVideoLike && visualAnalysisEnabled) {
  tasks.frame_prompt = {
    ...(tasks.frame_prompt as Record<string, unknown> || {}),
    on: true,
    frame_mode: framePromptParams.frame_mode,
    shot_frames: framePromptParams.shot_frames,
    sec_per_frame: framePromptParams.sec_per_frame,
    max_frames: framePromptParams.max_frames,
  }
}
```

注意：所有字段名要跟后端 `_adapt_r8_frame_prompt`（[workspaces.py:114](backend/app/routes/workspaces.py:114)）对得上：
- `frame_mode: '按秒截帧' | 'AI 镜头分析'` → backend 翻译成 `mode: 'interval' | 'ai_shot'`
- `sec_per_frame: number` → backend → `interval_sec`
- `shot_frames: '2 帧 · 首+尾' | '3 帧 · 首+中+尾'` → backend → `frames_per_shot: 2 | 3`
- `max_frames` 直接透传

### Step 7：测试

#### 7a. 前端单测
- `__tests__/modelMemory.test.ts`：save 后 load 能取回；空 localStorage 时 load 返回空串
- `__tests__/AddMaterialModal.test.tsx`：
  - 勾选「画面分析」后能看到 VisionModelPicker + FrameModePicker
  - 取消勾选「画面分析」后两者消失
  - 勾选「综合笔记」时 TextModelPicker 出现
  - 切换截帧模式时子字段切换（scene → 显示 shot_frames；interval → 显示 sec_per_frame + max_frames）

#### 7b. 端到端 curl
```bash
# 创建 ws + item + savePreflight，验证 preflight 含
#   models.text / models.vision
#   tasks.frame_prompt.{frame_mode, shot_frames, sec_per_frame, max_frames}
# 不含 models.video
```

#### 7c. 视觉验证（用户跑）
1. 打开 app → 输入 B 站 URL → AddMaterial 弹出
2. 选「音视频综合」板块
3. 「综合笔记」chip 下方有文本模型下拉
4. 「画面分析」chip 下方有图片模型下拉 + 截帧模式 + 子字段
5. 不勾「画面分析」时整组消失
6. 关掉 modal 重新打开 → 模型默认值回填上次选的
7. 「按秒截帧」选 5 秒、最大 60 帧 → 提交 → 任务跑出来的关键帧数符合

## 验收标准

1. [ ] AddMaterialModal 里没有独立的「⑤ 模型选择」「⑥ 截帧模式」section
2. [ ] 「综合笔记」/「视频文案总结」等文字类 chip 下方有文本大模型下拉
3. [ ] 「画面分析」chip 下方有图片模型下拉 + 完整截帧模式配置（模式 radio + 条件子字段）
4. [ ] 不勾「画面分析」时模型和截帧模式都隐藏
5. [ ] 不再出现「视频大模型」下拉
6. [ ] 模型选择从 localStorage 恢复上次选择
7. [ ] 提交后 localStorage 更新
8. [ ] `preflight.tasks.frame_prompt` 含 4 个字段（frame_mode/shot_frames/sec_per_frame/max_frames）
9. [ ] `npm run build` 无 TS 错
10. [ ] `npm test` 全过（含新增的 modelMemory + AddMaterialModal 用例）
11. [ ] 端到端 curl 验证 preflight 字段全部正确落地
12. [ ] ASR 模型选择：mimo 选项 A 实现（暂不暴露），代码里留 TODO 标识等用户反馈

## 不在本期范围

- ASR 引擎切换 / 模型 size 选择（选项 B/C 留给后续 phase）
- ProcessingPage 聚合视图（R21.P1，独立 phase）
- 已配置 provider 列表的管理 UI（已有「设置 → 模型」页面）

## 完工后

- ① `docs/EXECUTION_PLAN.md` 不新增条目（这是 P2 的修订，不是新 phase）
- ② 本文件 frontmatter 改 `status: done` + 填 commits / completed_date / actual_hours
- ③ commit message：`fix(r21.P2.v2): 模型选择 + 截帧模式分散到任务旁 + localStorage 记忆`
- ④ 等用户视觉验证后再 merge

## 给 mimo 的提示词

> P2 初版（commit 98e5f9d）方向错了——把模型选择和截帧模式做成了集中区块，用户希望分散到对应任务旁。详细方案见 `docs/plans/phase-r21-p2-revisions.md`。
>
> 关键决策点：
> - 视频大模型整段删除（用户不要这个路径）
> - ASR 模型选择用方案 A 暂不暴露，留 TODO
> - 模型记忆用 localStorage 实现
> - 截帧模式跟「画面分析」chip 绑定，勾上才出现
>
> 实施严格按文档 Step 1 → 7 推进，每步完成可独立提 commit。最终一个 squash commit 即可，但中间分步骤帮助你不踩坑。
>
> 完成后跑端到端 curl 验证 + 让用户视觉验证，再 commit。
