import { describe, expect, it } from 'vitest'
import { parseTs, TS_RE } from '@/pages/results/LearningNotesPage/HtmlView'

describe('parseTs', () => {
  it('解析 mm:ss', () => {
    expect(parseTs('0:12')).toBe(12)
    expect(parseTs('1:30')).toBe(90)
    expect(parseTs('12:00')).toBe(720)
  })

  it('解析 hh:mm:ss', () => {
    expect(parseTs('1:00:00')).toBe(3600)
    expect(parseTs('0:01:30')).toBe(90)
    expect(parseTs('2:30:45')).toBe(9045)
  })
})

describe('TS_RE 正则匹配', () => {
  function extractTs(text: string): string[] {
    const matches: string[] = []
    TS_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = TS_RE.exec(text)) !== null) {
      matches.push(m[0])
    }
    return matches
  }

  it('匹配 [mm:ss]', () => {
    expect(extractTs('在 [01:30] 处讲解了')).toEqual(['[01:30]'])
  })

  it('匹配 [mm:ss~mm:ss] 区间', () => {
    expect(extractTs('参考 [01:30~05:00] 这段')).toEqual(['[01:30~05:00]'])
  })

  it('匹配 [hh:mm:ss]', () => {
    expect(extractTs('从 [1:05:30] 开始')).toEqual(['[1:05:30]'])
  })

  it('匹配多个时间戳', () => {
    expect(extractTs('见 [00:12] 和 [01:30~05:00]')).toEqual(['[00:12]', '[01:30~05:00]'])
  })

  it('不匹配普通方括号', () => {
    expect(extractTs('[注意] 这不是时间戳')).toEqual([])
  })

  it('区间取起点秒数', () => {
    const text = '[01:30~05:00]'
    TS_RE.lastIndex = 0
    const m = TS_RE.exec(text)
    expect(m).not.toBeNull()
    expect(parseTs(m![1])).toBe(90) // 1:30 = 90 秒
  })
})
