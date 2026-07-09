import { describe, it, expect } from 'vitest'
import { nextEta } from '@/hooks/useGlobalEta'

describe('nextEta（ETA EMA 平滑跟踪 target）', () => {
  it('无估计且未显示 → -1（隐藏）', () => {
    expect(nextEta(-1, 0, false)).toBe(-1)
  })
  it('首次（prev<0）有 target → 直接用 target', () => {
    expect(nextEta(-1, 30, false)).toBe(30)
  })
  it('活跃任务集合变化 → 重新基线到 target', () => {
    expect(nextEta(3, 80, true)).toBe(80)
  })
  it('向 target 平滑收敛（向上修正，不卡在小值）', () => {
    // 0.3*80 + 0.7*10 = 31
    expect(nextEta(10, 80, false)).toBe(31)
  })
  it('稳定推进：target 略小于 prev → 平滑下降（保留倒计时手感）', () => {
    // 0.3*27 + 0.7*30 = 29.1 → 29
    expect(nextEta(30, 27, false)).toBe(29)
  })
  it('不会减过头：target 大时多次迭代收敛到 target 附近而非 1', () => {
    let e = 50
    for (let i = 0; i < 40; i++) e = nextEta(e, 80, false)
    expect(e).toBeGreaterThan(75)
  })
  it('不落 0：保持 ≥1', () => {
    expect(nextEta(2, 1, false)).toBeGreaterThanOrEqual(1)
  })
  it('target<=0（速率暂时丢失）→ 保持上一个显示值', () => {
    expect(nextEta(20, 0, false)).toBe(20)
  })
})
