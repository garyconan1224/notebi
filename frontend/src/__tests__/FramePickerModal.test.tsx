/**
 * FramePickerModal 组件测试。
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { FramePickerModal } from '@/components/FramePickerModal'
import type { SuggestedFrame } from '@/services/inlineFrames'

const FRAMES = [
  { timestamp: 10, image_path: '/img/f1.jpg', scene_description: '开场' },
  { timestamp: 30, image_path: '/img/f2.jpg', scene_description: '中间' },
  { timestamp: 60, image_path: '/img/f3.jpg', scene_description: '结尾' },
]

const SUGGESTED: SuggestedFrame[] = [
  { segment_idx: 0, frame_timestamp: 10, frame_path: '/img/f1.jpg', scene_description: '开场' },
]

describe('FramePickerModal', () => {
  it('渲染推荐帧和全部帧', () => {
    render(
      <FramePickerModal
        frames={FRAMES}
        suggested={SUGGESTED}
        currentSegmentIdx={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('系统推荐')).toBeTruthy()
    expect(screen.getByText('全部关键帧')).toBeTruthy()
    // 推荐帧标 ⭐
    expect(screen.getAllByText('⭐').length).toBeGreaterThanOrEqual(1)
    // 帧时间戳（0:10 在推荐和全部各出现一次）
    expect(screen.getAllByText('0:10').length).toBe(2)
    expect(screen.getByText('0:30')).toBeTruthy()
    expect(screen.getByText('1:00')).toBeTruthy()
  })

  it('点击帧选中，点击插入触发 onSelect', () => {
    const onSelect = vi.fn()
    render(
      <FramePickerModal
        frames={FRAMES}
        suggested={SUGGESTED}
        currentSegmentIdx={0}
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    )

    // 点击第一个帧卡片
    const cards = document.querySelectorAll('.fpm-card')
    fireEvent.click(cards[0])

    // 点击插入
    const confirmBtn = screen.getByText('插入')
    fireEvent.click(confirmBtn)

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ timestamp: 10, image_path: '/img/f1.jpg' }),
    )
  })

  it('点击关闭触发 onClose', () => {
    const onClose = vi.fn()
    render(
      <FramePickerModal
        frames={FRAMES}
        suggested={SUGGESTED}
        currentSegmentIdx={0}
        onSelect={vi.fn()}
        onClose={onClose}
      />,
    )

    fireEvent.click(screen.getByText('取消'))
    expect(onClose).toHaveBeenCalled()
  })

  it('未选中帧时插入按钮禁用', () => {
    render(
      <FramePickerModal
        frames={FRAMES}
        suggested={SUGGESTED}
        currentSegmentIdx={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    const confirmBtn = screen.getByText('插入')
    expect(confirmBtn.hasAttribute('disabled')).toBe(true)
  })
})
