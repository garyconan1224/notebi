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

export type VersionDiffEntry = {
  kind: 'same' | 'removed' | 'added'
  text: string
}

function splitVersionBlocks(markdown: string): string[] {
  return markdown.trim().split(/\n{2,}/).map(block => block.trim()).filter(Boolean)
}

/**
 * 以 Markdown 段落为单位做 LCS 对比。正文很长时使用顺序回退，避免版本面板
 * 因二次方内存消耗而卡顿；两种路径的输出格式一致。
 */
export function buildVersionDiff(left: string, right: string): VersionDiffEntry[] {
  const before = splitVersionBlocks(left)
  const after = splitVersionBlocks(right)
  const maxMatrixCells = 160_000

  if (before.length * after.length > maxMatrixCells) {
    const changes: VersionDiffEntry[] = []
    let beforeIndex = 0
    let afterIndex = 0
    while (beforeIndex < before.length || afterIndex < after.length) {
      if (before[beforeIndex] === after[afterIndex]) {
        changes.push({ kind: 'same', text: before[beforeIndex] })
        beforeIndex += 1
        afterIndex += 1
      } else if (beforeIndex < before.length) {
        changes.push({ kind: 'removed', text: before[beforeIndex] })
        beforeIndex += 1
      } else {
        changes.push({ kind: 'added', text: after[afterIndex] })
        afterIndex += 1
      }
    }
    return changes
  }

  const matrix = Array.from(
    { length: before.length + 1 },
    () => new Uint16Array(after.length + 1),
  )
  for (let beforeIndex = before.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = after.length - 1; afterIndex >= 0; afterIndex -= 1) {
      matrix[beforeIndex][afterIndex] = before[beforeIndex] === after[afterIndex]
        ? matrix[beforeIndex + 1][afterIndex + 1] + 1
        : Math.max(matrix[beforeIndex + 1][afterIndex], matrix[beforeIndex][afterIndex + 1])
    }
  }

  const changes: VersionDiffEntry[] = []
  let beforeIndex = 0
  let afterIndex = 0
  while (beforeIndex < before.length && afterIndex < after.length) {
    if (before[beforeIndex] === after[afterIndex]) {
      changes.push({ kind: 'same', text: before[beforeIndex] })
      beforeIndex += 1
      afterIndex += 1
    } else if (matrix[beforeIndex + 1][afterIndex] >= matrix[beforeIndex][afterIndex + 1]) {
      changes.push({ kind: 'removed', text: before[beforeIndex] })
      beforeIndex += 1
    } else {
      changes.push({ kind: 'added', text: after[afterIndex] })
      afterIndex += 1
    }
  }
  while (beforeIndex < before.length) changes.push({ kind: 'removed', text: before[beforeIndex++] })
  while (afterIndex < after.length) changes.push({ kind: 'added', text: after[afterIndex++] })
  return changes
}

export function NoteHistoryPanel(props: Props) {
  const [versions, setVersions] = useState<NoteVersion[]>([])
  const [copies, setCopies] = useState<LineageCopy[]>([])
  const [preview, setPreview] = useState<NoteVersion | null>(null)
  const [comparison, setComparison] = useState<NoteVersion[]>([])
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
    if (!window.confirm('只更新当前合集中的副本，其他合集版本不会改变。确认采用？')) {
      return
    }
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

  const selectForComparison = async (version: NoteVersion) => {
    setBusy(`compare:${version.version_id}`)
    try {
      const detailed = version.body_md === undefined
        ? await getNoteVersion(props.workspaceId, props.itemId, version.version_id)
        : version
      setComparison(current => {
        if (current.some(candidate => candidate.version_id === detailed.version_id)) {
          return current.filter(candidate => candidate.version_id !== detailed.version_id)
        }
        return current.length < 2 ? [...current, detailed] : [current[1], detailed]
      })
    } finally {
      setBusy('')
    }
  }

  const comparisonDiff = comparison.length === 2
    ? buildVersionDiff(comparison[0].body_md ?? '', comparison[1].body_md ?? '')
    : []
  const unchangedCount = comparisonDiff.filter(change => change.kind === 'same').length
  const removedCount = comparisonDiff.filter(change => change.kind === 'removed').length
  const addedCount = comparisonDiff.filter(change => change.kind === 'added').length

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
              <button
                aria-pressed={comparison.some(candidate => candidate.version_id === version.version_id)}
                onClick={() => void selectForComparison(version)}
                disabled={busy === `compare:${version.version_id}`}
              >
                对比
              </button>
            </article>
          ))}
        </section>
        <section>
          <h3>其他合集版本</h3>
          {copies.length === 0 && <p className="note-history-empty">没有其他同源副本。</p>}
          {copies.map(copy => (
            <article key={copy.content_id}>
              <div>
                <strong>{copy.name || '未命名内容'}</strong>
                <span>{copy.workspace_name} · {new Date(copy.updated_at).toLocaleString()}</span>
                {copy.summary_preview && <p>{copy.summary_preview}</p>}
              </div>
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
        {comparison.length > 0 && (
          <section className="note-history-compare" aria-label="版本对比">
            <div className="note-history-compare-header">
              <div>
                <h3>{comparison.length === 1 ? `已选 v${comparison[0].version_no}` : `对比 v${comparison[0].version_no} 与 v${comparison[1].version_no}`}</h3>
                <p>{comparison.length === 1 ? '再选择一个版本开始对比。' : `共同 ${unchangedCount} 段 · 左侧删除 ${removedCount} 段 · 右侧新增 ${addedCount} 段`}</p>
              </div>
              <button type="button" onClick={() => setComparison([])}>清除</button>
            </div>
            {comparison.length === 2 && (
              <div className="note-history-compare-columns">
                <article>
                  <strong>v{comparison[0].version_no} · {SOURCE_LABEL[comparison[0].source]}</strong>
                  {comparisonDiff.filter(change => change.kind !== 'added').map((change, index) => (
                    <pre key={`left-${index}`} className={change.kind === 'removed' ? 'is-removed' : ''}>{change.text}</pre>
                  ))}
                </article>
                <article>
                  <strong>v{comparison[1].version_no} · {SOURCE_LABEL[comparison[1].source]}</strong>
                  {comparisonDiff.filter(change => change.kind !== 'removed').map((change, index) => (
                    <pre key={`right-${index}`} className={change.kind === 'added' ? 'is-added' : ''}>{change.text}</pre>
                  ))}
                </article>
              </div>
            )}
          </section>
        )}
      </aside>
    </div>
  )
}
