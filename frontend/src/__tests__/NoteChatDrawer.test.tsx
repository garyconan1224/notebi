import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import NoteChatDrawer from '@/components/NoteChatDrawer'

const chatMocks = vi.hoisted(() => ({
  listChats: vi.fn(),
  listChatMessages: vi.fn(),
  deleteChat: vi.fn(),
  createChatTurn: vi.fn(),
  subscribeChatTurn: vi.fn(),
}))

vi.mock('@/services/chat', () => chatMocks)
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

describe('NoteChatDrawer enhanced sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chatMocks.listChats.mockResolvedValue([
      { chat_id: 'chat-1', message_count: 2, first_at: '2026-07-30T00:00:00Z', last_at: '2026-07-30T00:01:00Z' },
    ])
    chatMocks.listChatMessages.mockResolvedValue([
      { chat_id: 'chat-1', message_id: 'm-1', role: 'assistant', content: '可保存的回答', created_at: '2026-07-30T00:01:00Z', model: null },
    ])
    chatMocks.deleteChat.mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('opens a saved session and saves an assistant answer into the current note', async () => {
    const onSaveAnswer = vi.fn()
    render(
      <NoteChatDrawer
        workspaceId="ws-1"
        systemPrompt="prompt"
        scopeHint="当前笔记"
        mode="inline"
        onSaveAnswer={onSaveAnswer}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: '历史会话' }))
    fireEvent.click(screen.getByRole('button', { name: '打开会话 chat-1' }))
    expect(await screen.findByText('可保存的回答')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '保存为笔记' }))
    expect(onSaveAnswer).toHaveBeenCalledWith('可保存的回答')
  })

  it('fills a preset question and clears only the active session after confirmation', async () => {
    render(
      <NoteChatDrawer
        workspaceId="ws-1"
        systemPrompt="prompt"
        scopeHint="当前笔记"
        mode="inline"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '总结核心观点' }))
    expect(screen.getByLabelText('输入问题')).toHaveValue('请用 3 到 5 条总结这篇笔记的核心观点，并标出对应证据。')

    fireEvent.click(await screen.findByRole('button', { name: '历史会话' }))
    fireEvent.click(screen.getByRole('button', { name: '打开会话 chat-1' }))
    await screen.findByText('可保存的回答')
    fireEvent.click(screen.getByRole('button', { name: '清空当前会话' }))

    await waitFor(() => expect(chatMocks.deleteChat).toHaveBeenCalledWith('ws-1', 'chat-1'))
    expect(screen.queryByText('可保存的回答')).not.toBeInTheDocument()
  })
})
