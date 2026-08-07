import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, FilePlus2, Sparkles, Trash2, X } from 'lucide-react'

import {
  createNoteArtifact,
  deleteNoteArtifact,
  listNoteArtifacts,
  updateNoteArtifact,
  type NoteArtifact,
  type NoteArtifactKind,
} from '@/services/noteArtifacts'
import { toast } from 'sonner'
import { useLnEditorStore } from '@/store/lnEditorStore'
import { useTaskStore } from '@/store/taskStore'
import type { TaskRecord } from '@/types/task'
import { uploadLnScreenshot } from '@/services/lnScreenshots'
import {
  ActionItemsView,
  FlashcardsView,
  GlossaryView,
  KeyCardsView,
  TimelineView,
  actionItemsToMarkdown,
  type ActionItem,
  type ArtifactContentJson,
} from './ArtifactRenderers'
import {
  MindMapView,
  mindMapToMarkdown,
  type MindMapData,
  type MindMapExportHandle,
  type MindMapExportRef,
} from './MindMapView'

import './ai-artifact-panel.css'

const TOOL_LABELS: Record<NoteArtifactKind, string> = {
  mind_map: '思维导图',
  action_items: '行动项',
  key_cards: '要点卡',
  flashcards: '闪卡与测验',
  glossary: '术语表',
  timeline: '时间线',
  selection_rewrite: '选区改写',
}

interface AiArtifactPanelProps {
  open: boolean
  initialKind: NoteArtifactKind
  workspaceId: string
  itemId: string
  onClose: () => void
}

function downloadArtifact(artifact: NoteArtifact) {
  const blob = new Blob([artifact.content_md], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${artifact.title}.md`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/** Q4 / D7：按 kind 用语义组件渲染 content_json；无结构化内容回退 Markdown 并标注旧版。 */
interface ArtifactContentViewProps {
  artifact: NoteArtifact
  workspaceId?: string
  itemId?: string
  onMindMapUpdated?: (artifact: NoteArtifact, contentJson: MindMapData) => void
  onActionItemsUpdated?: (artifact: NoteArtifact, items: ActionItem[]) => void
  mindMapExportRef?: MindMapExportRef
}

export function ArtifactContentView({
  artifact,
  workspaceId,
  itemId,
  onMindMapUpdated,
  onActionItemsUpdated,
  mindMapExportRef,
}: ArtifactContentViewProps) {
  const contentJson = (artifact.content_json ?? null) as ArtifactContentJson

  if (artifact.kind === 'mind_map' && contentJson && (contentJson as MindMapData).root) {
    return (
      <MindMapView
        key={artifact.artifact_id}
        data={contentJson as MindMapData}
        title={artifact.title}
        workspaceId={workspaceId}
        itemId={itemId}
        artifactId={artifact.artifact_id}
        onUpdated={(next) => onMindMapUpdated?.(artifact, next)}
        exportRef={mindMapExportRef}
      />
    )
  }
  if (artifact.kind === 'action_items' && contentJson && Array.isArray((contentJson as { items?: unknown }).items)) {
    const items = (contentJson as { items: ActionItem[] }).items
    return (
      <ActionItemsView
        items={items}
        onToggle={(itemId, done) =>
          onActionItemsUpdated?.(
            artifact,
            items.map((item) => (item.id === itemId ? { ...item, done } : item)),
          )
        }
      />
    )
  }
  if (artifact.kind === 'key_cards' && contentJson && Array.isArray((contentJson as { cards?: unknown }).cards)) {
    const cards = (contentJson as { cards: Array<{ id?: string; title?: string; body?: string }> }).cards
    return <KeyCardsView cards={cards.map((c, i) => ({ id: c.id ?? `c${i}`, title: c.title ?? '', body: c.body ?? '' }))} />
  }
  if (artifact.kind === 'flashcards' && contentJson && Array.isArray((contentJson as { cards?: unknown }).cards)) {
    const cards = (contentJson as { cards: Array<{ id?: string; question?: string; answer?: string }> }).cards
    return <FlashcardsView cards={cards.map((c, i) => ({ id: c.id ?? `f${i}`, question: c.question ?? '', answer: c.answer ?? '' }))} />
  }
  if (artifact.kind === 'glossary' && contentJson && Array.isArray((contentJson as { rows?: unknown }).rows)) {
    return <GlossaryView rows={(contentJson as { rows: Array<{ term: string; definition: string; context: string }> }).rows} />
  }
  if (artifact.kind === 'timeline' && contentJson && Array.isArray((contentJson as { rows?: unknown }).rows)) {
    return <TimelineView rows={(contentJson as { rows: Array<{ time: string; event: string; who: string; impact: string }> }).rows} />
  }

  // 旧版产物 / 解析失败：回退 Markdown 并标注
  return (
    <div className="note-artifact-legacy">
      <span className="note-artifact-legacy-badge">旧版产物</span>
      <pre className="note-artifact-content">{artifact.content_md}</pre>
    </div>
  )
}

export function AiArtifactPanel({
  open,
  initialKind,
  workspaceId,
  itemId,
  onClose,
}: AiArtifactPanelProps) {
  const { t } = useTranslation('note')
  const [kind, setKind] = useState<NoteArtifactKind>(initialKind)
  const [artifacts, setArtifacts] = useState<NoteArtifact[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const mindMapExportRef = useRef<MindMapExportHandle | null>(null)
  const tasks = useTaskStore((state) => state.tasks)
  const addTask = useTaskStore((state) => state.addTask)

  useEffect(() => {
    if (!open) return
    setKind(initialKind)
    let cancelled = false
    listNoteArtifacts(workspaceId, itemId)
      .then((items) => {
        if (cancelled) return
        setArtifacts(items)
        const preferred = [...items].reverse().find((item) => item.kind === initialKind)
        setSelectedId(preferred?.artifact_id ?? null)
      })
      .catch(() => {
        if (!cancelled) setError('读取 AI 产物失败，请重试')
      })
    return () => { cancelled = true }
  }, [initialKind, itemId, open, workspaceId])

  const task = tasks.find((item) => item.task_id === taskId)
  useEffect(() => {
    if (!taskId || !task) return
    if (task.status === 'SUCCESS') {
      const raw = (task.result as Record<string, unknown>)?.artifact
      if (raw && typeof raw === 'object') {
        const artifact = raw as NoteArtifact
        setArtifacts((current) => [
          ...current.filter((item) => item.artifact_id !== artifact.artifact_id),
          artifact,
        ])
        setSelectedId(artifact.artifact_id)
      }
      setTaskId(null)
      return
    }
    if (['FAILED', 'PARTIAL', 'CANCELLED'].includes(task.status)) {
      setError(task.error || '生成失败，请重试')
      setTaskId(null)
    }
  }, [task, taskId])

  const selected = useMemo(
    () => artifacts.find((artifact) => artifact.artifact_id === selectedId) ?? null,
    [artifacts, selectedId],
  )

  if (!open) return null

  const handleGenerate = async () => {
    const selectedText = kind === 'selection_rewrite'
      ? useLnEditorStore.getState().getSelectedText().trim()
      : ''
    if (kind === 'selection_rewrite' && !selectedText) {
      setError('请先在正文中选择需要改写的文字')
      return
    }
    setError('')
    try {
      const accepted = await createNoteArtifact(workspaceId, itemId, {
        kind,
        selected_text: selectedText,
      })
      setTaskId(accepted.task_id)
      if (!useTaskStore.getState().getTask(accepted.task_id)) {
        const now = new Date().toISOString()
        addTask({
          task_id: accepted.task_id,
          project_id: workspaceId,
          task_type: 'note_artifact',
          payload: { item_id: itemId, kind, title: TOOL_LABELS[kind] },
          status: 'PENDING',
          progress: 0,
          log: [],
          result: {},
          error: '',
          retry_of: '',
          cancel_requested: false,
          created_at: now,
          updated_at: now,
        } satisfies TaskRecord)
      }
    } catch {
      setError('创建 AI 产物失败，请检查模型设置')
    }
  }

  const handleMindMapUpdated = (artifact: NoteArtifact, contentJson: MindMapData) => {
    void updateNoteArtifact(workspaceId, itemId, artifact.artifact_id, contentJson)
      .then(() => {
        setArtifacts((current) =>
          current.map((item) =>
            item.artifact_id === artifact.artifact_id
              ? { ...item, content_json: contentJson as NoteArtifact['content_json'] }
              : item,
          ),
        )
        toast.success(t('mindmap.saved'))
      })
      .catch(() => toast.error(t('mindmap.saveFailed')))
  }

  /** 行动项勾选：就地更新 content_json.items 并 PATCH 持久化（与导图编辑同一通道）。 */
  const handleActionItemsUpdated = (
    artifact: NoteArtifact,
    items: ActionItem[],
  ) => {
    void updateNoteArtifact(workspaceId, itemId, artifact.artifact_id, { items })
      .then(() => {
        setArtifacts((current) =>
          current.map((item) =>
            item.artifact_id === artifact.artifact_id
              ? { ...item, content_json: { items } as NoteArtifact['content_json'] }
              : item,
          ),
        )
      })
      .catch(() => toast.error(t('mindmap.saveFailed')))
  }

  /** 插入为图片：snapdom 截图 → 复用 ln-screenshots 上传通道 → 编辑器 image 节点（保持导图视觉格式）。 */
  const insertMindMapAsImage = async (target: NoteArtifact) => {
    const handle = mindMapExportRef.current
    if (!handle) return
    try {
      const blob = await handle.getPngBlob()
      const { url } = await uploadLnScreenshot(workspaceId, blob, Date.now())
      useLnEditorStore.getState().insertAtCursor(`\n\n![${target.title}](${url})\n\n`)
      // 插入成功后关闭面板，让用户直接看到编辑器里的插入结果
      onClose()
    } catch {
      toast.error(t('mindmap.insertImageFailed'))
    }
  }

  /** 插入为大纲：优先取当前编辑中的导图数据，回退产物 content_json，转 Markdown 后以真正的标题+列表节点插入。 */
  const insertMindMapAsOutline = (target: NoteArtifact) => {
    const handle = mindMapExportRef.current
    const data = handle?.getData() ?? (target.content_json as MindMapData | null)
    if (!data?.root) return
    useLnEditorStore.getState().insertMarkdownAtCursor(mindMapToMarkdown(data))
    // 插入成功后关闭面板，让用户直接看到编辑器里的插入结果
    onClose()
  }

  const handleDelete = async (artifact: NoteArtifact) => {
    await deleteNoteArtifact(workspaceId, itemId, artifact.artifact_id)
    setArtifacts((current) => current.filter((item) => item.artifact_id !== artifact.artifact_id))
    setSelectedId(null)
  }

  const busy = Boolean(taskId)
  return (
    <div className="note-artifact-backdrop" role="presentation">
      <section className="note-artifact-panel" role="dialog" aria-label="AI 笔记工具">
        <header>
          <div>
            <strong><Sparkles size={16} /> AI 笔记工具</strong>
            <span>产物独立保存，不占用总结版本</span>
          </div>
          <button type="button" aria-label="关闭 AI 笔记工具" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="note-artifact-layout">
          <aside>
            <label htmlFor="artifact-kind">工具</label>
            <select id="artifact-kind" value={kind} onChange={(event) => setKind(event.target.value as NoteArtifactKind)}>
              {Object.entries(TOOL_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <button type="button" className="note-artifact-generate" disabled={busy} onClick={handleGenerate}>
              <Sparkles size={14} />
              {busy ? '生成中…' : `生成${TOOL_LABELS[kind]}`}
            </button>
            <div className="note-artifact-list-label">已保存</div>
            <div className="note-artifact-list">
              {artifacts.length === 0 && <span>尚无产物</span>}
              {[...artifacts].reverse().map((artifact) => (
                <button
                  type="button"
                  key={artifact.artifact_id}
                  className={artifact.artifact_id === selectedId ? 'is-active' : ''}
                  onClick={() => setSelectedId(artifact.artifact_id)}
                >
                  <strong>{artifact.title}</strong>
                  <small>{new Date(artifact.created_at).toLocaleString()}</small>
                </button>
              ))}
            </div>
          </aside>
          <main>
            {error && <div className="note-artifact-error" role="alert">{error}</div>}
            {busy && (
              <div className="note-artifact-progress" role="status">
                <strong>{Math.round((task?.progress || 0) * 100)}%</strong>
                <span>{task?.log?.at(-1)?.message || `正在生成${TOOL_LABELS[kind]}`}</span>
              </div>
            )}
            {!selected && !busy && <div className="note-artifact-empty">选择已有产物，或生成新的结构化笔记素材。</div>}
            {selected && (
              <>
                {selected.kind === 'selection_rewrite' ? (
                  <div className="note-artifact-diff">
                    <article>
                      <h3>原文</h3>
                      <p>{selected.original_text}</p>
                    </article>
                    <article>
                      <h3>改写后</h3>
                      <p>{selected.content_md}</p>
                    </article>
                    <div className="note-artifact-diff-actions">
                      <button
                        type="button"
                        onClick={() => {
                          useLnEditorStore.getState().replaceSelection(selected.content_md)
                          setSelectedId(null)
                        }}
                      >
                        接受改写
                      </button>
                      <button type="button" onClick={() => setSelectedId(null)}>拒绝改写</button>
                    </div>
                  </div>
                ) : (
                  <ArtifactContentView
                    artifact={selected}
                    workspaceId={workspaceId}
                    itemId={itemId}
                    onMindMapUpdated={handleMindMapUpdated}
                    onActionItemsUpdated={handleActionItemsUpdated}
                    mindMapExportRef={mindMapExportRef}
                  />
                )}
                <footer>
                  {selected.kind === 'mind_map' && selected.content_json && (selected.content_json as MindMapData).root ? (
                    <>
                      <button type="button" onClick={() => void insertMindMapAsImage(selected)}>
                        <FilePlus2 size={14} /> {t('mindmap.insertAsImage')}
                      </button>
                      <button type="button" onClick={() => insertMindMapAsOutline(selected)}>
                        <FilePlus2 size={14} /> {t('mindmap.insertAsOutline')}
                      </button>
                    </>
                  ) : selected.kind !== 'selection_rewrite' ? (
                    <button
                      type="button"
                      onClick={() => {
                        // 行动项：用实时 content_json 重新生成待办清单（勾选状态生效）；
                        // 旧版无结构化内容的产物回退 content_md。
                        const structured = (selected.content_json as ArtifactContentJson | null)
                        const actionItems = structured && Array.isArray((structured as { items?: unknown }).items)
                          ? (structured as { items: ActionItem[] }).items
                          : null
                        const insertMarkdown = selected.kind === 'action_items' && actionItems && actionItems.length > 0
                          ? actionItemsToMarkdown(actionItems)
                          : selected.content_md
                        useLnEditorStore.getState().insertMarkdownAtCursor(`\n\n${insertMarkdown}\n\n`)
                        // 插入成功后关闭面板，让用户直接看到编辑器里的插入结果
                        onClose()
                      }}
                    >
                      <FilePlus2 size={14} /> 插入笔记
                    </button>
                  ) : null}
                  <button type="button" onClick={() => downloadArtifact(selected)}>
                    <Download size={14} /> 导出 Markdown
                  </button>
                  <button type="button" onClick={() => void handleDelete(selected)}>
                    <Trash2 size={14} /> 删除产物
                  </button>
                </footer>
              </>
            )}
          </main>
        </div>
      </section>
    </div>
  )
}
