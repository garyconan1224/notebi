import {
  Layers,
  Star,
  Archive,
  MessageCircle,
} from 'lucide-react'
import type { TabDef, TabId } from './types'

/** 合集功能 Tab 的静态定义（icon + 中英文 label）。count 由外部注入。 */
const TAB_DEFS: TabDef[] = [
  { id: 'materials', label: '素材', en: 'Materials', icon: Layers, count: null },
  { id: 'favs', label: '收藏夹', en: 'Favorites', icon: Star, count: null },
  { id: 'chat', label: 'AI 对话', en: 'Task Chat', icon: MessageCircle, count: null },
  { id: 'export', label: '导出', en: 'Export', icon: Archive, count: null },
]

interface TabsNavProps {
  active: TabId
  onChange: (id: TabId) => void
  /** 可选：覆盖各 tab 的徽章数字（key = tab id） */
  counts?: Partial<Record<TabId, number>>
}

/**
 * 合集功能标签栏导航。
 * 设计稿来源：taskboard.jsx 第 80-89 行。
 */
export function TabsNav({ active, onChange, counts }: TabsNavProps) {
  return (
    <div className="tb-tabs">
      {TAB_DEFS.map((t) => {
        const Icon = t.icon
        const n = counts?.[t.id] ?? t.count
        return (
          <button
            key={t.id}
            className="tb-tab"
            data-active={active === t.id}
            onClick={() => onChange(t.id)}
          >
            <Icon size={15} />
            <span>{t.label}</span>
            <span className="tb-tab-en">{t.en}</span>
            {n != null && <span className="tb-tab-n">{n}</span>}
          </button>
        )
      })}
    </div>
  )
}
