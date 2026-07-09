import { describe, it, expect } from 'vitest'
import { normalizeMediaUrl } from '@/lib/url'

describe('normalizeMediaUrl', () => {
  it('纯 BV 号 → 完整 B 站 URL', () => {
    expect(normalizeMediaUrl('BV1qA5j6jEJC')).toBe(
      'https://www.bilibili.com/video/BV1qA5j6jEJC'
    )
  })

  it('缺 scheme → 补 https://', () => {
    expect(normalizeMediaUrl('bilibili.com/video/BV1xx/')).toBe(
      'https://bilibili.com/video/BV1xx'
    )
  })

  it('带追踪参数 → 参数被移除', () => {
    const raw = 'https://www.bilibili.com/video/BV1qA5j6jEJC/?spm_id_from=333.1007&vd_source=d0c732f14ae6900c501b38a4d1c34b7d'
    expect(normalizeMediaUrl(raw)).toBe(
      'https://www.bilibili.com/video/BV1qA5j6jEJC'
    )
  })

  it('已规整 URL → 无变化', () => {
    const clean = 'https://www.bilibili.com/video/BV1qA5j6jEJC'
    expect(normalizeMediaUrl(clean)).toBe(clean)
  })

  it('末尾斜杠 → 移除', () => {
    expect(normalizeMediaUrl('https://www.bilibili.com/video/BV1qA5j6jEJC/')).toBe(
      'https://www.bilibili.com/video/BV1qA5j6jEJC'
    )
  })

  it('抖音分享文案 → 提取纯短链', () => {
    const shareText =
      '8.92 复制打开抖音，看看【光郡的作品】地毯式最强之一智能体Codex零基础攻略 # ag... https://v.douyin.com/VXJAb-M34nc/ :9pm 01/06 nda:/ r@E.hb'
    expect(normalizeMediaUrl(shareText)).toBe('https://v.douyin.com/VXJAb-M34nc')
  })

  it('纯抖音短链 → 不受影响', () => {
    expect(normalizeMediaUrl('https://v.douyin.com/iJvcK8CLC_o/')).toBe(
      'https://v.douyin.com/iJvcK8CLC_o'
    )
  })

  it('保留非追踪参数', () => {
    const raw = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxxx'
    const result = normalizeMediaUrl(raw)
    expect(result).toContain('v=dQw4w9WgXcQ')
    expect(result).toContain('list=PLxxx')
  })

  it('小红书图文分享文案 → 提取纯链接', () => {
    const shareText =
      '【小红书】快来查看我的笔记 http://xhslink.com/o/3w7r5xADEqD 复制本条笔记，打开小红书看更多精彩内容！'
    expect(normalizeMediaUrl(shareText)).toBe('http://xhslink.com/o/3w7r5xADEqD')
  })

  it('小红书视频分享文案 → 提取纯链接', () => {
    const shareText =
      '7 求求你们去试试这个发型好吗 http://xhslink.com/o/c7LCUZRTFn 复制本条笔记，打开小红书看更多精彩内容！'
    expect(normalizeMediaUrl(shareText)).toBe('http://xhslink.com/o/c7LCUZRTFn')
  })

  it('通用分享文案（无平台特定规则）→ 提取第一个 URL', () => {
    const shareText =
      '快来看看这个视频 https://example.com/watch?v=abc123 很有意思哦'
    expect(normalizeMediaUrl(shareText)).toBe('https://example.com/watch?v=abc123')
  })

  it('分享文案含中文标点 → URL 尾部标点被去除', () => {
    const shareText = '点击链接 https://example.com/page，快来！'
    expect(normalizeMediaUrl(shareText)).toBe('https://example.com/page')
  })
})
