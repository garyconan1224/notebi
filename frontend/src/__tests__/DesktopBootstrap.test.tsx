import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DesktopBootstrap from '@/desktop/DesktopBootstrap'
import { bootstrapBackend, isDesktopRuntime } from '@/desktop/bridge'

vi.mock('@/desktop/bridge', () => ({
  bootstrapBackend: vi.fn(),
  isDesktopRuntime: vi.fn(),
}))

describe('DesktopBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the web app immediately outside Tauri', () => {
    vi.mocked(isDesktopRuntime).mockReturnValue(false)

    render(<DesktopBootstrap><div>NoteBi app</div></DesktopBootstrap>)

    expect(screen.getByText('NoteBi app')).toBeInTheDocument()
    expect(bootstrapBackend).not.toHaveBeenCalled()
  })

  it('waits for the backend health gate without requiring a model', async () => {
    vi.mocked(isDesktopRuntime).mockReturnValue(true)
    vi.mocked(bootstrapBackend).mockResolvedValue({
      status: 'ready',
      backendUrl: 'http://127.0.0.1:8001',
    })

    render(<DesktopBootstrap><div>NoteBi app</div></DesktopBootstrap>)

    expect(screen.queryByText('NoteBi app')).not.toBeInTheDocument()
    expect(screen.getByText('正在准备 NoteBi')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('NoteBi app')).toBeInTheDocument()
    })
    expect(bootstrapBackend).toHaveBeenCalledTimes(1)
  })
})
