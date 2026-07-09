import { describe, expect, it } from 'vitest'

import { platformLabelFromUrl } from '@/pages/result/NoteShell/note-shell-utils'

describe('platformLabelFromUrl', () => {
  it.each([
    ['https://www.bilibili.com/video/BV1xx', 'Bilibili'],
    ['https://youtu.be/demo-id', 'YouTube'],
    ['https://v.douyin.com/iMJqS9Nn/', '抖音'],
    ['https://www.xiaohongshu.com/explore/abc123', '小红书'],
    ['http://xhslink.com/o/3w7r5xADEqD', '小红书'],
    ['https://example.com/article/1', '网页'],
  ])('maps %s to %s', (url, label) => {
    expect(platformLabelFromUrl(url)).toBe(label)
  })
})
