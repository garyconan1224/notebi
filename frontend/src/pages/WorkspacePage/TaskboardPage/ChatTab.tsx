import { TaskChatPanel } from '@/components/workspace/TaskChatPanel'
import type { WorkspaceRecord } from '@/types/workspace'

interface ChatTabProps {
  workspace: WorkspaceRecord
}

/**
 * Chat tab — 复用 N6 的 TaskChatPanel。
 */
export function ChatTab({ workspace }: ChatTabProps) {
  return (
    <>
      <div className="tb-head-mini">
        <div>
          <div
            className="eyebrow"
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 11,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--ink-3)',
            }}
          >
            AI 对话 · 基于素材上下文
          </div>
          <h2 className="display" style={{ fontSize: 28, margin: '4px 0 0' }}>
            AI 对话 · Task Chat
          </h2>
        </div>
      </div>
      <TaskChatPanel workspace={workspace} />
    </>
  )
}
