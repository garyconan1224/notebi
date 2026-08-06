import '@testing-library/jest-dom'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AddMaterialModal } from '@/components/workspace/AddMaterialModal'

const {
  navigateMock,
  sniffUrlMock,
  probeDurationMock,
  autoCreateWorkspaceMock,
  ensureInboxMock,
  generateNoteMock,
  addWorkspaceItemMock,
  savePreflightMock,
  startItemPipelineMock,
  updateWorkspaceMock,
  resolveBatchSourceMock,
  importBatchSourceMock,
  createTaskBatchMock,
  getWorkspaceMock,
  fetchLinkPreviewMock,
  fetchTemplatesMock,
  getTaskDefaultsMock,
  fetchProvidersMock,
  providerState,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  sniffUrlMock: vi.fn(),
  probeDurationMock: vi.fn(),
  autoCreateWorkspaceMock: vi.fn(),
  ensureInboxMock: vi.fn(),
  generateNoteMock: vi.fn(),
  addWorkspaceItemMock: vi.fn(),
  savePreflightMock: vi.fn(),
  startItemPipelineMock: vi.fn(),
  updateWorkspaceMock: vi.fn(),
  resolveBatchSourceMock: vi.fn(),
  importBatchSourceMock: vi.fn(),
  createTaskBatchMock: vi.fn(),
  getWorkspaceMock: vi.fn(),
  fetchLinkPreviewMock: vi.fn(),
  fetchTemplatesMock: vi.fn(),
  getTaskDefaultsMock: vi.fn(),
  fetchProvidersMock: vi.fn(),
  providerState: {
    providers: [{ id: 'p1', name: 'TestProvider', enabled: true, capabilities: ['vision'] }],
    providerModels: { p1: [{ id: 'm1', name: 'TestModel', capabilities: ['vision'] }] },
  } as {
    providers: Array<{ id: string; name: string; enabled: boolean; capabilities: string[] }>
    providerModels: Record<string, Array<{ id: string; name: string; capabilities: string[] }>>
  },
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useLocation: () => ({ pathname: '/library' }),
}))

vi.mock('@/services/workspaces', () => ({
  sniffUrl: sniffUrlMock,
  probeDuration: probeDurationMock,
  autoCreateWorkspace: autoCreateWorkspaceMock,
  ensureInbox: ensureInboxMock,
  addWorkspaceItem: addWorkspaceItemMock,
  savePreflight: savePreflightMock,
  startItemPipeline: startItemPipelineMock,
  generateNote: generateNoteMock,
  updateWorkspace: updateWorkspaceMock,
  resolveBatchSource: resolveBatchSourceMock,
  importBatchSource: importBatchSourceMock,
  getWorkspace: getWorkspaceMock,
}))

vi.mock('@/services/taskBatches', () => ({
  createTaskBatch: createTaskBatchMock,
}))

vi.mock('@/services/taskDefaults', () => ({
  getTaskDefaults: getTaskDefaultsMock,
}))

vi.mock('@/services/linkPreview', () => ({
  fetchLinkPreview: fetchLinkPreviewMock,
}))

vi.mock('@/services/templates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/templates')>()
  return { ...actual, fetchTemplates: fetchTemplatesMock }
})

vi.mock('@/store/providerStore', () => ({
  useProviderStore: vi.fn(() => ({
    ...providerState,
    fetchProviders: fetchProvidersMock,
  })),
}))

describe('AddMaterialModal', () => {
  beforeEach(() => {
    navigateMock.mockClear()
    sniffUrlMock.mockReset()
    probeDurationMock.mockReset()
    autoCreateWorkspaceMock.mockReset()
    ensureInboxMock.mockReset()
    generateNoteMock.mockReset()
    addWorkspaceItemMock.mockReset()
    savePreflightMock.mockReset()
    startItemPipelineMock.mockReset()
    updateWorkspaceMock.mockReset()
    resolveBatchSourceMock.mockReset()
    importBatchSourceMock.mockReset()
    createTaskBatchMock.mockReset()
    getWorkspaceMock.mockReset()
    fetchLinkPreviewMock.mockReset()
    fetchTemplatesMock.mockReset()
    fetchTemplatesMock.mockResolvedValue([])
    getTaskDefaultsMock.mockResolvedValue({
      summary_template: 'standard',
      video_frame_analysis: true,
      frame_interval_sec: 5,
      diarize: false,
      speaker_count: null,
    })
    providerState.providers = [{ id: 'p1', name: 'TestProvider', enabled: true, capabilities: ['vision'] }]
    providerState.providerModels = { p1: [{ id: 'm1', name: 'TestModel', capabilities: ['vision'] }] }
    fetchProvidersMock.mockReset()
    probeDurationMock.mockResolvedValue({ duration_sec: 0 })
    fetchLinkPreviewMock.mockImplementation(() => new Promise(() => {}))
    generateNoteMock.mockResolvedValue({
      task_id: 'task-note-1',
      task_type: 'note',
      item_type: 'video',
      item_id: 'item-1',
      workspace: {},
    })
    resolveBatchSourceMock.mockResolvedValue({
      source_type: 'multi_url',
      source_url: '',
      title: '批量合集',
      items: [{
        source_url: 'https://example.com/1',
        title: '第一条',
        platform: 'youtube',
        index: 1,
        external_id: 'video-1',
      }],
    })
    importBatchSourceMock.mockResolvedValue({
      workspace: { workspace_id: 'legacy-ws' },
      items_added: 1,
      tasks: [{ task_id: 'legacy-task' }],
    })
    createTaskBatchMock.mockResolvedValue({
      batch_id: 'batch-1',
      target_workspace_id: 'workspace-1',
      items: [],
    })
    getWorkspaceMock.mockResolvedValue({
      workspace_id: 'workspace-1',
      name: '批量合集',
      items: [],
    })
  })

  it('uses a wide dialog instead of inheriting the default max-w-lg limit', () => {
    render(
      <AddMaterialModal
        open
        onOpenChange={vi.fn()}
        workspaceIds={[]}
      />,
    )

    expect(document.querySelector('[data-slot="dialog-content"]')?.className).toContain('!max-w-none')
  })

  it('图片链接无封面时用链接本身作为封面并经代理展示', async () => {
    fetchLinkPreviewMock.mockResolvedValue({
      title: null,
      description: null,
      image_url: null,
      source: 'fallback',
    })
    render(
      <AddMaterialModal
        open
        onOpenChange={vi.fn()}
        workspaceIds={[]}
        urlValue="https://example.com/photo.png"
        sniffResult={{
          primary_type: 'image',
          possible_types: ['image'],
          platform: 'example',
          title: '示例图片',
          thumbnail: null,
          content_type_header: 'image/png',
        }}
      />,
    )

    const img = await waitFor(() => {
      const node = document.querySelector('.sniff-thumb img')
      if (!node) throw new Error('封面未渲染')
      return node as HTMLImageElement
    })
    expect(img.getAttribute('src')).toContain('/api/image_proxy?url=')
    expect(decodeURIComponent(img.getAttribute('src') ?? '')).toContain(
      'https://example.com/photo.png',
    )
  })

  it('单条 B 站视频复用批量解析器拿封面（与批量策略一致）', async () => {
    resolveBatchSourceMock.mockResolvedValueOnce({
      source_type: 'bilibili_multipart',
      source_url: 'https://www.bilibili.com/video/BV1fjGG6AEAP',
      title: '批量来源',
      items: [{
        source_url: 'https://www.bilibili.com/video/BV1fjGG6AEAP?p=1',
        title: '视频标题',
        platform: 'bilibili',
        index: 1,
        duration_seconds: 331,
        thumbnail: 'http://i0.hdslb.com/bfs/archive/cover.jpg',
        external_id: 'BV1fjGG6AEAP:p1',
      }],
    })
    render(
      <AddMaterialModal
        open
        onOpenChange={vi.fn()}
        workspaceIds={[]}
        urlValue="https://www.bilibili.com/video/BV1fjGG6AEAP/"
        sniffResult={{
          primary_type: 'video',
          possible_types: ['video'],
          platform: 'bilibili',
          title: null,
          thumbnail: null,
          content_type_header: null,
        }}
      />,
    )

    const img = await waitFor(() => {
      const node = document.querySelector('.sniff-thumb img')
      if (!node) throw new Error('封面未渲染')
      return node as HTMLImageElement
    })
    expect(resolveBatchSourceMock).toHaveBeenCalledWith('https://www.bilibili.com/video/BV1fjGG6AEAP/')
    expect(img.getAttribute('src')).toContain('/api/image_proxy?url=')
    expect(decodeURIComponent(img.getAttribute('src') ?? '')).toContain(
      'http://i0.hdslb.com/bfs/archive/cover.jpg',
    )
  })

  it('B站链接已失效时给出明确提示而不是只显示占位', async () => {
    fetchLinkPreviewMock.mockResolvedValue({
      title: '视频去哪了呢？_哔哩哔哩_bilibili',
      description: '',
      image_url: null,
      source: 'og',
    })
    render(
      <AddMaterialModal
        open
        onOpenChange={vi.fn()}
        workspaceIds={[]}
        urlValue="https://www.bilibili.com/video/BV1fjGQ6AEAP/"
        sniffResult={{
          primary_type: 'video',
          possible_types: ['video'],
          platform: 'bilibili',
          title: null,
          thumbnail: null,
          content_type_header: null,
        }}
      />,
    )

    expect(await screen.findByText(/该视频可能已失效或删除/)).toBeInTheDocument()
  })

  it('切换到音频笔记后从 style_audio 加载风格模板', async () => {
    render(
      <AddMaterialModal
        open
        onOpenChange={vi.fn()}
        workspaceIds={[]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /音频笔记/ }))

    await waitFor(() => {
      expect(fetchTemplatesMock).toHaveBeenCalledWith('style_audio')
    })
  })

  it('打开时读取任务默认值并传入真实生成请求', async () => {
    getTaskDefaultsMock.mockResolvedValue({
      summary_template: 'detailed',
      video_frame_analysis: false,
      frame_interval_sec: 12,
      diarize: true,
      speaker_count: 3,
    })
    render(
      <AddMaterialModal
        open
        onOpenChange={vi.fn()}
        workspaceIds={['ws-1']}
        urlValue="https://example.com/video"
        sniffResult={{
          primary_type: 'video',
          possible_types: ['video'],
          platform: 'example',
          title: '默认值视频',
          thumbnail: null,
          content_type_header: null,
        }}
      />,
    )

    await waitFor(() => expect(getTaskDefaultsMock).toHaveBeenCalled())
    expect(await screen.findByText('详细要点')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /开始生成/ }))

    await waitFor(() => expect(generateNoteMock).toHaveBeenCalled())
    expect(generateNoteMock.mock.calls[0]).toEqual([
      'ws-1',
      'https://example.com/video',
      '默认值视频',
      false,
      'vision',
      12,
      '',
      'note',
      'auto',
      expect.objectContaining({
        diarize: true,
        speaker_count: 3,
        summary_template: 'detailed',
        summary_mode: 'speaker_aware',
      }),
      '',
    ])
  })

  it('视觉模型晚于默认值加载时仍保留关闭画面分析的默认值', async () => {
    providerState.providers = []
    providerState.providerModels = {}
    getTaskDefaultsMock.mockResolvedValue({
      summary_template: 'standard',
      video_frame_analysis: false,
      frame_interval_sec: 9,
      diarize: false,
      speaker_count: null,
    })
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      workspaceIds: ['ws-1'],
      urlValue: 'https://example.com/late-provider',
      sniffResult: {
        primary_type: 'video' as const,
        possible_types: ['video'] as Array<'video'>,
        platform: 'example',
        title: '晚加载模型',
        thumbnail: null,
        content_type_header: null,
      },
    }
    const { rerender } = render(<AddMaterialModal {...props} />)

    await waitFor(() => expect(getTaskDefaultsMock).toHaveBeenCalled())
    providerState.providers = [{ id: 'p1', name: 'TestProvider', enabled: true, capabilities: ['vision'] }]
    providerState.providerModels = { p1: [{ id: 'm1', name: 'TestModel', capabilities: ['vision'] }] }
    rerender(<AddMaterialModal {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /开始生成/ }))

    await waitFor(() => expect(generateNoteMock).toHaveBeenCalled())
    expect(generateNoteMock.mock.calls[0][3]).toBe(false)
  })

  it('显示三层入口，不显示手动分析模式', () => {
    render(
      <AddMaterialModal
        open={true}
        onOpenChange={vi.fn()}
        workspaceIds={['ws-1']}
        sniffResult={{
          primary_type: 'video',
          possible_types: ['video', 'audio'],
          platform: 'bilibili',
          title: 'test video',
          thumbnail: null,
          content_type_header: null,
        }}
      />,
    )

    expect(screen.getByText('② 合集归属')).toBeTruthy()
    expect(screen.getByText('③ 笔记设置')).toBeTruthy()
    expect(screen.getByText('test video')).toBeTruthy()
    expect(screen.getByText('已识别视频')).toBeTruthy()
    expect(screen.getByRole('button', { name: /开始生成/ })).toBeTruthy()
    expect(screen.queryByText(/分析范围/)).toBeNull()
    expect(screen.queryByText(/勾选分析任务/)).toBeNull()
    expect(screen.queryByText(/音视频综合/)).toBeNull()
    expect(screen.queryByText(/综合笔记/)).toBeNull()
    expect(screen.queryByText('一键解析')).toBeNull()
  })

  it('可在弹窗内选择目标合集', () => {
    const onWorkspaceIdsChange = vi.fn()

    render(
      <AddMaterialModal
        open={true}
        onOpenChange={vi.fn()}
        workspaceIds={[]}
        availableWorkspaces={[
          {
            workspace_id: 'ws-note-1',
            name: '课程合集',
            kind: 'note',
            status: 'active',
            trashed: false,
            background: { content_type: '', participants: [], topic: '', glossary: [], purpose: '' },
            items: [],
            favorites: [],
            created_at: '2026-06-28T00:00:00Z',
            updated_at: '2026-06-28T00:00:00Z',
            source: 'manual',
          },
        ]}
        onWorkspaceIdsChange={onWorkspaceIdsChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /选择合集/ }))
    fireEvent.click(screen.getByRole('button', { name: /课程合集/ }))

    expect(onWorkspaceIdsChange).toHaveBeenCalledWith(['ws-note-1'])
  })

  it('双击当前合集名可重命名', async () => {
    updateWorkspaceMock.mockResolvedValue({
      workspace_id: 'ws-note-1',
      name: '重命名后的合集',
      kind: 'note',
      status: 'active',
      trashed: false,
      background: { content_type: '', participants: [], topic: '', glossary: [], purpose: '' },
      items: [],
      favorites: [],
      created_at: '2026-06-28T00:00:00Z',
      updated_at: '2026-06-28T00:00:00Z',
      source: 'manual',
    })

    render(
      <AddMaterialModal
        open={true}
        onOpenChange={vi.fn()}
        workspaceIds={['ws-note-1']}
        availableWorkspaces={[
          {
            workspace_id: 'ws-note-1',
            name: '课程合集',
            kind: 'note',
            status: 'active',
            trashed: false,
            background: { content_type: '', participants: [], topic: '', glossary: [], purpose: '' },
            items: [],
            favorites: [],
            created_at: '2026-06-28T00:00:00Z',
            updated_at: '2026-06-28T00:00:00Z',
            source: 'manual',
          },
        ]}
      />,
    )

    fireEvent.doubleClick(screen.getByText('课程合集'))
    const input = screen.getByDisplayValue('课程合集')
    fireEvent.change(input, { target: { value: '重命名后的合集' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(updateWorkspaceMock).toHaveBeenCalledWith('ws-note-1', { name: '重命名后的合集' })
    })
    expect(screen.getByText('重命名后的合集')).toBeTruthy()
  })

  it('提交时只调用 generateNote 并跳转到 note task processing', async () => {
    const onAdded = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <AddMaterialModal
        open={true}
        onOpenChange={onOpenChange}
        workspaceIds={['ws-1']}
        urlValue="https://example.com/video"
        onAdded={onAdded}
        sniffResult={{
          primary_type: 'video',
          possible_types: ['video'],
          platform: 'bilibili',
          title: '测试视频',
          thumbnail: null,
          content_type_header: null,
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /图文笔记/ }))
    fireEvent.click(screen.getByRole('button', { name: /开始生成/ }))

    await waitFor(() => {
      expect(generateNoteMock).toHaveBeenCalledWith(
        'ws-1',
        'https://example.com/video',
        '测试视频',
        true,
        'vision',
        10,
        '',
        'note',
        'image_text',
        { diarize: false, summary_template: 'standard', user_notes: '' },
        '',
      )
    })
    expect(addWorkspaceItemMock).not.toHaveBeenCalled()
    expect(savePreflightMock).not.toHaveBeenCalled()
    expect(startItemPipelineMock).not.toHaveBeenCalled()
    expect(onAdded).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(navigateMock).toHaveBeenCalledWith('/processing/task-note-1', {
      state: {
        url: 'https://example.com/video',
        workspaceId: 'ws-1',
        taskType: 'note',
        itemId: 'item-1',
        itemType: 'video',
      },
    })
  })

  it('B 站视频链接带 favlist 来源参数时仍按单条内容提交', async () => {
    const url = 'https://www.bilibili.com/video/BV1y1QzB1EK3/?spm_id_from=333.1387.favlist.content.click&vd_source=d0c732f14ae6900c501b38a4d1c34b7d'

    render(
      <AddMaterialModal
        open={true}
        onOpenChange={vi.fn()}
        workspaceIds={['ws-1']}
        urlValue={url}
        sniffResult={{
          primary_type: 'video',
          possible_types: ['video'],
          platform: 'bilibili',
          title: '收藏夹来源单条视频',
          thumbnail: null,
          content_type_header: null,
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /开始生成/ }))

    await waitFor(() => {
      expect(generateNoteMock).toHaveBeenCalledWith(
        'ws-1',
        url,
        '收藏夹来源单条视频',
        true,
        'vision',
        10,
        '',
        'note',
        'auto',
        { diarize: false, summary_template: 'standard', user_notes: '' },
        '',
      )
    })
    expect(navigateMock).toHaveBeenCalledWith('/processing/task-note-1', {
      state: {
        url,
        workspaceId: 'ws-1',
        taskType: 'note',
        itemId: 'item-1',
        itemType: 'video',
      },
    })
  })

  it('单条链接可用 link preview 补回协议相对封面', async () => {
    fetchLinkPreviewMock.mockResolvedValueOnce({
      title: '预览标题',
      description: '',
      image_url: '//i1.hdslb.com/bfs/archive/cover.jpg@100w_100h_1c.png',
      source: 'og',
    })

    render(
      <AddMaterialModal
        open={true}
        onOpenChange={vi.fn()}
        workspaceIds={['ws-1']}
        urlValue="https://www.bilibili.com/video/BV1y1QzB1EK3/"
        sniffResult={{
          primary_type: 'video',
          possible_types: ['video'],
          platform: 'bilibili',
          title: null,
          thumbnail: null,
          content_type_header: null,
        }}
      />,
    )

    await waitFor(() => {
      const image = document.body.querySelector('.sniff-thumb img') as HTMLImageElement | null
      expect(image?.getAttribute('src')).toBe(
        '/api/image_proxy?url=' +
          encodeURIComponent('https://i1.hdslb.com/bfs/archive/cover.jpg@100w_100h_1c.png'),
      )
    })
  })

  it('自动识别为批量时可以手动切回单条内容', async () => {
    const url = 'https://www.bilibili.com/video/BV1xx411c7mD?p=2'

    render(
      <AddMaterialModal
        open={true}
        onOpenChange={vi.fn()}
        workspaceIds={['ws-1']}
        urlValue={url}
        sniffResult={{
          primary_type: 'video',
          possible_types: ['video'],
          platform: 'bilibili',
          title: '分 P 单条视频',
          thumbnail: null,
          content_type_header: null,
        }}
      />,
    )

    expect(screen.getAllByRole('button', { name: /解析批量来源/ }).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /单条内容/ }))
    fireEvent.click(screen.getByRole('button', { name: /开始生成/ }))

    await waitFor(() => {
      expect(generateNoteMock).toHaveBeenCalledWith(
        'ws-1',
        url,
        '分 P 单条视频',
        true,
        'vision',
        10,
        '',
        'note',
        'auto',
        { diarize: false, summary_template: 'standard', user_notes: '' },
        '',
      )
    })
  })

  it('批量提交使用统一批次 API 并进入批次详情', async () => {
    const onWorkspaceUpdated = vi.fn()
    render(
      <AddMaterialModal
        open={true}
        onOpenChange={vi.fn()}
        workspaceIds={[]}
        urlValue={'https://example.com/1\nhttps://example.com/2'}
        onWorkspaceUpdated={onWorkspaceUpdated}
      />,
    )

    fireEvent.click(screen.getByTitle('解析批量来源'))
    await waitFor(() => expect(resolveBatchSourceMock).toHaveBeenCalled())
    expect(await screen.findByText(/第一条/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /提交批量/ }))

    await waitFor(() => expect(createTaskBatchMock).toHaveBeenCalledTimes(1))
    expect(importBatchSourceMock).not.toHaveBeenCalled()
    expect(createTaskBatchMock).toHaveBeenCalledWith(expect.objectContaining({
      name: '批量合集',
      source_type: 'urls',
      items: [expect.objectContaining({
        source_url: 'https://example.com/1',
        action: 'process',
      })],
    }))
    expect(getWorkspaceMock).toHaveBeenCalledWith('workspace-1')
    expect(onWorkspaceUpdated).toHaveBeenCalled()
    expect(navigateMock).toHaveBeenCalledWith('/tasks/batches/batch-1')
  })

  it('没有工作空间时落入收纳箱，再生成笔记', async () => {
    ensureInboxMock.mockResolvedValue({ workspace_id: '__inbox__', name: '收纳箱' })

    render(
      <AddMaterialModal
        open={true}
        onOpenChange={vi.fn()}
        workspaceIds={[]}
        urlValue="https://example.com/article"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /开始生成/ }))

    await waitFor(() => {
      expect(ensureInboxMock).toHaveBeenCalled()
      expect(generateNoteMock).toHaveBeenCalledWith(
        '__inbox__',
        'https://example.com/article',
        undefined,
        true,
        'vision',
        10,
        '',
        'note',
        'auto',
        { diarize: false, summary_template: 'standard', user_notes: '' },
        '',
      )
    })
  })

  it('占位任务不会提交任务', () => {
    render(
      <AddMaterialModal
        open={true}
        onOpenChange={vi.fn()}
        workspaceIds={['ws-1']}
        urlValue="https://example.com/video"
      />,
    )

    expect(generateNoteMock).not.toHaveBeenCalled()
  })

  it('音频笔记直接显示区分说话人设置，且不展示非笔记功能', async () => {
    render(
      <AddMaterialModal
        open={true}
        onOpenChange={vi.fn()}
        workspaceIds={['ws-1']}
        urlValue="https://example.com/audio"
        sniffResult={{
          primary_type: 'audio',
          possible_types: ['audio'],
          platform: 'bilibili',
          title: '播客片段',
          thumbnail: null,
          content_type_header: null,
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /音频笔记/ }))
    await waitFor(() => {
      expect(fetchTemplatesMock).toHaveBeenCalledWith('style_audio')
    })
    expect(screen.queryByText('笔记里配图')).toBeNull()
    expect(screen.queryByText('视觉模型')).toBeNull()
    expect(screen.queryByText('取画面')).toBeNull()
    expect(screen.getByText('区分说话人')).toBeTruthy()
    expect(screen.getByPlaceholderText(/可选：输入额外要求/)).toBeTruthy()
    expect(screen.queryByText('AI视频')).toBeNull()
    expect(screen.queryByText('分镜脚本')).toBeNull()
    expect(screen.queryByText('二创改写')).toBeNull()

    const speakerSwitch = screen.getByRole('switch')
    expect(speakerSwitch).toHaveProperty('ariaChecked', 'false')
    fireEvent.click(speakerSwitch)
    expect(screen.getByText('区分说话人的总结方式')).toBeTruthy()
    expect(screen.getByText('咨询师录音版本详细总结')).toBeTruthy()
    expect(screen.getByRole('combobox', { name: '预计说话人数' })).toBeTruthy()
    expect(screen.getByText('自动判断')).toBeTruthy()

    // R5-C: 补充说明常驻，无需展开高级设置
    expect(screen.getByPlaceholderText(/可选：输入额外要求/)).toBeTruthy()
  })

  it('音频可把预计说话人数提交给任务', async () => {
    render(
      <AddMaterialModal
        open={true}
        onOpenChange={vi.fn()}
        workspaceIds={['ws-1']}
        urlValue="https://example.com/interview.m4a"
        sniffResult={{
          primary_type: 'audio',
          possible_types: ['audio'],
          platform: 'direct',
          title: '双人访谈',
          thumbnail: null,
          content_type_header: 'audio/mp4',
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /音频笔记/ }))
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByRole('combobox', { name: '区分说话人的总结方式' }))
    fireEvent.click(screen.getByRole('option', { name: /咨询师录音版会议纪要\/客户声音/ }))
    fireEvent.click(screen.getByRole('combobox', { name: '预计说话人数' }))
    fireEvent.click(screen.getByRole('option', { name: '2 人' }))
    fireEvent.click(screen.getByRole('button', { name: /开始生成/ }))

    await waitFor(() => {
      expect(generateNoteMock).toHaveBeenCalledWith(
        'ws-1',
        'https://example.com/interview.m4a',
        '双人访谈',
        true,
        'vision',
        10,
        '',
        'note',
        'audio',
        expect.objectContaining({
          diarize: true,
          speaker_count: 2,
          summary_mode: 'speaker_aware',
          summary_template: 'speaker_consultant_meeting_customer_voice',
        }),
        '',
      )
    })
  })

  it('内部输入链接后自动嗅探并展示视频卡', async () => {
    sniffUrlMock.mockResolvedValue({
      primary_type: 'text',
      possible_types: ['text'],
      platform: 'web',
      title: '文章标题',
      thumbnail: null,
      content_type_header: null,
    })

    render(
      <AddMaterialModal
        open={true}
        onOpenChange={vi.fn()}
        workspaceIds={['ws-1']}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText(/B站/), {
      target: { value: 'https://example.com/article' },
    })

    await waitFor(() => {
      expect(screen.getByText('文章标题')).toBeTruthy()
      expect(screen.getByText('已识别网页')).toBeTruthy()
    })
  })

  it('R5-C: 双栏结构——左栏来源+合集，右栏笔记设置', () => {
    render(
      <AddMaterialModal
        open
        onOpenChange={vi.fn()}
        workspaceIds={['ws-1']}
      />,
    )
    const cols = document.body.querySelector('.m-body-cols')
    expect(cols).toBeTruthy()
    const left = cols!.querySelector('.m-col-left')
    const right = cols!.querySelector('.m-col-right')
    expect(left).toBeTruthy()
    expect(right).toBeTruthy()
    // 左栏包含素材源和合集归属
    expect(left!.textContent).toContain('① 素材源')
    expect(left!.textContent).toContain('② 合集归属')
    // 右栏包含笔记设置
    expect(right!.textContent).toContain('③ 笔记设置')
  })

  it('R5-C: 补充说明常驻，无高级设置折叠器', () => {
    render(
      <AddMaterialModal
        open
        onOpenChange={vi.fn()}
        workspaceIds={['ws-1']}
      />,
    )
    // 补充说明 textarea 始终可见
    expect(screen.getByPlaceholderText(/可选：输入额外要求或上下文/)).toBeTruthy()
    // 高级设置折叠器已删除
    expect(screen.queryByText('高级设置')).toBeNull()
  })

  it('R5-C: 页脚固定显示状态摘要和开始生成', () => {
    render(
      <AddMaterialModal
        open
        onOpenChange={vi.fn()}
        workspaceIds={['ws-1']}
      />,
    )
    expect(screen.getByText('开始生成')).toBeTruthy()
    // 页脚状态摘要包含“笔记”
    const footer = document.body.querySelector('.m-foot')
    expect(footer).toBeTruthy()
    expect(footer!.textContent).toContain('笔记')
  })
})

describe('AddMaterialModal Q5：自动类型与模板可见性', () => {
  beforeEach(() => {
    navigateMock.mockClear()
    sniffUrlMock.mockReset()
    resolveBatchSourceMock.mockReset()
    createTaskBatchMock.mockReset()
    getWorkspaceMock.mockReset()
    fetchTemplatesMock.mockReset()
    fetchTemplatesMock.mockResolvedValue([])
    getTaskDefaultsMock.mockResolvedValue({
      summary_template: 'standard',
      video_frame_analysis: true,
      frame_interval_sec: 5,
      diarize: false,
      speaker_count: null,
    })
    probeDurationMock.mockResolvedValue({ duration_sec: 0 })
    fetchLinkPreviewMock.mockImplementation(() => new Promise(() => {}))
    createTaskBatchMock.mockResolvedValue({
      batch_id: 'batch-1',
      target_workspace_id: 'workspace-1',
      items: [],
    })
    getWorkspaceMock.mockResolvedValue({
      workspace_id: 'workspace-1',
      name: '批量合集',
      items: [],
    })
  })

  it('批量提交保留 auto 类型，不再硬编码 video', async () => {
    resolveBatchSourceMock.mockResolvedValue({
      source_type: 'multi_url',
      source_url: '',
      title: '批量合集',
      items: [{
        source_url: 'https://example.com/1',
        title: '第一条',
        index: 1,
        external_id: 'video-1',
      }],
    })
    render(<AddMaterialModal open onOpenChange={vi.fn()} workspaceIds={['ws-1']} />)

    fireEvent.click(screen.getByRole('button', { name: /批量合集/ }))
    const urlInput = screen.getByPlaceholderText(/B站|小红书|抖音|YouTube|本地文件路径/)
    fireEvent.change(urlInput, {
      target: { value: 'https://example.com/1\nhttps://example.com/2' },
    })

    await waitFor(() => {
      expect(screen.getByText(/提交批量/)).toBeTruthy()
    }, { timeout: 3000 })
    fireEvent.click(screen.getByRole('button', { name: /提交批量/ }))

    await waitFor(() => expect(createTaskBatchMock).toHaveBeenCalled())
    const payload = createTaskBatchMock.mock.calls[0][0]
    // auto 必须原样下发给后端，由 probe 决定真实类型
    expect(payload.settings.note_type).toBe('auto')
    // 配图分析保持用户开关（默认开），不因类型未识别而关掉
    expect(payload.settings.frame_analysis).toBe(true)
  })

  it('批量识别结果里未知类型行显示待识别，不标视频', async () => {
    resolveBatchSourceMock.mockResolvedValue({
      source_type: 'multi_url',
      source_url: '',
      title: '批量合集',
      items: [{
        source_url: 'https://example.com/unknown-1',
        title: '未知内容',
        external_id: 'u-1',
      }],
    })
    render(<AddMaterialModal open onOpenChange={vi.fn()} workspaceIds={['ws-1']} />)

    fireEvent.click(screen.getByRole('button', { name: /批量合集/ }))
    const urlInput = screen.getByPlaceholderText(/B站|小红书|抖音|YouTube|本地文件路径/)
    fireEvent.change(urlInput, {
      target: { value: 'https://example.com/unknown-1\nhttps://example.com/unknown-2' },
    })

    await waitFor(() => {
      expect(screen.getAllByText(/待识别/).length).toBeGreaterThan(0)
    }, { timeout: 3000 })
    // 未知行不得默认标「视频」
    const rows = document.querySelectorAll('.batch-source-row')
    expect(rows.length).toBeGreaterThan(0)
    rows.forEach((row) => {
      expect(row.textContent).not.toMatch(/^视频$|>视频</)
    })
  })

  it('所有模板隐藏时回退标准总结并给设置入口', async () => {
    fetchTemplatesMock.mockResolvedValue([
      { template_id: 'standard', name: '标准总结', prompt: '', is_builtin: true, category: 'style_video_with_frames', created_at: '', updated_at: '', show_in_create: false },
      { template_id: 'detailed', name: '详细要点', prompt: '', is_builtin: true, category: 'style_video_with_frames', created_at: '', updated_at: '', show_in_create: false },
    ])
    render(<AddMaterialModal open onOpenChange={vi.fn()} workspaceIds={['ws-1']} />)

    await waitFor(() => {
      expect(screen.getByText(/可见模板已全部隐藏/)).toBeTruthy()
    })
    // 提供进入模板设置的入口
    expect(screen.getByRole('button', { name: /前往模板设置/ })).toBeTruthy()
  })

  it('show_in_create=false 的模板不出现在风格选项里', async () => {
    fetchTemplatesMock.mockResolvedValue([
      { template_id: 'standard', name: '标准总结', prompt: '', is_builtin: true, category: 'style_video_with_frames', created_at: '', updated_at: '', show_in_create: true },
      { template_id: 'hidden-one', name: '隐藏模板甲', prompt: '', is_builtin: false, category: 'style_video_with_frames', created_at: '', updated_at: '', show_in_create: false },
    ])
    render(<AddMaterialModal open onOpenChange={vi.fn()} workspaceIds={['ws-1']} />)

    await waitFor(() => expect(fetchTemplatesMock).toHaveBeenCalled())
    // 打开风格下拉，隐藏模板不应出现
    fireEvent.click(screen.getByRole('combobox', { name: '笔记风格' }))
    await waitFor(() => {
      expect(screen.queryByText('隐藏模板甲')).toBeNull()
    })
  })
})
