import { PromptVersionStack } from '@/components/result/PromptVersionStack'
import type { PromptVersion } from '@/services/workspaces'

interface VersionsTabProps {
  versions?: PromptVersion[]
  onAddVersion?: (content: string) => Promise<void>
}

/**
 * Versions tab — 提示词版本历史。
 * 复用现有 PromptVersionStack 组件。
 * 设计稿来源：taskboard.jsx TBHistory。
 */
export function VersionsTab({ versions = [], onAddVersion }: VersionsTabProps) {
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
            提示词迭代
          </div>
          <h2 className="display" style={{ fontSize: 28, margin: '4px 0 0' }}>
            版本历史 · Versions
          </h2>
        </div>
      </div>

      {onAddVersion ? (
        <PromptVersionStack versions={versions} onAddVersion={onAddVersion} />
      ) : (
        <div className="tb-placeholder" style={{ minHeight: 200 }}>
          暂无版本历史
        </div>
      )}
    </>
  )
}
