import { describe, expect, it } from 'vitest'
import { getProductConfig, resolveProductMode } from '@/config/product'

describe('product config', () => {
  it('defaults empty and unknown modes to nibi', () => {
    expect(resolveProductMode('')).toBe('nibi')
    expect(resolveProductMode(undefined)).toBe('nibi')
    expect(resolveProductMode('unknown')).toBe('nibi')
  })

  it('keeps the legacy nibi mode internally while presenting NoteBi', () => {
    const config = getProductConfig('nibi')

    expect(config.name).toBe('NoteBi')
    expect(config.storagePrefix).toBe('nibi')
    expect(config.allowedKinds).toEqual(['note', 'replica'])
    expect(config.defaultKind).toBe('note')
    expect(config.showKnowledge).toBe(true)
    expect(config.showReplica).toBe(true)
    expect(config.showPromptFormat).toBe(true)
  })

  it('limits notebi to note-facing features', () => {
    const config = getProductConfig('notebi')

    expect(config.name).toBe('NoteBi')
    expect(config.allowedKinds).toEqual(['note'])
    expect(config.defaultKind).toBe('note')
    expect(config.showKnowledge).toBe(true)
    expect(config.showReplica).toBe(false)
    expect(config.showStoryboard).toBe(false)
    expect(config.showDirector).toBe(false)
    expect(config.showPromptFormat).toBe(false)
    expect(config.allowReplicaCleanup).toBe(true)
  })

  it('limits replicabi to replica-facing features', () => {
    const config = getProductConfig('replicabi')

    expect(config.name).toBe('ReplicaBi')
    expect(config.allowedKinds).toEqual(['replica'])
    expect(config.defaultKind).toBe('replica')
    expect(config.showKnowledge).toBe(false)
    expect(config.showReplica).toBe(true)
    expect(config.showStoryboard).toBe(true)
    expect(config.showDirector).toBe(true)
    expect(config.showPromptFormat).toBe(true)
    expect(config.allowReplicaCleanup).toBe(false)
  })
})
