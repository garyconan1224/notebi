// NoteBi 是唯一的本地产品。历史上这里曾通过环境变量在多个产品之间切换功能，
// 复刻 / 分镜 / 提示词生产能力删除后不再需要多产品配置。
// 本模块只保留固定的 NoteBi 常量与本地存储 helper。
//
// 注意：allowedKinds / defaultKind / isWorkspaceKindAllowed / isFeatureEnabled 等
// 仍被部分页面引用，它们会在复刻、分镜、提示词生产能力被逐步删除（后续阶段）后
// 连同各自的消费代码一起移除，不属于长期保留的开关。
export type WorkspaceKind = 'note' | 'replica'

export interface ProductConfig {
  name: string
  allowedKinds: WorkspaceKind[]
  defaultKind: WorkspaceKind
  storagePrefix: string
  showKnowledge: boolean
  showReplica: boolean
  showPromptFormat: boolean
}

export const productConfig: ProductConfig = {
  name: 'NoteBi',
  allowedKinds: ['note'],
  defaultKind: 'note',
  storagePrefix: 'notebi',
  showKnowledge: true,
  showReplica: false,
  showPromptFormat: false,
}

export function isWorkspaceKindAllowed(kind?: string | null): kind is WorkspaceKind {
  return productConfig.allowedKinds.includes((kind || '') as WorkspaceKind)
}

export function isFeatureEnabled(feature: keyof Pick<
  ProductConfig,
  | 'showKnowledge'
  | 'showReplica'
  | 'showPromptFormat'
>): boolean {
  return Boolean(productConfig[feature])
}

export function productStorageKey(key: string): string {
  return `${productConfig.storagePrefix}-${key}`
}

export function getProductStorageItem(key: string, legacyKey?: string): string | null {
  const value = localStorage.getItem(productStorageKey(key))
  if (value != null) return value
  return legacyKey ? localStorage.getItem(legacyKey) : null
}

export function setProductStorageItem(key: string, value: string): void {
  localStorage.setItem(productStorageKey(key), value)
}
