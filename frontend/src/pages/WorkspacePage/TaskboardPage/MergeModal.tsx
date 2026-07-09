import { useState, useCallback } from 'react'
import { X, Sparkles } from 'lucide-react'
import type { WorkspaceItem } from '@/types/workspace'

const MERGE_STYLES = [
  { id: '综合大纲', label: '综合大纲', desc: '逻辑组织，要点+对比+总结，适合全面了解' },
  { id: '知识图谱', label: '知识图谱', desc: '提取核心概念及关系，适合理清知识结构' },
  { id: '精华摘要', label: '精华摘要', desc: '每篇2-4条要点精炼，≤1500字，快速获取干货' },
] as const

interface MergeModalProps {
  items: WorkspaceItem[]
  /** 外部预设的选中 id 集合（默认全选） */
  defaultSelectedIds?: Set<string>
  loading?: boolean
  onConfirm: (itemIds: string[], style: string) => void
  onClose: () => void
}

/**
 * 融合弹框：默认全选 + 可取消 + 风格选择。
 * 对齐 BiliNote 的融合交互。
 */
export function MergeModal({
  items,
  defaultSelectedIds,
  loading = false,
  onConfirm,
  onClose,
}: MergeModalProps) {
  const initialIds = defaultSelectedIds ?? new Set(items.map((it) => it.item_id))
  const [selected, setSelected] = useState<Set<string>>(new Set(initialIds))
  const [style, setStyle] = useState<string>('综合大纲')

  const toggleItem = useCallback((itemId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }, [])

  const canMerge = selected.size >= 2

  const handleSubmit = () => {
    if (!canMerge) return
    onConfirm([...selected], style)
  }

  return (
    <div className="tb-modal-overlay" onClick={onClose}>
      <div className="tb-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <button className="tb-modal-close" onClick={onClose}>
          <X size={18} />
        </button>

        <h2 style={{ fontSize: 18, marginBottom: 4 }}>融合笔记</h2>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 16 }}>
          选择要融合的素材和风格，AI 将合并生成综合笔记
        </p>

        {/* 素材选择列表 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--ink-2)' }}>
            素材（{selected.size}/{items.length}）
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
            {items.map((item) => {
              const isSel = selected.has(item.item_id)
              return (
                <label
                  key={item.item_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    cursor: 'pointer',
                    borderBottom: '1px solid var(--line)',
                    background: isSel ? 'color-mix(in oklch, var(--accent) 6%, transparent)' : undefined,
                    fontSize: 13,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => toggleItem(item.item_id)}
                    style={{ accentColor: 'var(--accent)' }}
                  />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.name || '未命名素材'}
                  </span>
                  <span style={{ color: 'var(--ink-4)', fontSize: 11, flexShrink: 0 }}>
                    {item.type}
                  </span>
                </label>
              )
            })}
          </div>
        </div>

        {/* 风格选择 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--ink-2)' }}>
            融合风格
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {MERGE_STYLES.map((s) => (
              <label
                key={s.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '10px 12px',
                  border: `1.5px solid ${style === s.id ? 'var(--accent)' : 'var(--line)'}`,
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: style === s.id ? 'color-mix(in oklch, var(--accent) 6%, transparent)' : undefined,
                }}
              >
                <input
                  type="radio"
                  name="merge-style"
                  value={s.id}
                  checked={style === s.id}
                  onChange={() => setStyle(s.id)}
                  style={{ accentColor: 'var(--accent)', marginTop: 2 }}
                />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{s.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
                    {s.desc}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* 底部按钮 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={onClose} disabled={loading}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={!canMerge || loading}
            title={!canMerge ? '至少选择 2 个素材' : undefined}
          >
            <Sparkles size={14} />
            {loading ? '融合中…' : '开始融合'}
          </button>
        </div>
      </div>
    </div>
  )
}
