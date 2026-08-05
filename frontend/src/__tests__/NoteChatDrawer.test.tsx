import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ChatRichText } from '@/components/chatRichText'

describe('NoteChatDrawer 回答富文本与素材引用', () => {
  it('回答以富文本渲染（加粗生效）而不是裸 md 文本', () => {
    render(<ChatRichText content="**加粗要点** 与 普通文本" />)

    expect(screen.getByText('加粗要点').tagName).toBe('STRONG')
  })

  it('【素材 N】渲染为可点击 chip 并回调素材索引', () => {
    const onOpenSource = vi.fn()
    render(<ChatRichText content="证据见【素材 1】和【素材2】" onOpenSource={onOpenSource} />)

    const chips = screen.getAllByRole('button', { name: /素材/ })
    expect(chips).toHaveLength(2)

    fireEvent.click(chips[0])
    expect(onOpenSource).toHaveBeenCalledWith(1)

    fireEvent.click(chips[1])
    expect(onOpenSource).toHaveBeenCalledWith(2)
  })

  it('普通链接新窗口打开，不触发素材回调', () => {
    const onOpenSource = vi.fn()
    render(<ChatRichText content="参考 [文档](https://example.com)" onOpenSource={onOpenSource} />)

    const link = screen.getByRole('link', { name: '文档' })
    expect(link).toHaveAttribute('href', 'https://example.com')
    expect(link).toHaveAttribute('target', '_blank')
    expect(onOpenSource).not.toHaveBeenCalled()
  })
})
