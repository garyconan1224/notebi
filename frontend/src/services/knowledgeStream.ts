import type {
  KnowledgeMessage,
  KnowledgeItemRef,
  KnowledgeSourceSnapshot,
  KnowledgeStreamEvent,
} from '@/types/knowledgeConversation'

const BASE = import.meta.env.VITE_BACKEND_BASE_URL ?? 'http://127.0.0.1:8001'

export class KnowledgeStreamError extends Error {
  readonly sources: KnowledgeSourceSnapshot[]
  readonly recoverable: boolean
  readonly aborted: boolean

  constructor(
    message: string,
    options: {
      sources?: KnowledgeSourceSnapshot[]
      recoverable?: boolean
      aborted?: boolean
    } = {},
  ) {
    super(message)
    this.name = 'KnowledgeStreamError'
    this.sources = options.sources ?? []
    this.recoverable = options.recoverable ?? true
    this.aborted = options.aborted ?? false
  }
}

function parseLine(line: string): KnowledgeStreamEvent {
  try {
    const event = JSON.parse(line) as KnowledgeStreamEvent
    if (!event || typeof event !== 'object' || !('type' in event)) {
      throw new Error('missing event type')
    }
    return event
  } catch {
    throw new KnowledgeStreamError('知识库返回了无法解析的流事件')
  }
}

export async function* parseKnowledgeNdjson(
  response: Response,
): AsyncGenerator<KnowledgeStreamEvent> {
  if (!response.body) {
    throw new KnowledgeStreamError('知识库响应没有可读取的内容')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim()) yield parseLine(line)
      }
      if (done) break
    }
    if (buffer.trim()) yield parseLine(buffer)
  } finally {
    reader.releaseLock()
  }
}

export interface SendKnowledgeMessageOptions {
  conversationId: string
  question: string
  workspaceIds?: string[]
  itemRefs?: KnowledgeItemRef[]
  topK?: number
  signal?: AbortSignal
  onStatus?: (stage: 'retrieving' | 'generating', messageId: string) => void
  onSources?: (sources: KnowledgeSourceSnapshot[]) => void
  onDelta?: (text: string) => void
  onDone?: (message: KnowledgeMessage) => void
  fetcher?: typeof fetch
}

export async function sendKnowledgeMessage(
  options: SendKnowledgeMessageOptions,
): Promise<KnowledgeMessage | undefined> {
  const fetcher = options.fetcher ?? fetch
  let sources: KnowledgeSourceSnapshot[] = []
  try {
    const response = await fetcher(
      `${BASE}/knowledge/conversations/${encodeURIComponent(options.conversationId)}/messages/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: options.question,
          workspace_ids: options.workspaceIds,
          item_refs: options.itemRefs,
          top_k: options.topK ?? 10,
        }),
        signal: options.signal,
      },
    )
    if (!response.ok) {
      const detail = (await response.text()).trim()
      throw new KnowledgeStreamError(
        detail || `知识库请求失败（${response.status}）`,
      )
    }
    for await (const event of parseKnowledgeNdjson(response)) {
      if (event.type === 'status') {
        options.onStatus?.(event.stage, event.message_id)
      } else if (event.type === 'sources') {
        sources = event.sources
        options.onSources?.(sources)
      } else if (event.type === 'delta') {
        options.onDelta?.(event.text)
      } else if (event.type === 'error') {
        throw new KnowledgeStreamError(event.error, {
          sources,
          recoverable: event.recoverable ?? true,
        })
      } else if (event.type === 'done') {
        options.onDone?.(event.message)
        return event.message
      }
    }
    throw new KnowledgeStreamError('知识库连接已中断', { sources })
  } catch (error) {
    if (error instanceof KnowledgeStreamError) throw error
    if (
      options.signal?.aborted
      || (error instanceof DOMException && error.name === 'AbortError')
    ) {
      throw new KnowledgeStreamError('已停止生成', {
        sources,
        aborted: true,
      })
    }
    throw new KnowledgeStreamError(
      error instanceof Error ? error.message : '知识库连接失败',
      { sources },
    )
  }
}
