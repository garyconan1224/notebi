---
title: Track K · R4.1 重写 useGlobalEta（修 ETA 倒计时循环/跳变）
status: ready
owner: mimo（执行）/ Claude（已定方案+目标代码）
depends_on: R4（track-K-R4-settings-and-regression-fix.md §1.1）
created: 2026-06-10
context: Claude 已读实际代码 + 调研 GitHub(alive-progress/ewma) 定方案，mimo 照本卡执行即可，逻辑不用自己想
---

# Track K · R4.1：重写 `useGlobalEta`

> ⚠️ **2026-06-10 v2 修正（实测后的最终方案）**：v1 的「单调递减 `min(prev-1, target)`」**实测会减过头**——截帧 60%、后面还有 vlm+sum 时 ETA 却减到 1s。根因：`min` 只能在「真实更快」时让显示值加速下降，**托不住下降**，稳定期会无脑每秒减 1 一直到 1，无视真实 target。**已由 Claude 改为 EMA 平滑跟踪 target**：`nextEta = α·target + (1-α)·prev`（α=`SMOOTHING`=0.3），显示值向真实剩余收敛、不再减过头，α 同时压平阶段切换抖动。**最终实现以 git 为准**（fix commit，见 §6），下方 §2/§3/§4 的 v1 描述仅留档、勿照抄。
>
> 📌 给 mimo：本卡是**唯一执行依据**。目标代码已写好，你**整文件替换 + 加一个单测 + 跑验证**就行，**不要自己改算法**。两个 commit。

---

## 0. 一句话目标

把 `frontend/src/hooks/useGlobalEta.ts` 换成下面 §3 的目标代码（修掉倒计时循环/跳变/卡顿），再加 §4 的单测，跑通验证。

---

## 1. 当前 bug（已定位，不用你再查）

文件：`frontend/src/hooks/useGlobalEta.ts`（旧版，gemini 写的）。三个问题：

1. **倒计时卡顿**：两个 `useEffect` 都依赖 `[tasks]` 且都 `setEta`。每次后端推进度→`tasks` 变→定时器被 `clearInterval`+重建。进度更新比 1 秒快时，「每秒减 1」几乎执行不到 → 倒计时不连贯。
2. **ETA 往上跳**：旧版 `hasFreshUpdate` 时直接用新算的值、不做单调约束。阶段切换（转写→VLM 速率突变）时 ETA 会突然变大、跳上去。
3. **难维护**：旧版有 `prev*0.7 + ideal*0.3` 阻尼、`stallPenalty` 等魔法数，没人看得懂。

---

## 2. 方案（Claude 已定，照做即可）

- **拆成两个互不打架的职责**：
  - 采样 `useEffect`（依赖 `[tasks]`）：进度变化时把 `(进度, 时间戳)` 推入每个任务的滚动窗口（保留最近 5 个样本），并把最新 `tasks` 存到 `tasksRef`。**只采样，不碰显示值。**
  - 倒计时 `useEffect`（依赖 `[]`，**整个生命周期只建一次**）：每秒读 ref 算 `target = Σ(剩余进度 / 速率)`，用纯函数 `nextEta` 更新显示值。
- **显示值规则（纯函数 `nextEta`）**：
  - 首次 / 活跃任务集合变化 → 校准到 `target`（允许跳，重新基线）。
  - 稳定期 → `min(prev-1, target)`：每秒至少减 1，**永不上跳**；真实更快完成时跟着降。
  - 不落 0：保持 ≥1，任务全部结束后由定时器置 -1（隐藏）。
- **保留** gemini 原来不错的「滑动窗口算速率」（对阶段切换响应快）。**去掉**所有阻尼/penalty 魔法数。

---

## 3. 目标代码（Step 1：整文件替换 `frontend/src/hooks/useGlobalEta.ts`）

> 用编辑器**整个文件内容替换**成下面这段，不要东拼西凑。

```typescript
import { useEffect, useRef, useState } from 'react'
import { useTaskStore } from '@/store/taskStore'
import { isTaskTerminal } from '@/types/task'

/** 进度样本：进度值 + 时间戳（ms） */
interface ProgressSample {
  p: number
  t: number
}

const WINDOW_SIZE = 5 // 每个任务保留的进度样本数

/**
 * 计算下一个 ETA 显示值（纯函数，便于单测）。
 *
 * 规则：
 * - target<=0（速率还没估出来 / 无活跃）：已在显示中就继续每秒减 1（不低于 1），否则 -1 隐藏。
 * - 首次（prev<0）或活跃任务集合变化（changed）：校准到 target（允许跳，重新基线）。
 * - 稳定期：每秒至少减 1 且永不上跳 —— min(prev-1, target)，不低于 1（不落 0）。
 */
export function nextEta(prev: number, target: number, changed: boolean): number {
  if (target <= 0) return prev > 0 ? Math.max(1, prev - 1) : -1
  if (prev < 0 || changed) return Math.max(1, target)
  return Math.max(1, Math.min(prev - 1, target))
}

/**
 * 全局 ETA：所有活跃任务剩余秒数之和（秒）。无活跃任务返回 -1（不显示）。
 *
 * 设计（2026-06 简洁版重写，替换旧的双 effect 版）：
 * - 采样 effect（依赖 tasks）：进度变化时把 (progress, 时间戳) 推入每个任务的滚动窗口，
 *   并把最新 tasks 同步到 tasksRef 供定时器读取。只采样，不改显示值。
 * - 倒计时 effect（依赖 []，整个生命周期只建一次）：每秒读 ref 算 target=Σ(剩余/速率)，
 *   用 nextEta 更新显示值。
 *
 * 修掉旧版三个问题：
 * 1. 旧版两个 effect 都依赖 tasks 且都 setEta → 进度更新频繁时定时器被反复重建、
 *    「每秒减1」几乎执行不到（倒计时卡顿）。本版定时器依赖 [] 只建一次。
 * 2. 旧版 hasFreshUpdate 时不做单调约束 → 阶段切换 ETA 上跳。本版 nextEta 严格单调递减。
 * 3. 去掉旧版的阻尼系数(0.7/0.3)、stallPenalty 等魔法数。
 */
export function useGlobalEta(): number {
  const tasks = useTaskStore((s) => s.tasks)
  const [eta, setEta] = useState(-1)

  const tasksRef = useRef(tasks)
  const samplesRef = useRef<Map<string, ProgressSample[]>>(new Map())
  const cachedRateRef = useRef<Map<string, number>>(new Map())
  const lastActiveKeyRef = useRef('')

  /** 滚动窗口首尾算速率（进度/秒）；样本不足时沿用缓存值 */
  function calcRate(taskId: string): number {
    const samples = samplesRef.current.get(taskId)
    if (!samples || samples.length < 2) {
      return cachedRateRef.current.get(taskId) ?? 0
    }
    const oldest = samples[0]
    const newest = samples[samples.length - 1]
    const dt = (newest.t - oldest.t) / 1000
    if (dt <= 0) return cachedRateRef.current.get(taskId) ?? 0
    const rate = (newest.p - oldest.p) / dt
    if (rate > 0) cachedRateRef.current.set(taskId, rate)
    return rate
  }

  // 采样：进度变化时推样本 + 同步最新 tasks 到 ref（不改显示值）
  useEffect(() => {
    tasksRef.current = tasks
    const now = Date.now()
    for (const t of tasks) {
      if (isTaskTerminal(t.status) || t.progress <= 0 || t.progress >= 1) continue
      const samples = samplesRef.current.get(t.task_id) ?? []
      const last = samples[samples.length - 1]
      if (!last || t.progress !== last.p) {
        const merged = [...samples, { p: t.progress, t: now }]
        if (merged.length > WINDOW_SIZE) merged.splice(0, merged.length - WINDOW_SIZE)
        samplesRef.current.set(t.task_id, merged)
      }
    }
  }, [tasks])

  // 倒计时：每秒一次，整个生命周期只建一次
  useEffect(() => {
    const timer = setInterval(() => {
      const active = tasksRef.current.filter(
        (t) => !isTaskTerminal(t.status) && t.progress > 0 && t.progress < 1,
      )
      if (active.length === 0) {
        lastActiveKeyRef.current = ''
        setEta(-1)
        return
      }
      let target = 0
      for (const t of active) {
        const rate = calcRate(t.task_id)
        if (rate > 0) target += (1 - t.progress) / rate
      }
      const targetSec = Math.round(target)
      const activeKey = active
        .map((t) => t.task_id)
        .sort()
        .join(',')
      const changed = activeKey !== lastActiveKeyRef.current
      lastActiveKeyRef.current = activeKey
      setEta((prev) => nextEta(prev, targetSec, changed))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  return eta
}
```

> ✅ 返回值语义没变（`-1` 隐藏 / `≥1` 显示秒数），调用方 `ProcessingPage/index.tsx`（`etaSec > 0 && ...`）和 `SystemResourceCard` **不用动**。

---

## 4. 单测（Step 2：新建 `frontend/src/__tests__/useGlobalEta.test.ts`）

> 只测纯函数 `nextEta`，**不用 mock 定时器或 store**，跑得动。整文件照抄：

```typescript
import { describe, it, expect } from 'vitest'
import { nextEta } from '@/hooks/useGlobalEta'

describe('nextEta（ETA 单调递减规则）', () => {
  it('无活跃/无速率且未显示 → -1（隐藏）', () => {
    expect(nextEta(-1, 0, false)).toBe(-1)
  })
  it('首次（prev<0）有 target → 校准到 target', () => {
    expect(nextEta(-1, 30, false)).toBe(30)
  })
  it('稳定期每秒至少减 1', () => {
    expect(nextEta(30, 30, false)).toBe(29)
  })
  it('永不上跳：target 暴涨也只减 1', () => {
    expect(nextEta(10, 100, false)).toBe(9)
  })
  it('真实更快完成 → 跟降到 target', () => {
    expect(nextEta(30, 5, false)).toBe(5)
  })
  it('活跃任务集合变化 → 校准（允许跳到 target）', () => {
    expect(nextEta(3, 80, true)).toBe(80)
  })
  it('不落 0：减到 1 后保持 1', () => {
    expect(nextEta(1, 30, false)).toBe(1)
  })
  it('显示中但 target 掉到 0 → 继续减 1 不低于 1', () => {
    expect(nextEta(5, 0, false)).toBe(4)
  })
})
```

---

## 5. 验证（自己跑，报数字，不要贴日志）

```bash
cd /Users/conan/Desktop/nibi/frontend
npx tsc --noEmit              # 期望 EXIT=0（无类型错误）
pnpm test --run useGlobalEta  # 期望 8 passed
```

- 两条都过 → 报「tsc EXIT=0 / vitest 8 passed」。
- 「实际倒计时观感」（数字平滑递减、不跳、不循环）属动态 UI，**请用户跑 `./dev.sh` 看**，你不用截图。

---

## 6. 提交（两个 commit，别揉一起）

```
Step 1 提交：feat(k-10.R4.1): 重写 useGlobalEta — 单 timer + 单调递减，修 ETA 循环/跳变/卡顿
Step 2 提交：test(k-10.R4.1): nextEta 纯函数单测（单调递减/不落0/集合变化校准）
```

> 结尾带仓库现有的 Co-Authored-By 行。**不要 push origin**（开源前暂缓）。

---

## 7. 红线 / 不确定怎么办

- ❌ 不要改算法、不要"优化"目标代码、不要动 `ProcessingPage`/`SystemResourceCard`/`taskStore`。
- ❌ 不装新依赖、不改 `.env`、不 push、不 `git reset --hard`。
- ⚠️ 若 `@/types/task` 没有 `isTaskTerminal` 或 `task.progress`/`task_id` 字段对不上（理论上有，Claude 已确认）→ **先 `rg` 确认，对不上就停下来问用户**，不要自己改字段名。
- ⚠️ 若 `pnpm test` 命令名/配置和上面不符 → 看 `frontend/package.json` 的 `scripts.test`，按实际命令跑。
