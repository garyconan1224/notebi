import { APP_NAME } from '@/config/product'

export function buildDocumentTitle(title?: string): string {
  const normalized = title?.trim()
  return normalized ? `${normalized} · ${APP_NAME}` : APP_NAME
}
