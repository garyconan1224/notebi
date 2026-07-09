import { useState } from 'react'
import { MessageCircle, X } from 'lucide-react'

import NoteChatDrawer from '@/components/NoteChatDrawer'

interface FloatingAskAiProps {
  workspaceId: string
  systemPrompt: string
  scopeHint: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
}

/**
 * 问 AI 悬浮泡泡 — 仿 FloatingTaskQueue（fixed right:24 bottom:24）。
 * 收起时显示胶囊按钮，展开时 popover 内嵌 NoteChatDrawer。
 */
export function FloatingAskAi({
  workspaceId,
  systemPrompt,
  scopeHint,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: FloatingAskAiProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen

  if (!open && hideTrigger) return null

  return (
    <>
      {/* ── 收起态：胶囊按钮 ── */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{
            position: 'fixed', right: 24, bottom: 80, zIndex: 38,
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 16px',
            background: 'var(--acc)', color: '#fff',
            borderRadius: 99, border: 'none', cursor: 'pointer',
            boxShadow: 'var(--shadow-lg)',
            fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600,
            transition: 'transform 160ms ease, box-shadow 160ms ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)' }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'none' }}
        >
          <MessageCircle size={16} />
          <span>问 AI</span>
        </button>
      )}

      {/* ── 展开态：popover 内嵌 NoteChatDrawer ── */}
      {open && (
        <div
          style={{
            position: 'fixed', right: 24, bottom: 24, zIndex: 38,
            width: 'min(440px, calc(100vw - 32px))', height: 'min(680px, calc(100vh - 88px))',
            background: 'var(--srf)', border: '1px solid var(--bdr)',
            borderRadius: 12, boxShadow: 'var(--shadow-lg)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 16px',
              borderBottom: '1px solid var(--bdr)',
              flexShrink: 0,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: 'var(--acc)' }}>
                <MessageCircle size={14} /> 问 AI
              </span>
              <div style={{
                maxWidth: 340,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                marginTop: 3,
                color: 'var(--mut)',
                fontSize: 11,
              }}>
                {scopeHint}
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 26, height: 26,
                borderRadius: 8, border: 'none', background: 'none',
                cursor: 'pointer', color: 'var(--mut)',
              }}
            >
              <X size={14} />
            </button>
          </div>

          {/* NoteChatDrawer (inline mode) */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
            <NoteChatDrawer
              workspaceId={workspaceId}
              systemPrompt={systemPrompt}
              scopeHint={scopeHint}
              mode="inline"
            />
          </div>
        </div>
      )}
    </>
  )
}
