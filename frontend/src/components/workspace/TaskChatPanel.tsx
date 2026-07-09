import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCheck,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  Loader2,
  Send,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import {
  type ChatMessage,
  createChatTurn,
  listChatMessages,
  subscribeChatTurn,
} from '@/services/chat'
import type { ItemType, WorkspaceRecord } from '@/types/workspace'
import { toast } from 'sonner'

interface TaskChatPanelProps {
  workspace: WorkspaceRecord
  /** 知识库问答模式：自动全选所有素材，UI 措辞对齐"知识库" */
  autoSelectAll?: boolean
}

const ITEM_TYPE_ICON: Record<ItemType, typeof FileVideo> = {
  video: FileVideo,
  audio: FileAudio,
  image: FileImage,
  text: FileText,
}

/**
 * 任务级 AI 对话面板（N6，SPEC §1.5）。
 *
 * - 顶部素材 chip 多选条 + 「全任务上下文」一键全选
 * - 用户必须勾 ≥ 1 个素材才能发送
 * - 后端把选中 item 拼成 system prompt；超 token 阈值时返回 context_truncated
 *   → 顶部展示「上下文已自动精简」徽章（仅本轮）
 * - 复用现有 SSE 流式订阅逻辑
 *
 * 旧浮动 ChatSidebar 不动，作为「无上下文」快速入口保留。
 */
export function TaskChatPanel({ workspace, autoSelectAll }: TaskChatPanelProps) {
  const items = workspace.items ?? []
  const workspaceId = workspace.workspace_id

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // 知识库问答模式：自动全选所有素材
  useEffect(() => {
    if (autoSelectAll && items.length > 0 && selectedIds.size === 0) {
      setSelectedIds(new Set(items.map((it) => it.item_id)))
    }
  }, [autoSelectAll, items, selectedIds.size])
  const [chatId, setChatId] = useState<string | null>(null)
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [input, setInput] = useState('')
  const [lastTruncated, setLastTruncated] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  const allSelected = items.length > 0 && selectedIds.size === items.length

  // 拉历史
  useEffect(() => {
    if (!chatId) return
    let cancelled = false
    listChatMessages(workspaceId, chatId)
      .then((msgs) => {
        if (!cancelled) setHistory(msgs)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [chatId, workspaceId])

  // 自动滚到底
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [history, streamText, streaming])

  // 卸载清掉 SSE
  useEffect(
    () => () => {
      cleanupRef.current?.()
    },
    [],
  )

  const toggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set())
    else setSelectedIds(new Set(items.map((it) => it.item_id)))
  }

  const handleSend = useCallback(async () => {
    const prompt = input.trim()
    if (!prompt || streaming) return
    if (selectedIds.size === 0) {
      toast.error('请先勾选至少一个素材作为上下文')
      return
    }
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
        item_ids: Array.from(selectedIds),
      })
      setChatId(turn.chat_id)
      setLastTruncated(!!turn.context_truncated)

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
      setHistory((h) => h.filter((m) => m.message_id !== optimisticUser.message_id))
    }
  }, [input, streaming, selectedIds, workspaceId, chatId])

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
    setLastTruncated(false)
  }

  const placeholder = useMemo(() => {
    if (items.length === 0) return '当前合集还没有笔记，先去「素材」标签添加'
    if (selectedIds.size === 0) return '请先勾选上方的素材 chip 作为对话上下文'
    return '输入消息… Enter 发送 / Shift+Enter 换行'
  }, [items.length, selectedIds.size])

  return (
    <div className="flex h-[calc(100vh-220px)] min-h-[480px] flex-col rounded-lg border bg-background">
      {/* 顶部：素材 chip 条 */}
      <div className="border-b px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-xs font-medium text-muted-foreground">
            {autoSelectAll ? '知识库笔记' : '上下文素材'} · 已选 {selectedIds.size} / {items.length}
          </div>
          <div className="flex items-center gap-2">
            {lastTruncated && (
              <Badge
                variant="outline"
                className="border-amber-300 bg-amber-50 text-amber-800"
              >
                <AlertTriangle size={12} className="mr-1" />
                {autoSelectAll ? '上下文已精简，部分笔记未完整纳入' : '上下文已自动精简'}
              </Badge>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={toggleAll}
              disabled={items.length === 0}
            >
              <CheckCheck size={14} className="mr-1" />
              {allSelected ? '全部取消' : autoSelectAll ? '全选笔记' : '全任务上下文'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={startNewChat}
              disabled={streaming}
              title="新对话"
            >
              <Trash2 size={14} />
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {items.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              {autoSelectAll ? '当前合集还没有笔记' : '当前任务还没有素材'}
            </span>
          ) : (
            items.map((it) => {
              const Icon = ITEM_TYPE_ICON[it.type as ItemType] ?? FileText
              const selected = selectedIds.has(it.item_id)
              return (
                <button
                  key={it.item_id}
                  type="button"
                  onClick={() => toggleItem(it.item_id)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition',
                    selected
                      ? 'border-violet-500 bg-violet-100 text-violet-900'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted/50',
                  )}
                >
                  <Icon size={12} />
                  <span className="max-w-[160px] truncate">
                    {it.name || it.item_id.slice(0, 8)}
                  </span>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* 消息列表 */}
      <ScrollArea className="flex-1 px-4 py-4">
        <div ref={scrollRef} className="flex flex-col gap-3">
          {history.length === 0 && !streaming && (
            <p className="mt-12 text-center text-xs text-muted-foreground">
              {autoSelectAll
                ? '笔记已自动选为上下文，直接开始提问。'
                : '勾选上方素材，然后开始提问。'}
              <br />
              {autoSelectAll
                ? '试试：「这些笔记的共同主题是什么？」「帮我总结一下关键要点。」'
                : '典型问题：「这几个素材色调有什么共同点？」「素材 1 第 0-10 秒的画面怎么优化提示词？」'}
            </p>
          )}
          {history.map((m) => (
            <Bubble key={m.message_id} role={m.role} content={m.content} />
          ))}
          {streaming && <Bubble role="assistant" content={streamText} pending />}
        </div>
      </ScrollArea>

      {/* 输入框 */}
      <div className="border-t p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={2}
            className="resize-none text-sm"
            disabled={streaming || selectedIds.size === 0}
          />
          <Button
            size="sm"
            onClick={() => void handleSend()}
            disabled={streaming || !input.trim() || selectedIds.size === 0}
          >
            {streaming ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
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

export default TaskChatPanel
