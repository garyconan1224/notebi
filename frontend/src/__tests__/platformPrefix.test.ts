import { describe, it, expect } from 'vitest'
import { platformPrefixFromUrl } from '@/lib/platformPrefix'

describe('platformPrefixFromUrl', () => {
  it('returns bilibili for B 站 URL', () => {
    expect(platformPrefixFromUrl('https://www.bilibili.com/video/BV1xxx')).toBe('bilibili')
  })
  it('returns youtube for both youtube.com and youtu.be', () => {
    expect(platformPrefixFromUrl('https://www.youtube.com/watch?v=x')).toBe('youtube')
    expect(platformPrefixFromUrl('https://youtu.be/x')).toBe('youtube')
  })
  it('returns xiaohongshu / douyin / kuaishou / weixin', () => {
    expect(platformPrefixFromUrl('https://www.xiaohongshu.com/explore/x')).toBe('xiaohongshu')
    expect(platformPrefixFromUrl('http://xhslink.com/o/xxx')).toBe('xiaohongshu')
    expect(platformPrefixFromUrl('https://www.douyin.com/video/x')).toBe('douyin')
    expect(platformPrefixFromUrl('https://www.kuaishou.com/short-video/x')).toBe('kuaishou')
    expect(platformPrefixFromUrl('https://mp.weixin.qq.com/s/x')).toBe('weixin')
  })
  it('falls back to second-level domain for unknown platforms', () => {
    expect(platformPrefixFromUrl('https://www.example.com/x')).toBe('example')
  })
  it('returns empty string for invalid url', () => {
    expect(platformPrefixFromUrl('')).toBe('')
    expect(platformPrefixFromUrl('not-a-url')).toBe('')
  })
})
