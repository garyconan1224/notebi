/**
 * R21.P2.v2: 模型选择记忆 —— 用 localStorage 记下用户上一次在「添加素材」选的
 * 文本模型 / 图片模型（VLM），下次打开 AddMaterialModal 时默认回填。
 *
 * 优先级：initialStaged > localStorage > 空串
 */

const KEYS = {
  textProvider: 'nibi:preflight:textProvider',
  textModel: 'nibi:preflight:textModel',
  visionProvider: 'nibi:preflight:visionProvider',
  visionModel: 'nibi:preflight:visionModel',
} as const

export interface ModelMemory {
  textProviderId: string
  textModelId: string
  visionProviderId: string
  visionModelId: string
}

function safeGet(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    // 隐私模式 / SSR 等场景下 localStorage 不可用，静默兜底
    return ''
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 隐私模式 / 配额满 等场景，静默兜底
  }
}

export function loadModelMemory(): ModelMemory {
  return {
    textProviderId: safeGet(KEYS.textProvider),
    textModelId: safeGet(KEYS.textModel),
    visionProviderId: safeGet(KEYS.visionProvider),
    visionModelId: safeGet(KEYS.visionModel),
  }
}

export function saveModelMemory(s: ModelMemory): void {
  safeSet(KEYS.textProvider, s.textProviderId)
  safeSet(KEYS.textModel, s.textModelId)
  safeSet(KEYS.visionProvider, s.visionProviderId)
  safeSet(KEYS.visionModel, s.visionModelId)
}

/** R21.P2.v3: 部分更新 —— 文本模型选定即存 */
export function saveTextModel(providerId: string, modelId: string): void {
  safeSet(KEYS.textProvider, providerId)
  safeSet(KEYS.textModel, modelId)
}

/** R21.P2.v3: 部分更新 —— 图片模型选定即存 */
export function saveVisionModel(providerId: string, modelId: string): void {
  safeSet(KEYS.visionProvider, providerId)
  safeSet(KEYS.visionModel, modelId)
}
