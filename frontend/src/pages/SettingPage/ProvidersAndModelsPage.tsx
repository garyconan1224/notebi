import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, ChevronDown } from 'lucide-react'
import ProvidersManagementPage from './ProvidersManagementPage'
import ModelManagementPage from './ModelManagementPage'
import { http } from '@/services/client'
import { useConfigStore } from '@/store/configStore'
import { cn } from '@/lib/utils'

/**
 * 模型与渠道设置页（合并视图）。
 *
 * 单页三区布局：
 * 1. 供应商管理
 * 2. 模型管理
 * 3. 默认模型（为每种用途指定默认）
 */
export default function ProvidersAndModelsPage() {
  const { t } = useTranslation('settings')
  const [expandProviders, setExpandProviders] = useState(true)
  const [expandModels, setExpandModels] = useState(true)
  const [expandDefaults, setExpandDefaults] = useState(true)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-8">
        {/* 区块一：供应商 */}
        <Section
          title={t('layout.menu.providers', '供应商管理')}
          subtitle="配置 AI 服务供应商的 API 密钥和连接"
          expanded={expandProviders}
          onToggle={() => setExpandProviders((v) => !v)}
        >
          <ProvidersManagementPage />
        </Section>

        {/* 区块二：模型 */}
        <Section
          title={t('layout.menu.models', '模型管理')}
          subtitle="浏览和选择各供应商提供的模型"
          expanded={expandModels}
          onToggle={() => setExpandModels((v) => !v)}
        >
          <ModelManagementPage />
        </Section>

        {/* 区块三：默认模型 */}
        <Section
          title="默认模型"
          subtitle="为对话、视觉、嵌入、重排分别指定全局默认模型"
          expanded={expandDefaults}
          onToggle={() => setExpandDefaults((v) => !v)}
        >
          <DefaultModelsSection />
        </Section>
      </div>
    </div>
  )
}

function Section({
  title,
  subtitle,
  expanded,
  onToggle,
  children,
}: {
  title: string
  subtitle: string
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <div>
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <ChevronDown
          size={18}
          className={cn(
            'text-muted-foreground transition-transform',
            expanded ? '' : '-rotate-90',
          )}
        />
      </button>
      {expanded && <div className="px-5 pb-5">{children}</div>}
    </div>
  )
}

// ── 默认模型区 ────────────────────────────────────────────

interface ProviderOption {
  id: string
  name: string
  kind: string
  enabled: boolean
  capabilities?: string[]
  models: string[]
  modelNames: Record<string, string>
  defaultModels: Record<string, string>
}

interface ModelChoice {
  providerId: string
  modelId: string
}

function DefaultModelsSection() {
  const configStore = useConfigStore()
  const [providers, setProviders] = useState<ProviderOption[]>([])
  const [loading, setLoading] = useState(true)

  // 合并 configStore (localStorage) 与后端 provider.default_models + default_provider 信息。
  // 后端 /providers 返回的 default_provider_for_* 是权威源；provider.default_models 次之；
  // configStore 是最后 fallback。
  const defaults: Record<string, ModelChoice> = useMemo(() => {
    const roleKeys = ['chat', 'vision', 'embedding', 'rerank'] as const
    const merged: Record<string, ModelChoice> = {}

    for (const role of roleKeys) {
      // 1) 后端返回的 default_provider_for_<role> 是全局默认 provider id
      const defaultPid = (providers as any)._defaultProviderFor?.[role]
      if (defaultPid) {
        // 从该 provider 的 default_models 里找对应 role 的 model
        const p = (providers as any)._providersRaw?.find((rp: any) => rp.id === defaultPid)
        if (p) {
          merged[role] = { providerId: defaultPid, modelId: p.default_models?.[role] ?? '' }
          continue
        }
      }
      // 2) 遍历 providers 的 default_models 找第一个有该 role 的
      for (const p of (providers as any)._providersRaw ?? []) {
        const dm = p.default_models ?? p.defaultModels ?? {}
        if (dm[role]) {
          merged[role] = { providerId: p.id, modelId: dm[role] }
          break
        }
      }
      if (merged[role]) continue

      // 3) configStore fallback
      const storeKey = role === 'chat' ? 'text' : role
      merged[role] = {
        providerId: String((configStore as any)[`${storeKey}ProviderId`] ?? ''),
        modelId: String((configStore as any)[`${storeKey}ModelId`] ?? ''),
      }
    }
    return merged
  }, [providers, configStore])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await http.get('/providers')
        const payload = res.data.data ?? res.data
        // /providers now returns { data: [...], default_provider_for_chat: "...", ... }
        const list: any[] = Array.isArray(payload) ? payload : (payload.data ?? [])
        const result: ProviderOption[] = []
        for (const p of list) {
          const models: string[] = []
          const modelNames: Record<string, string> = {}
          try {
            const mRes = await http.get(`/providers/${p.id}/models`)
            const mList: any[] = mRes.data.data?.models ?? mRes.data?.models ?? []
            for (const m of mList) {
              models.push(m.id)
              modelNames[m.id] = m.name ?? m.id
            }
          } catch { /* 模型加载失败静默 */ }
          result.push({
            id: p.id,
            name: p.name,
            kind: p.kind,
            enabled: p.enabled,
            capabilities: p.capabilities,
            models,
            modelNames,
            defaultModels: p.default_models ?? {},
          })
        }
        // Attach server-side defaults + raw provider list for the `defaults` memo
        const enhanced: any = Object.assign([...result], {
          _defaultProviderFor: {
            chat: (payload as any).default_provider_for_chat ?? '',
            vision: (payload as any).default_provider_for_vision ?? '',
            embedding: (payload as any).default_provider_for_embedding ?? '',
            rerank: (payload as any).default_provider_for_rerank ?? '',
          },
          _providersRaw: result,
        })
        if (!cancelled) setProviders(enhanced)
      } catch { /* 静默 */ } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const handleSaveDefault = async (
    role: 'chat' | 'vision' | 'embedding' | 'rerank',
    providerId: string,
    modelId: string,
  ) => {
    // If clearing, we need to know the current provider so we can call PUT
    // on it with an empty role value to clear the default_models entry.
    const effectiveProviderId = providerId || defaults[role]?.providerId
    if (!effectiveProviderId) {
      toast.error('没有关联的供应商，无法保存')
      return
    }
    try {
      await http.put(`/providers/${effectiveProviderId}`, {
        default_models: { [role]: modelId || '' },
      })
      // 同步更新 configStore
      const storeKey = role === 'chat' ? 'text' : role
      const providerKey = `${storeKey}ProviderId` as keyof typeof configStore
      const modelKey = `${storeKey}ModelId` as keyof typeof configStore
      configStore.setConfig({ [providerKey]: modelId ? providerId : '', [modelKey]: modelId || '' })
      toast.success(
        modelId
          ? `已设置默认${ROLE_LABELS[role]}模型：${modelId}`
          : `已清除默认${ROLE_LABELS[role]}模型`,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存失败'
      toast.error(msg)
    }
  }

  if (loading) {
    return <div className="py-4 text-sm text-muted-foreground">加载中…</div>
  }

  if (providers.length === 0) {
    return (
      <div className="py-4 text-sm text-muted-foreground">
        暂无已配置的供应商。请先在「供应商管理」中添加供应商。
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {(Object.keys(ROLE_LABELS) as Array<'chat' | 'vision' | 'embedding' | 'rerank'>).map((role) => {
        const current = defaults[role]
        const eligibleProviders = providers.filter((p) => {
          if (!p.enabled) return false
          if (role === 'chat') return p.capabilities?.includes('chat')
          if (role === 'vision') return p.capabilities?.includes('vision')
          if (role === 'embedding') return p.capabilities?.includes('embedding')
          if (role === 'rerank') return p.capabilities?.includes('rerank')
          return false
        })
        const currentProviderName = current.providerId
          ? providers.find((p) => p.id === current.providerId)?.name ?? current.providerId
          : ''

        return (
          <ModelRolePicker
            key={role}
            role={role}
            label={ROLE_LABELS[role]}
            description={ROLE_DESCRIPTIONS[role]}
            currentProviderId={current.providerId}
            currentModelId={current.modelId}
            currentProviderName={currentProviderName}
            providers={eligibleProviders}
            onSave={(providerId, modelId) => handleSaveDefault(role, providerId, modelId)}
          />
        )
      })}
    </div>
  )
}

const ROLE_LABELS: Record<string, string> = {
  chat: '对话模型',
  vision: '视觉模型',
  embedding: '嵌入模型',
  rerank: '重排模型',
}

const ROLE_DESCRIPTIONS: Record<string, string> = {
  chat: '用于摘要、问答、脚本生成等文本任务',
  vision: '用于视频帧分析、图片理解等多模态任务',
  embedding: '用于知识库索引的文本向量化',
  rerank: '用于知识库检索结果的精排',
}

function ModelRolePicker({
  label,
  description,
  currentProviderId,
  currentModelId,
  currentProviderName,
  providers,
  onSave,
}: {
  role: string
  label: string
  description: string
  currentProviderId: string
  currentModelId: string
  currentProviderName: string
  providers: ProviderOption[]
  onSave: (providerId: string, modelId: string) => void
}) {
  const [selectedProviderId, setSelectedProviderId] = useState(currentProviderId)
  const [selectedModelId, setSelectedModelId] = useState(currentModelId)
  const [open, setOpen] = useState(false)

  // 当外部 defaults 变化时同步
  useEffect(() => {
    setSelectedProviderId(currentProviderId)
    setSelectedModelId(currentModelId)
  }, [currentProviderId, currentModelId])

  const activeProvider = providers.find((p) => p.id === selectedProviderId)
  const models = activeProvider?.models ?? []

  const handleConfirm = () => {
    if (selectedModelId && selectedProviderId) {
      onSave(selectedProviderId, selectedModelId)
    }
    setOpen(false)
  }

  const handleClear = () => {
    setSelectedProviderId('')
    setSelectedModelId('')
    onSave('', '')
    setOpen(false)
  }

  const displayText = currentModelId
    ? `${currentProviderName} / ${currentModelId}`
    : '（未设置，使用系统默认）'

  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-background px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
        <div className="mt-1 font-mono text-xs text-foreground truncate">
          {displayText}
        </div>
      </div>
      <div className="relative ml-4 shrink-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-muted/60"
        >
          {currentModelId ? '更换' : '设置'}
          <ChevronDown size={12} />
        </button>
        {open && (
          <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-md border border-border bg-card shadow-lg">
            <div className="border-b border-border px-3 py-2">
              <span className="text-xs font-medium text-muted-foreground">选择默认{label}</span>
            </div>
            <div className="max-h-64 overflow-y-auto p-2 space-y-2">
              {/* 供应商选择 */}
              <div>
                <div className="mb-1 text-[10px] text-muted-foreground uppercase">供应商</div>
                <select
                  value={selectedProviderId}
                  onChange={(e) => {
                    setSelectedProviderId(e.target.value)
                    setSelectedModelId('')
                  }}
                  className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
                >
                  <option value="">-- 选择供应商 --</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.kind})
                    </option>
                  ))}
                </select>
              </div>
              {/* 模型选择 */}
              {selectedProviderId && models.length > 0 && (
                <div>
                  <div className="mb-1 text-[10px] text-muted-foreground uppercase">模型</div>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {models.map((mId) => {
                      const mName = activeProvider?.modelNames?.[mId] ?? mId
                      const isSel = mId === selectedModelId
                      return (
                        <button
                          key={mId}
                          type="button"
                          onClick={() => setSelectedModelId(mId)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs',
                            isSel ? 'bg-violet-50 text-violet-700' : 'hover:bg-muted/60',
                          )}
                        >
                          <span
                            className={cn(
                              'flex size-3.5 shrink-0 items-center justify-center rounded-sm border',
                              isSel
                                ? 'border-violet-400 bg-violet-200'
                                : 'border-border',
                            )}
                          >
                            {isSel ? <Check size={8} /> : null}
                          </span>
                          <span className="truncate font-mono text-[11px]">{mId}</span>
                          {mName !== mId && (
                            <span className="truncate text-[10px] text-muted-foreground">{mName}</span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              {selectedProviderId && models.length === 0 && (
                <div className="text-xs text-muted-foreground py-1">该供应商暂无模型</div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-border px-3 py-2">
              <button
                type="button"
                onClick={handleClear}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                清除
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!selectedProviderId || !selectedModelId}
                className="rounded bg-violet-600 px-3 py-1 text-xs text-white hover:bg-violet-700 disabled:opacity-40"
              >
                确认
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
