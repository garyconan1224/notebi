/**
 * 链接封面代理工具：远程图片统一走后端 /api/image_proxy（带 Referer，规避防盗链），
 * 站内 /static 等路径直接使用。
 */

export const IMAGE_PROXY_PATH = '/api/image_proxy'

export function previewSrcForProxy(
  url?: string | null,
  apiBaseUrl = IMAGE_PROXY_PATH,
): string {
  const value = (url ?? '').trim()
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) {
    return `${apiBaseUrl}?url=${encodeURIComponent(value)}`
  }
  if (value.startsWith('//')) {
    return `${apiBaseUrl}?url=${encodeURIComponent(`https:${value}`)}`
  }
  // 站内 /static、根路径相对路径直接使用（本地封面等），其余非法值返回空
  if (value.startsWith('/') || value.startsWith('./') || value.startsWith('../')) {
    return value
  }
  return ''
}

/** 从代理 URL 还原原始远程地址；非代理地址原样返回。 */
export function decodeProxySrc(src: string): string {
  const marker = `${IMAGE_PROXY_PATH}?`
  if (!src.startsWith(marker)) return src
  try {
    const query = src.slice(marker.length)
    const target = new URLSearchParams(query).get('url')
    return target ? decodeURIComponent(target) : src
  } catch {
    return src
  }
}
