import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/settings', () => ({
  fetchSettings: vi.fn(),
  patchSettings: vi.fn(),
}))

import ExportSyncSettingsPage from '@/pages/SettingPage/ExportSyncSettingsPage'
import { fetchSettings, patchSettings } from '@/services/settings'

const fetchSettingsMock = vi.mocked(fetchSettings)
const patchSettingsMock = vi.mocked(patchSettings)

describe('ExportSyncSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchSettingsMock.mockResolvedValue({
      theme: 'paper',
      mode: 'system',
      fonts: { ui: null, cap: null, sum: null },
      uploaded_fonts: [],
      obsidian: { vault_path: '/Users/test/Vault', subdir: 'NoteBi', direct_write: true },
      export_sync: { notion_parent_page_id: 'page-abc', feishu_folder_token: 'fld-xyz' },
    })
    patchSettingsMock.mockImplementation(async (patch) => ({
      theme: 'paper',
      mode: 'system',
      fonts: { ui: null, cap: null, sum: null },
      uploaded_fonts: [],
      obsidian: {
        vault_path: patch.obsidian?.vault_path ?? '',
        subdir: patch.obsidian?.subdir ?? '',
        direct_write: patch.obsidian?.direct_write ?? false,
      },
      export_sync: {
        notion_parent_page_id: patch.export_sync?.notion_parent_page_id ?? '',
        feishu_folder_token: patch.export_sync?.feishu_folder_token ?? '',
      },
    }))
  })

  it('加载并展示 Obsidian 与云笔记默认值', async () => {
    render(<ExportSyncSettingsPage />)

    expect(await screen.findByLabelText('Obsidian Vault 路径')).toHaveValue('/Users/test/Vault')
    expect(screen.getByLabelText('Obsidian 子目录')).toHaveValue('NoteBi')
    expect(screen.getByRole('checkbox', { name: '启用 Obsidian 直写' })).toBeChecked()
    expect(screen.getByLabelText('Notion 默认父页面 ID 或链接')).toHaveValue('page-abc')
    expect(screen.getByLabelText('飞书默认文件夹 Token')).toHaveValue('fld-xyz')
  })

  it('保存时同时提交 obsidian 与 export_sync 非敏感默认值', async () => {
    render(<ExportSyncSettingsPage />)

    const notion = await screen.findByLabelText('Notion 默认父页面 ID 或链接')
    fireEvent.change(notion, { target: { value: 'page-new' } })
    fireEvent.change(screen.getByLabelText('Obsidian Vault 路径'), {
      target: { value: '/Users/test/NewVault' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存导出与同步设置' }))

    await waitFor(() =>
      expect(patchSettingsMock).toHaveBeenCalledWith({
        obsidian: {
          vault_path: '/Users/test/NewVault',
          subdir: 'NoteBi',
          direct_write: true,
        },
        export_sync: {
          notion_parent_page_id: 'page-new',
          feishu_folder_token: 'fld-xyz',
        },
      }),
    )
  })
})
