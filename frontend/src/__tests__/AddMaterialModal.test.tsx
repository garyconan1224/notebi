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
  fetchLinkPreviewMock,
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
  fetchLinkPreviewMock: vi.fn(),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
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
}))

vi.mock('@/services/linkPreview', () => ({
  fetchLinkPreview: fetchLinkPreviewMock,
}))

vi.mock('@/store/providerStore', () => ({
  useProviderStore: vi.fn(() => ({
    providers: [{ id: 'p1', name: 'TestProvider', enabled: true, capabilities: ['vision'] }],
    providerModels: { p1: [{ id: 'm1', name: 'TestModel', capabilities: ['vision'] }] },
    fetchProviders: vi.fn(),
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
    fetchLinkPreviewMock.mockReset()
    probeDurationMock.mockResolvedValue({ duration_sec: 0 })
    fetchLinkPreviewMock.mockImplementation(() => new Promise(() => {}))
    generateNoteMock.mockResolvedValue({
      task_id: 'task-note-1',
      task_type: 'note',
      item_type: 'video',
      item_id: 'item-1',
      workspace: {},
    })
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
    expect(screen.getByText('③ 你要做什么')).toBeTruthy()
    expect(screen.getByText('④ 笔记设置')).toBeTruthy()
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

    fireEvent.click(screen.getByRole('button', { name: /学习笔记/ }))
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
      expect(image?.getAttribute('src')).toBe('https://i1.hdslb.com/bfs/archive/cover.jpg@100w_100h_1c.png')
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
      )
    })
  })

  it('选择复刻时提交 intent=replica', async () => {
    generateNoteMock.mockResolvedValueOnce({
      task_id: 'task-replica-1',
      task_type: 'replica',
      item_type: 'video',
      item_id: 'item-2',
      workspace: {},
    })

    render(
      <AddMaterialModal
        open={true}
        onOpenChange={vi.fn()}
        workspaceIds={['ws-1']}
        urlValue="https://example.com/video"
        sniffResult={{
          primary_type: 'video',
          possible_types: ['video'],
          platform: 'bilibili',
          title: '复刻测试',
          thumbnail: null,
          content_type_header: null,
        }}
      />,
    )

    // 点击复刻大卡
    fireEvent.click(screen.getByRole('button', { name: /逐帧复刻/ }))
    // 此时应该切到“④ 复刻设置”
    expect(screen.queryByText('④ 笔记设置')).toBeNull()
    expect(screen.getByText('④ 复刻设置')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /开始生成/ }))

    await waitFor(() => {
      expect(generateNoteMock).toHaveBeenCalledWith(
        'ws-1',
        'https://example.com/video',
        '复刻测试',
        true,
        'replica_prompt',
        10,
        '',
        'replica',
        'auto',
        { diarize: false, summary_template: 'standard', user_notes: '', replica_kind: 'prompt' },
      )
    })
    expect(navigateMock).toHaveBeenCalledWith('/processing/task-replica-1', {
      state: {
        url: 'https://example.com/video',
        workspaceId: 'ws-1',
        taskType: 'replica',
        itemId: 'item-2',
        itemType: 'video',
      },
    })
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

  it('音频笔记只显示音频相关高级项', () => {
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
    fireEvent.click(screen.getByRole('button', { name: /高级设置/ }))

    expect(screen.queryByText('笔记里配图')).toBeNull()
    expect(screen.queryByText('视觉模型')).toBeNull()
    expect(screen.queryByText('取画面')).toBeNull()
    expect(screen.getByText('区分发言人')).toBeTruthy()
    expect(screen.getByText('补充说明')).toBeTruthy()
  })

  it('复刻设置展示取画面，不展示笔记专属项', () => {
    render(
      <AddMaterialModal
        open={true}
        onOpenChange={vi.fn()}
        workspaceIds={['ws-1']}
        urlValue="https://example.com/video"
        sniffResult={{
          primary_type: 'video',
          possible_types: ['video'],
          platform: 'bilibili',
          title: '复刻视频',
          thumbnail: null,
          content_type_header: null,
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /逐帧复刻/ }))
    fireEvent.click(screen.getByRole('button', { name: /高级设置/ }))

    expect(screen.queryByText('笔记风格')).toBeNull()
    expect(screen.queryByText('区分发言人')).toBeNull()
    expect(screen.getByText('画面分析')).toBeTruthy()
    expect(screen.getByText('取画面')).toBeTruthy()
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
})
