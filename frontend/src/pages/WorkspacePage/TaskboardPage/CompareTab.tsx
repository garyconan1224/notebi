import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, Image, FileText } from 'lucide-react'

import { getImageCompare, getTextCompare } from '@/services/workspaces'
import type {
  ImageCompareResult,
  TextCompareResult,
} from '@/services/workspaces'
import type { WorkspaceRecord, WorkspaceItem, ItemType } from '@/types/workspace'
import { ITEM_TYPE_TEXT } from '@/types/workspace'

interface CompareTabProps {
  workspace: WorkspaceRecord
  onSelectItem?: (itemId: string) => void
  /** 前端多选传入的素材 ID 集合；有值时只对比选中素材 */
  selectedIds?: Set<string>
}

/** 同步派生的"不需要请求"的状态 */
type SyncState =
  | { kind: 'need-fetch' }
  | { kind: 'empty'; message: string }
  | { kind: 'unsupported'; itemType: ItemType }

/** 异步 fetch 结果 */
type AsyncState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'image'; data: ImageCompareResult }
  | { phase: 'text'; data: TextCompareResult }
  | { phase: 'error'; message: string }

/** 选第一个有结果的同类素材作为锚点 */
function pickAnchor(items: WorkspaceItem[], type: ItemType): WorkspaceItem | null {
  const same = items.filter((i) => i.type === type)
  if (same.length === 0) return null
  return same.find((i) => i.results && Object.keys(i.results).length > 0) ?? same[0]
}

/** 同步计算：是否需要 fetch、还是直接展示空态/不支持 */
function deriveSyncState(items: WorkspaceItem[]): SyncState {
  const anchor = pickAnchor(items, 'image') ?? pickAnchor(items, 'text')
  if (!anchor) return { kind: 'empty', message: '暂无素材可对比，请先添加素材' }
  if (anchor.type !== 'image' && anchor.type !== 'text') {
    return { kind: 'unsupported', itemType: anchor.type }
  }
  const count = items.filter((i) => i.type === anchor.type).length
  if (count < 2) {
    return {
      kind: 'empty',
      message: `至少需要 2 个${ITEM_TYPE_TEXT[anchor.type]}素材才能对比，当前仅 ${count} 个`,
    }
  }
  return { kind: 'need-fetch' }
}

export function CompareTab({ workspace, onSelectItem, selectedIds }: CompareTabProps) {
  // 当有 selectedIds 时只用选中的素材
  const filteredItems = useMemo(
    () =>
      selectedIds && selectedIds.size > 0
        ? workspace.items.filter((it) => selectedIds.has(it.item_id))
        : workspace.items,
    [workspace.items, selectedIds],
  )

  const sync = useMemo(() => deriveSyncState(filteredItems), [filteredItems])
  const [async, setAsync] = useState<AsyncState>({ phase: 'idle' })
  const abortRef = useRef<AbortController | null>(null)

  // 只有 need-fetch 时才发请求
  const anchor = useMemo(() => {
    if (sync.kind !== 'need-fetch') return null
    return pickAnchor(filteredItems, 'image') ?? pickAnchor(filteredItems, 'text')
  }, [sync.kind, filteredItems])

  const selectedIdList = useMemo(
    () => (selectedIds && selectedIds.size > 0 ? [...selectedIds] : undefined),
    [selectedIds],
  )

  useEffect(() => {
    if (!anchor) return

    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    setAsync({ phase: 'loading' }) // eslint-disable-line react-hooks/set-state-in-effect

    const promise =
      anchor.type === 'image'
        ? getImageCompare(workspace.workspace_id, anchor.item_id, selectedIdList).then(
            (d): AsyncState => ({ phase: 'image', data: d }),
          )
        : getTextCompare(workspace.workspace_id, anchor.item_id, selectedIdList).then(
            (d): AsyncState => ({ phase: 'text', data: d }),
          )

    promise
      .then((s) => {
        if (!ac.signal.aborted) setAsync(s)
      })
      .catch((err: unknown) => {
        if (!ac.signal.aborted) {
          setAsync({
            phase: 'error',
            message: err instanceof Error ? err.message : '加载对比数据失败',
          })
        }
      })

    return () => ac.abort()
  }, [anchor, workspace.workspace_id, selectedIdList])

  return (
    <div className="cmp-tab">
      <div className="tb-head-mini">
        <div>
          <div className="eyebrow">素材对比 · Compare</div>
          <h2 className="display" style={{ fontSize: 28, margin: '4px 0 0' }}>
            同类素材对比分析
          </h2>
        </div>
      </div>

      {sync.kind === 'empty' && (
        <div className="tb-placeholder" style={{ minHeight: 200 }}>
          <ArrowLeftRight size={24} style={{ marginBottom: 8, opacity: 0.4 }} />
          <span>{sync.message}</span>
        </div>
      )}

      {sync.kind === 'unsupported' && (
        <div className="tb-placeholder" style={{ minHeight: 200 }}>
          {ITEM_TYPE_TEXT[sync.itemType]}类型暂不支持对比
        </div>
      )}

      {sync.kind === 'need-fetch' && async.phase === 'loading' && (
        <div className="tb-placeholder" style={{ minHeight: 200 }}>
          加载对比数据…
        </div>
      )}

      {sync.kind === 'need-fetch' && async.phase === 'error' && (
        <div className="tb-placeholder" style={{ minHeight: 200, color: 'var(--accent-pink)' }}>
          {async.message}
        </div>
      )}

      {sync.kind === 'need-fetch' && async.phase === 'image' && (
        <ImageCompareView data={async.data} onSelectItem={onSelectItem} />
      )}

      {sync.kind === 'need-fetch' && async.phase === 'text' && (
        <TextCompareView data={async.data} onSelectItem={onSelectItem} />
      )}
    </div>
  )
}

/* ── 图片对比 ───────────────────────────────────────── */

function ImageCompareView({
  data,
  onSelectItem,
}: {
  data: ImageCompareResult
  onSelectItem?: (id: string) => void
}) {
  return (
    <>
      {data.vlm_summary && (
        <div
          style={{
            padding: '14px 18px',
            background: 'var(--bg-sunken)',
            borderRadius: 'var(--radius)',
            marginBottom: 16,
            fontSize: 13,
            lineHeight: 1.7,
            color: 'var(--ink-2)',
          }}
        >
          <span className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>
            AI 对比总结
          </span>
          {data.vlm_summary}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table className="cmp-tbl">
          <thead>
            <tr>
              <th style={{ width: 40 }}></th>
              <th>素材</th>
              <th>描述</th>
              <th>OCR 文字</th>
              <th>标签</th>
            </tr>
          </thead>
          <tbody>
            {data.images.map((img) => (
              <tr
                key={img.item_id}
                data-current={img.is_current}
                style={img.is_current ? { background: 'var(--bg-sunken)' } : undefined}
                onClick={() => onSelectItem?.(img.item_id)}
              >
                <td style={{ textAlign: 'center' }}>
                  <Image size={14} style={{ color: 'var(--accent-3)' }} />
                </td>
                <td>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{img.name}</div>
                  {img.is_current && (
                    <span style={{ fontSize: 10, color: 'var(--accent-pink)', fontWeight: 600 }}>
                      当前
                    </span>
                  )}
                </td>
                <td style={{ fontSize: 12, maxWidth: 280 }}>
                  {img.description || <span style={{ color: 'var(--ink-4)' }}>—</span>}
                </td>
                <td style={{ fontSize: 12, maxWidth: 200 }}>
                  {img.ocr_text || <span style={{ color: 'var(--ink-4)' }}>—</span>}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {Object.values(img.tags)
                      .flat()
                      .slice(0, 5)
                      .map((t, i) => (
                        <span
                          key={i}
                          style={{
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: 'var(--bg-sunken)',
                            fontSize: 10,
                            color: 'var(--ink-3)',
                          }}
                        >
                          {t}
                        </span>
                      ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/* ── 文字对比 ───────────────────────────────────────── */

function TextCompareView({
  data,
  onSelectItem,
}: {
  data: TextCompareResult
  onSelectItem?: (id: string) => void
}) {
  return (
    <>
      {data.llm_summary && (
        <div
          style={{
            padding: '14px 18px',
            background: 'var(--bg-sunken)',
            borderRadius: 'var(--radius)',
            marginBottom: 16,
            fontSize: 13,
            lineHeight: 1.7,
            color: 'var(--ink-2)',
          }}
        >
          <span className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>
            AI 对比总结
          </span>
          {data.llm_summary}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table className="cmp-tbl">
          <thead>
            <tr>
              <th style={{ width: 40 }}></th>
              <th>素材</th>
              <th>摘要</th>
              <th>内容预览</th>
              <th>字数</th>
            </tr>
          </thead>
          <tbody>
            {data.texts.map((txt) => (
              <tr
                key={txt.item_id}
                data-current={txt.is_current}
                style={txt.is_current ? { background: 'var(--bg-sunken)' } : undefined}
                onClick={() => onSelectItem?.(txt.item_id)}
              >
                <td style={{ textAlign: 'center' }}>
                  <FileText size={14} style={{ color: 'var(--accent-2)' }} />
                </td>
                <td>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{txt.name}</div>
                  {txt.is_current && (
                    <span style={{ fontSize: 10, color: 'var(--accent-pink)', fontWeight: 600 }}>
                      当前
                    </span>
                  )}
                </td>
                <td style={{ fontSize: 12, maxWidth: 280 }}>
                  {(typeof txt.summary === 'string' ? txt.summary : txt.summary?.abstract) || <span style={{ color: 'var(--ink-4)' }}>—</span>}
                </td>
                <td style={{ fontSize: 12, maxWidth: 300 }}>
                  {txt.content_preview || <span style={{ color: 'var(--ink-4)' }}>—</span>}
                </td>
                <td style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'right' }}>
                  {txt.char_count.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
