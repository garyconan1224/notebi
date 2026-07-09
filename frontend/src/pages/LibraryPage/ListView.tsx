import type { LibraryItem } from '@/services/library'
import {
  TYPE_ICON,
  STATE_COLOR,
  STATE_LABEL,
  primaryStatusToState,
  formatDuration,
  formatDate,
} from './libraryHelpers'

interface ListViewProps {
  items: LibraryItem[]
  selectMode?: boolean
  selectedSet: Set<string>
  selectionKey: (wsId: string, itemId: string) => string
  onToggle: (itemId: string, wsId: string) => void
  onOpen: (item: LibraryItem) => void
  onDelete: (item: LibraryItem) => void
}

export function ListView({ items, selectMode, selectedSet, selectionKey, onToggle, onOpen, onDelete }: ListViewProps) {
  return (
    <div className="lv-wrapper">
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {selectMode && <th className="lv-th" style={{ width: 36 }}></th>}
            <th className="lv-th">名称</th>
            <th className="lv-th" style={{ width: 80 }}>类型</th>
            <th className="lv-th" style={{ width: 110 }}>状态</th>
            <th className="lv-th" style={{ width: 80 }}>时长</th>
            <th className="lv-th" style={{ width: 160 }}>合集</th>
            <th className="lv-th" style={{ width: 100 }}>创建时间</th>
            <th className="lv-th" style={{ width: 40 }}></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const Icon = TYPE_ICON[item.type] || TYPE_ICON.text
            const state = primaryStatusToState(item.primary_task_status)
            const stateColor = STATE_COLOR[state] || STATE_COLOR.queued
            const stateLabel = STATE_LABEL[state] || 'queued'
            const isSel = selectedSet.has(selectionKey(item.workspace_id, item.item_id))

            return (
              <tr
                key={`${item.workspace_id}:${item.item_id}`}
                className="lv-row"
                onClick={() => (selectMode ? onToggle(item.item_id, item.workspace_id) : onOpen(item))}
              >
                {selectMode && (
                  <td className="lv-td" onClick={(e) => e.stopPropagation()}>
                    <span
                      className={`lv-select-dot${isSel ? ' lv-select-dot--selected' : ''}`}
                      onClick={() => onToggle(item.item_id, item.workspace_id)}
                    >
                      {isSel && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      )}
                    </span>
                  </td>
                )}
                <td className="lv-td">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Icon size={16} strokeWidth={1.4} style={{ color: 'var(--mut)', flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.name || '未命名'}
                    </span>
                  </div>
                </td>
                <td className="lv-td-mono">{item.type}</td>
                <td className="lv-td">
                  <span className="lv-status-cell">
                    <span className="ex-state-dot" style={{ background: stateColor }} />
                    {stateLabel}
                  </span>
                </td>
                <td className="lv-td-mono">{formatDuration(item.duration_seconds)}</td>
                <td className="lv-td" style={{ fontSize: 12, color: 'var(--fg2)' }}>
                  {item.workspace_name}
                </td>
                <td className="lv-td-mono">{formatDate(item.created_at)}</td>
                <td className="lv-td" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="lv-delete-btn"
                    onClick={() => onDelete(item)}
                    title="删除"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
                    </svg>
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
