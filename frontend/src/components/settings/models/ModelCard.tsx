import { useTranslation } from 'react-i18next'
import { Star } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export type ModelRole = 'text' | 'vision' | 'embedding' | 'rerank'

/**
 * 模型卡片（DESIGN_NOTES_SETTINGS.md §4.3 · Models）。
 *
 * - 左侧：模型 id（font-mono）+ 可选 name；
 * - 右侧：两个星标切换按钮 T / V，分别表示"设为默认文本模型 / 视觉模型"；
 * - 当前默认态：按钮实心、violet 描边 + 背景。
 *
 * 写入 `configStore` 的 `textProviderId/textModelId` 或
 * `visionProviderId/visionModelId` 由调用方在 onToggle 回调里处理。
 */
export interface ModelCardProps {
  /** 模型 id（唯一） */
  modelId: string
  /** 显示名称（为空则回退 modelId） */
  modelName?: string
  /** 是否当前默认文本模型（本 provider + 此模型） */
  isTextDefault: boolean
  /** 是否当前默认视觉模型（本 provider + 此模型） */
  isVisionDefault: boolean
  /** 是否隐藏视觉切换（provider 不声明 vision capability 时） */
  hideVision?: boolean
  isEmbeddingDefault: boolean
  isRerankDefault: boolean
  hideEmbedding?: boolean
  hideRerank?: boolean
  /** 切换回调：next=true 设为默认、false 取消 */
  onToggleDefault: (role: ModelRole, next: boolean) => void
}

export function ModelCard({
  modelId,
  modelName,
  isTextDefault,
  isVisionDefault,
  isEmbeddingDefault,
  isRerankDefault,
  hideVision,
  hideEmbedding,
  hideRerank,
  onToggleDefault,
}: ModelCardProps) {
  const { t } = useTranslation('settings')
  const displayName = modelName && modelName !== modelId ? modelName : null
  const roleButtons: Array<{
    role: ModelRole
    label: string
    active: boolean
    hidden?: boolean
    title: string
  }> = [
    { role: 'text', label: 'T', active: isTextDefault, title: t('model.defaultText.set') },
    { role: 'vision', label: 'V', active: isVisionDefault, hidden: hideVision, title: t('model.defaultVision.set') },
    { role: 'embedding', label: 'E', active: isEmbeddingDefault, hidden: hideEmbedding, title: '设为默认嵌入模型' },
    { role: 'rerank', label: 'R', active: isRerankDefault, hidden: hideRerank, title: '设为默认重排模型' },
  ]

  return (
    <div
      data-slot="model-card"
      className="group flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[13px] text-zinc-800">{modelId}</div>
        {displayName ? (
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {displayName}
          </div>
        ) : null}
      </div>
      <TooltipProvider delayDuration={200}>
        <div className="flex shrink-0 items-center gap-1">
          {roleButtons.filter((item) => !item.hidden).map((item) => (
            <Tooltip key={item.role}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-pressed={item.active}
                  aria-label={item.title}
                  onClick={() => onToggleDefault(item.role, !item.active)}
                  className={cn(
                    'inline-flex size-6 items-center justify-center rounded-md border text-[10px] font-semibold transition-colors',
                    item.active
                      ? 'border-violet-300 bg-violet-50 text-violet-700'
                      : 'border-zinc-200 bg-white text-zinc-400 hover:border-zinc-300 hover:text-zinc-600',
                  )}
                >
                  {item.role === 'text' ? (
                    <Star className={cn('size-3', item.active ? 'fill-violet-500 stroke-violet-500' : '')} />
                  ) : (
                    item.label
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {item.active ? '当前默认' : item.title}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>
    </div>
  )
}

export default ModelCard
