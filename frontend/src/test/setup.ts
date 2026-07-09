import { vi } from 'vitest'

const createStorage = (): Storage => {
  const items = new Map<string, string>()

  return {
    get length() {
      return items.size
    },
    clear: vi.fn(() => items.clear()),
    getItem: vi.fn((key: string) => items.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(items.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      items.delete(key)
    }),
    setItem: vi.fn((key: string, value: string) => {
      items.set(key, value)
    }),
  }
}

const localStorageMock = createStorage()

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: localStorageMock,
})

Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: localStorageMock,
})
