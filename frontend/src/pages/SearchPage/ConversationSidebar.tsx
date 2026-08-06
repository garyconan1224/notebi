import { MessageSquare, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('pages')
  return (
    <nav className="knowledge-conversations" aria-label={t('knowledge.conversationsTitle')}>
      <div className="knowledge-panel-heading">
        <div>
          <span>CONVERSATIONS</span>
          <strong>{t('knowledge.conversations')}</strong>
        </div>
        <button type="button" onClick={onNew} aria-label={t('knowledge.newConversationAria')}>
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
                <strong>{conversation.title || t('knowledge.newConversation')}</strong>
                <small>
                  {conversation.messages.length} 条消息
                </small>
              </span>
            </button>
            <button
              type="button"
              className="knowledge-conversation-delete"
              aria-label={t('knowledge.deleteConversation', { title: conversation.title })}
              onClick={() => onDelete(conversation.conversation_id)}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {conversations.length === 0 && (
          <p className="knowledge-panel-empty">{t('knowledge.noConversations')}</p>
        )}
      </div>
    </nav>
  )
}
