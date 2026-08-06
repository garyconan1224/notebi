import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, ChevronDown, Search } from 'lucide-react'
import ProvidersManagementPage from './ProvidersManagementPage'
import { http } from '@/services/client'
import { useConfigStore } from '@/store/configStore'
import { useDismissibleLayer } from '@/hooks/useDismissibleLayer'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * 模型与渠道设置页（合并视图）。
 *
 * 单页两区布局（S3）：
 * 1. 服务渠道（供应商管理）
 * 2. 默认模型（为每种用途指定默认）
 */
export default function ProvidersAndModelsPage() {
  const { t } = useTranslation('settings')
  const [expandProviders, setExpandProviders] = useState(true)
  const [expandDefaults, setExpandDefaults] = useState(true)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-8">
        {/* 区块一：服务渠道 */}
        <Section
          title={t('layout.menu.providers', '供应商管理')}
          subtitle={t('providerDefaults.subtitle')}
          expanded={expandProviders}
          onToggle={() => setExpandProviders((v) => !v)}
        >
          <ProvidersManagementPage />
        </Section>

        {/* 区块二：默认模型 */}
        <Section
          title={t('providerDefaults.defaultsTitle')}
          subtitle={t('providerDefaults.defaultsDesc')}
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
  /** 模型级显式能力 token（后端透传上游 capabilities，已小写归一）；无则视为能力未知 */
  modelCaps: Record<string, string[]>
  /** 模型列表拉取失败时的错误信息（后端返回 { models: [], error }），'' 表示无错误 */
  modelsError: string
  defaultModels: Record<string, string>
}

interface ProviderApiOption {
  id: string
  name: string
  kind: string
  enabled: boolean
  capabilities?: string[]
  default_models?: Record<string, string>
}

interface ModelChoice {
  providerId: string
  modelId: string
}

interface ProviderModelOption {
  id: string
  name?: string
  /** 后端透传上游 capabilities / supported_modalities / supported_inputs；token 空间不保证是 role 名 */
  capabilities?: unknown[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function providerListFromPayload(payload: unknown): ProviderApiOption[] {
  if (Array.isArray(payload)) return payload as ProviderApiOption[]
  if (isRecord(payload) && Array.isArray(payload.data)) return payload.data as ProviderApiOption[]
  return []
}

interface ParsedModelList {
  models: ProviderModelOption[]
  error: string
}

function modelListFromPayload(payload: unknown): ParsedModelList {
  // 后端在上游失败时返回 { models: [], error: "..." } 而不是抛 500，
  // 这里把 error 原样带出，供界面显示可读错误态，避免与「暂无模型」混淆。
  const error = isRecord(payload) && typeof payload.error === 'string' ? payload.error : ''
  if (!isRecord(payload)) return { models: [], error }
  if (Array.isArray(payload.models)) return { models: payload.models as ProviderModelOption[], error }
  if (isRecord(payload.data) && Array.isArray(payload.data.models)) {
    return { models: payload.data.models as ProviderModelOption[], error }
  }
  return { models: [], error }
}

function DefaultModelsSection() {
  const { t } = useTranslation('settings')
  const configStore = useConfigStore()
  const [providers, setProviders] = useState<ProviderOption[]>([])
  const [defaultProviderFor, setDefaultProviderFor] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  // 拉取并解析 /providers 的权威数据。纯读取：只返回解析结果、不做 setState，
  // 网络或解析失败时向上抛出，供「保存后读回校验」严格使用。
  const fetchProvidersData = useCallback(async (): Promise<{
    providers: ProviderOption[]
    defaultProviderFor: Record<string, string>
  }> => {
    const res = await http.get('/providers')
    const payload = res.data
    const list = providerListFromPayload(payload)
    const result: ProviderOption[] = []
    for (const p of list) {
      const models: string[] = []
      const modelNames: Record<string, string> = {}
      const modelCaps: Record<string, string[]> = {}
      let modelsError = ''
      try {
        const mRes = await http.get(`/providers/${p.id}/models`)
        const parsed = modelListFromPayload(mRes.data)
        modelsError = parsed.error
        for (const m of parsed.models) {
          models.push(m.id)
          modelNames[m.id] = m.name ?? m.id
          const caps = normalizeCaps(m.capabilities)
          if (caps.length > 0) modelCaps[m.id] = caps
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
        modelCaps,
        modelsError,
        defaultModels: p.default_models ?? {},
      })
    }
    // 兼容两种结构：平铺（payload.default_provider_for_*）或嵌套（payload.data.default_provider_for_*）
    const payloadRecord = isRecord(payload) ? payload : {}
    const nestedRecord = isRecord(payloadRecord.data) ? payloadRecord.data : {}
    const dpf = (role: string) => {
      const key = `default_provider_for_${role}`
      const value = payloadRecord[key] ?? nestedRecord[key]
      return typeof value === 'string' ? value : ''
    }
    return {
      providers: result,
      defaultProviderFor: {
        chat: dpf('chat'),
        vision: dpf('vision'),
        embedding: dpf('embedding'),
        rerank: dpf('rerank'),
      },
    }
  }, [])

  // 把解析结果写入本地状态
  const applyProvidersData = useCallback((data: {
    providers: ProviderOption[]
    defaultProviderFor: Record<string, string>
  }) => {
    setProviders(data.providers)
    setDefaultProviderFor(data.defaultProviderFor)
  }, [])

  // 阶段 D：初始加载 / 刷新。读回失败时静默（页面保持可用），不阻断渲染。
  const loadProviders = useCallback(async () => {
    try {
      applyProvidersData(await fetchProvidersData())
    } catch { /* 静默 */ }
  }, [applyProvidersData, fetchProvidersData])

  // 合并 defaultProviderFor（后端权威）+ provider.defaultModels + configStore fallback
  const defaults: Record<string, ModelChoice> = useMemo(() => {
    const roleKeys = ['chat', 'vision', 'embedding', 'rerank'] as const
    const merged: Record<string, ModelChoice> = {}

    for (const role of roleKeys) {
      // 1) 后端返回的 default_provider_for_<role> 是全局默认 provider id
      const defaultPid = defaultProviderFor[role]
      if (defaultPid) {
        // 从该 provider 的 defaultModels 里找对应 role 的 model
        const p = providers.find((rp) => rp.id === defaultPid)
        if (p) {
          merged[role] = { providerId: defaultPid, modelId: p.defaultModels?.[role] ?? '' }
          continue
        }
      }
      // 2) 遍历 providers 的 defaultModels 找第一个有该 role 的
      for (const p of providers) {
        const dm = p.defaultModels ?? {}
        if (dm[role]) {
          merged[role] = { providerId: p.id, modelId: dm[role] }
          break
        }
      }
      if (merged[role]) continue

      // 3) configStore fallback
      const fallbackByRole: Record<typeof role, ModelChoice> = {
        chat: {
          providerId: configStore.textProviderId,
          modelId: configStore.textModelId,
        },
        vision: {
          providerId: configStore.visionProviderId,
          modelId: configStore.visionModelId,
        },
        embedding: {
          providerId: configStore.embeddingProviderId,
          modelId: configStore.embeddingModelId,
        },
        rerank: {
          providerId: configStore.rerankProviderId,
          modelId: configStore.rerankModelId,
        },
      }
      merged[role] = fallbackByRole[role]
    }
    return merged
  }, [providers, defaultProviderFor, configStore])

  useEffect(() => {
    loadProviders().finally(() => setLoading(false))
  }, [loadProviders])

  const handleSaveDefault = async (
    role: 'chat' | 'vision' | 'embedding' | 'rerank',
    providerId: string,
    modelId: string,
  ) => {
    // If clearing, we need to know the current provider so we can call PUT
    // on it with an empty role value to clear the default_models entry.
    const effectiveProviderId = providerId || defaults[role]?.providerId
    if (!effectiveProviderId) {
      toast.error(t('providerDefaults.noProvider'))
      return
    }
    try {
      await http.put(`/providers/${effectiveProviderId}`, {
        default_models: { [role]: modelId || '' },
      })
      // 阶段 D + P1：PUT 成功后必须 GET 读回并核对目标值，读回失败或值不一致
      // 都不能提示成功。fetchProvidersData 读回失败会抛错，直接进入 catch。
      const data = await fetchProvidersData()
      const readBack = data.providers.find((p) => p.id === effectiveProviderId)?.defaultModels?.[role] ?? ''
      if (readBack !== (modelId || '')) {
        applyProvidersData(data)
        toast.error(t('providerDefaults.saveMismatch', { readBack: readBack || t('providerDefaults.unset'), target: modelId || t('providerDefaults.unset') }))
        return
      }
      // 读回一致：以后端权威数据刷新界面
      applyProvidersData(data)
      // 同步更新 configStore（不让 localStorage 覆盖后端权威读回）
      const storeKey = role === 'chat' ? 'text' : role
      const providerKey = `${storeKey}ProviderId` as keyof typeof configStore
      const modelKey = `${storeKey}ModelId` as keyof typeof configStore
      configStore.setConfig({ [providerKey]: modelId ? providerId : '', [modelKey]: modelId || '' })
      toast.success(
        modelId
          ? t('providerDefaults.setDefault', { role: ROLE_LABEL_KEY[role], model: modelId })
          : t('providerDefaults.clearedDefault', { role: ROLE_LABEL_KEY[role] }),
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('providerDefaults.saveFailed')
      toast.error(t('providerDefaults.saveFailedMsg', { msg }))
    }
  }

  if (loading) {
    return (
      <div className="space-y-3 py-4" role="status" aria-label={t('providerDefaults.loading')}>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
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
      {(Object.keys(ROLE_LABEL_KEY) as Array<'chat' | 'vision' | 'embedding' | 'rerank'>).map((role) => {
        const current = defaults[role]
        // 新建的 OpenAI 兼容 provider 初始只声明 chat；模型角色由用户在
        // 此处选择后再持久化为 capability。因此不能用旧 capability 把它
        // 从候选列表排除，否则视觉/嵌入/重排模型永远无从配置。
        const eligibleProviders = providers.filter((p) => p.enabled)
        const currentProviderName = current.providerId
          ? providers.find((p) => p.id === current.providerId)?.name ?? current.providerId
          : ''

        return (
          <ModelRolePicker
            key={role}
            role={role}
            label={t(ROLE_LABEL_KEY[role])}
            description={t(ROLE_DESC_KEY[role])}
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

const ROLE_LABEL_KEY: Record<string, string> = {
  chat: 'providerDefaults.chat',
  vision: 'providerDefaults.vision',
  embedding: 'providerDefaults.embedding',
  rerank: 'providerDefaults.rerank',
}

const ROLE_DESC_KEY: Record<string, string> = {
  chat: 'providerDefaults.chatDesc',
  vision: 'providerDefaults.visionDesc',
  embedding: 'providerDefaults.embeddingDesc',
  rerank: 'providerDefaults.rerankDesc',
}

// ── 能力感知（第 2 批）────────────────────────────────────
// 只用后端显式返回的 capabilities 判断用途支持度：
// - 模型级 capabilities 由后端透传上游（token 空间不保证是 role 名）；
// - 不允许凭模型名猜能力；token 不可识别时保守判为「未知」。

type RoleSupport = 'supported' | 'unsupported' | 'unknown'

/** role 到其等价能力 token 的映射（保守：不纳入 text/image 这类歧义 token，
 * 例如 embedding 模型的上游 supported_inputs 也常是 ["text"]，误映射会把用途判错） */
const ROLE_CAP_ALIASES: Record<string, string[]> = {
  chat: ['chat'],
  vision: ['vision'],
  embedding: ['embedding', 'embeddings'],
  rerank: ['rerank', 'reranker'],
}

const KNOWN_CAP_TOKENS = new Set(Object.values(ROLE_CAP_ALIASES).flat())

function normalizeCaps(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * 依据模型级显式能力判断对当前用途的支持度（三态）：
 * - 无 capabilities → unknown（能力待确认）
 * - 含当前 role 等价 token → supported
 * - 含可识别 role token 但不含当前 role → unsupported（显式不支持）
 * - token 全部不可识别 → unknown（保守，不误报不支持）
 */
function modelRoleSupport(caps: string[] | undefined, role: string): RoleSupport {
  if (!caps || caps.length === 0) return 'unknown'
  const wanted = new Set(ROLE_CAP_ALIASES[role] ?? [role])
  if (caps.some((c) => wanted.has(c))) return 'supported'
  if (caps.some((c) => KNOWN_CAP_TOKENS.has(c))) return 'unsupported'
  return 'unknown'
}

function SupportBadge({ support }: { support: RoleSupport }) {
  if (support === 'supported') {
    return (
      <span className="rounded-sm bg-violet-100 px-1 py-px text-[10px] text-violet-700">
        推荐：已验证支持当前用途
      </span>
    )
  }
  if (support === 'unsupported') {
    return (
      <span className="rounded-sm bg-amber-100 px-1 py-px text-[10px] text-amber-700">
        未声明当前用途
      </span>
    )
  }
  return (
    <span className="rounded-sm bg-muted px-1 py-px text-[10px] text-muted-foreground">
      能力待确认
    </span>
  )
}

function ModelRolePicker({
  role,
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
  const { t } = useTranslation('settings')
  const [selectedProviderId, setSelectedProviderId] = useState(currentProviderId)
  const [selectedModelId, setSelectedModelId] = useState(currentModelId)
  const [open, setOpen] = useState(false)
  const [modelSearch, setModelSearch] = useState('')
  const [providerSearch, setProviderSearch] = useState('')
  const [supportFilter, setSupportFilter] = useState<'all' | 'supported' | 'unverified'>('all')

  const popoverRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // 统一弹层关闭规则：点外部 / Escape 关闭，Escape 后焦点返回触发按钮。
  useDismissibleLayer({
    containerRef: popoverRef,
    triggerRef,
    open,
    onClose: () => setOpen(false),
  })

  // 当外部 defaults 变化时同步
  useEffect(() => {
    setSelectedProviderId(currentProviderId)
    setSelectedModelId(currentModelId)
  }, [currentProviderId, currentModelId])

  const activeProvider = providers.find((p) => p.id === selectedProviderId)
  const models = activeProvider?.models ?? []
  const filteredModels = modelSearch.trim()
    ? models.filter((mId) => {
        const mName = activeProvider?.modelNames?.[mId] ?? mId
        const q = modelSearch.trim().toLowerCase()
        return mId.toLowerCase().includes(q) || mName.toLowerCase().includes(q)
      })
    : models

  // 按当前用途的显式能力分区：推荐区（supported）与次级区（unknown / unsupported）。
  // 显式不支持的模型不做推荐，但保留在候选中——用户在此选择后后端才会
  // 把该用途持久化为 capability，提前排除会让新用途永远无从配置。
  const entries = filteredModels.map((mId) => ({
    mId,
    support: modelRoleSupport(activeProvider?.modelCaps[mId], role),
  }))
  const recommended = entries.filter((e) => e.support === 'supported')
  const others = entries.filter((e) => e.support !== 'supported')
  const visibleRecommended = supportFilter === 'unverified' ? [] : recommended
  const visibleOthers = supportFilter === 'supported' ? [] : others
  const nothingVisible = visibleRecommended.length === 0 && visibleOthers.length === 0

  // 供应商搜索：过滤下拉项；已选中的供应商始终保留，避免被搜索词滤掉。
  const providerQuery = providerSearch.trim().toLowerCase()
  const providerOptions = (() => {
    if (!providerQuery) return providers
    const filtered = providers.filter(
      (p) =>
        p.id.toLowerCase().includes(providerQuery) ||
        p.name.toLowerCase().includes(providerQuery) ||
        p.kind.toLowerCase().includes(providerQuery),
    )
    if (selectedProviderId && !filtered.some((p) => p.id === selectedProviderId)) {
      const selected = providers.find((p) => p.id === selectedProviderId)
      return selected ? [...filtered, selected] : filtered
    }
    return filtered
  })()

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
    : t('providerDefaults.unsetHint')

  const renderModelRow = (mId: string, support: RoleSupport) => {
    const mName = activeProvider?.modelNames?.[mId] ?? mId
    const caps = activeProvider?.modelCaps[mId]
    const isSel = mId === selectedModelId
    return (
      <button
        key={mId}
        type="button"
        onClick={() => setSelectedModelId(mId)}
        className={cn(
          'flex w-full items-start gap-2 rounded px-2 py-1 text-left text-xs',
          isSel ? 'bg-violet-50 text-violet-700' : 'hover:bg-muted/60',
        )}
      >
        <span
          className={cn(
            'mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-sm border',
            isSel ? 'border-violet-400 bg-violet-200' : 'border-border',
          )}
        >
          {isSel ? <Check size={8} /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1">
            <span className="truncate font-mono text-[11px]">{mId}</span>
            {mName !== mId && (
              <span className="truncate text-[10px] text-muted-foreground">{mName}</span>
            )}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1">
            <SupportBadge support={support} />
            {caps && caps.length > 0 && (
              <span className="text-[10px] text-muted-foreground">{caps.join(' · ')}</span>
            )}
          </span>
        </span>
      </button>
    )
  }

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
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="dialog"
          className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-muted/60"
        >
          {currentModelId ? t('providerDefaults.change') : t('providerDefaults.set')}
          <ChevronDown size={12} />
        </button>
        {open && (
          <div
            ref={popoverRef}
            role="dialog"
            aria-label={t('providerDefaults.selectDefault', { label })}
            className="absolute right-0 top-full z-50 mt-1 w-72 rounded-md border border-border bg-card shadow-lg"
          >
            <div className="border-b border-border px-3 py-2">
              <span className="text-xs font-medium text-muted-foreground">{t('providerDefaults.selectDefault', { label })}</span>
            </div>
            <div className="max-h-72 overflow-y-auto p-2 space-y-2">
              {/* 供应商搜索 */}
              <div className="flex items-center gap-1.5 rounded border border-border px-2 py-1">
                <Search size={11} className="text-muted-foreground shrink-0" />
                <input
                  placeholder={t('providerDefaults.searchProvider')}
                  value={providerSearch}
                  onChange={(e) => setProviderSearch(e.target.value)}
                  className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                />
              </div>
              {/* 供应商选择 */}
              <div>
                <div className="mb-1 text-[10px] text-muted-foreground uppercase">{t('providerDefaults.provider')}</div>
                <select
                  value={selectedProviderId}
                  onChange={(e) => {
                    setSelectedProviderId(e.target.value)
                    setSelectedModelId('')
                    setModelSearch('')
                    setSupportFilter('all')
                  }}
                  className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
                >
                  <option value="">{t('providerDefaults.selectProvider')}</option>
                  {providerOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.kind})
                    </option>
                  ))}
                </select>
                {providerQuery && providerOptions.length === 0 && (
                  <div className="mt-1 text-xs text-muted-foreground">{t('providerDefaults.noMatchProvider')}</div>
                )}
              </div>
              {/* 模型搜索 */}
              {selectedProviderId && models.length > 0 && (
                <div className="flex items-center gap-1.5 rounded border border-border px-2 py-1">
                  <Search size={11} className="text-muted-foreground shrink-0" />
                  <input
                    placeholder={t('providerDefaults.searchModel')}
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                  />
                </div>
              )}
              {/* 用途能力筛选 */}
              {selectedProviderId && models.length > 0 && (
                <div className="flex flex-wrap gap-1" role="group" aria-label={t('providerDefaults.capabilityFilter')}>
                  {(
                    [
                      ['all', t('providerDefaults.all')],
                      ['supported', t('providerDefaults.supportsCurrent')],
                      ['unverified', t('providerDefaults.unverified')],
                    ] as const
                  ).map(([value, text]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSupportFilter(value)}
                      aria-pressed={supportFilter === value}
                      className={cn(
                        'rounded border px-1.5 py-0.5 text-[10px]',
                        supportFilter === value
                          ? 'border-violet-400 bg-violet-50 text-violet-700'
                          : 'border-border text-muted-foreground hover:bg-muted/60',
                      )}
                    >
                      {text}
                    </button>
                  ))}
                </div>
              )}
              {/* 模型列表：推荐区 + 次级区 */}
              {selectedProviderId && models.length > 0 && visibleRecommended.length > 0 && (
                <div>
                  <div className="mb-1 text-[10px] text-muted-foreground uppercase">{t('providerDefaults.recommended')}</div>
                  <div className="space-y-1">
                    {visibleRecommended.map((e) => renderModelRow(e.mId, e.support))}
                  </div>
                </div>
              )}
              {selectedProviderId && models.length > 0 && visibleOthers.length > 0 && (
                <div>
                  <div className="mb-1 text-[10px] text-muted-foreground uppercase">{t('providerDefaults.otherModels')}</div>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {visibleOthers.map((e) => renderModelRow(e.mId, e.support))}
                  </div>
                </div>
              )}
              {selectedProviderId && models.length === 0 && activeProvider?.modelsError && (
                <div className="text-xs text-destructive py-1">
                  {t('providerDefaults.modelsLoadFailed', { error: activeProvider.modelsError })}
                </div>
              )}
              {selectedProviderId && models.length === 0 && !activeProvider?.modelsError && (
                <div className="text-xs text-muted-foreground py-1">{t('providerDefaults.noModels')}</div>
              )}
              {selectedProviderId && models.length > 0 && nothingVisible && (
                <div className="text-xs text-muted-foreground py-1">{t('providerDefaults.noMatchModel')}</div>
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
