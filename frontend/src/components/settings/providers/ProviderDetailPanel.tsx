import { useTranslation } from 'react-i18next'
import { KeyRound, Loader2, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Section } from '@/components/ui/section'
import { FieldRow } from '@/components/ui/field-row'
import { EmptyState } from '@/components/ui/empty-state'
import type { ProviderItem } from '@/store/providerStore'

/** 已加载的 Provider 详情（与后端 GET /providers/{id} 对齐，api_key 不回传明文） */
export interface ProviderDetail extends ProviderItem {
  api_key?: string
  default_models?: Record<string, string>
  rate_limit_rpm?: number
  timeout_sec?: number
  capabilities?: string[]
}

/** 编辑表单草稿，字段与 ProviderUpdateRequest 对齐；api_key 为空串视为"不修改" */
export interface EditDraft extends Record<string, unknown> {
  api_key: string
  base_url: string
  enabled: boolean
  name: string
}

export interface ProviderDetailPanelProps {
  /** 当前选中的 provider（列表行）；null 表示未选中 */
  provider: ProviderItem | null
  /** 懒加载的详情缓存值；为空表示正在加载 */
  detail: ProviderDetail | null
  /** 当前草稿；为空表示详情尚未就绪 */
  draft: EditDraft | null
  /** 对各字段的脏状态映射；用于 FieldRow.dirty */
  dirtyMap: Record<keyof EditDraft, boolean>
  savingId: string | null
  testingId: string | null
  testResult?: { ok: boolean; msg: string }
  onChange: (patch: Partial<EditDraft>) => void
  onSave: () => void
  onTest: () => void
}

export function ProviderDetailPanel({
  provider,
  detail,
  draft,
  dirtyMap,
  savingId,
  testingId,
  testResult,
  onChange,
  onSave,
  onTest,
}: ProviderDetailPanelProps) {
  const { t } = useTranslation(['providers', 'common'])

  // 未选中任何 provider：右侧展示空态占位，同时让父组件 CTA 按钮下穿
  if (!provider) {
    return (
      <div className="flex flex-1 items-center justify-center p-10">
        <EmptyState
          title={t('detail.emptyTitle')}
          description={t('detail.emptyDescription')}
        />
      </div>
    )
  }

  const id = provider.id
  const isSaving = savingId === id
  const isTesting = testingId === id
  const isLoading = !detail || !draft

  return (
    <section
      data-slot="provider-detail-panel"
      aria-label={`provider-detail-${id}`}
      className="flex flex-1 flex-col overflow-y-auto"
    >
      {/* 标题区 */}
      <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {provider.name}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="font-mono">{provider.kind}</span>
            <span className="mx-1.5">·</span>
            <span className="font-mono">{provider.id}</span>
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={onTest}
          disabled={isTesting}
        >
          {isTesting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RotateCcw className="size-3.5" />
          )}
          {t('actions.testConnection')}
        </Button>
      </div>

      {/* 连接测试结果 */}
      {testResult?.msg ? (
        <div
          role="status"
          className={`border-b px-6 py-2 text-xs ${
            testResult.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-rose-200 bg-rose-50 text-rose-600'
          }`}
        >
          {testResult.ok ? '✓ ' : '✗ '}
          {testResult.msg}
        </div>
      ) : null}

      {/* 主体：Section × 3 */}
      <div className="flex flex-1 flex-col gap-6 px-6 py-5">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('common:status.loading')}
          </div>
        ) : (
          <>
            <Section
              title={t('detail.sectionBasic')}
              icon={<SlidersHorizontal className="size-4" />}
            >
              <FieldRow
                htmlFor={`p-${id}-name`}
                label={t('form.name')}
                dirty={dirtyMap.name}
              >
                <Input
                  id={`p-${id}-name`}
                  value={draft.name}
                  onChange={(e) => onChange({ name: e.target.value })}
                  placeholder={t('form.namePlaceholder')}
                />
              </FieldRow>
              <FieldRow
                htmlFor={`p-${id}-base-url`}
                label={t('form.baseUrl')}
                dirty={dirtyMap.base_url}
              >
                <Input
                  id={`p-${id}-base-url`}
                  value={draft.base_url}
                  onChange={(e) => onChange({ base_url: e.target.value })}
                  placeholder={t('form.baseUrlPlaceholder')}
                  className="font-mono"
                />
              </FieldRow>
              <FieldRow
                htmlFor={`p-${id}-enabled`}
                label={t('form.enabled')}
                dirty={dirtyMap.enabled}
                inline
              >
                <Switch
                  id={`p-${id}-enabled`}
                  checked={draft.enabled}
                  onCheckedChange={(v) => onChange({ enabled: v })}
                />
              </FieldRow>
            </Section>

            <Section
              title={t('detail.sectionAuth')}
              icon={<KeyRound className="size-4" />}
            >
              <FieldRow
                htmlFor={`p-${id}-api-key`}
                label={t('form.apiKey')}
                dirty={dirtyMap.api_key}
                hint={
                  detail.has_api_key
                    ? t('form.apiKeyPlaceholderSet')
                    : undefined
                }
              >
                <Input
                  id={`p-${id}-api-key`}
                  type="password"
                  autoComplete="new-password"
                  value={draft.api_key}
                  onChange={(e) => onChange({ api_key: e.target.value })}
                  placeholder={
                    detail.has_api_key
                      ? t('form.apiKeyPlaceholderSet')
                      : t('form.apiKeyPlaceholderEmpty')
                  }
                  className="font-mono"
                />
              </FieldRow>
            </Section>

            <Section title={t('detail.sectionMeta')}>
              <dl className="grid grid-cols-[100px_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">{t('detail.metaKind')}</dt>
                <dd className="font-mono">{provider.kind}</dd>
                <dt className="text-muted-foreground">{t('detail.metaId')}</dt>
                <dd className="font-mono">{provider.id}</dd>
                {detail.capabilities?.length ? (
                  <>
                    <dt className="text-muted-foreground">{t('detail.metaCapabilities')}</dt>
                    <dd className="flex flex-wrap gap-1">
                      {detail.capabilities.map((c) => (
                        <span
                          key={c}
                          className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700"
                        >
                          {c}
                        </span>
                      ))}
                    </dd>
                  </>
                ) : null}
              </dl>
            </Section>

            {/* 内联保存按钮（与 SaveBar 双通道，方便在长表单底部直接触发） */}
            <div className="flex justify-end pt-2">
              <Button size="sm" onClick={onSave} disabled={isSaving} className="gap-1.5">
                {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
                {t('common:actions.save')}
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

export default ProviderDetailPanel

