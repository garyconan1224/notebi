import DiffViewer from 'react-diff-viewer-continued'

import type { PromptVersion } from '@/services/workspaces'

interface VersionDiffViewProps {
  versions: PromptVersion[]
  diffLeft: PromptVersion
  diffRight: PromptVersion
  onLeftChange: (v: PromptVersion) => void
  onRightChange: (v: PromptVersion) => void
}

export function VersionDiffView({
  versions,
  diffLeft,
  diffRight,
  onLeftChange,
  onRightChange,
}: VersionDiffViewProps) {
  return (
    <div>
      <div
        style={{
          marginBottom: 8,
          borderRadius: 8,
          overflow: 'hidden',
          border: '1px solid var(--line)',
          fontSize: 11,
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 8,
            padding: '6px 10px',
            background: 'var(--bg-sunken)',
            borderBottom: '1px solid var(--line)',
            fontSize: 11,
          }}
        >
          <span style={{ color: 'var(--ink-3)' }}>
            对比 v{diffLeft.version} → v{diffRight.version}
          </span>
        </div>
        <DiffViewer
          oldValue={diffLeft.content}
          newValue={diffRight.content}
          splitView={false}
          useDarkTheme={false}
          styles={{
            variables: {
              dark: {
                diffViewerBackground: 'var(--bg)',
                addedBackground: 'rgba(76,175,80,0.12)',
                removedBackground: 'rgba(244,67,54,0.12)',
                wordAddedBackground: 'rgba(76,175,80,0.2)',
                wordRemovedBackground: 'rgba(244,67,54,0.2)',
                addedColor: 'var(--ink)',
                removedColor: 'var(--ink)',
              },
            },
            contentText: {
              fontSize: 11,
              lineHeight: 1.7,
              fontFamily: 'var(--mono)',
            },
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <select
          value={diffLeft.version}
          onChange={(e) => {
            const v = versions.find((pv) => pv.version === Number(e.target.value))
            if (v) onLeftChange(v)
          }}
          style={{
            flex: 1,
            height: 28,
            borderRadius: 6,
            fontSize: 11,
            border: '1px solid var(--line)',
            background: 'var(--bg-sunken)',
            color: 'var(--ink)',
            padding: '0 6px',
          }}
        >
          {versions.map((pv) => (
            <option key={pv.version} value={pv.version}>v{pv.version}</option>
          ))}
        </select>
        <span style={{ alignSelf: 'center', fontSize: 11, color: 'var(--ink-3)' }}>→</span>
        <select
          value={diffRight.version}
          onChange={(e) => {
            const v = versions.find((pv) => pv.version === Number(e.target.value))
            if (v) onRightChange(v)
          }}
          style={{
            flex: 1,
            height: 28,
            borderRadius: 6,
            fontSize: 11,
            border: '1px solid var(--line)',
            background: 'var(--bg-sunken)',
            color: 'var(--ink)',
            padding: '0 6px',
          }}
        >
          {versions.map((pv) => (
            <option key={pv.version} value={pv.version}>v{pv.version}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
