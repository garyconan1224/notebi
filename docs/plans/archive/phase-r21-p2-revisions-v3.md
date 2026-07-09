---
phase: R21.P2-revisions-v3
title: 模型记忆即时保存 + 砍细调 / 状态同步
status: ready
owner: mimo (deepseek v4-pro)
estimated_hours: 3-5
depends_on:
  - r21-p2-revisions (v2，mimo 已完成主体)
user_source: 2026-05-28 用户第二轮反馈
---

## 用户第二轮反馈（原话）

> 1. 点击添加素材这里设置比如音乐分析我打勾了，细调里面缺没有。这么看是不是细调可以不需要了，在前面合理且逻辑的展示也行。
> 2. 模型选过只有要有记忆。默认选择好，不要每次都选择。
> 3. 文字模型和实际（图片）模型只能选择一个，这个不对。

## 诊断

### Bug 1：模型记忆不工作

**根因**：`saveModelMemory` 只在 [AddMaterialModal.tsx:558](frontend/src/components/workspace/AddMaterialModal.tsx) `handleSubmit` 成功后才调用。**用户选了但没提交（或提交失败）→ localStorage 空 → 下次打开仍要重选。**

**修法**：每次 `setTextProviderId / setTextModelId / setVisionProviderId / setVisionModelId` 触发时立即 `saveModelMemory(...)`，**不等提交**。

```ts
// 抽个 helper
const persistTextModel = (providerId: string, modelId: string) => {
  setTextProviderId(providerId)
  setTextModelId(modelId)
  saveModelMemory({ textProviderId: providerId, textModelId: modelId, visionProviderId, visionModelId })
}
// 同理 persistVisionModel(providerId, modelId)
```

或者在 modelMemory 那里加 `saveTextModel(...)` `saveVisionModel(...)` 部分更新接口，避免每次都写全四个 key（注意闭包陷阱：用 `useRef` 缓存最新 state 或者用 setter 函数式）。**mimo 自己选实现方式，但目标是「选了立刻持久化」。**

### Bug 2："文字模型 + 图片模型只能选一个"

**实际不是互斥 bug**——代码里两组 state（text/vision 各自独立）。

**真相**：两个 picker 状态独立，但**用户感知错乱**的可能原因：
- a) `visionProviders` 过滤 `capabilities.includes('vision')`，**如果用户配的 provider 没声明 vision capability**（比如 anthropic-default 只有 chat），图片模型 Provider 下拉就是空 → 体感"选不了"。
- b) `providerModels[providerId]` 是按 provider id 索引的全集 model 列表，**两个 picker 共用同一份**——但 SiliconFlow 的 chat 模型和 vision 模型混在一起，用户在图片模型下拉里也看到 deepseek-chat 之类的，会误以为是文字模型"占用"了。

**修法**：
1. 不改 provider 级过滤（用户 SiliconFlow 已经声明含 vision，看 [providers JSON](backend/data/providers.json)），但**让 picker 下拉只显示对应 capability 的 model**：
   - 后端 `GET /providers/{id}/models` 返回的 Model 项含 `capabilities` 字段吗？mimo 先验证。如果有，TextModelPicker 过滤 `m.capabilities.includes('chat')`，VisionModelPicker 过滤 `m.capabilities.includes('vision')`。
   - 如果模型本身没 capability 标签，则**前端按模型 id 启发式**：包含 "vl"、"vision"、"gemini-pro-vision"、"gpt-4o"、"qwen-vl"、"claude-3.5"、"claude-sonnet-4" 之类的进 vision；其余进 chat。这个映射放在 `lib/modelCapability.ts` 里独立可维护。
2. 在两个 picker 下方加一行小字提示："文本模型用于总结/笔记；图片模型用于画面 VLM 分析。同一 Provider 下可分别选不同模型。" 帮用户理解两者独立。

### Bug 3：细调状态不同步 + 是否砍掉细调

**用户原话**："是不是细调可以不需要了，在前面合理且逻辑展示也行"

**当前细调（PreflightDrawer）只剩 2 个 section**：
- 01 背景信息 → 主界面 ④ 已经有，**重复**
- 02 任务勾选 → 含 Preset bar + PFTaskCard 子字段

**PFTaskCard 子字段当前覆盖**：
- 截帧组：frame_mode / shot_frames / sec_per_frame / max_frames → **主界面 FrameModePicker 已覆盖**
- 音乐组：BPM / 调性 / 乐器子开关 → **主界面只是个 chip，没暴露子字段**
- 总结组：summary_path / summary_depth / video_template / output_format → **主界面只暴露 summary_path（板块选择间接控制），没暴露 depth/template/format**
- 字幕组：lang / format → **主界面没暴露**

**所以**：完全砍细调会丢一些字段（summary_depth、video_template、output_format、subtitle lang/format、音乐子选项）。这些字段普通用户不常调，但去掉用户后续可能再要回来。

**推荐方案：砍细调入口 + 保留组件 + 主界面补「高级选项」抽屉**

具体做法：
1. **删除 AddMaterialModal 里的「细调...」按钮**（line 不知道，搜 `onFineTune` 触发位置）
2. **删除 Composer / WorkbenchPage 里的 PreflightDrawer 打开逻辑**——但 PreflightDrawer.tsx 文件**先保留**（不删），后面有需要再恢复
3. **主界面 ③ 任务勾选区下方**加一个 `<details><summary>高级选项</summary>` 折叠区，里面放：
   - 总结深度（详细/极简）
   - 视频模板（不指定/课程/会议/...）
   - 字幕语言 + 格式（仅勾了字幕导出时显示）
   - 音乐子开关（BPM / 调性 / 乐器，仅勾了音乐分析时显示）
4. 这样**主界面成为唯一入口**，状态同步 bug 自动消失。

**如果工作量预估超过 3 小时，方案降级到 B**：保留细调，但修同步 bug（让 PreflightDrawer.hydrateTasks 从 stagedConfig.features 反推 task.on 字段）。

**mimo 先实施方案 A（砍细调入口 + 高级选项折叠）**，做不动再退方案 B。开工前先扫一眼工作量，发现超时立刻退到 B 并跟用户说一声。

## 实施步骤

### Step 1：模型记忆即时保存（Bug 1）

修改 `frontend/src/lib/modelMemory.ts`：

```ts
// 新增部分更新接口
export function saveTextModel(providerId: string, modelId: string) {
  safeSet(KEYS.textProvider, providerId)
  safeSet(KEYS.textModel, modelId)
}

export function saveVisionModel(providerId: string, modelId: string) {
  safeSet(KEYS.visionProvider, providerId)
  safeSet(KEYS.visionModel, modelId)
}
```

在 AddMaterialModal 的 `onPickProvider / onPickModel` 回调里调用：

```tsx
<TextModelPicker
  ...
  onPickProvider={(id) => { setTextProviderId(id); setTextModelId(''); saveTextModel(id, '') }}
  onPickModel={(id) => { setTextModelId(id); saveTextModel(textProviderId, id) }}
/>
<VisionModelPicker
  ...
  onPickProvider={(id) => { setVisionProviderId(id); setVisionModelId(''); saveVisionModel(id, '') }}
  onPickModel={(id) => { setVisionModelId(id); saveVisionModel(visionProviderId, id) }}
/>
```

handleSubmit 里的 `saveModelMemory(...)` 保留（兜底，确保提交时也写一遍）。

### Step 2：模型列表按 capability 过滤（Bug 2）

先验证：
```bash
curl -s 'http://127.0.0.1:8000/providers/openai_compatible-siliconflow/models' | python3 -m json.tool | head -30
```

看 Model 项是否含 `capabilities` 字段。

**情况 A：Model 有 capabilities** —— 在 textModels / visionModels 计算里加过滤：
```ts
const textModels = textProviderId
  ? (providerModels[textProviderId] ?? []).filter(m => !m.capabilities || m.capabilities.includes('chat'))
  : []
const visionModels = visionProviderId
  ? (providerModels[visionProviderId] ?? []).filter(m => !m.capabilities || m.capabilities.includes('vision'))
  : []
```

**情况 B：Model 没 capabilities** —— 新建 `frontend/src/lib/modelCapability.ts`：
```ts
const VISION_PATTERNS = [/vl/i, /vision/i, /gpt-4o/i, /gpt-4-turbo/i, /gemini.*pro/i, /claude-3/i, /claude-sonnet/i, /qwen-vl/i, /qwen2-vl/i]
const CHAT_ONLY_BLACKLIST = [/embedding/i, /rerank/i]

export function isVisionModel(modelId: string): boolean {
  if (CHAT_ONLY_BLACKLIST.some(p => p.test(modelId))) return false
  return VISION_PATTERNS.some(p => p.test(modelId))
}
export function isChatModel(modelId: string): boolean {
  return !CHAT_ONLY_BLACKLIST.some(p => p.test(modelId))
}
```

然后 textModels / visionModels 过滤用这俩函数。

### Step 3：砍细调入口

定位 AddMaterialModal 里的「细调...」按钮（在 modal-footer，调用 `onFineTune(staged)`），改成：

```tsx
{/* 高级选项折叠区，替代细调 */}
<details className="m-section advanced-options">
  <summary>高级选项（总结深度 / 模板 / 字幕格式 / ...）</summary>
  <AdvancedOptionsPanel
    features={features}
    onChange={(patch) => setAdvancedOptions(prev => ({ ...prev, ...patch }))}
    ...
  />
</details>
```

`AdvancedOptionsPanel` 新组件，包含 summary_depth / video_template / subtitle lang+format / music BPM/key/instrument 子选项。

提交时把这些值并入 `tasks` payload。

删 Composer 里调 PreflightDrawer 的代码。**保留 PreflightDrawer.tsx 文件不动**（注释一行 `@deprecated R21.P2.v3 — 已并入主界面高级选项`），万一用户后悔再恢复。

### Step 4：单测 + 端到端

- `__tests__/modelMemory.test.ts`：saveTextModel 后 loadModelMemory 能取回；saveVisionModel 不影响 text 字段
- `__tests__/modelCapability.test.ts`（如选情况 B）：典型 vision 模型 / chat 模型 / embedding 模型分类正确
- `__tests__/AddMaterialModal.test.tsx`：
  - 选了文本模型 → 重开 modal → 默认值回填
  - 选了视觉模型 → 重开 modal → 默认值回填
  - 文本和视觉两个 picker 可以同时选不同模型
- 端到端 curl：savePreflight 含 `models.text` + `models.vision` + tasks 里的高级选项字段

## 验收标准

1. [ ] 选了模型不提交，关闭 modal 重新打开，默认值已回填
2. [ ] 文字模型和图片模型可以同时选（不互相覆盖）
3. [ ] 图片模型下拉只显示能做 vision 的模型（不显示 embedding/rerank）
4. [ ] 主界面勾选「音乐分析」 → 不再有"细调里没勾上"的不一致
5. [ ] 主界面成为唯一前置配置入口（细调按钮消失或者细调与主界面状态同步）
6. [ ] 高级选项里能调 summary_depth / video_template / subtitle 格式
7. [ ] `npm run build` 无 TS 错
8. [ ] `npm test` 全过

## 不在本期范围

- ASR 模型选择（仍是方案 A 暂不暴露）
- ProcessingPage 聚合视图（R21.P1 独立 phase）
- PreflightDrawer 文件删除（保留备份）

## 给 mimo 的提示词

> v2 已合并主体，但用户验证后发现 3 个问题（见 `docs/plans/phase-r21-p2-revisions-v3.md`）：
> 1. 模型选了不保存（仅提交时存）→ 改为选定即写 localStorage
> 2. 文字/图片模型可同时选，但下拉显示有干扰 → 按 capability 过滤模型列表
> 3. 细调与主界面状态不同步 → 推荐砍细调入口，主界面加「高级选项」折叠
>
> 按 Step 1 → 4 推进。**Step 3 工作量超 3 小时就退方案 B（保留细调修同步 bug），停下问用户。**
>
> 完成后端到端 curl + 用户视觉验证再 commit。commit message：`fix(r21.P2.v3): 模型记忆即时保存 + 模型列表 capability 过滤 + 砍细调入口（或修同步 bug）`
