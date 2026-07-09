import { useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { SYSTEM_TAG_DIMENSIONS } from '@/constants/tagDimensions'
import { updateItemTags } from '@/services/workspaces'
import type { WorkspaceItem, SystemTagDimension } from '@/types/workspace'

type FilterMode = 'all' | 'auto' | 'manual'

interface TagEntry {
  tag: string
  count: number
  auto: boolean
  itemIds: string[]
}

interface TagsTabProps {
  items: WorkspaceItem[]
  workspaceId: string
  onTagsChanged: () => void
}

/**
 * Tags tab — 标签库，从 workspace items 的 tags 中聚合标签，按维度分组展示。
 * 支持手动添加/删除标签（optimistic update）。
 */
export function TagsTab({ items, workspaceId, onTagsChanged }: TagsTabProps) {
  const [filter, setFilter] = useState<FilterMode>('all')
  const [editingDim, setEditingDim] = useState<string | null>(null)
  const [newTag, setNewTag] = useState('')

  /** 按维度聚合标签（附带 itemIds 用于 CRUD） */
  const tagLib = useMemo(() => {
    const result: Record<string, TagEntry[]> = {}
    for (const dim of SYSTEM_TAG_DIMENSIONS) {
      const counts = new Map<string, { count: number; auto: boolean; itemIds: string[] }>()
      for (const item of items) {
        const val = item.tags?.[dim.key as SystemTagDimension]
        if (!val) continue
        const existing = counts.get(val)
        if (existing) {
          existing.count++
          existing.itemIds.push(item.item_id)
        } else {
          counts.set(val, { count: 1, auto: true, itemIds: [item.item_id] })
        }
      }
      for (const item of items) {
        for (const ct of item.tags?.custom_tags ?? []) {
          const existing = counts.get(ct)
          if (existing) {
            existing.count++
            if (!existing.itemIds.includes(item.item_id)) existing.itemIds.push(item.item_id)
          } else {
            counts.set(ct, { count: 1, auto: false, itemIds: [item.item_id] })
          }
        }
      }
      result[dim.label] = Array.from(counts.entries()).map(([tag, v]) => ({
        tag,
        count: v.count,
        auto: v.auto,
        itemIds: v.itemIds,
      }))
    }
    return result
  }, [items])

  const allEntries = Object.entries(tagLib)
  const totalTags = allEntries.reduce((a, [, tags]) => a + tags.length, 0)

  /** 删除标签：从所有包含该标签的 item 中移除 */
  const handleDelete = async (dimKey: string, tag: string, itemIds: string[]) => {
    try {
      await Promise.all(
        itemIds.map(async (itemId) => {
          const item = items.find((i) => i.item_id === itemId)
          if (!item) return
          const newTags: Record<string, unknown> = { ...item.tags }
          if (dimKey === 'custom_tags') {
            newTags.custom_tags = (item.tags.custom_tags ?? []).filter((t) => t !== tag)
          } else {
            delete newTags[dimKey]
          }
          await updateItemTags(workspaceId, itemId, newTags)
        }),
      )
      toast.success(`已删除标签「${tag}」`)
      onTagsChanged()
    } catch {
      toast.error('删除失败')
    }
  }

  /** 新增标签 */
  const handleAdd = async (dimKey: string, dimLabel: string) => {
    const value = newTag.trim()
    if (!value) return

    const targetItems = items.filter((item) => !item.tags?.[dimKey as SystemTagDimension])
    if (targetItems.length === 0) {
      toast.error(`所有素材已有「${dimLabel}」，无空位可填`)
      return
    }

    try {
      await Promise.all(
        targetItems.map(async (item) => {
          const newTags: Record<string, unknown> = { ...item.tags, [dimKey]: value }
          await updateItemTags(workspaceId, item.item_id, newTags)
        }),
      )
      toast.success(`已添加「${value}」到 ${targetItems.length} 个素材`)
      setNewTag('')
      setEditingDim(null)
      onTagsChanged()
    } catch {
      toast.error('添加失败')
    }
  }

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
            提示词维度 · {SYSTEM_TAG_DIMENSIONS.length}类 · 共 {totalTags} 个标签
          </div>
          <h2 className="display" style={{ fontSize: 28, margin: '4px 0 0' }}>
            标签库 · Tag Library
          </h2>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="tw-segm">
            {(['all', 'auto', 'manual'] as const).map((mode) => (
              <button
                key={mode}
                data-active={filter === mode}
                onClick={() => setFilter(mode)}
              >
                {mode === 'all' ? '全部' : mode === 'auto' ? '自动' : '手动'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="tb-tag-grid">
        {allEntries.map(([dim, tags]) => {
          const dimSpec = SYSTEM_TAG_DIMENSIONS.find((d) => d.label === dim)
          const dimKey = dimSpec?.key ?? ''
          const filtered = tags.filter(
            (t) => filter === 'all' || (filter === 'auto' ? t.auto : !t.auto),
          )
          if (filtered.length === 0 && editingDim !== dim) return null
          return (
            <div key={dim} className="tag-col">
              <div className="tag-col-h">
                <span>{dim}</span>
                <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
                  {filtered.length}
                </span>
              </div>
              <div className="tag-col-b">
                {filtered.map((t) => (
                  <div key={t.tag} className="tag-row" data-auto={t.auto}>
                    <div className="tag-l">
                      <span className="tag-name">{t.tag}</span>
                      <span className={`tag-badge ${t.auto ? 'auto' : 'manual'}`}>
                        {t.auto ? '自动' : '手动'}
                      </span>
                    </div>
                    <div className="tag-r">
                      <span className="tag-bar">
                        <span style={{ width: `${Math.min(100, t.count * 8)}%` }} />
                      </span>
                      <span
                        className="mono"
                        style={{
                          fontSize: 11,
                          color: 'var(--ink-3)',
                          minWidth: 22,
                          textAlign: 'right',
                        }}
                      >
                        {t.count}
                      </span>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>
                        {t.count}素材
                      </span>
                      <button
                        className="tag-del"
                        title={`删除「${t.tag}」`}
                        onClick={() => handleDelete(dimKey, t.tag, t.itemIds)}
                      >
                        <X size={10} />
                      </button>
                    </div>
                  </div>
                ))}

                {/* 新增标签 */}
                {editingDim === dim ? (
                  <div className="tag-add-input">
                    <input
                      autoFocus
                      placeholder="输入标签名"
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAdd(dimKey, dim)
                        if (e.key === 'Escape') { setEditingDim(null); setNewTag('') }
                      }}
                    />
                    <button onClick={() => handleAdd(dimKey, dim)}>确定</button>
                    <button onClick={() => { setEditingDim(null); setNewTag('') }}>取消</button>
                  </div>
                ) : (
                  <button className="tag-add" onClick={() => setEditingDim(dim)}>
                    <Plus size={11} /> 新增
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
