import { describe, expect, it } from 'vitest'

import {
  decodeProxySrc,
  previewSrcForProxy,
} from '@/components/workspace/linkCover'

describe('previewSrcForProxy', () => {
  it('远程 http 图片返回后端代理地址', () => {
    expect(previewSrcForProxy('https://i0.hdslb.com/a.jpg')).toBe(
      '/api/image_proxy?url=' + encodeURIComponent('https://i0.hdslb.com/a.jpg'),
    )
  })

  it('支持注入自定义 base（测试用）', () => {
    expect(
      previewSrcForProxy('https://example.com/a.png', 'http://127.0.0.1:8001/api/image_proxy'),
    ).toBe(
      'http://127.0.0.1:8001/api/image_proxy?url=' +
        encodeURIComponent('https://example.com/a.png'),
    )
  })

  it('站内 /static 与相对路径原样返回', () => {
    expect(previewSrcForProxy('/static/frames/1.jpg')).toBe('/static/frames/1.jpg')
    expect(previewSrcForProxy('/frames/1.jpg')).toBe('/frames/1.jpg')
  })

  it('协议相对地址补 https 后走代理', () => {
    expect(previewSrcForProxy('//i0.hdslb.com/a.jpg')).toBe(
      '/api/image_proxy?url=' + encodeURIComponent('https://i0.hdslb.com/a.jpg'),
    )
  })

  it('空值与非法协议返回空字符串', () => {
    expect(previewSrcForProxy('')).toBe('')
    expect(previewSrcForProxy(null)).toBe('')
    expect(previewSrcForProxy('javascript:alert(1)')).toBe('')
    expect(previewSrcForProxy('data:image/png;base64,AA')).toBe('')
    expect(previewSrcForProxy('frames/1.jpg')).toBe('')
  })
})

describe('decodeProxySrc', () => {
  it('还原代理地址中的原始 URL', () => {
    const original = 'https://i0.hdslb.com/a.jpg'
    const proxied = '/api/image_proxy?url=' + encodeURIComponent(original)
    expect(decodeProxySrc(proxied)).toBe(original)
  })

  it('非代理地址原样返回', () => {
    expect(decodeProxySrc('https://i0.hdslb.com/a.jpg')).toBe('https://i0.hdslb.com/a.jpg')
    expect(decodeProxySrc('/static/frames/1.jpg')).toBe('/static/frames/1.jpg')
  })
})
