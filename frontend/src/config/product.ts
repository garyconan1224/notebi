/** The application has one fixed product surface. */
export const APP_NAME = 'NoteBi'
const STORAGE_PREFIX = 'notebi'

export function productStorageKey(key: string): string {
  return `${STORAGE_PREFIX}-${key}`
}

export function getProductStorageItem(key: string, legacyKey?: string): string | null {
  const value = localStorage.getItem(productStorageKey(key))
  if (value != null) return value
  return legacyKey ? localStorage.getItem(legacyKey) : null
}

export function setProductStorageItem(key: string, value: string): void {
  localStorage.setItem(productStorageKey(key), value)
}
