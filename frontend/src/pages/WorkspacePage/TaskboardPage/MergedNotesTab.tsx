import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  createMergedNote,
  deleteMergedNote,
  listMergedNoteVersions,
  restoreMergedNoteVersion,
  updateMergedNote,
  type MergedNote,
  type MergedNoteVersion,
} from '@/services/workspaces'
import type { WorkspaceItem } from '@/types/workspace'

interface Props {
  workspaceId: string
  notes: MergedNote[]
  items: WorkspaceItem[]
  onRefresh: () => Promise<void>
}

export function MergedNotesTab({ workspaceId, notes, items, onRefresh }: Props) {
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('综合笔记')
  const [content, setContent] = useState('')
  const [editingId, setEditingId] = useState('')
  const [editContent, setEditContent] = useState('')
  const [versions, setVersions] = useState<Record<string, MergedNoteVersion[]>>({})

  const loadVersions = async (mergedId: string) => {
    const result = await listMergedNoteVersions(workspaceId, mergedId)
    setVersions((current) => ({ ...current, [mergedId]: result }))
  }

  return (
    <section className="space-y-4" aria-label="融合笔记">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          每次编辑和恢复都会生成新版本，旧版本不会被覆盖。
        </p>
        <button className="btn" type="button" onClick={() => setCreating((value) => !value)}>
          新建融合笔记
        </button>
      </div>
      {creating && (
        <div className="space-y-2 rounded-lg border p-4">
          <input aria-label="融合笔记标题" value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded border p-2" />
          <textarea aria-label="融合笔记内容" value={content} onChange={(event) => setContent(event.target.value)} className="min-h-40 w-full rounded border p-2" />
          <button
            className="btn"
            type="button"
            disabled={!content.trim()}
            onClick={async () => {
              await createMergedNote(workspaceId, {
                title,
                content_md: content,
                item_ids: items.map((item) => item.item_id),
              })
              setCreating(false)
              setContent('')
              await onRefresh()
            }}
          >
            保存为第一版
          </button>
        </div>
      )}
      {notes.length === 0 && <div className="rounded-lg border p-8 text-center">暂无融合笔记</div>}
      {notes.map((note) => (
        <article key={note.merged_id} className="space-y-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold">{note.title}</h3>
              <div className="text-xs text-muted-foreground">
                {note.versions.length} 个版本 · {note.item_ids.length} 个来源
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn" type="button" onClick={() => {
                setEditingId(note.merged_id)
                setEditContent(note.content_md)
              }}>编辑</button>
              <button className="btn" type="button" onClick={() => void loadVersions(note.merged_id)}>版本历史</button>
              <button
                className="btn"
                type="button"
                onClick={async () => {
                  if (!window.confirm('删除融合笔记？素材不会被删除。')) return
                  await deleteMergedNote(workspaceId, note.merged_id)
                  await onRefresh()
                }}
              >删除</button>
            </div>
          </div>
          {editingId === note.merged_id ? (
            <div className="space-y-2">
              <textarea aria-label={`编辑 ${note.title}`} value={editContent} onChange={(event) => setEditContent(event.target.value)} className="min-h-48 w-full rounded border p-2" />
              <button className="btn" type="button" onClick={async () => {
                await updateMergedNote(workspaceId, note.merged_id, { content_md: editContent })
                setEditingId('')
                await onRefresh()
              }}>保存新版本</button>
            </div>
          ) : <div className="whitespace-pre-wrap text-sm leading-7">{note.content_md}</div>}
          {(versions[note.merged_id] || []).length > 0 && (
            <div className="space-y-2 rounded border p-3" aria-label={`${note.title}版本历史`}>
              {versions[note.merged_id].map((version) => (
                <div key={version.version_id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2">
                  <span className="text-xs">{version.created_at} · {version.created_by}</span>
                  <button
                    className="btn"
                    type="button"
                    disabled={version.version_id === note.current_version_id}
                    onClick={async () => {
                      if (!window.confirm('恢复后会创建一个新版本，确认继续？')) return
                      await restoreMergedNoteVersion(workspaceId, note.merged_id, version.version_id)
                      await onRefresh()
                      await loadVersions(note.merged_id)
                    }}
                  >恢复此版本</button>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {(note.versions.find((version) => version.version_id === note.current_version_id)?.source_snapshot || []).map((source) => (
              <Link
                key={source.item_id}
                to={`/workspaces/${workspaceId}/items/${source.item_id}/note`}
                className="text-xs underline"
              >
                来源：{source.title}
              </Link>
            ))}
          </div>
        </article>
      ))}
    </section>
  )
}
