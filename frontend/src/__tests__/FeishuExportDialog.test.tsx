import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { FeishuExportDialog } from '@/pages/result/NoteShell/FeishuExportDialog'
import * as workspaces from '@/services/workspaces'

vi.mock('@/services/workspaces', () => ({
  exportItemNoteToFeishu: vi.fn(),
}))

describe('FeishuExportDialog', () => {
  it('uses the access token only for this export and keeps the folder optional', async () => {
    vi.mocked(workspaces.exportItemNoteToFeishu).mockResolvedValue({
      document_id: 'docx-1',
      url: 'https://feishu.cn/docx/docx-1',
    })
    const onSuccess = vi.fn()
    render(
      <FeishuExportDialog
        open
        onOpenChange={vi.fn()}
        workspaceId="workspace-1"
        itemId="item-1"
        title="产品笔记"
        markdown={'# 产品笔记\n\n正文'}
        onSuccess={onSuccess}
      />,
    )

    fireEvent.change(screen.getByLabelText('飞书访问令牌'), {
      target: { value: 'tenant-token' },
    })
    fireEvent.change(screen.getByLabelText('飞书文件夹 Token（可选）'), {
      target: { value: 'folder-token' },
    })
    fireEvent.click(screen.getByRole('button', { name: '导出到飞书' }))

    await waitFor(() => {
      expect(workspaces.exportItemNoteToFeishu).toHaveBeenCalledWith(
        'workspace-1',
        'item-1',
        {
          accessToken: 'tenant-token',
          folderToken: 'folder-token',
          title: '产品笔记',
          markdown: '# 产品笔记\n\n正文',
        },
      )
      expect(onSuccess).toHaveBeenCalledWith({
        document_id: 'docx-1',
        url: 'https://feishu.cn/docx/docx-1',
      })
    })
  })
})
