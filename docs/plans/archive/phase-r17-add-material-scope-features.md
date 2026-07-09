---
phase: R17
title: AddMaterial 弹窗 · 分析范围与任务勾选/细调联动
status: done
owner: deepseek v4-pro
estimated_hours: 2
actual_hours: 1.5
completed_date: 2026-05-26
commits:
  - pending
related_spec:
  - docs/design/system_design_v1.1.md §4.4
  - docs/spec/02-input-layer.md
  - docs/spec/03-preflight-config.md
---

## 背景

「添加素材」弹窗第①区有三选一「分析范围」（只听音频 / 只看画面 / 音视频综合），但第③区「任务勾选」和底部「细调…」抽屉**没有按范围联动**：

- `visual_only` 与 `av_combined` 都映射到 `itemType = 'video'`，因此 chips 列表相同
- `visual_only` 显示「字幕导出」「音乐分析」——但「无 ASR」「不分析音频」，这两个不应出现
- 细调抽屉同样没按 scope 收窄，可能让用户勾出与范围矛盾的任务

## 用户决议（2026-05-26）

1. **visual_only 默认走「只看画面」路径**，不再支持「视频模型直接分析」（pipeline 已支持，无需后端改动）
2. **「说话人音色」(`speaker_diarize`) 不进 av_combined 的主 chip**，只在细调抽屉里可调
3. **切换 scope 时清空已勾的 features**（方案 A）：避免隐藏状态泄漏到后端

## 修改清单

### 1. `frontend/src/lib/featuresToSteps.ts`

在文件末尾新增 scope → features 子集映射：

```ts
import type { AnalysisScope } from '@/components/workspace/AddMaterialModal'

export const FEATURES_BY_SCOPE: Record<AnalysisScope, Feature[]> = {
  audio_only:  ['transcribe_summary', 'speaker_diarize', 'subtitle_export', 'music_analysis'],
  visual_only: ['visual_prompt', 'video_summary'],            // 无 ASR
  av_combined: ['visual_prompt', 'video_summary', 'subtitle_export', 'music_analysis'],
}
```

> 注意：`AnalysisScope` 是 type-only import，避免循环依赖；若 lint 报错，把类型独立挪到 `types/workspace.ts`。

### 2. `frontend/src/components/workspace/AddMaterialModal.tsx`

#### 2a. 第③区 chips 渲染按 scope 过滤（约第 540~582 行）

```ts
const baseFeatures = FEATURES_BY_TYPE[type]
const typeFeatures = showScopeCards
  ? baseFeatures.filter(f => FEATURES_BY_SCOPE[analysisScope].includes(f.id))
  : baseFeatures
```

#### 2b. 切换 scope 时清空 features（约第 460 行 setAnalysisScope 调用处）

把 `setAnalysisScope(scope)` 替换为：

```ts
setAnalysisScope(scope)
// 切换 scope 必清 features，避免隐藏 chip 状态泄漏到后端
setFeatures({})
```

`features` 为空时，下游 `enabledFeatures` 收集逻辑（约第 281 行）会按 scope chip 列表的 `defaultChecked` 重新计算——验证：visual_only 切回 av_combined 时，音乐分析应回到未勾默认。

#### 2c. submit 时再保险一次（第 281~321 行 enabledFeatures 收集）

```ts
const allowed = showScopeCards ? new Set(FEATURES_BY_SCOPE[analysisScope]) : null
const enabledFeatures = Object.entries(features[type] ?? {})
  .filter(([id, on]) => on && (!allowed || allowed.has(id as Feature)))
  .map(([id]) => id)
```

> 防御性双保险：UI 层已经过滤，但回写 staged 时再过滤一次，确保后端 `enabled_features` 永远不含 scope 外的项。

#### 2d. visual_only 强制 summary_path

第 308~319 行已经在写 `summary_path`：保持现状，确认 visual_only → `summary.summary_path = '只看画面'`（已 OK，无需改）。

### 3. `frontend/src/pages/WorkbenchPage/preflightTasks.ts`

#### 3a. `applyCascades` 增加 scope 参数

```ts
import type { AnalysisScope } from '@/components/workspace/AddMaterialModal'

export function applyCascades(
  kind: MediaKind,
  raw: TaskState,
  materialCount = 1,
  scope?: AnalysisScope,
): CascadeResult {
  // ... 原有逻辑保留 ...

  if (kind === 'video' && scope) {
    if (scope === 'visual_only') {
      if (s.summary) {
        s.summary = { ...s.summary, summary_path: '只看画面' }
        locks['summary.summary_path'] = '只看画面模式 · 路径已锁定'
      }
      if (s.srt)   { s.srt   = { ...s.srt,   on: false }; disabled.srt   = '只看画面无 ASR' }
      if (s.music) { s.music = { ...s.music, on: false }; disabled.music = '只看画面不分析音频' }
    }
    if (scope === 'av_combined') {
      if (s.summary) {
        s.summary = { ...s.summary, on: true, summary_path: '音视频综合' }
        locks['summary.summary_path'] = '音视频综合 · 路径已锁定'
      }
      // 原本 summary_path = 音视频综合 的级联（frame_prompt + srt）已存在，无需重复
    }
  }
  // audio_only 不需要额外动作：audio 分支级联本身就对
  return { state: s, locks, disabled }
}
```

> `locks` 原本是 `Record<groupId, reason>`；这里用 `'summary.summary_path'` 这种嵌套 key，需要在 PreflightDrawer 渲染 radio 时按这个 key 查 lock 并禁用切换。如果嫌麻烦，可以简化成 `locks.summary = '路径已锁定'` 配合在 summary group radio 控件层加 `disabled` 属性，DS 自行选实现方式，但最终效果必须是 radio 不能改。

#### 3b. `PreflightDrawer.tsx` 调用处透传 scope

约 [PreflightDrawer.tsx:151](frontend/src/pages/WorkbenchPage/PreflightDrawer.tsx:151) 附近调用 `applyCascades(kind, tasks, count)` 的地方全部加上第四个参数 `sc?.analysisScope`。`sc` 已在作用域内（hydrateTasks 已经在用）。

如果 `applyCascades` 在多处被调用，全部一起改。

### 4. 测试

#### 4a. `frontend/src/__tests__/AddMaterialModal.test.tsx` 新增 3 个 case

```ts
it('visual_only 范围下隐藏字幕导出和音乐分析 chip', () => {
  // render + click visual_only card
  expect(screen.queryByText('字幕导出')).toBeNull()
  expect(screen.queryByText('音乐分析')).toBeNull()
  expect(screen.getByText('画面提示词')).toBeInTheDocument()
  expect(screen.getByText('文案总结')).toBeInTheDocument()
})

it('av_combined 范围下显示完整 4 个 video chip', () => {
  // ...
  expect(screen.getByText('画面提示词')).toBeInTheDocument()
  expect(screen.getByText('文案总结')).toBeInTheDocument()
  expect(screen.getByText('字幕导出')).toBeInTheDocument()
  expect(screen.getByText('音乐分析')).toBeInTheDocument()
})

it('从 av_combined 切到 visual_only 时清空已勾 features', async () => {
  // 1. 选 av_combined，手动勾上音乐分析
  // 2. 切到 visual_only
  // 3. 切回 av_combined
  // 4. assert 音乐分析 chip 是未勾状态（回到 defaultChecked）
})
```

#### 4b. `frontend/src/__tests__/preflightTasks.test.ts` 新增 2 个 case

```ts
it('applyCascades(video, visual_only) 禁用 srt 和 music', () => {
  const init = buildInitialTasks('video')
  const { state, disabled } = applyCascades('video', init, 1, 'visual_only')
  expect(disabled.srt).toBeTruthy()
  expect(disabled.music).toBeTruthy()
  expect(state.summary.summary_path).toBe('只看画面')
})

it('applyCascades(video, av_combined) 锁定 summary_path = 音视频综合', () => {
  const init = buildInitialTasks('video')
  const { state } = applyCascades('video', init, 1, 'av_combined')
  expect(state.summary.summary_path).toBe('音视频综合')
  expect(state.summary.on).toBe(true)
})
```

### 5. 不需要改的地方（DS 注意别误改）

- 后端 `pipeline_tasks.py`：`summary_path = visual_only / av_combined / subtitle` 全部已支持
- `FEATURES_BY_TYPE`：保留原表，image/text 入口仍在用
- `SCOPE_META`（AddMaterialModal:52）：保留 sub 文案做底部摘要

## 验收标准

1. 弹窗里切换三个 scope card，第③区 chips 数量分别为 4 / 2 / 4
2. 在 av_combined 勾上音乐分析后切到 visual_only 再切回，音乐分析 chip 回到未勾
3. 打开细调抽屉：
   - visual_only → srt 和 music 行灰态不可勾，路径 radio 锁在「只看画面」
   - av_combined → 路径 radio 锁在「音视频综合」
   - audio_only → 与现状一致
4. 后端收到的 `enabled_features` 不含 scope 外的 feature（接口 log 检查或 e2e）
5. `npm run test` 全绿；新增 5 个 case 通过
6. `npm run build` 无 TS 错误

## 完工后

- ① `docs/EXECUTION_PLAN.md` 把 R17 打勾
- ② 本文件 frontmatter 改 `status: done` + 填 `commits` / `completed_date` / `actual_hours`
- ③ `docs/COMPLETED_WORK.md` 追加一段
- ④ commit message 建议：`fix(R17): align add-material scope with chips and preflight cascade`
