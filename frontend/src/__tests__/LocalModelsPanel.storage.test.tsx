import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import LocalModelsPanel from '@/pages/SettingPage/LocalModelsPanel'

vi.mock('@/services/localModels', () => ({
  listLocalModels: vi.fn().mockResolvedValue([]),
  getLocalModelStorage: vi.fn()
    .mockResolvedValueOnce({ directory: '', effective_cache_dir: '/default/hub' })
    .mockResolvedValueOnce({ directory: 'D:\\NoteBi\\models', effective_cache_dir: 'D:\\NoteBi\\models\\huggingface\\hub' }),
  updateLocalModelStorage: vi.fn().mockImplementation(async (directory: string) => ({
    directory,
    effective_cache_dir: `${directory}/huggingface/hub`,
  })),
  downloadLocalModel: vi.fn(),
  activateLocalModel: vi.fn(),
}))

describe('LocalModelsPanel model storage', () => {
  it('lets the user save the model directory from settings', async () => {
    render(<LocalModelsPanel />)

    await screen.findByText('本地模型下载与切换')
    expect(screen.getByLabelText('模型存储目录')).toHaveValue('')

    fireEvent.change(screen.getByLabelText('模型存储目录'), {
      target: { value: 'D:\\NoteBi\\models' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存目录' }))

    await waitFor(() => {
      expect(screen.getByLabelText('模型存储目录')).toHaveValue('D:\\NoteBi\\models')
    })
  })
})
