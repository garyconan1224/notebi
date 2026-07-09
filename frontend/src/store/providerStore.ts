import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { http } from '@/services/client'

/** Provider 类型（DESIGN_NOTES_SETTINGS.md §3.2，冻结联合类型） */
export type ProviderKind =
  | 'openai_compatible'
  | 'anthropic'
  | 'google'
  | 'ollama'
  | 'openai'

/** Provider 条目（与后端 GET /providers 响应字段对齐，api_key 脱敏） */
export interface ProviderItem {
  id: string          // 提供商唯一标识（provider_id）
  name: string        // 显示名称
  base_url: string    // 接口地址
  enabled: boolean    // 是否启用
  kind: ProviderKind  // 收敛为联合类型
  has_api_key: boolean // 后端标志：是否已配置 api_key（不下发明文）
  /** 后端 capabilities 元组；Models 页用于过滤（chat/vision/…） */
  capabilities?: string[]
  logo?: string       // 可选 logo URL
}

/** 从后端 /providers/{id}/models 返回的模型条目 */
export interface Model {
  id: string    // 模型唯一 ID（传给后端的 model_name）
  name: string  // 显示名称
  /** R21.P2.v3: 后端返回的模型能力标签（chat/vision/…），可能不存在 */
  capabilities?: string[]
}

/** 新增 provider 的入参（对应后端 ProviderCreateRequest） */
export interface AddProviderInput {
  name: string
  kind: ProviderKind
  api_key?: string
  base_url?: string
}

/** 更新 provider 的入参（对应后端 ProviderUpdateRequest，全部可选） */
export interface UpdateProviderInput {
  api_key?: string
  base_url?: string
  enabled?: boolean
  default_models?: Record<string, string>
}

interface ProviderStoreState {
  /** 提供商列表 */
  providers: ProviderItem[]
  /** 是否正在拉取 providers 中 */
  loading: boolean
  /** 最近一次拉取的错误信息 */
  error: string | null

  /**
   * 各 provider 的模型缓存。
   * key = provider_id，value = 该 provider 下的模型列表
   */
  providerModels: Record<string, Model[]>
  /** 正在拉取模型的 provider_id 集合 */
  modelsLoading: Record<string, boolean>

  /** 操作 */
  setProviders: (providers: ProviderItem[]) => void

  /** 从后端 GET /providers 拉取并更新列表，成功后自动拉取各 enabled provider 的模型 */
  fetchProviders: () => Promise<void>

  /** 拉取单个 provider 的可用模型并写入缓存 */
  fetchProviderModels: (provider_id: string) => Promise<void>

  /** 调用 POST /providers 新增，成功后追加到 providers 数组 */
  addProvider: (data: AddProviderInput) => Promise<ProviderItem>

  /** 调用 PUT /providers/{id} 更新，成功后同步数组对应项 */
  updateProvider: (id: string, data: UpdateProviderInput) => Promise<void>

  /** 调用 DELETE /providers/{id} 删除，成功后从本地数组移除 */
  removeProvider: (id: string) => Promise<void>
}

export const useProviderStore = create<ProviderStoreState>()(
  persist(
    (set, get) => ({
      providers: [],
      loading: false,
      error: null,
      providerModels: {},
      modelsLoading: {},

      setProviders: (providers) => set({ providers }),

      fetchProviders: async () => {
        set({ loading: true, error: null })
        try {
          const res = await http.get('/providers')
          const data: ProviderItem[] = res.data.data ?? res.data
          set({ providers: data, loading: false })
          // 对所有 enabled provider 自动拉取模型列表
          const enabledIds = data.filter(p => p.enabled).map(p => p.id)
          await Promise.all(enabledIds.map(id => get().fetchProviderModels(id)))
        } catch (e) {
          const msg = e instanceof Error ? e.message : '未知错误'
          set({ error: msg, loading: false })
        }
      },

      fetchProviderModels: async (provider_id: string) => {
        // 防止重复请求
        if (get().modelsLoading[provider_id]) return
        set(state => ({
          modelsLoading: { ...state.modelsLoading, [provider_id]: true },
        }))
        try {
          const res = await http.get(`/providers/${provider_id}/models`)
          const payload = res.data.data ?? res.data
          const models: Model[] = Array.isArray(payload.models) ? payload.models : []
          set(state => ({
            providerModels: { ...state.providerModels, [provider_id]: models },
            modelsLoading: { ...state.modelsLoading, [provider_id]: false },
          }))
        } catch {
          // 静默失败：保留空数组，不影响页面渲染
          set(state => ({
            providerModels: { ...state.providerModels, [provider_id]: [] },
            modelsLoading: { ...state.modelsLoading, [provider_id]: false },
          }))
        }
      },

      addProvider: async (data) => {
        const res = await http.post('/providers', data)
        const payload = res.data.data ?? res.data
        const item: ProviderItem = {
          id: payload.id,
          name: payload.name,
          kind: payload.kind,
          base_url: payload.base_url ?? '',
          enabled: payload.enabled ?? true,
          has_api_key: Boolean(payload.has_api_key),
          capabilities: Array.isArray(payload.capabilities) ? payload.capabilities : undefined,
        }
        set(state => ({ providers: [...state.providers, item] }))
        return item
      },

      updateProvider: async (id, data) => {
        // D10 / §3.4：api_key === '' 视为"不修改"，不下发字段
        const payload: UpdateProviderInput = { ...data }
        if (payload.api_key === '') {
          delete payload.api_key
        }
        const res = await http.put(`/providers/${id}`, payload)
        const body = res.data.data ?? res.data
        set(state => ({
          providers: state.providers.map(p =>
            p.id === id
              ? {
                  ...p,
                  name: body.name ?? p.name,
                  kind: body.kind ?? p.kind,
                  base_url: body.base_url ?? p.base_url,
                  enabled: typeof body.enabled === 'boolean' ? body.enabled : p.enabled,
                  has_api_key:
                    typeof body.has_api_key === 'boolean' ? body.has_api_key : p.has_api_key,
                }
              : p,
          ),
        }))
      },

      removeProvider: async (id) => {
        await http.delete(`/providers/${id}`)
        set(state => {
          const nextModels = { ...state.providerModels }
          delete nextModels[id]
          const nextLoading = { ...state.modelsLoading }
          delete nextLoading[id]
          return {
            providers: state.providers.filter(p => p.id !== id),
            providerModels: nextModels,
            modelsLoading: nextLoading,
          }
        })
      },
    }),
    {
      name: 'provider-storage',
      // 只持久化 providers 列表和模型缓存，不持久化 loading/error 状态
      partialize: (state) => ({
        providers: state.providers,
        providerModels: state.providerModels,
      }),
    },
  ),
)

