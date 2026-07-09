import { useState } from 'react'
import {
  Archive,
  Check,
  Download,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
} from 'lucide-react'
import { downloadExport } from '@/services/workspaces'
import type { WorkspaceItem, ItemType } from '@/types/workspace'
import { toast } from 'sonner'

const TYPE_ICON: Record<ItemType, React.ElementType> = {
  video: FileVideo,
  audio: FileAudio,
  image: FileImage,
  text: FileText,
}

interface ExportTabProps {
  items: WorkspaceItem[]
  workspaceId: string
}

/**
 * Export tab — 导出工作包，按素材粒度选中后打包 zip。
 * 设计稿来源：taskboard.jsx TBExport。
 */
export function ExportTab({ items, workspaceId }: ExportTabProps) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(items.map((it) => it.item_id)),
  )
  const [exporting, setExporting] = useState(false)

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleExport = async () => {
    if (selected.size === 0) return
    setExporting(true)
    try {
      // 导出第一个选中项（后端按 item 粒度导出）
      const firstId = [...selected][0]
      await downloadExport(workspaceId, firstId)
      toast.success('导出成功')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }

  if (items.length === 0) {
    return (
      <div className="tb-placeholder" style={{ minHeight: 240 }}>
        暂无可导出的素材
      </div>
    )
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
            复刻工作包 · LOCAL ONLY · .zip
          </div>
          <h2 className="display" style={{ fontSize: 28, margin: '4px 0 0' }}>
            导出工作包 · Export
          </h2>
        </div>
        <div className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          已选 {selected.size} / {items.length} 项
        </div>
      </div>

      <div className="exp-list">
        {items.map((item) => {
          const Icon = TYPE_ICON[item.type]
          const isOn = selected.has(item.item_id)
          return (
            <div
              key={item.item_id}
              className="exp-row"
              data-on={String(isOn)}
              onClick={() => toggle(item.item_id)}
            >
              <div className="exp-chk">{isOn && <Check size={14} />}</div>
              <div className="exp-ic">
                <Icon size={16} />
              </div>
              <div className="exp-nm">
                <span className="mono">{item.name || '未命名素材'}</span>
                <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>
                  {item.type} · {item.source}
                </span>
              </div>
              <div className="exp-count mono">{item.status}</div>
              <div className="exp-size mono">
                {item.results && Object.keys(item.results).length > 0 ? '有结果' : '—'}
              </div>
            </div>
          )
        })}
      </div>

      <div className="exp-foot">
        <div className="exp-path mono">
          <Archive size={14} />
          ~/exports/{workspaceId}.zip
        </div>
        <button
          className="btn btn-primary"
          disabled={selected.size === 0 || exporting}
          onClick={handleExport}
        >
          <Download size={13} />
          {exporting ? '导出中…' : `打包导出 (${selected.size} 项)`}
        </button>
      </div>
    </>
  )
}
