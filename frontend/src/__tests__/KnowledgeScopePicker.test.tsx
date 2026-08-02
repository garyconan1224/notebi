import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  KnowledgeScopePicker,
  type KnowledgeScope,
} from '@/pages/SearchPage/KnowledgeScopePicker'
import type { WorkspaceRecord } from '@/types/workspace'

const workspace: WorkspaceRecord = {
  workspace_id: 'collection-a',
  name: '产品研究',
  status: 'active',
  trashed: false,
  background: { content_type: '', participants: [], topic: '', glossary: [], purpose: '' },
  items: [],
  favorites: [],
  created_at: '2026-07-30T00:00:00Z',
  updated_at: '2026-07-30T00:00:00Z',
  kind: 'note',
  source: 'manual',
}

describe('KnowledgeScopePicker', () => {
  it('adds one note alongside a selected collection as an inclusive scope', () => {
    const onChange = vi.fn()
    const scope: KnowledgeScope = {
      type: 'selected',
      workspaceIds: ['collection-a'],
      itemRefs: [],
    }
    render(
      <KnowledgeScopePicker
        workspaces={[workspace]}
        items={[{
          workspaceId: 'collection-b',
          itemId: 'note-b',
          name: '访谈整理',
          workspaceName: '市场观察',
          type: 'audio',
        }]}
        scope={scope}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '知识库范围' }))
    fireEvent.click(screen.getByRole('option', { name: /访谈整理/ }))

    expect(onChange).toHaveBeenCalledWith({
      type: 'selected',
      workspaceIds: ['collection-a'],
      itemRefs: [{ workspace_id: 'collection-b', item_id: 'note-b' }],
    })
  })
})
