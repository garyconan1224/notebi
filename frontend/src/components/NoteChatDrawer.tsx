import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, History, Loader2, MessageCircle, Plus, Save, Send, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  type ChatMessage,
  createChatTurn,
  deleteChat,
  listChats,
  listChatMessages,
  subscribeChatTurn,
  type ChatSummary,
} from '@/services/chat'
import { toast } from 'sonner'
import './NoteChatDrawer.css'

export interface NoteChatDrawerProps {
  workspaceId: string
  /** 前端构建的 system prompt，锁定问答上下文 */
  systemPrompt: string
  /** 后端按当前问题从这些素材的完整转写中检索相关证据。 */
  itemIds?: string[]
  /** 作用域提示文案（显示在消息区上方） */
  scopeHint: string
  /** 'drawer' = FAB + 浮动抽屉；'inline' = 仅内嵌内容（由父容器控制尺寸） */
  mode?: 'drawer' | 'inline'
  /** drawer 模式下关闭按钮回调（inline 模式可不传） */
  onClose?: () => void
  /** 父级已有标题时隐藏内部标题，避免停靠面板重复显示“问 AI”。 */
  showHeader?: boolean
  /** 结果页将回答追加到当前正在编辑的主笔记或总结版本。 */
  onSaveAnswer?: (answer: string) => void
}

/**
 * 共用 AI 问答组件。
 * - drawer 模式：渲染浮动按钮 + 抽屉（ln 页用）
 * - inline 模式：仅渲染 header/scope/messages/input（结果页右侧面板用）
 */
export default function NoteChatDrawer({
  workspaceId,
  systemPrompt,
  itemIds = [],
  scopeHint,
  mode = 'drawer',
  onClose,
  showHeader = true,
  onSaveAnswer,
}: NoteChatDrawerProps) {
  const [open, setOpen] = useState(mode === 'inline') // inline 模式默认打开
  const [chatId, setChatId] = useState<string | null>(null)
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [chatSummaries, setChatSummaries] = useState<ChatSummary[]>([])
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  const refreshChatSummaries = useCallback(async () => {
    try {
      setChatSummaries(await listChats(workspaceId))
    } catch {
      // 历史会话不可用不应阻塞当前提问。
    }
  }, [workspaceId])

  useEffect(() => {
    if (open) void refreshChatSummaries()
  }, [open, refreshChatSummaries])

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
        item_ids: itemIds,
      })
      setChatId(turn.chat_id)
      void refreshChatSummaries()

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
          void refreshChatSummaries()
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
  }, [input, streaming, workspaceId, chatId, systemPrompt, itemIds, refreshChatSummaries])

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

  const handleStartNewChat = () => {
    cleanupRef.current?.()
    cleanupRef.current = null
    setChatId(null)
    setHistory([])
    setStreamText('')
    setInput('')
    setSessionsOpen(false)
  }

  const handleClearActiveChat = async () => {
    if (!chatId || streaming) return
    if (!window.confirm('清空当前会话后无法恢复。确认继续吗？')) return
    try {
      await deleteChat(workspaceId, chatId)
      handleStartNewChat()
      await refreshChatSummaries()
      toast.success('当前会话已清空')
    } catch {
      toast.error('清空当前会话失败，请重试')
    }
  }

  const handleCopyAnswer = async (answer: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(answer)
      toast.success('回答已复制')
    } catch {
      toast.error('复制失败，请手动选择文本')
    }
  }

  const chatContent = (
    <>
      {showHeader && (
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
      )}

      <div className="note-chat-scope-hint">{scopeHint}</div>

      <div className="note-chat-session-tools">
        <div className="note-chat-session-actions">
          <button type="button" onClick={() => setSessionsOpen((value) => !value)} aria-label="历史会话">
            <History size={13} /> 历史{chatSummaries.length ? ` (${chatSummaries.length})` : ''}
          </button>
          <button type="button" onClick={handleStartNewChat} aria-label="新建会话">
            <Plus size={13} /> 新建
          </button>
          {chatId && (
            <button type="button" onClick={() => void handleClearActiveChat()} aria-label="清空当前会话" disabled={streaming}>
              <Trash2 size={13} /> 清空
            </button>
          )}
        </div>
        {sessionsOpen && (
          <ul className="note-chat-session-list" aria-label="历史会话列表">
            {chatSummaries.length === 0 ? (
              <li className="note-chat-session-empty">还没有历史会话</li>
            ) : chatSummaries.map((summary) => (
              <li key={summary.chat_id}>
                <button
                  type="button"
                  aria-label={`打开会话 ${summary.chat_id}`}
                  onClick={() => {
                    setChatId(summary.chat_id)
                    setHistory([])
                    setSessionsOpen(false)
                  }}
                >
                  <strong>{new Date(summary.last_at).toLocaleString()}</strong>
                  <span>{summary.message_count} 条消息</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="note-chat-prompts" aria-label="推荐问题">
        {[
          ['总结核心观点', '请用 3 到 5 条总结这篇笔记的核心观点，并标出对应证据。'],
          ['解释关键概念', '请解释这篇笔记里的关键概念，并用素材中的例子说明。'],
          ['整理行动项', '请整理可执行的行动项、前置条件和风险；没有依据时明确说明。'],
        ].map(([label, prompt]) => (
          <button key={label} type="button" onClick={() => setInput(prompt)}>{label}</button>
        ))}
      </div>

      <ScrollArea className="note-chat-messages">
        <div ref={scrollRef} className="note-chat-messages-inner">
          {history.length === 0 && !streaming && (
            <p className="note-chat-empty">
              问个问题吧 · Enter 发送 / Shift+Enter 换行
            </p>
          )}
          {history.map((m) => (
            <Bubble
              key={m.message_id}
              role={m.role}
              content={m.content}
              onCopy={handleCopyAnswer}
              onSave={onSaveAnswer}
            />
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
            aria-label="输入问题"
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
  onCopy?: (answer: string) => void
  onSave?: (answer: string) => void
}

function Bubble({ role, content, pending, onCopy, onSave }: BubbleProps) {
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
      {!isUser && !pending && content && (onCopy || onSave) && (
        <div className="note-chat-answer-actions">
          {onCopy && <button type="button" aria-label="复制回答" onClick={() => void onCopy(content)}><Copy size={12} />复制</button>}
          {onSave && <button type="button" aria-label="保存为笔记" onClick={() => onSave(content)}><Save size={12} />保存</button>}
        </div>
      )}
    </div>
  )
}
