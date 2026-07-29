import type { SearchSource } from '@/services/search'

export type KnowledgeMessageStatus =
  | 'retrieving'
  | 'generating'
  | 'complete'
  | 'failed'
  | 'insufficient_evidence'

export type KnowledgeSourceSnapshot = Partial<SearchSource> & {
  source_id: string
  workspace_id: string
  item_id: string
  title?: string
}

export interface KnowledgeMessage {
  message_id: string
  role: 'user' | 'assistant'
  status: KnowledgeMessageStatus
  content: string
  scope_snapshot: string[]
  query_text: string
  answer_version: number
  citations: string[]
  sources: KnowledgeSourceSnapshot[]
  evidence_status: {
    sufficient?: boolean
    threshold?: number
    best_score?: number | null
  }
  error: string
  timings_ms: Record<string, number>
  created_at: string
}

export interface KnowledgeConversation {
  conversation_id: string
  title: string
  default_scope: string[]
  messages: KnowledgeMessage[]
  created_at: string
  updated_at: string
}

export type KnowledgeStreamEvent =
  | {
    type: 'status'
    stage: 'retrieving' | 'generating'
    message_id: string
  }
  | {
    type: 'sources'
    message_id?: string
    sources: KnowledgeSourceSnapshot[]
    citations?: string[]
    evidence_status?: KnowledgeMessage['evidence_status']
  }
  | { type: 'delta'; message_id?: string; text: string }
  | { type: 'done'; message: KnowledgeMessage }
  | {
    type: 'error'
    message_id?: string
    error: string
    recoverable?: boolean
  }
