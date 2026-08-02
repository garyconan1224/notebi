import { useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { Check, Layers, Plus, Search } from 'lucide-react'
import type { WorkspaceRecord } from '@/types/workspace'
import { useDismissibleLayer } from '@/hooks/useDismissibleLayer'

export interface WorkspacePickerProps {
  workspaceIds: string[]
  availableWorkspaces?: WorkspaceRecord[]
  workspacePickerOpen: boolean
  onWorkspacePickerOpenChange: (open: boolean) => void
  workspaceQuery: string
  onWorkspaceQueryChange: (value: string) => void
  filteredWorkspaces: WorkspaceRecord[]
  renamingWorkspaceId: string | null
  workspaceNameDraft: string
  onWorkspaceNameDraftChange: (value: string) => void
  onRenameStart: (workspaceId: string, currentLabel: string) => void
  onRenameSave: () => void
  onRenameCancel: () => void
  creatingWorkspace: boolean
  getWorkspaceLabel: (workspaceId: string, fallback?: string) => string
  onSelectWorkspace: (workspaceId: string) => void
  onClearWorkspace: () => void
  onCreateWorkspace: () => void
  onWorkspaceIdsChange?: (workspaceIds: string[]) => void
  hasOnCreateWorkspace?: boolean
}

export function WorkspacePicker({
  workspaceIds,
  availableWorkspaces,
  workspacePickerOpen,
  onWorkspacePickerOpenChange,
  workspaceQuery,
  onWorkspaceQueryChange,
  filteredWorkspaces,
  renamingWorkspaceId,
  workspaceNameDraft,
  onWorkspaceNameDraftChange,
  onRenameStart,
  onRenameSave,
  onRenameCancel,
  creatingWorkspace,
  getWorkspaceLabel,
  onSelectWorkspace,
  onClearWorkspace,
  onCreateWorkspace,
  onWorkspaceIdsChange,
  hasOnCreateWorkspace,
}: WorkspacePickerProps) {
  const location = useLocation()
  const popoverRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // 临时浮层统一关闭规则（计划 §1.1）：外部点击 / Escape / 路由变化关闭并还焦点。
  useDismissibleLayer({
    containerRef: popoverRef,
    triggerRef,
    open: workspacePickerOpen,
    onClose: () => onWorkspacePickerOpenChange(false),
    routeKey: location.pathname,
  })

  return (
    <div className="m-section">
      <div className="eyebrow" style={{ marginBottom: 10 }}>② 合集归属</div>
      <div className="modal-workspace-picker">
        <div className="modal-workspace-row">
          {workspaceIds[0] ? (
            <div className="modal-workspace-current">
              <Layers size={15} />
              {renamingWorkspaceId === workspaceIds[0] ? (
                <input
                  autoFocus
                  className="modal-inline-name-input"
                  value={workspaceNameDraft}
                  onChange={(event) => onWorkspaceNameDraftChange(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onBlur={onRenameSave}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      onRenameSave()
                    }
                    if (event.key === 'Escape') {
                      onRenameCancel()
                    }
                  }}
                />
              ) : (
                <span
                  onDoubleClick={() => {
                    onRenameStart(workspaceIds[0], getWorkspaceLabel(workspaceIds[0], '当前合集'))
                  }}
                >
                  {getWorkspaceLabel(workspaceIds[0], '当前合集')}
                </span>
              )}
              <span className="kw">笔记</span>
            </div>
          ) : (
            <div className="modal-workspace-current modal-workspace-current--empty" aria-hidden="true" />
          )}
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {onWorkspaceIdsChange && (availableWorkspaces?.length ?? 0) > 0 && (
              <button
                ref={triggerRef}
                type="button"
                className="pp-add"
                onClick={() => onWorkspacePickerOpenChange(!workspacePickerOpen)}
              >
                <Layers size={11} />
                {workspaceIds.length ? '更换合集' : '选择合集'}
              </button>
            )}
            {(onWorkspaceIdsChange || !hasOnCreateWorkspace) && (
              <button
                type="button"
                className="pp-add"
                onClick={onCreateWorkspace}
                disabled={creatingWorkspace}
              >
                <Plus size={11} />
                {creatingWorkspace ? '创建中…' : '新建合集'}
              </button>
            )}
          </div>
        </div>

        {workspacePickerOpen && onWorkspaceIdsChange && (
          <div ref={popoverRef} className="pp-popover modal-workspace-popover">
            <div className="pp-search">
              <Search size={14} />
              <input
                autoFocus
                placeholder="搜索合集..."
                value={workspaceQuery}
                onChange={(e) => onWorkspaceQueryChange(e.target.value)}
              />
              {workspaceIds.length > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={onClearWorkspace}
                  style={{ height: 24, padding: '0 8px', fontSize: 11 }}
                >
                  清空
                </button>
              )}
            </div>
            <div className="pp-list">
              {filteredWorkspaces.length === 0 && (
                <div className="modal-workspace-empty">无匹配合集</div>
              )}
              {filteredWorkspaces.map((ws) => {
                const on = workspaceIds[0] === ws.workspace_id
                return (
                  <button
                    key={ws.workspace_id}
                    type="button"
                    className="pp-row"
                    data-on={on}
                    onClick={() => onSelectWorkspace(ws.workspace_id)}
                  >
                    <span className="pp-check">
                      <Check size={11} strokeWidth={3} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div className="pp-name">{getWorkspaceLabel(ws.workspace_id, ws.name)}</div>
                    </div>
                    <span className="pp-count">{ws.items.length} 项</span>
                  </button>
                )
              })}
            </div>
            <div className="pp-foot">
              <button
                type="button"
                className="pp-new"
                onClick={onCreateWorkspace}
                disabled={!hasOnCreateWorkspace || creatingWorkspace}
              >
                <Plus size={11} />
                {creatingWorkspace ? '创建中…' : `新建合集${workspaceQuery ? ` "${workspaceQuery}"` : ''}`}
              </button>
              <button type="button" className="pp-done" onClick={() => onWorkspacePickerOpenChange(false)}>
                完成
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
