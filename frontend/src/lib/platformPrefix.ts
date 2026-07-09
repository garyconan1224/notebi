/**
 * R13.3 根据 URL 识别平台并返回小写前缀名。
 * 用于 ProcessingPage 等处的标题展示 `bilibili · 视频名`。
 */
export function platformPrefixFromUrl(url: string): string {
  if (!url) return ''
  let hostname = ''
  try { hostname = new URL(url).hostname.toLowerCase() } catch { return '' }

  const map: Array<[RegExp, string]> = [
    [/\bbilibili\.com$/, 'bilibili'],
    [/\b(youtube\.com|youtu\.be)$/, 'youtube'],
    [/\b(xiaohongshu\.com|xhslink\.com)$/, 'xiaohongshu'],
    [/\b(douyin\.com|iesdouyin\.com)$/, 'douyin'],
    [/\bkuaishou\.com$/, 'kuaishou'],
    [/\bweixin\.qq\.com$/, 'weixin'],
    [/\b(x\.com|twitter\.com)$/, 'twitter'],
  ]
  for (const [re, name] of map) {
    if (re.test(hostname)) return name
  }
  const parts = hostname.replace(/^www\./, '').split('.')
  return parts.length >= 2 ? parts[parts.length - 2] : hostname
}
