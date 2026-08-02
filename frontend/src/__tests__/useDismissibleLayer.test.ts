import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { useDismissibleLayer } from '@/hooks/useDismissibleLayer'

describe('useDismissibleLayer', () => {
  function setup(overrides: Partial<{ open: boolean; routeKey: string }> = {}) {
    const containerRef = createRef<HTMLDivElement>()
    const triggerRef = createRef<HTMLButtonElement>()
    const onClose = vi.fn()

    // 渲染真实 DOM 节点以便 contains 判断
    const container = document.createElement('div')
    const trigger = document.createElement('button')
    document.body.append(container, trigger)
    ;(containerRef as { current: HTMLDivElement | null }).current = container
    ;(triggerRef as { current: HTMLButtonElement | null }).current = trigger

    const props = {
      containerRef,
      triggerRef,
      open: overrides.open ?? true,
      onClose,
      routeKey: overrides.routeKey,
    }

    const result = renderHook(() => useDismissibleLayer(props))
    return { container, trigger, onClose, result, cleanup: () => { container.remove(); trigger.remove() } }
  }

  it('外部 pointerdown 触发关闭', () => {
    const { onClose, cleanup } = setup()
    act(() => {
      document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('浮层内部 pointerdown 不关闭', () => {
    const { container, onClose, cleanup } = setup()
    act(() => {
      container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
    expect(onClose).not.toHaveBeenCalled()
    cleanup()
  })

  it('Escape 关闭并把焦点还给触发按钮', () => {
    const { trigger, onClose, cleanup } = setup()
    const focusSpy = vi.spyOn(trigger, 'focus')
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(focusSpy).toHaveBeenCalled()
    cleanup()
  })

  it('非 Escape 按键不关闭', () => {
    const { onClose, cleanup } = setup()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    })
    expect(onClose).not.toHaveBeenCalled()
    cleanup()
  })

  it('open=false 时不挂监听，外部点击不关闭', () => {
    const { onClose, cleanup } = setup({ open: false })
    act(() => {
      document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
    expect(onClose).not.toHaveBeenCalled()
    cleanup()
  })

  it('rerender 传入新 onClose 后，外部 pointerdown 调用的是最新回调（ref 稳定，不复用旧渲染的对象）', () => {
    const onCloseA = vi.fn()
    const onCloseB = vi.fn()
    const containerRef = createRef<HTMLDivElement>()
    const container = document.createElement('div')
    document.body.append(container)
    ;(containerRef as { current: HTMLDivElement | null }).current = container

    const { rerender } = renderHook(
      ({ onClose }: { onClose: () => void }) =>
        useDismissibleLayer({ containerRef, open: true, onClose }),
      { initialProps: { onClose: onCloseA } },
    )

    // open / containerRef 不变 → 监听 effect 不重挂；
    // 此时 handler 持有的 ref 必须能读到最新的 onCloseB。
    rerender({ onClose: onCloseB })

    act(() => {
      document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })

    expect(onCloseB).toHaveBeenCalledTimes(1)
    expect(onCloseA).not.toHaveBeenCalled()
    container.remove()
  })

  it('routeKey 变化时关闭', () => {
    const containerRef = createRef<HTMLDivElement>()
    const onClose = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    ;(containerRef as { current: HTMLDivElement | null }).current = container

    let routeKey = '/library'
    const { rerender } = renderHook(() =>
      useDismissibleLayer({ containerRef, open: true, onClose, routeKey }),
    )

    // routeKey 不变不关闭
    rerender()
    expect(onClose).not.toHaveBeenCalled()

    // routeKey 变化 → 关闭
    routeKey = '/settings'
    rerender()
    expect(onClose).toHaveBeenCalledTimes(1)
    container.remove()
  })
})
