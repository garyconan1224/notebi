import {
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { MessageCircle, X } from 'lucide-react'

import NoteChatDrawer from '@/components/NoteChatDrawer'

import './floating-ask-ai.css'

interface FloatingAskAiProps {
  workspaceId: string
  systemPrompt: string
  itemIds?: string[]
  scopeHint: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onWidthChange?: (width: number) => void
  hideTrigger?: boolean
  onSaveAnswer?: (answer: string) => void
  onOpenSource?: (sourceIndex: number) => void
}

const MIN_WIDTH = 340
const MAX_WIDTH = 620

export function FloatingAskAi({
  workspaceId,
  systemPrompt,
  itemIds,
  scopeHint,
  open: controlledOpen,
  onOpenChange,
  onWidthChange,
  hideTrigger = false,
  onSaveAnswer,
  onOpenSource,
}: FloatingAskAiProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [width, setWidth] = useState(400)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen

  const handleResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    const handleMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, startWidth + startX - moveEvent.clientX),
      )
      setWidth(nextWidth)
      onWidthChange?.(nextWidth)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', cleanup)
      window.removeEventListener('pointercancel', cleanup)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', cleanup)
    window.addEventListener('pointercancel', cleanup)
  }

  if (!open && hideTrigger) return null

  return (
    <>
      {!open && (
        <button
          type="button"
          className="note-ai-trigger"
          onClick={() => setOpen(true)}
        >
          <MessageCircle size={16} />
          <span>问 AI</span>
        </button>
      )}

      {open && (
        <aside
          className="note-ai-dock"
          role="complementary"
          aria-label="问 AI"
          style={{ '--note-ai-width': `${width}px` } as CSSProperties}
        >
          <div
            className="note-ai-resizer"
            role="separator"
            aria-label="调整问 AI 宽度"
            aria-orientation="vertical"
            aria-valuemin={MIN_WIDTH}
            aria-valuemax={MAX_WIDTH}
            aria-valuenow={width}
            onPointerDown={handleResizeStart}
          />
          <header className="note-ai-dock-header">
            <div>
              <strong><MessageCircle size={14} /> 问 AI</strong>
              <span>{scopeHint}</span>
            </div>
            <button
              type="button"
              aria-label="关闭问 AI"
              onClick={() => setOpen(false)}
            >
              <X size={15} />
            </button>
          </header>
          <div className="note-ai-dock-body">
            <NoteChatDrawer
              workspaceId={workspaceId}
              systemPrompt={systemPrompt}
              itemIds={itemIds}
              scopeHint={scopeHint}
              mode="inline"
              showHeader={false}
              onSaveAnswer={onSaveAnswer}
              onOpenSource={onOpenSource}
            />
          </div>
        </aside>
      )}
    </>
  )
}
