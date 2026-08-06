import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { fetchSettings, patchSettings } from '@/services/settings'

interface ObsidianDraft {
  vault_path: string
  subdir: string
  direct_write: boolean
}

interface ExportSyncDraft {
  notion_parent_page_id: string
  feishu_folder_token: string
}

const DEFAULT_OBSIDIAN: ObsidianDraft = { vault_path: '', subdir: '', direct_write: false }
const DEFAULT_EXPORT_SYNC: ExportSyncDraft = {
  notion_parent_page_id: '',
  feishu_folder_token: '',
}

/**
 * 导出与同步设置页（用户问题 4.2）。
 *
 * 只保存非敏感的目的地默认值：Obsidian vault 路径、Notion 父页面 ID、
 * 飞书文件夹 Token。API Token 一律不保存，仍只在单次导出时输入。
 */
export function ExportSyncSettingsPage() {
  const { t } = useTranslation('settings')
  const [obsidian, setObsidian] = useState<ObsidianDraft>(DEFAULT_OBSIDIAN)
  const [exportSync, setExportSync] = useState<ExportSyncDraft>(DEFAULT_EXPORT_SYNC)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    let active = true
    void fetchSettings()
      .then((settings) => {
        if (!active) return
        if (settings.obsidian) setObsidian(settings.obsidian)
        if (settings.export_sync) setExportSync(settings.export_sync)
      })
      .catch(() => {
        if (active) setStatus(t('exportSync.loadFailed'))
      })
    return () => {
      active = false
    }
  }, [t])

  const save = async () => {
    setSaving(true)
    setStatus('')
    try {
      const saved = await patchSettings({ obsidian, export_sync: exportSync })
      if (saved.obsidian) setObsidian(saved.obsidian)
      if (saved.export_sync) setExportSync(saved.export_sync)
      setStatus(t('exportSync.saved'))
    } catch {
      setStatus(t('exportSync.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="settings-panel" aria-labelledby="export-sync-title">
      <header className="settings-header">
        <div>
          <h2 id="export-sync-title">{t('exportSync.title')}</h2>
          <p className="settings-header-desc">
            {t('exportSync.subtitle')}
          </p>
        </div>
      </header>

      <div className="settings-section">
        <div className="settings-section-title">{t('exportSync.obsidianSection')}</div>
        <div className="settings-card">
          <label className="settings-row">
            <span className="settings-row-label">
              <strong>{t('exportSync.vaultLabel')}</strong>
              <span className="settings-row-hint">{t('exportSync.vaultHint')}</span>
            </span>
            <span className="settings-row-control">
              <input
                className="settings-input"
                aria-label={t('exportSync.vaultAria')}
                value={obsidian.vault_path}
                placeholder={t('exportSync.vaultPlaceholder')}
                onChange={(event) =>
                  setObsidian((current) => ({ ...current, vault_path: event.target.value }))
                }
              />
            </span>
          </label>
          <label className="settings-row">
            <span className="settings-row-label">
              <strong>{t('exportSync.subdirLabel')}</strong>
              <span className="settings-row-hint">{t('exportSync.subdirHint')}</span>
            </span>
            <span className="settings-row-control">
              <input
                className="settings-input"
                aria-label={t('exportSync.subdirAria')}
                value={obsidian.subdir}
                placeholder={t('exportSync.subdirPlaceholder')}
                onChange={(event) =>
                  setObsidian((current) => ({ ...current, subdir: event.target.value }))
                }
              />
            </span>
          </label>
          <div className="settings-row">
            <span className="settings-row-label">
              <strong>{t('exportSync.directWriteLabel')}</strong>
              <span className="settings-row-hint">{t('exportSync.directWriteHint')}</span>
            </span>
            <span className="settings-row-control">
              <label>
                <input
                  type="checkbox"
                  aria-label={t('exportSync.directWriteAria')}
                  checked={obsidian.direct_write}
                  onChange={(event) =>
                    setObsidian((current) => ({
                      ...current,
                      direct_write: event.target.checked,
                    }))
                  }
                />
              </label>
            </span>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">{t('exportSync.cloudSection')}</div>
        <div className="settings-card">
          <label className="settings-row">
            <span className="settings-row-label">
              <strong>{t('exportSync.notionLabel')}</strong>
              <span className="settings-row-hint">{t('exportSync.prefillHint')}</span>
            </span>
            <span className="settings-row-control">
              <input
                className="settings-input"
                aria-label={t('exportSync.notionAria')}
                value={exportSync.notion_parent_page_id}
                placeholder={t('exportSync.notionPlaceholder')}
                onChange={(event) =>
                  setExportSync((current) => ({
                    ...current,
                    notion_parent_page_id: event.target.value,
                  }))
                }
              />
            </span>
          </label>
          <label className="settings-row">
            <span className="settings-row-label">
              <strong>{t('exportSync.feishuLabel')}</strong>
              <span className="settings-row-hint">{t('exportSync.prefillHint')}</span>
            </span>
            <span className="settings-row-control">
              <input
                className="settings-input"
                aria-label={t('exportSync.feishuAria')}
                value={exportSync.feishu_folder_token}
                placeholder={t('exportSync.feishuPlaceholder')}
                onChange={(event) =>
                  setExportSync((current) => ({
                    ...current,
                    feishu_folder_token: event.target.value,
                  }))
                }
              />
            </span>
          </label>
          <div className="settings-row">
            <span className="settings-row-label">
              <strong>{t('exportSync.tokenLabel')}</strong>
              <span className="settings-row-hint">
                {t('exportSync.tokenHint')}
              </span>
            </span>
            <span className="settings-row-control">
              <button
                type="button"
                className="settings-save-btn"
                disabled={saving}
                onClick={() => void save()}
              >
                {saving ? t('exportSync.saving') : t('exportSync.saveButton')}
              </button>
              {status && (
                <span role="status" className="settings-row-hint">
                  {status}
                </span>
              )}
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

export default ExportSyncSettingsPage
