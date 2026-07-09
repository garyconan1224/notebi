import { create } from 'zustand'
import type { VideoTemplateItem, TemplateCategory } from '@/services/templates'
import { fetchTemplates } from '@/services/templates'

interface CategoryCache {
  templates: VideoTemplateItem[]
  loaded: boolean
}

interface TemplateStoreState {
  /** 按 category 分缓存 */
  caches: Record<TemplateCategory, CategoryCache>
  loading: boolean
  error: string | null
  /** 按 category 拉取（有缓存跳过） */
  fetch: (category: TemplateCategory) => Promise<void>
  /** 标记某个 category 缓存失效 */
  invalidate: (category?: TemplateCategory) => void
  /** 返回某个 category 的模板名列表 */
  getOptions: (category: TemplateCategory) => string[]
}

const emptyCache = (): CategoryCache => ({ templates: [], loaded: false })
const emptyCaches = (): Record<TemplateCategory, CategoryCache> => ({
  video: emptyCache(),
  text: emptyCache(),
  style_video_with_frames: emptyCache(),
  style_video_text_only: emptyCache(),
  style_audio: emptyCache(),
  style_image_text: emptyCache(),
  style_replica: emptyCache(),
  style_text: emptyCache(),
})

export const useTemplateStore = create<TemplateStoreState>((set, get) => ({
  caches: emptyCaches(),
  loading: false,
  error: null,

  fetch: async (category: TemplateCategory) => {
    if (get().caches[category].loaded) return
    set({ loading: true, error: null })
    try {
      const data = await fetchTemplates(category)
      set((s) => ({
        caches: { ...s.caches, [category]: { templates: data, loaded: true } },
        loading: false,
      }))
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '加载模板失败', loading: false })
    }
  },

  invalidate: (category?: TemplateCategory) => {
    if (category) {
      set((s) => ({ caches: { ...s.caches, [category]: emptyCache() } }))
    } else {
      set({ caches: emptyCaches() })
    }
  },

  getOptions: (category: TemplateCategory) => {
    return ['auto', ...get().caches[category].templates.map((t) => t.name)]
  },
}))
