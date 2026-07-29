import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { FloatingAskAi } from '@/pages/result/NoteShell/FloatingAskAi'

vi.mock('@/components/NoteChatDrawer', () => ({
  default: () => <div>对话内容</div>,
}))

describe('FloatingAskAi', () => {
  it('展开为右侧停靠面板并显示上下文范围', () => {
    render(
      <FloatingAskAi
        workspaceId="ws-1"
        itemIds={['item-1']}
        systemPrompt="prompt"
        scopeHint="当前笔记与完整转录"
        open
        onOpenChange={vi.fn()}
        hideTrigger
      />,
    )

    expect(screen.getByRole('complementary', { name: '问 AI' })).toHaveClass(
      'note-ai-dock',
    )
    expect(screen.getByText('当前笔记与完整转录')).toBeInTheDocument()
    expect(screen.getByRole('separator', { name: '调整问 AI 宽度' })).toBeInTheDocument()
  })

  it('关闭按钮回传关闭状态', () => {
    const onOpenChange = vi.fn()
    render(
      <FloatingAskAi
        workspaceId="ws-1"
        systemPrompt="prompt"
        scopeHint="当前笔记"
        open
        onOpenChange={onOpenChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '关闭问 AI' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
