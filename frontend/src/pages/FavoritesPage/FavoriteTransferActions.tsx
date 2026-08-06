import { Download, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  exportFavoriteMetadata,
  importFavoriteMetadata,
} from '@/services/workspaces'

interface Props {
  onImported: (message: string | null) => void
}

export function FavoriteTransferActions({ onImported }: Props) {
  const { t } = useTranslation('pages')
  const exportFavorites = async () => {
    const payload = await exportFavoriteMetadata()
    const url = URL.createObjectURL(new Blob(
      [JSON.stringify(payload, null, 2)],
      { type: 'application/json' },
    ))
    const link = document.createElement('a')
    link.href = url
    link.download = 'notebi-favorites.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  const importFavorites = async (file?: File) => {
    if (!file) return
    try {
      const payload = JSON.parse(await file.text()) as Record<string, unknown>
      const result = await importFavoriteMetadata(payload)
      onImported(result.skipped
        ? t('favorites.transferSkipped', { count: result.skipped })
        : null)
    } catch (error) {
      onImported(error instanceof Error ? error.message : t('favorites.transferFailed'))
    }
  }

  return (
    <>
      <button className="btn btn-sm" onClick={() => void exportFavorites()}>
        <Download size={13} />导出
      </button>
      <label className="btn btn-sm">
        <Upload size={13} />导入
        <input type="file" accept="application/json" hidden
          onChange={event => void importFavorites(event.target.files?.[0])} />
      </label>
    </>
  )
}
