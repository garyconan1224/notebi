/**
 * 未解析截帧占位符兜底：历史数据里可能残留 *FRAME-[mm:ss]（后端解析失败或旧版本
 * 主笔记），渲染前清掉，避免出现裂图；保留真实图片 URL。
 */

const UNRESOLVED_FRAME_RE = /!\[[^\]]*\]\(\*FRAME-\[\d{1,2}:\d{2}(?::\d{2})?\]\)/g

export function stripUnresolvedFramePlaceholders(markdown: string): string {
  if (!markdown) return markdown
  return markdown
    .replace(UNRESOLVED_FRAME_RE, '')
    .replace(/\n{4,}/g, '\n\n\n')
}
