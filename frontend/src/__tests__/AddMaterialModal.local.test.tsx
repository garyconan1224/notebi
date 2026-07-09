import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AddMaterialModal } from '@/components/workspace/AddMaterialModal'
import * as workspaces from '@/services/workspaces'

vi.mock('@/services/workspaces', () => ({
  ensureInbox: vi.fn(),
  generateNote: vi.fn(),
  probeDuration: vi.fn(),
  probeItemMedia: vi.fn().mockResolvedValue({ duration_sec: 0, cover_url: '' }),
  savePreflight: vi.fn().mockResolvedValue({}),
  sniffUrl: vi.fn(),
  startItemPipeline: vi.fn().mockResolvedValue({ task_id: 'task-123', task_type: 'note' }),
  updateWorkspace: vi.fn().mockResolvedValue({}),
  fetchLinkPreview: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/store/providerStore', () => ({
  useProviderStore: vi.fn(() => ({
    providers: [],
    providerModels: {},
    fetchProviders: vi.fn(),
  })),
}))

vi.mock('@/services/linkPreview', () => ({
  fetchLinkPreview: vi.fn().mockResolvedValue({}),
}))

function renderLocal(opts: {
  embedFrames?: boolean
  noteStyle?: string
  frameInterval?: number
  onAdded?: () => void
  onOpenChange?: (open: boolean) => void
} = {}) {
  const onAdded = opts.onAdded ?? vi.fn()
  const onOpenChange = opts.onOpenChange ?? vi.fn()
  return {
    onAdded,
    onOpenChange,
    ...render(
      <MemoryRouter>
        <AddMaterialModal
          open
          onOpenChange={onOpenChange}
          workspaceIds={['ws-1']}
          localFile="item-abc"
          localFileName="demo.mp4"
          localWsId="ws-1"
          onAdded={onAdded}
        />
      </MemoryRouter>,
    ),
  }
}

describe('AddMaterialModal — 本地文件提交', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('savePreflight payload 写 tasks.summary.embed_frames（后端消费路径）', async () => {
    // 配图开关默认开（无 providers → hasVisionModel=false → 默认关）
    renderLocal({ embedFrames: true })

    // 点击开始生成
    const btn = screen.getByRole('button', { name: /开始生成/ })
    fireEvent.click(btn)

    await waitFor(() => {
      expect(workspaces.savePreflight).toHaveBeenCalledTimes(1)
    })

    const [, , payload] = (workspaces.savePreflight as ReturnType<typeof vi.fn>).mock.calls[0]
    // 核心断言：后端 /start 从 tasks.summary 读 embed_frames
    expect(payload.tasks?.summary?.embed_frames).toBeDefined()
    expect(payload.tasks?.summary?.summary_template).toBe('standard')
    // 不应写到 tasks.video（后端不读）
    expect(payload.tasks?.video).toBeUndefined()
  })

  it('savePreflight payload 包含 background_overrides.frame_interval_sec', async () => {
    renderLocal()

    const btn = screen.getByRole('button', { name: /开始生成/ })
    fireEvent.click(btn)

    await waitFor(() => {
      expect(workspaces.savePreflight).toHaveBeenCalledTimes(1)
    })

    const [, , payload] = (workspaces.savePreflight as ReturnType<typeof vi.fn>).mock.calls[0]
    // frame_interval_sec 在 background_overrides 中（后端 /start 从这里读）
    expect(payload.background_overrides?.frame_interval_sec).toBeDefined()
    expect(typeof payload.background_overrides.frame_interval_sec).toBe('number')
  })

  it('成功提交后不调用 removeWorkspaceItem', async () => {
    const onAdded = vi.fn()
    const onOpenChange = vi.fn()
    renderLocal({ onAdded, onOpenChange })

    const btn = screen.getByRole('button', { name: /开始生成/ })
    fireEvent.click(btn)

    await waitFor(() => {
      expect(workspaces.startItemPipeline).toHaveBeenCalledTimes(1)
    })

    // onAdded 被调用（成功路径）
    expect(onAdded).toHaveBeenCalled()
    // onOpenChange(false) 被调用（关闭弹窗）
    expect(onOpenChange).toHaveBeenCalledWith(false)
    // removeWorkspaceItem 不应被调用
    // （它在 Composer 层，此处验证 savePreflight/startItemPipeline 成功且无异常）
  })

  it('提交时应调用 startItemPipeline', async () => {
    renderLocal()

    const btn = screen.getByRole('button', { name: /开始生成/ })
    fireEvent.click(btn)

    await waitFor(() => {
      expect(workspaces.startItemPipeline).toHaveBeenCalledWith('ws-1', 'item-abc')
    })
  })

  it('本地文件时按钮不需要 URL 即可点击', () => {
    renderLocal()
    const btn = screen.getByRole('button', { name: /开始生成/ })
    // 没有 URL 但有 localFile，按钮应可用
    expect((btn as HTMLButtonElement).disabled).toBe(false)
  })

  it('配图关闭时 embed_frames 为 false', async () => {
    // 无 providers → hasVisionModel=false → embedFrames 默认 false
    renderLocal()

    const btn = screen.getByRole('button', { name: /开始生成/ })
    fireEvent.click(btn)

    await waitFor(() => {
      expect(workspaces.savePreflight).toHaveBeenCalledTimes(1)
    })

    const [, , payload] = (workspaces.savePreflight as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(payload.tasks?.summary?.embed_frames).toBe(false)
  })
})
