import { describe, expect, it } from 'vitest'
import {
  isFeatureEnabled,
  isWorkspaceKindAllowed,
  productConfig,
  productStorageKey,
} from '@/config/product'

describe('product config', () => {
  it('is fixed to NoteBi with note-only workspaces', () => {
    expect(productConfig.name).toBe('NoteBi')
    expect(productConfig.allowedKinds).toEqual(['note'])
    expect(productConfig.defaultKind).toBe('note')
    expect(productConfig.storagePrefix).toBe('notebi')
  })

  it('only exposes NoteBi note-facing features', () => {
    expect(productConfig.showKnowledge).toBe(true)
    expect(productConfig.showReplica).toBe(false)
    expect(productConfig.showStoryboard).toBe(false)
    expect(productConfig.showDirector).toBe(false)
    expect(productConfig.showPromptFormat).toBe(false)
  })

  it('only allows the note workspace kind', () => {
    expect(isWorkspaceKindAllowed('note')).toBe(true)
    expect(isWorkspaceKindAllowed('replica')).toBe(false)
    expect(isWorkspaceKindAllowed('')).toBe(false)
    expect(isWorkspaceKindAllowed(undefined)).toBe(false)
  })

  it('reports feature flags from the fixed NoteBi config', () => {
    expect(isFeatureEnabled('showKnowledge')).toBe(true)
    expect(isFeatureEnabled('showReplica')).toBe(false)
    expect(isFeatureEnabled('showStoryboard')).toBe(false)
    expect(isFeatureEnabled('showDirector')).toBe(false)
    expect(isFeatureEnabled('showPromptFormat')).toBe(false)
  })

  it('prefixes local storage keys with the NoteBi prefix', () => {
    expect(productStorageKey('sidebar-collapsed')).toBe('notebi-sidebar-collapsed')
  })
})
