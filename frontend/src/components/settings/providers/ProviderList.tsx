import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DirtyDot } from '@/components/ui/dirty-dot'
import { EmptyState } from '@/components/ui/empty-state'
import { ProviderIcon } from '@/components/settings/providers/ProviderIcon'
import { cn } from '@/lib/utils'
import type { ProviderItem } from '@/store/providerStore'

/**
 * Master-Detail 左侧列表（SETTINGS_REPLICA_PLAN.md §3.2 M1）。
 *
 * - 顶部：搜索框 + 新增按钮；
 * - 中段：可滚动的 Provider 列表，active 项高亮，脏项挂 DirtyDot；
 * - 空态：复用 EmptyState，内嵌新增 CTA。
 *
 * 所有交互均以 props 回调上抛，本组件不持有业务数据。
 */
export interface ProviderListProps {
  providers: ProviderItem[]
  /** 当前选中的 provider id；为空表示未选中 */
  selectedId: string | null
  /** 脏 provider id 集合（有未保存草稿） */
  dirtyIds: ReadonlySet<string>
  /** 列表项点击（父组件负责脏态拦截） */
  onSelect: (id: string) => void
  /** 顶部「新增」按钮点击 */
  onAdd: () => void
  /** 行内「删除」按钮点击 */
  onDelete: (provider: ProviderItem) => void
}

export function ProviderList({
  providers,
  selectedId,
  dirtyIds,
  onSelect,
  onAdd,
  onDelete,
}: ProviderListProps) {
  const { t } = useTranslation(['providers', 'settings', 'common'])
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return providers
    return providers.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.kind.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q),
    )
  }, [providers, query])

  return (
    <aside
      data-slot="provider-list"
      aria-label="provider-list"
      className="flex h-full w-72 shrink-0 flex-col border-r border-zinc-200 bg-white"
    >
      {/* 顶部工具条 */}
      <div className="flex flex-col gap-2 border-b border-zinc-200 p-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            {t('page.title')}
          </h2>
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={onAdd}>
            <Plus className="size-3.5" />
            {t('list.addButton')}
          </Button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('list.searchPlaceholder')}
            aria-label="search-providers"
            className="h-8 pl-7 text-sm"
          />
        </div>
      </div>

      {/* 列表主体 */}
      <div className="flex-1 overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <div className="p-2">
            <EmptyState
              title={t('settings:providers.emptyState.title')}
              description={t('settings:providers.emptyState.description')}
              action={
                <Button size="sm" onClick={onAdd} className="gap-1">
                  <Plus className="size-3.5" />
                  {t('settings:providers.emptyState.action')}
                </Button>
              }
            />
          </div>
        ) : (
          <ul role="listbox" aria-label="providers" className="flex flex-col gap-1">
            {filtered.map((p) => {
              const active = p.id === selectedId
              const dirty = dirtyIds.has(p.id)
              // 外层使用 div[role=option] 避免 <button> 嵌套 <button> 的 HTML 违规；
              // 行本身通过 click + keydown 维持键盘可达性，行内删除才是真正的 <button>。
              return (
                <li key={p.id}>
                  <div
                    role="option"
                    aria-selected={active}
                    tabIndex={0}
                    data-dirty={dirty || undefined}
                    onClick={() => onSelect(p.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSelect(p.id)
                      }
                    }}
                    className={cn(
                      'group flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400',
                      active
                        ? 'bg-violet-50 text-violet-900 ring-1 ring-violet-200'
                        : 'text-foreground hover:bg-zinc-50',
                    )}
                  >
                    <span className="inline-flex size-5 shrink-0 items-center justify-center text-muted-foreground">
                      <ProviderIcon kind={p.kind} />
                    </span>
                    <span className="flex-1 min-w-0 truncate font-medium">{p.name}</span>
                    {dirty ? <DirtyDot aria-label={t('settings:dirty.unsavedBadge')} /> : null}
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                        p.enabled
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-zinc-100 text-zinc-500',
                      )}
                    >
                      {p.enabled ? t('badge.enabled') : t('badge.disabled')}
                    </span>
                    <button
                      type="button"
                      aria-label={t('actions.delete')}
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete(p)
                      }}
                      onKeyDown={(e) => {
                        // 阻止空格/Enter 冒泡到外层 option 触发 onSelect
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.stopPropagation()
                        }
                      }}
                      className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100 focus:opacity-100 focus-visible:ring-2 focus-visible:ring-rose-300"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}

export default ProviderList

