import { TaskChatPanel } from '@/components/workspace/TaskChatPanel'
import type { WorkspaceRecord } from '@/types/workspace'

interface KnowledgeQATabProps {
  workspace: WorkspaceRecord
}

/**
 * 知识库问答 Tab — 复用 TaskChatPanel，自动全选所有笔记作为上下文。
 */
export function KnowledgeQATab({ workspace }: KnowledgeQATabProps) {
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
            知识库问答 · 基于全部笔记
          </div>
          <h2 className="display" style={{ fontSize: 28, margin: '4px 0 0' }}>
            知识库问答
          </h2>
        </div>
      </div>
      <TaskChatPanel workspace={workspace} autoSelectAll />
    </>
  )
}
