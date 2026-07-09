export type ProductMode = 'nibi' | 'notebi' | 'replicabi'
export type WorkspaceKind = 'note' | 'replica'

export interface ProductConfig {
  mode: ProductMode
  name: string
  allowedKinds: WorkspaceKind[]
  defaultKind: WorkspaceKind
  storagePrefix: string
  showKnowledge: boolean
  showReplica: boolean
  showStoryboard: boolean
  showDirector: boolean
  showPromptFormat: boolean
  allowReplicaCleanup: boolean
}

const PRODUCT_CONFIGS: Record<ProductMode, ProductConfig> = {
  nibi: {
    mode: 'nibi',
    name: 'Nibi',
    allowedKinds: ['note', 'replica'],
    defaultKind: 'note',
    storagePrefix: 'nibi',
    showKnowledge: true,
    showReplica: true,
    showStoryboard: true,
    showDirector: true,
    showPromptFormat: true,
    allowReplicaCleanup: false,
  },
  notebi: {
    mode: 'notebi',
    name: 'NoteBi',
    allowedKinds: ['note'],
    defaultKind: 'note',
    storagePrefix: 'notebi',
    showKnowledge: true,
    showReplica: false,
    showStoryboard: false,
    showDirector: false,
    showPromptFormat: false,
    allowReplicaCleanup: true,
  },
  replicabi: {
    mode: 'replicabi',
    name: 'ReplicaBi',
    allowedKinds: ['replica'],
    defaultKind: 'replica',
    storagePrefix: 'replicabi',
    showKnowledge: false,
    showReplica: true,
    showStoryboard: true,
    showDirector: true,
    showPromptFormat: true,
    allowReplicaCleanup: false,
  },
}

export function resolveProductMode(rawMode: unknown): ProductMode {
  const mode = String(rawMode ?? '').trim().toLowerCase()
  if (mode === 'notebi' || mode === 'replicabi') return mode
  return 'nibi'
}

export function getProductConfig(rawMode: unknown): ProductConfig {
  return PRODUCT_CONFIGS[resolveProductMode(rawMode)]
}

export const productConfig = getProductConfig(import.meta.env.VITE_PRODUCT_MODE)

export function isWorkspaceKindAllowed(kind?: string | null): kind is WorkspaceKind {
  return productConfig.allowedKinds.includes((kind || '') as WorkspaceKind)
}

export function isFeatureEnabled(feature: keyof Pick<
  ProductConfig,
  | 'showKnowledge'
  | 'showReplica'
  | 'showStoryboard'
  | 'showDirector'
  | 'showPromptFormat'
  | 'allowReplicaCleanup'
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
