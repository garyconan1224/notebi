import { useEffect, useRef, type RefObject } from 'react'

export interface DismissibleLayerOptions {
  /** 浮层根容器；外部 pointerdown 命中其外则关闭 */
  containerRef: RefObject<HTMLElement | null>
  /** 是否打开；关闭时不挂监听 */
  open: boolean
  /** 关闭回调（外部点击 / Escape / 路由变化都会调用） */
  onClose: () => void
  /** 触发按钮；Escape 关闭后把焦点还给它（可选） */
  triggerRef?: RefObject<HTMLElement | null>
  /**
   * 当前路由标识（通常传 useLocation().pathname）。
   * 打开后该值变化即视为路由切换 → 关闭。不传则不启用路由关闭。
   */
  routeKey?: string
  /**
   * 额外的“视为浮层内部”的节点。用于 Portal / 下拉菜单把弹层
   * 渲染到 body 之外的场景：点这些节点也不算外部点击。
   */
  ignoreRefs?: Array<RefObject<HTMLElement | null>>
}

/**
 * 统一“临时浮层”关闭规则（计划 §1.1）：
 * 下拉菜单 / 选择器 / Popover / 小型二级面板适用；
 * 模态框未保存表单、Accordion 持久披露不应套用本 hook。
 *
 * 规则：
 * - 点浮层内部：保持打开（由 React 自然处理，本 hook 不介入）。
 * - 点浮层外部（pointerdown）：关闭。
 * - 按 Escape：关闭并把焦点还给触发按钮。
 * - 路由变化（routeKey 改变）：关闭。
 */
export function useDismissibleLayer({
  containerRef,
  open,
  onClose,
  triggerRef,
  routeKey,
  ignoreRefs,
}: DismissibleLayerOptions): void {
  // 用 ref 持有最新 onClose，避免父组件每次渲染重建回调导致监听器反复重挂。
  const onCloseRef = { current: onClose }
  onCloseRef.current = onClose

  // 外部 pointerdown 关闭
  useEffect(() => {
    if (!open) return
    const handler = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      const container = containerRef.current
      if (container && container.contains(target)) return
      if (ignoreRefs?.some((ref) => ref.current?.contains(target))) return
      onCloseRef.current()
    }
    // pointerdown 比 click 更早触发，能在点击其它输入框前先关闭，体验更稳。
    document.addEventListener('pointerdown', handler, true)
    return () => document.removeEventListener('pointerdown', handler, true)
  }, [open, containerRef, ignoreRefs])

  // Escape 关闭并归还焦点
  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      onCloseRef.current()
      triggerRef?.current?.focus()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, triggerRef])

  // 路由变化关闭
  const prevRouteKeyRef = useRef(routeKey)
  useEffect(() => {
    // 仅在 routeKey 实际变化时触发；初次挂载不关闭。
    if (prevRouteKeyRef.current === routeKey) return
    prevRouteKeyRef.current = routeKey
    if (!open || routeKey === undefined) return
    onCloseRef.current()
  }, [routeKey, open])
}
