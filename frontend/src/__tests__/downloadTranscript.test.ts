import { beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadTranscript } from '@/services/workspaces'
import { http } from '@/services/client'

// Mock http.get
vi.mock('@/services/client', () => ({
  http: {
    get: vi.fn(),
  },
}))

// Mock DOM APIs
const mockClick = vi.fn()
const mockAppendChild = vi.fn()
const mockRemove = vi.fn()
const mockCreateObjectURL = vi.fn(() => 'blob:mock')
const mockRevokeObjectURL = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.URL.createObjectURL = mockCreateObjectURL
  globalThis.URL.revokeObjectURL = mockRevokeObjectURL
  vi.spyOn(document, 'createElement').mockReturnValue({
    href: '',
    download: '',
    click: mockClick,
    remove: mockRemove,
  } as unknown as HTMLAnchorElement)
  vi.spyOn(document.body, 'appendChild').mockImplementation(mockAppendChild)
})

describe('downloadTranscript fallback filename', () => {
  it('当响应缺少 Content-Disposition 时，fallback 文件名必须包含笔记标题', async () => {
    const title = '我的播客第一期'
    const mode = 'article'
    vi.mocked(http.get).mockResolvedValue({
      data: new Blob(['test content']),
      headers: {}, // 无 content-disposition
    })

    await downloadTranscript('ws-1', 'item-1', mode, title)

    // 验证创建了 <a> 并设置了 download 属性
    expect(document.createElement).toHaveBeenCalledWith('a')
    const anchor = vi.mocked(document.createElement).mock.results[0].value as HTMLAnchorElement
    expect(anchor.download).toContain(title)
    expect(anchor.download).toContain('转写文本')
    expect(anchor.download).not.toBe('转写文本（无时间轴）.txt') // 不能退回无标题通用名
  })

  it('speaker_grouped 模式的 fallback 文件名也必须包含标题', async () => {
    const title = '测试音频'
    const mode = 'speaker_grouped'
    vi.mocked(http.get).mockResolvedValue({
      data: new Blob(['test content']),
      headers: {},
    })

    await downloadTranscript('ws-1', 'item-1', mode, title)

    const anchor = vi.mocked(document.createElement).mock.results[0].value as HTMLAnchorElement
    expect(anchor.download).toContain(title)
    expect(anchor.download).toContain('区分说话人')
  })

  it('响应带 Content-Disposition 时以后端文件名为准', async () => {
    const backendFilename = '后端文件名-转写文本.txt'
    vi.mocked(http.get).mockResolvedValue({
      data: new Blob(['test content']),
      headers: {
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(backendFilename)}`,
      },
    })

    await downloadTranscript('ws-1', 'item-1', 'article', 'ignored-title')

    const anchor = vi.mocked(document.createElement).mock.results[0].value as HTMLAnchorElement
    expect(anchor.download).toBe(backendFilename)
  })
})
