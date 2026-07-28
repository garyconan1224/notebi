import { MessageSquare, Plus, Trash2 } from 'lucide-react'
import type { KnowledgeConversation } from '@/types/knowledgeConversation'

interface Props {
  conversations: KnowledgeConversation[]
  activeId: string | null
  onSelect: (conversationId: string) => void
  onNew: () => void
  onDelete: (conversationId: string) => void
}

export function ConversationSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: Props) {
  return (
    <nav className="knowledge-conversations" aria-label="知识库会话">
      <div className="knowledge-panel-heading">
        <div>
          <span>CONVERSATIONS</span>
          <strong>会话</strong>
        </div>
        <button type="button" onClick={onNew} aria-label="新建知识库会话">
          <Plus size={16} />
        </button>
      </div>
      <div className="knowledge-conversation-list">
        {conversations.map(conversation => (
          <div
            className="knowledge-conversation-row"
            data-active={conversation.conversation_id === activeId}
            key={conversation.conversation_id}
          >
            <button
              type="button"
              className="knowledge-conversation-select"
              onClick={() => onSelect(conversation.conversation_id)}
            >
              <MessageSquare size={14} />
              <span>
                <strong>{conversation.title || '新会话'}</strong>
                <small>
                  {conversation.messages.length} 条消息
                </small>
              </span>
            </button>
            <button
              type="button"
              className="knowledge-conversation-delete"
              aria-label={`删除会话 ${conversation.title}`}
              onClick={() => onDelete(conversation.conversation_id)}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {conversations.length === 0 && (
          <p className="knowledge-panel-empty">暂无会话，提出第一个问题即可创建。</p>
        )}
      </div>
    </nav>
  )
}
