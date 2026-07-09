// chat API 客户端——对应 backend/app/routes/chat.py（Phase 2A.2）
//
// 与其它 service 同风格：走 axios 实例返回 .data；SSE 用原生 EventSource。

import { http } from './client'

const BASE = import.meta.env.VITE_BACKEND_BASE_URL ?? 'http://127.0.0.1:8000'

export type ChatRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  chat_id: string
  message_id: string
  role: ChatRole
  content: string
  created_at: string
  model: string | null
}

export interface ChatSummary {
  chat_id: string
  message_count: number
  first_at: string
  last_at: string
}

export interface CreateChatTurnRequest {
  prompt: string
  chat_id?: string
  model?: string
  /** N6: 选中的上下文素材 id 列表；空 = 无 item 上下文（兼容浮动入口） */
  item_ids?: string[]
  /** B-8: 前端直接提供 system prompt（如 LN 页上下文）；优先级高于 item_ids */
  system_prompt?: string
}

export interface CreateChatTurnResponse {
  turn_id: string
  chat_id: string
  workspace_id: string
  status: string
  /** N6: 后端把 item 上下文截断了 → 前端展示「上下文已自动精简」 */
  context_truncated?: boolean
  /** N6: 实际成功注入的 item_ids（与请求里的 item_ids 对比可知哪些被丢） */
  used_item_ids?: string[]
}

/** POST /workspaces/{id}/chat */
export async function createChatTurn(
  workspaceId: string,
  req: CreateChatTurnRequest,
): Promise<CreateChatTurnResponse> {
  const res = await http.post<CreateChatTurnResponse>(
    `/workspaces/${workspaceId}/chat`,
    req,
  )
  return res.data
}

/** GET /workspaces/{id}/chat/messages?chat_id= */
export async function listChatMessages(
  workspaceId: string,
  chatId?: string,
): Promise<ChatMessage[]> {
  const params = chatId ? { chat_id: chatId } : undefined
  const res = await http.get<ChatMessage[]>(
    `/workspaces/${workspaceId}/chat/messages`,
    { params },
  )
  return res.data
}

/** GET /workspaces/{id}/chat/list */
export async function listChats(workspaceId: string): Promise<ChatSummary[]> {
  const res = await http.get<ChatSummary[]>(`/workspaces/${workspaceId}/chat/list`)
  return res.data
}

export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; chat_id: string; message_id: string }
  | { type: 'error'; message: string }

export interface ChatStreamHandlers {
  onDelta?: (text: string) => void
  onDone?: (e: { chat_id: string; message_id: string }) => void
  onError?: (msg: string) => void
}

/** 订阅一轮对话的 SSE 流；返回 cleanup。 */
export function subscribeChatTurn(
  workspaceId: string,
  turnId: string,
  handlers: ChatStreamHandlers,
): () => void {
  const url = `${BASE}/workspaces/${workspaceId}/chat/events?turn_id=${encodeURIComponent(turnId)}`
  const source = new EventSource(url)

  source.addEventListener('message', (evt) => {
    try {
      const data = JSON.parse((evt as MessageEvent).data) as ChatStreamEvent
      if (data.type === 'delta') handlers.onDelta?.(data.text)
      else if (data.type === 'done') {
        handlers.onDone?.({ chat_id: data.chat_id, message_id: data.message_id })
        source.close()
      } else if (data.type === 'error') {
        handlers.onError?.(data.message)
        source.close()
      }
    } catch {
      // ignore malformed line
    }
  })

  source.addEventListener('error', () => {
    handlers.onError?.('连接中断')
    source.close()
  })

  return () => source.close()
}
