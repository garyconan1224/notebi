import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, MessageCircle, Send, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  type ChatMessage,
  createChatTurn,
  listChatMessages,
  subscribeChatTurn,
} from '@/services/chat'
import { toast } from 'sonner'
import './NoteChatDrawer.css'

export interface NoteChatDrawerProps {
  workspaceId: string
  /** 前端构建的 system prompt，锁定问答上下文 */
  systemPrompt: string
  /** 作用域提示文案（显示在消息区上方） */
  scopeHint: string
  /** 'drawer' = FAB + 浮动抽屉；'inline' = 仅内嵌内容（由父容器控制尺寸） */
  mode?: 'drawer' | 'inline'
  /** drawer 模式下关闭按钮回调（inline 模式可不传） */
  onClose?: () => void
}

/**
 * 共用 AI 问答组件。
 * - drawer 模式：渲染浮动按钮 + 抽屉（ln 页用）
 * - inline 模式：仅渲染 header/scope/messages/input（结果页右侧面板用）
 */
export default function NoteChatDrawer({
  workspaceId,
  systemPrompt,
  scopeHint,
  mode = 'drawer',
  onClose,
}: NoteChatDrawerProps) {
  const [open, setOpen] = useState(mode === 'inline') // inline 模式默认打开
  const [chatId, setChatId] = useState<string | null>(null)
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!open || !chatId) return
    let cancelled = false
    listChatMessages(workspaceId, chatId)
      .then((msgs) => {
        if (!cancelled) setHistory(msgs)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [open, chatId, workspaceId])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [history, streamText, streaming])

  useEffect(() => {
    return () => { cleanupRef.current?.() }
  }, [])

  const handleSend = useCallback(async () => {
    const prompt = input.trim()
    if (!prompt || streaming) return
    setInput('')
    setStreaming(true)
    setStreamText('')

    const optimisticUser: ChatMessage = {
      chat_id: chatId ?? '__pending__',
      message_id: `tmp-${Date.now()}`,
      role: 'user',
      content: prompt,
      created_at: new Date().toISOString(),
      model: null,
    }
    setHistory((h) => [...h, optimisticUser])

    try {
      const turn = await createChatTurn(workspaceId, {
        prompt,
        chat_id: chatId ?? undefined,
        system_prompt: systemPrompt,
      })
      setChatId(turn.chat_id)

      cleanupRef.current?.()
      cleanupRef.current = subscribeChatTurn(workspaceId, turn.turn_id, {
        onDelta: (text) => setStreamText((s) => s + text),
        onDone: async () => {
          try {
            const fresh = await listChatMessages(workspaceId, turn.chat_id)
            setHistory(fresh)
          } catch { /* ignore */ }
          setStreamText('')
          setStreaming(false)
        },
        onError: (msg) => {
          toast.error(`聊天出错：${msg}`)
          setStreamText('')
          setStreaming(false)
        },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`发送失败：${msg}`)
      setStreaming(false)
      setHistory((h) => h.filter((m) => m.message_id !== optimisticUser.message_id))
    }
  }, [input, streaming, workspaceId, chatId, systemPrompt])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void handleSend()
    }
  }

  const handleClose = () => {
    if (mode === 'drawer') {
      setOpen(false)
      onClose?.()
    }
  }

  const chatContent = (
    <>
      <div className="note-chat-header">
        <div className="note-chat-title">
          <MessageCircle size={14} />
          <span>问 AI</span>
        </div>
        {mode === 'drawer' && (
          <Button size="sm" variant="ghost" title="关闭" onClick={handleClose}>
            <X size={14} />
          </Button>
        )}
      </div>

      <div className="note-chat-scope-hint">{scopeHint}</div>

      <ScrollArea className="note-chat-messages">
        <div ref={scrollRef} className="note-chat-messages-inner">
          {history.length === 0 && !streaming && (
            <p className="note-chat-empty">
              问个问题吧 · Enter 发送 / Shift+Enter 换行
            </p>
          )}
          {history.map((m) => (
            <Bubble key={m.message_id} role={m.role} content={m.content} />
          ))}
          {streaming && (
            <Bubble role="assistant" content={streamText} pending />
          )}
        </div>
      </ScrollArea>

      <div className="note-chat-input-area">
        <div className="note-chat-input-row">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息…"
            rows={2}
            className="note-chat-textarea"
            disabled={streaming}
          />
          <Button
            size="sm"
            onClick={() => void handleSend()}
            disabled={streaming || !input.trim()}
          >
            {streaming ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
          </Button>
        </div>
      </div>
    </>
  )

  // ── drawer 模式：FAB + 浮动面板 ──
  if (mode === 'drawer') {
    return (
      <>
        {!open && (
          <button aria-label="问 AI" onClick={() => setOpen(true)} className="ln-chat-fab">
            <MessageCircle size={18} />
            <span>问 AI</span>
          </button>
        )}
        {open && (
          <div className="ln-chat-drawer">
            {chatContent}
          </div>
        )}
      </>
    )
  }

  // ── inline 模式：直接渲染内容 ──
  return <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>{chatContent}</div>
}

/* ── Bubble 子组件 ── */

interface BubbleProps {
  role: ChatMessage['role']
  content: string
  pending?: boolean
}

function Bubble({ role, content, pending }: BubbleProps) {
  const isUser = role === 'user'
  return (
    <div className={cn('note-chat-bubble-row', isUser && 'note-chat-bubble-user')}>
      <div
        className={cn(
          'note-chat-bubble',
          isUser ? 'note-chat-bubble-user-bg' : 'note-chat-bubble-assistant-bg',
          pending && 'note-chat-bubble-pending',
        )}
      >
        {content || (pending ? '…' : '')}
      </div>
    </div>
  )
}
