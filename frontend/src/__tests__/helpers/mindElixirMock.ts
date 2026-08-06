import { vi } from 'vitest'

/**
 * mind-elixir 测试替身：测试不跑真实布局引擎（依赖真实 DOM/SVG 测量），
 * 只验证包装组件的数据转换、事件接线与面板集成。
 */

export interface FakeMindElixirInstance {
  options: Record<string, unknown>
  init: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  changeTheme: ReturnType<typeof vi.fn>
  scaleFit: ReturnType<typeof vi.fn>
  getData: ReturnType<typeof vi.fn>
  listeners: Record<string, Array<(op: { name: string }) => void>>
  nodes: HTMLDivElement
  emit: (name: string, op: { name: string }) => void
}

export const mindElixirInstances: FakeMindElixirInstance[] = []

export function resetMindElixirMock() {
  mindElixirInstances.length = 0
}

export function lastMindElixir(): FakeMindElixirInstance {
  return mindElixirInstances[mindElixirInstances.length - 1]
}

class FakeMindElixir {
  static SIDE = 2
  static LEFT = 0
  static RIGHT = 1
  static DOWN = 3

  options: Record<string, unknown>
  init = vi.fn()
  destroy = vi.fn()
  changeTheme = vi.fn()
  scaleFit = vi.fn()
  getData = vi.fn(() => ({ nodeData: { id: 'n0', topic: '根', children: [] } }))
  listeners: Record<string, Array<(op: { name: string }) => void>> = {}
  nodes = document.createElement('div')
  bus = {
    addListener: (name: string, cb: (op: { name: string }) => void) => {
      ;(this.listeners[name] ??= []).push(cb)
    },
    removeListener: (name: string, cb: (op: { name: string }) => void) => {
      this.listeners[name] = (this.listeners[name] ?? []).filter((fn) => fn !== cb)
    },
  }

  constructor(options: Record<string, unknown>) {
    this.options = options
    mindElixirInstances.push(this as unknown as FakeMindElixirInstance)
  }

  emit(name: string, op: { name: string }) {
    ;(this.listeners[name] ?? []).forEach((cb) => cb(op))
  }
}

export const mindElixirModuleMock = { default: FakeMindElixir }

export const mindElixirI18nMock = {
  zh_CN: { addChild: '添加子节点', addSibling: '添加同级节点', removeNode: '删除节点' },
}

export const snapdomModuleMock = {
  snapdom: vi.fn(async () => ({
    toBlob: vi.fn(async () => new Blob(['fake'], { type: 'image/png' })),
    download: vi.fn(async () => undefined),
  })),
}
