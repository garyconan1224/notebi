/** 前端 link preview fetcher — 调用后端 GET /link-preview */

import { http } from './client'

export interface LinkPreviewResult {
  title: string | null
  description: string | null
  image_url: string | null
  source: 'bili' | 'og' | 'fallback' | 'pdf' | 'text'
}

export interface LinkPreviewWithContent extends LinkPreviewResult {
  content: string
  word_count: number
  parser?: string
  warning?: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function fetchLinkPreview(url: string): Promise<LinkPreviewResult> {
  // B 站等预览走后端 downloader（同步阻塞调用），添加素材弹框打开时会与 sniff-url /
  // probe-duration 并发，偶发 5xx/超时 → 重试几次（端点本身在非并发时稳定返回）。
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { data } = await http.get<LinkPreviewResult>('/link-preview', { params: { url } })
      // 拿到有效封面/标题即返回；否则再试（可能并发降级返回了空）
      if (data && (data.image_url || data.title)) return data
      lastErr = new Error('empty preview')
    } catch (e) {
      lastErr = e
    }
    if (attempt < 2) await sleep(500 * (attempt + 1))
  }
  void lastErr
  return { title: null, description: null, image_url: null, source: 'fallback' }
}

export async function fetchLinkPreviewWithContent(url: string): Promise<LinkPreviewWithContent> {
  try {
    const { data } = await http.get<LinkPreviewWithContent>('/link-preview', {
      params: { url, include_content: true },
    })
    return data
  } catch {
    return { title: null, description: null, image_url: null, source: 'fallback', content: '', word_count: 0 }
  }
}
