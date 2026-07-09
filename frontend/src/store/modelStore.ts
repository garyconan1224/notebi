/**
 * @deprecated modelStore 中的硬编码模型列表已被 providerStore.providerModels 取代。
 * 该文件暂时保留作为 fallback，后续重构时统一清理。
 * 请优先使用 useProviderStore().providerModels[provider_id] 获取动态模型列表。
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** 模型条目 */
export interface ModelItem {
  model_id: string   // 模型唯一标识（即 model_name，传给后端）
  name: string       // 显示名称
  provider_id: string // 归属的 provider id
}

interface ModelStoreState {
  /** 模型列表 */
  models: ModelItem[]
  /** 当前选中的 model_id */
  currentModelId: string | null

  /** 操作 */
  setModels: (models: ModelItem[]) => void
  setCurrentModel: (modelId: string | null) => void
}

/** 3 个硬编码默认模型（可在设置页中覆盖 setModels） */
const DEFAULT_MODELS: ModelItem[] = [
  { model_id: 'gpt-4o-mini',         name: 'GPT-4o Mini',          provider_id: 'openai' },
  { model_id: 'claude-3-5-sonnet',   name: 'Claude 3.5 Sonnet',    provider_id: 'anthropic' },
  { model_id: 'deepseek-chat',       name: 'DeepSeek Chat',         provider_id: 'deepseek' },
]

export const useModelStore = create<ModelStoreState>()(
  persist(
    (set) => ({
      models: DEFAULT_MODELS,
      currentModelId: DEFAULT_MODELS[0].model_id,

      setModels: (models) => set({ models }),
      setCurrentModel: (modelId) => set({ currentModelId: modelId }),
    }),
    { name: 'model-storage' },
  ),
)

