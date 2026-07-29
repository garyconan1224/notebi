import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/useSystemStats', () => ({
  useSystemStats: () => ({ stats: null, online: true }),
}))
vi.mock('@/hooks/useHealthPulse', () => ({
  useHealthPulse: () => ({ online: true, data: null, error: null, lastCheckedAt: null, bootstrapping: false }),
}))

vi.mock('@/components/FloatingTaskQueue', () => ({
  FloatingTaskQueue: () => null,
}))

vi.mock('@/components/workspace/GlobalAddMaterialModal', () => ({
  GlobalAddMaterialModal: () => null,
}))

vi.mock('@/components/ThemeSwitcher', () => ({
  default: () => null,
}))

const serviceMock = vi.hoisted(() => ({
  fn: vi.fn(),
}))

vi.mock('@/services/workspaces', () => ({
  sniffUrl: serviceMock.fn,
  probeDuration: vi.fn().mockResolvedValue({ duration_sec: 0 }),
  autoCreateWorkspace: serviceMock.fn,
  ensureInbox: serviceMock.fn,
  createWorkspace: serviceMock.fn,
  addWorkspaceItem: serviceMock.fn,
  savePreflight: serviceMock.fn,
  startItemPipeline: serviceMock.fn,
  generateNote: serviceMock.fn,
  updateWorkspace: serviceMock.fn,
}))

vi.mock('@/services/linkPreview', () => ({
  fetchLinkPreview: vi.fn(() => new Promise(() => {})),
}))

vi.mock('@/store/providerStore', () => ({
  useProviderStore: vi.fn(() => ({
    providers: [],
    providerModels: {},
    fetchProviders: vi.fn(),
  })),
}))

import { AppShell } from '@/layouts/AppShell'
import { AddMaterialModal } from '@/components/workspace/AddMaterialModal'

describe('NoteBi-only UI', () => {
  it('renders only the fixed NoteBi navigation', () => {
    render(
      <MemoryRouter>
        <AppShell>
          <div>content</div>
        </AppShell>
      </MemoryRouter>,
    )

    expect(screen.getByText('NoteBi')).toBeTruthy()
    expect(screen.getByText('笔记')).toBeTruthy()
    // R1：智能检索已升级为正式入口“知识库”
    expect(screen.getByText('知识库')).toBeTruthy()
    expect(screen.queryByText('智能检索')).toBeNull()
    expect(screen.queryByText('复刻')).toBeNull()
    expect(screen.queryByText('分镜')).toBeNull()
    expect(screen.queryByText('AI 导演')).toBeNull()
  })

  it('renders the note-only AddMaterialModal without the learning-note action card', () => {
    render(
      <MemoryRouter>
        <AddMaterialModal
          open
          onOpenChange={vi.fn()}
          workspaceIds={[]}
        />
      </MemoryRouter>,
    )

    // R5-A：删除“学习笔记”action 卡，固定为笔记流程
    expect(screen.queryByText('学习笔记')).toBeNull()
    expect(screen.queryByText('逐帧复刻')).toBeNull()
    expect(screen.getByText('输入素材链接并生成笔记')).toBeTruthy()
  })
})
