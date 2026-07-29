import { describe, expect, it } from 'vitest'
import {
  APP_NAME,
  productStorageKey,
} from '@/config/product'

describe('product config', () => {
  it('uses the fixed NoteBi identity without product feature flags', () => {
    expect(APP_NAME).toBe('NoteBi')
  })

  it('prefixes local storage keys with the NoteBi prefix', () => {
    expect(productStorageKey('sidebar-collapsed')).toBe('notebi-sidebar-collapsed')
  })
})
