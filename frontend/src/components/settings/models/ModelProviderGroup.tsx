import { useTranslation } from 'react-i18next'
import { AlertCircle, ChevronDown, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/ui/section'
import { ProviderIcon } from '@/components/settings/providers/ProviderIcon'
import { ModelCard } from '@/components/settings/models/ModelCard'
import type { ModelRole } from '@/components/settings/models/ModelCard'
import { cn } from '@/lib/utils'

/** 分组视图所需的 provider + 模型状态快照（由 ModelManagementPage 组装） */
export interface ModelProviderGroupItem {
  id: string
  name: string
  kind: string
  enabled: boolean
  capabilities?: string[]
  loadingModels: boolean
  modelError?: string
  /** 经搜索过滤后的模型列表（由父组件过滤） */
  filteredModels: { id: string; name: string }[]
  /** 过滤前的原始数量；用于区分"未加载/被过滤为 0"两种空态 */
  totalModels: number
}

export interface ModelProviderGroupProps {
  provider: ModelProviderGroupItem
  /** 是否当前展开；折叠状态由父组件管理以便懒加载 */
  expanded: boolean
  onToggleExpand: () => void
  onRefresh: () => void
  /** 当前默认文本模型（若属于本 provider） */
  defaultText: { providerId: string; modelId: string }
  /** 当前默认视觉模型（若属于本 provider） */
  defaultVision: { providerId: string; modelId: string }
  defaultEmbedding: { providerId: string; modelId: string }
  defaultRerank: { providerId: string; modelId: string }
  onSetDefault: (role: ModelRole, modelId: string, next: boolean) => void
}

export function ModelProviderGroup({
  provider,
  expanded,
  onToggleExpand,
  onRefresh,
  defaultText,
  defaultVision,
  defaultEmbedding,
  defaultRerank,
  onSetDefault,
}: ModelProviderGroupProps) {
  const { t } = useTranslation('settings')

  // capability 是 provider 级声明;缺 "vision" 时隐藏 V 按钮以避免误导
  const hasVision = Boolean(provider.capabilities?.includes('vision'))
  const hasEmbedding = Boolean(provider.capabilities?.includes('embedding'))
  const hasRerank = Boolean(provider.capabilities?.includes('rerank'))

  // 标题节点:整行可点击触发折叠;refresh 按钮自身 stopPropagation
  const titleNode = (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggleExpand}
      className="inline-flex items-center gap-2 text-left"
    >
      <ChevronDown
        className={cn(
          'size-4 text-muted-foreground transition-transform',
          expanded ? '' : '-rotate-90',
        )}
      />
      <ProviderIcon kind={provider.kind} size={16} className="text-muted-foreground" />
      <span>{provider.name}</span>
      <span className="font-mono text-xs text-muted-foreground">·{provider.kind}</span>
    </button>
  )

  const actionNode = (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
          provider.enabled
            ? 'bg-emerald-50 text-emerald-700'
            : 'bg-zinc-100 text-zinc-500',
        )}
      >
        <span
          className={cn(
            'size-1.5 rounded-full',
            provider.enabled ? 'bg-emerald-500' : 'bg-zinc-400',
          )}
        />
        {provider.enabled ? t('model.statusEnabled') : t('model.statusDisabled')}
      </span>
      {expanded ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2"
          disabled={provider.loadingModels}
          title={t('model.refreshModelsTitle')}
          onClick={(e) => {
            e.stopPropagation()
            onRefresh()
          }}
        >
          <RefreshCw
            className={cn('size-3.5', provider.loadingModels ? 'animate-spin' : '')}
          />
        </Button>
      ) : null}
    </div>
  )

  return (
    <Section title={titleNode} action={actionNode}>
      {!expanded ? null : provider.loadingModels ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t('model.fetchingModels')}
        </div>
      ) : provider.modelError ? (
        <div className="flex items-start gap-2 rounded-md bg-rose-50 p-3 text-xs text-rose-600">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="mb-1 font-medium">{t('model.fetchModelsFailed')}</p>
            <p>{provider.modelError}</p>
          </div>
        </div>
      ) : provider.totalModels === 0 ? (
        <p className="text-sm text-muted-foreground">{t('model.noModels')}</p>
      ) : provider.filteredModels.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('model.noMatch')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {provider.filteredModels.map((m) => (
            <ModelCard
              key={m.id}
              modelId={m.id}
              modelName={m.name}
              isTextDefault={
                defaultText.providerId === provider.id && defaultText.modelId === m.id
              }
              isVisionDefault={
                defaultVision.providerId === provider.id && defaultVision.modelId === m.id
              }
              isEmbeddingDefault={
                defaultEmbedding.providerId === provider.id && defaultEmbedding.modelId === m.id
              }
              isRerankDefault={
                defaultRerank.providerId === provider.id && defaultRerank.modelId === m.id
              }
              hideVision={!hasVision}
              hideEmbedding={!hasEmbedding}
              hideRerank={!hasRerank}
              onToggleDefault={(role, next) => onSetDefault(role, m.id, next)}
            />
          ))}
        </div>
      )}
    </Section>
  )
}

export default ModelProviderGroup
