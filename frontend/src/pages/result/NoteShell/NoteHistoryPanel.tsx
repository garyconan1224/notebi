import { useEffect, useState } from 'react'
import { ExternalLink, RotateCcw, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import {
  adoptSiblingNote,
  getNoteVersion,
  listItemLineage,
  listNoteVersions,
  restoreNoteVersion,
  type LineageCopy,
  type NoteVersion,
} from '@/services/workspaces'
import type { ItemNote } from '@/types/workspace'

interface Props {
  open: boolean
  workspaceId: string
  itemId: string
  onClose: () => void
  onRestored: (note: ItemNote) => void
}

const SOURCE_LABEL: Record<NoteVersion['source'], string> = {
  BASELINE: '保存前基线',
  USER_EDIT: '手工编辑',
  RESTORE: '恢复历史',
  ADOPT_FROM_SIBLING: '采用同源版本',
}

export function NoteHistoryPanel(props: Props) {
  const [versions, setVersions] = useState<NoteVersion[]>([])
  const [copies, setCopies] = useState<LineageCopy[]>([])
  const [preview, setPreview] = useState<NoteVersion | null>(null)
  const [busy, setBusy] = useState('')

  useEffect(() => {
    if (!props.open) return
    Promise.all([
      listNoteVersions(props.workspaceId, props.itemId),
      listItemLineage(props.workspaceId, props.itemId),
    ]).then(([history, lineage]) => {
      setVersions(history)
      setCopies(lineage.copies)
    }).catch(error => toast.error(
      error instanceof Error ? error.message : '版本历史加载失败',
    ))
  }, [props.itemId, props.open, props.workspaceId])

  if (!props.open) return null

  const restore = async (version: NoteVersion) => {
    setBusy(version.version_id)
    try {
      props.onRestored(await restoreNoteVersion(
        props.workspaceId, props.itemId, version.version_id,
      ))
      setVersions(await listNoteVersions(props.workspaceId, props.itemId))
      toast.success('已恢复为新的正文版本')
    } finally {
      setBusy('')
    }
  }

  const adopt = async (copy: LineageCopy) => {
    setBusy(copy.content_id)
    try {
      props.onRestored(await adoptSiblingNote(
        props.workspaceId, props.itemId, copy.content_id,
      ))
      setVersions(await listNoteVersions(props.workspaceId, props.itemId))
      toast.success('已采用同源正文，其他副本未被修改')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="note-history-backdrop" onMouseDown={props.onClose}>
      <aside className="note-history-panel" onMouseDown={event => event.stopPropagation()}>
        <header>
          <div><strong>正文版本</strong><span>恢复会创建新版本，不覆盖历史</span></div>
          <button onClick={props.onClose} aria-label="关闭版本历史"><X size={16} /></button>
        </header>
        <section>
          <h3>当前副本历史</h3>
          {versions.length === 0 && <p className="note-history-empty">编辑并保存后会出现版本。</p>}
          {versions.map(version => (
            <article key={version.version_id}>
              <button className="note-history-preview" onClick={async () => {
                setPreview(await getNoteVersion(
                  props.workspaceId, props.itemId, version.version_id,
                ))
              }}>
                <strong>v{version.version_no} · {SOURCE_LABEL[version.source]}</strong>
                <span>{new Date(version.created_at).toLocaleString()}</span>
                <p>{version.preview || '（空正文）'}</p>
              </button>
              <button onClick={() => void restore(version)}
                disabled={busy === version.version_id}>
                <RotateCcw size={13} />恢复
              </button>
            </article>
          ))}
        </section>
        <section>
          <h3>其他合集版本</h3>
          {copies.length === 0 && <p className="note-history-empty">没有其他同源副本。</p>}
          {copies.map(copy => (
            <article key={copy.content_id}>
              <div><strong>{copy.name || '未命名内容'}</strong><span>{copy.workspace_name}</span></div>
              <Link to={copy.jump_url}><ExternalLink size={13} />打开</Link>
              <button onClick={() => void adopt(copy)} disabled={busy === copy.content_id}>
                采用
              </button>
            </article>
          ))}
        </section>
        {preview && (
          <section className="note-history-body">
            <h3>v{preview.version_no} 原文</h3>
            <pre>{preview.body_md}</pre>
          </section>
        )}
      </aside>
    </div>
  )
}
