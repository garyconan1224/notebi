import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, MessageSquare, Send, Trash2, X } from 'lucide-react'
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

interface ChatSidebarProps {
  workspaceId: string
}

/**
 * 工作区右侧浮动聊天面板（Phase 2A.3）。
 *
 * 折叠态：右下角浮动按钮；展开态：固定右侧 400px 宽抽屉，内部消息列表 + 输入框。
 * 流式：POST 创建回合 → 订阅 SSE delta → 完成后用 messages 接口重拉做最终一致性校验。
 */
export function ChatSidebar({ workspaceId }: ChatSidebarProps) {
  const [open, setOpen] = useState(false)
  const [chatId, setChatId] = useState<string | null>(null)
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  // 打开时拉一次最近会话（若有 chatId）
  useEffect(() => {
    if (!open || !chatId) return
    let cancelled = false
    listChatMessages(workspaceId, chatId)
      .then((msgs) => {
        if (!cancelled) setHistory(msgs)
      })
      .catch(() => {
        /* 静默：可能是 workspace 还没消息 */
      })
    return () => {
      cancelled = true
    }
  }, [open, chatId, workspaceId])

  // 自动滚到底
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [history, streamText, streaming])

  // 卸载时清掉 SSE
  useEffect(() => {
    return () => {
      cleanupRef.current?.()
    }
  }, [])

  const handleSend = useCallback(async () => {
    const prompt = input.trim()
    if (!prompt || streaming) return
    setInput('')
    setStreaming(true)
    setStreamText('')
    // 乐观插入用户消息
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
      })
      setChatId(turn.chat_id)

      cleanupRef.current?.()
      cleanupRef.current = subscribeChatTurn(workspaceId, turn.turn_id, {
        onDelta: (text) => setStreamText((s) => s + text),
        onDone: async () => {
          try {
            const fresh = await listChatMessages(workspaceId, turn.chat_id)
            setHistory(fresh)
          } catch {
            /* ignore */
          }
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
      // 撤回乐观消息
      setHistory((h) => h.filter((m) => m.message_id !== optimisticUser.message_id))
    }
  }, [input, streaming, workspaceId, chatId])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void handleSend()
    }
  }

  const startNewChat = () => {
    cleanupRef.current?.()
    setChatId(null)
    setHistory([])
    setStreamText('')
    setStreaming(false)
  }

  if (!open) {
    return (
      <button
        aria-label="打开聊天"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-violet-600 text-white shadow-lg transition-transform hover:scale-105"
      >
        <MessageSquare size={20} />
      </button>
    )
  }

  return (
    <div className="fixed right-4 top-16 bottom-4 z-40 flex w-[400px] flex-col rounded-lg border border-border bg-background shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <MessageSquare size={14} />
          <span>工作区助手</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            title="新会话"
            onClick={startNewChat}
            disabled={streaming}
          >
            <Trash2 size={14} />
          </Button>
          <Button size="sm" variant="ghost" title="关闭" onClick={() => setOpen(false)}>
            <X size={14} />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-3 py-3">
        <div ref={scrollRef} className="flex flex-col gap-3">
          {history.length === 0 && !streaming && (
            <p className="mt-8 text-center text-xs text-muted-foreground">
              发个消息开始聊天吧 · Enter 发送 / Shift+Enter 换行
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

      {/* Input */}
      <div className="border-t border-border p-2">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息…"
            rows={2}
            className="resize-none text-sm"
            disabled={streaming}
          />
          <Button
            size="sm"
            onClick={() => void handleSend()}
            disabled={streaming || !input.trim()}
          >
            {streaming ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </Button>
        </div>
      </div>
    </div>
  )
}

interface BubbleProps {
  role: ChatMessage['role']
  content: string
  pending?: boolean
}

function Bubble({ role, content, pending }: BubbleProps) {
  const isUser = role === 'user'
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm',
          isUser
            ? 'bg-violet-600 text-white'
            : 'bg-muted text-foreground',
          pending && 'opacity-90',
        )}
      >
        {content || (pending ? '…' : '')}
      </div>
    </div>
  )
}

export default ChatSidebar
