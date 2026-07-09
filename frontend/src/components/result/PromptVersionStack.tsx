import { useCallback, useState } from 'react'
import { ChevronDown, GitCompare, Plus } from 'lucide-react'

import type { PromptVersion } from '@/services/workspaces'

import { AddVersionForm, EmptyVersionState } from './AddVersionForm'
import { VersionDiffView } from './VersionDiffView'

interface PromptVersionStackProps {
  versions: PromptVersion[]
  onAddVersion: (content: string) => Promise<void>
  selectedIdx?: number | null
  onSelectVersion?: (idx: number | null) => void
}

export function PromptVersionStack({ versions, onAddVersion, selectedIdx, onSelectVersion }: PromptVersionStackProps) {
  const [adding, setAdding] = useState(false)
  const [diffMode, setDiffMode] = useState(false)
  const [diffLeft, setDiffLeft] = useState<PromptVersion | null>(null)
  const [diffRight, setDiffRight] = useState<PromptVersion | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const toggleDiff = useCallback(() => {
    setDiffMode((prev) => {
      if (!prev && versions.length >= 2) {
        setDiffLeft(versions[versions.length - 2])
        setDiffRight(versions[versions.length - 1])
      }
      return !prev
    })
  }, [versions])

  const handleAddSubmit = useCallback(async (content: string) => {
    await onAddVersion(content)
    setAdding(false)
  }, [onAddVersion])

  if (versions.length === 0 && !adding) {
    return <EmptyVersionState onAdd={() => setAdding(true)} />
  }

  return (
    <div>
      {/* 标题行：diff 按钮 + 新增按钮 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
        <span className="eyebrow" style={{ flex: 1 }}>提示词版本</span>
        {versions.length >= 2 && (
          <button
            onClick={toggleDiff}
            title={diffMode ? '关闭 diff' : '对比版本'}
            style={{
              height: 22,
              padding: '0 6px',
              borderRadius: 4,
              fontSize: 10,
              border: diffMode ? '1px solid var(--accent-pink)' : '1px solid var(--line)',
              background: diffMode ? 'rgba(255,77,126,0.08)' : 'transparent',
              color: diffMode ? 'var(--accent-pink)' : 'var(--ink-3)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
            }}
          >
            <GitCompare size={10} /> diff
          </button>
        )}
        <button
          onClick={() => setAdding(true)}
          title="新增版本"
          style={{
            height: 22,
            padding: '0 6px',
            borderRadius: 4,
            fontSize: 10,
            border: '1px solid var(--line)',
            background: 'transparent',
            color: 'var(--ink-3)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
          }}
        >
          <Plus size={10} />
        </button>
      </div>

      {/* 版本下拉 */}
      <VersionDropdown
        versions={versions}
        open={dropdownOpen}
        onToggle={() => setDropdownOpen((v) => !v)}
        selectedIdx={selectedIdx ?? undefined}
        onSelect={(pv) => {
          setDropdownOpen(false)
          if (diffMode) {
            if (!diffLeft || diffLeft.version === pv.version) setDiffLeft(pv)
            else setDiffRight(pv)
          } else if (onSelectVersion) {
            const idx = versions.findIndex((v) => v.version === pv.version)
            onSelectVersion(idx >= 0 ? idx : null)
          }
        }}
      />

      {/* 版本内容预览（选中版本或最新版本） */}
      {!diffMode && versions.length > 0 && (
        <div
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 11.5,
            lineHeight: 1.72,
            background: 'var(--bg-sunken)',
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid var(--line)',
            color: 'var(--ink)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            marginBottom: 8,
          }}
        >
          {versions[selectedIdx ?? versions.length - 1].content}
        </div>
      )}

      {/* Diff 视图 */}
      {diffMode && diffLeft && diffRight && (
        <VersionDiffView
          versions={versions}
          diffLeft={diffLeft}
          diffRight={diffRight}
          onLeftChange={setDiffLeft}
          onRightChange={setDiffRight}
        />
      )}

      {/* 新增版本表单 */}
      {adding ? (
        <AddVersionForm onSubmit={handleAddSubmit} onCancel={() => setAdding(false)} />
      ) : (
        versions.length > 0 && (
          <button
            onClick={() => setAdding(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              height: 28,
              padding: '0 10px',
              borderRadius: 6,
              fontSize: 11,
              border: '1px solid var(--line)',
              background: 'transparent',
              color: 'var(--ink-2)',
              cursor: 'pointer',
            }}
          >
            <Plus size={12} /> 新增版本
          </button>
        )
      )}
    </div>
  )
}

/** 版本下拉选择器（内联子组件） */
function VersionDropdown({
  versions,
  open,
  onToggle,
  selectedIdx,
  onSelect,
}: {
  versions: PromptVersion[]
  open: boolean
  onToggle: () => void
  selectedIdx?: number
  onSelect: (pv: PromptVersion) => void
}) {
  if (versions.length === 0) return null
  const selected = versions[selectedIdx ?? versions.length - 1]
  return (
    <div style={{ position: 'relative', marginBottom: 8 }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          height: 30,
          padding: '0 10px',
          borderRadius: 6,
          fontSize: 12,
          border: '1px solid var(--line)',
          background: 'var(--bg-sunken)',
          color: 'var(--ink)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span>v{selected.version}{(selectedIdx ?? versions.length - 1) === versions.length - 1 ? '（最新）' : ''}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 20,
            marginTop: 2,
            border: '1px solid var(--line)',
            borderRadius: 6,
            background: 'var(--bg-elev)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            overflow: 'hidden',
          }}
        >
          {[...versions].reverse().map((pv) => (
            <button
              key={pv.version}
              onClick={() => onSelect(pv)}
              style={{
                width: '100%',
                padding: '6px 10px',
                fontSize: 12,
                border: 'none',
                background: 'transparent',
                color: 'var(--ink-2)',
                cursor: 'pointer',
                textAlign: 'left',
                borderBottom: '1px solid var(--line)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-sunken)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)', marginRight: 6 }}>
                v{pv.version}
              </span>
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                {pv.content.slice(0, 60)}{pv.content.length > 60 ? '…' : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
