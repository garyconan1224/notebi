import { describe, expect, it } from 'vitest'
import type { AxiosAdapter } from 'axios'

import { http } from '@/services/client'

function adapter(data: unknown): AxiosAdapter {
  return async (config) => ({
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  })
}

describe('HTTP client response contract', () => {
  it('accepts ordinary API responses without a code envelope', async () => {
    const response = await http.get('/health', { adapter: adapter({ status: 'ok' }) })
    expect(response.data).toEqual({ status: 'ok' })
  })

  it('accepts an explicit code=0 envelope', async () => {
    const response = await http.get('/ok', { adapter: adapter({ code: 0, data: { ok: true } }) })
    expect(response.data.data.ok).toBe(true)
  })

  it('rejects a nonzero business code with the server message', async () => {
    await expect(
      http.get('/failed', { adapter: adapter({ code: 4001, msg: '配置无效' }) }),
    ).rejects.toThrow('配置无效')
  })
})
