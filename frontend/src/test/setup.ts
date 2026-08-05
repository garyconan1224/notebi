import '@/locales/i18n'
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

// jsdom 未实现 scrollIntoView：字幕高亮行自动滚动等行为依赖它，
// 测试里只需确认调用存在，不需要真实滚动。
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn()
}
