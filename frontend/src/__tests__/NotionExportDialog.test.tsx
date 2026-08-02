import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { NotionExportDialog } from '@/pages/result/NoteShell/NotionExportDialog'
import * as workspaces from '@/services/workspaces'

vi.mock('@/services/workspaces', () => ({
  exportItemNoteToNotion: vi.fn(),
}))

describe('NotionExportDialog', () => {
  it('sends the current markdown with a request-only token', async () => {
    vi.mocked(workspaces.exportItemNoteToNotion).mockResolvedValue({
      page_id: 'page-1',
      url: 'https://notion.so/page-1',
    })
    const onSuccess = vi.fn()
    render(
      <NotionExportDialog
        open
        onOpenChange={vi.fn()}
        workspaceId="workspace-1"
        itemId="item-1"
        title="产品笔记"
        markdown={'# 产品笔记\n\n正文'}
        onSuccess={onSuccess}
      />,
    )

    fireEvent.change(screen.getByLabelText('Notion 集成令牌'), {
      target: { value: 'secret-token' },
    })
    fireEvent.change(screen.getByLabelText('Notion 父页面 ID 或链接'), {
      target: { value: 'parent-page' },
    })
    fireEvent.click(screen.getByRole('button', { name: '导出到 Notion' }))

    await waitFor(() => {
      expect(workspaces.exportItemNoteToNotion).toHaveBeenCalledWith(
        'workspace-1',
        'item-1',
        {
          accessToken: 'secret-token',
          parentPageId: 'parent-page',
          title: '产品笔记',
          markdown: '# 产品笔记\n\n正文',
        },
      )
      expect(onSuccess).toHaveBeenCalledWith({
        page_id: 'page-1',
        url: 'https://notion.so/page-1',
      })
    })
  })
})
