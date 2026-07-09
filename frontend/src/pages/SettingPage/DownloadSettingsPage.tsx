import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { FieldRow } from '@/components/ui/field-row'
import { useConfigStore } from '@/store/configStore'
import { useSettingsShellStore } from '@/store/settingsShellStore'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import type { DownloadConfig } from '@/store/configStore'

/**
 * 下载设置页（DESIGN_NOTES_SETTINGS.md §3.4 M3）。
 *
 * - 两个 Section：存储与命名 / 网络与凭据；
 * - 草稿-快照模型：本地 draft + useDirtyGuard(downloadConfig) 基线；
 * - 顶层 SaveBar 由 settingsShellStore 桥接。
 * - cookieBaseDirs 在 store 存储为数组，UI 显示为 \n 连接的字符串。
 */

const DownloadSettingsPage = () => {
  const { t } = useTranslation('settings')

  // 分片订阅 configStore 的 downloadConfig
  const downloadConfig  = useConfigStore((s) => s.downloadConfig)
  const saveDownloadConfig = useConfigStore((s) => s.saveDownloadConfig)

  const setSaveBar   = useSettingsShellStore((s) => s.setSaveBar)
  const resetSaveBar = useSettingsShellStore((s) => s.resetSaveBar)

  // 基线快照：用于 dirty 检查与重置
  const baseline = useMemo<DownloadConfig>(
    () => ({ ...downloadConfig }),
    [downloadConfig],
  )

  const [draft, setDraft] = useState<DownloadConfig>(baseline)
  const [isSaving, setIsSaving] = useState(false)

  // 基线刷新：仅在 store 侧值变化时同步
  useEffect(() => {
    setDraft((prev) =>
      JSON.stringify(prev) === JSON.stringify(baseline) ? prev : baseline,
    )
  }, [baseline])

  const guard = useDirtyGuard<DownloadConfig>({
    initial: baseline,
    current: draft,
    message: t('dirty.leaveConfirm'),
  })

  const patch = useCallback((p: Partial<DownloadConfig>) => {
    setDraft((prev) => ({ ...prev, ...p }))
  }, [])

  const handleReset = useCallback(() => {
    setDraft(baseline)
  }, [baseline])

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    try {
      await saveDownloadConfig(draft)
      guard.commit(draft)
      toast.success(t('download.saved'))
    } catch (error) {
      console.error('Failed to save download config:', error)
      toast.error(t('download.saveFailed'))
    } finally {
      setIsSaving(false)
    }
  }, [draft, saveDownloadConfig, guard, t])

  // SaveBar 桥：推送脏计数 + 保存/重置回调；卸载归零
  useEffect(() => {
    setSaveBar({
      dirtyCount: guard.dirtyCount,
      saving: isSaving,
      onSave: handleSave,
      onReset: handleReset,
    })
    return () => resetSaveBar()
  }, [guard.dirtyCount, isSaving, handleSave, handleReset, setSaveBar, resetSaveBar])

  const dirty = guard.dirtyMap

  // 文件名模板预设与预览
  const filenamePresets = [
    { label: t('download.templatePresets.titleOnly'), value: '%(title)s.%(ext)s' },
    { label: t('download.templatePresets.titleId'), value: '%(title)s-%(id)s.%(ext)s' },
    { label: t('download.templatePresets.uploaderTitle'), value: '%(uploader)s-%(title)s.%(ext)s' },
    { label: t('download.templatePresets.playlistIndex'), value: '%(playlist_index)s-%(title)s.%(ext)s' },
  ]

  // 生成模板预览（示例文件名）
  const generatePreview = (template: string): string => {
    const example = {
      title: 'Example Video',
      id: 'abc123',
      uploader: 'Creator',
      playlist_index: '001',
      ext: 'mp4',
    }
    return Object.entries(example).reduce(
      (prev, [key, val]) => prev.replace(`%(${key})s`, val),
      template,
    )
  }

  // 处理 cookieBaseDirs：数组 ↔ 字符串转换
  const cookieDirsString = draft.cookieBaseDirs.join('\n')
  const handleCookieDirsChange = (value: string) => {
    const dirs = value.split('\n').filter((line) => line.trim())
    patch({ cookieBaseDirs: dirs })
  }

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <div>
          <h2>{t('download.title')}</h2>
          <div className="settings-header-desc">{t('download.subtitle')}</div>
        </div>
        <div className="settings-header-actions">
          <button
            type="button"
            className="settings-reset-btn"
            onClick={handleReset}
            disabled={guard.dirtyCount === 0 || isSaving}
          >
            重置
          </button>
          <button
            type="button"
            className="settings-save-btn"
            onClick={handleSave}
            disabled={guard.dirtyCount === 0 || isSaving}
          >
            {isSaving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      {/* ── Section A · 存储与命名 ── */}
      <div className="settings-section">
        <div className="settings-section-title">{t('download.storageTitle')}</div>
        <div className="settings-card">
          <FieldRow
            htmlFor="output-dir"
            label={t('download.outputDirLabel')}
            hint={t('download.outputDirHint')}
            dirty={dirty.outputDir}
          >
            <Input
              id="output-dir"
              type="text"
              value={draft.outputDir}
              onChange={(e) => patch({ outputDir: e.target.value })}
              placeholder={t('download.outputDirPlaceholder')}
              className="text-sm"
            />
          </FieldRow>

          <FieldRow
            htmlFor="filename-template"
            label={t('download.filenameTemplateLabel')}
            hint={t('download.filenameTemplateHint')}
            dirty={dirty.filenameTemplate}
          >
            <div className="space-y-3">
              <Input
                id="filename-template"
                type="text"
                value={draft.filenameTemplate}
                onChange={(e) => patch({ filenameTemplate: e.target.value })}
                placeholder={t('download.filenameTemplatePlaceholder')}
                className="text-sm font-mono"
              />
              {/* 模板预设 Chips */}
              <div className="flex flex-wrap gap-2">
                {filenamePresets.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => patch({ filenameTemplate: preset.value })}
                    className="chip"
                    style={{
                      background:
                        draft.filenameTemplate === preset.value
                          ? 'var(--fg)'
                          : 'var(--bgalt)',
                      color:
                        draft.filenameTemplate === preset.value
                          ? 'var(--bg)'
                          : 'var(--fg2)',
                      border:
                        draft.filenameTemplate === preset.value
                          ? '1px solid var(--fg)'
                          : '1px solid var(--bdr)',
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              {/* 模板预览 */}
              <div style={{
                padding: 8,
                borderRadius: 'var(--rs)',
                background: 'var(--bgalt)',
                fontSize: 'var(--xs)',
                color: 'var(--mut)',
              }}>
                {t('download.templatePreview')}: {generatePreview(draft.filenameTemplate)}
              </div>
            </div>
          </FieldRow>
        </div>
      </div>

      {/* ── Section B · 网络与凭据 ── */}
      <div className="settings-section">
        <div className="settings-section-title">{t('download.networkTitle')}</div>
        <div className="settings-card">
          <FieldRow
            htmlFor="proxy"
            label={t('download.proxyLabel')}
            hint={t('download.proxyHint')}
            dirty={dirty.httpProxy}
          >
            <Input
              id="proxy"
              type="text"
              value={draft.httpProxy}
              onChange={(e) => patch({ httpProxy: e.target.value })}
              placeholder={t('download.proxyPlaceholder')}
              className="text-sm"
            />
          </FieldRow>

          <FieldRow
            htmlFor="po-token"
            label={t('download.poTokenLabel')}
            dirty={dirty.poToken}
          >
            <Input
              id="po-token"
              type="text"
              value={draft.poToken}
              onChange={(e) => patch({ poToken: e.target.value })}
              placeholder={t('download.poTokenPlaceholder')}
              className="text-sm font-mono"
            />
          </FieldRow>

          <FieldRow
            htmlFor="visitor-data"
            label={t('download.visitorDataLabel')}
            dirty={dirty.visitorData}
          >
            <Input
              id="visitor-data"
              type="text"
              value={draft.visitorData}
              onChange={(e) => patch({ visitorData: e.target.value })}
              placeholder={t('download.visitorDataPlaceholder')}
              className="text-sm font-mono"
            />
          </FieldRow>

          <FieldRow
            htmlFor="cookie-dirs"
            label={t('download.cookieDirsLabel')}
            hint={t('download.cookieDirsHint')}
            dirty={dirty.cookieBaseDirs}
          >
            <Textarea
              id="cookie-dirs"
              value={cookieDirsString}
              onChange={(e) => handleCookieDirsChange(e.target.value)}
              placeholder={t('download.cookieDirsPlaceholder')}
              className="min-h-[88px] text-sm font-mono"
            />
          </FieldRow>
        </div>
      </div>

      {/* ── Section C · 高级参数 ── */}
      <div className="settings-section">
        <div className="settings-section-title">{t('download.advancedTitle')}</div>
        <div className="settings-card">
          <FieldRow
            htmlFor="concurrency-limit"
            label={t('download.concurrencyLimitLabel')}
            hint={t('download.concurrencyLimitHint')}
            dirty={dirty.concurrencyLimit}
          >
            <Input
              id="concurrency-limit"
              type="number"
              min="1"
              max="8"
              value={draft.concurrencyLimit}
              onChange={(e) => patch({ concurrencyLimit: parseInt(e.target.value, 10) || 1 })}
              className="text-sm"
            />
          </FieldRow>

          <FieldRow
            htmlFor="retry-count"
            label={t('download.retryCountLabel')}
            hint={t('download.retryCountHint')}
            dirty={dirty.retryCount}
          >
            <Input
              id="retry-count"
              type="number"
              min="0"
              max="10"
              value={draft.retryCount}
              onChange={(e) => patch({ retryCount: parseInt(e.target.value, 10) || 0 })}
              className="text-sm"
            />
          </FieldRow>

          <FieldRow
            htmlFor="socket-timeout"
            label={t('download.socketTimeoutLabel')}
            hint={t('download.socketTimeoutHint')}
            dirty={dirty.socketTimeout}
          >
            <Input
              id="socket-timeout"
              type="number"
              min="5"
              max="300"
              value={draft.socketTimeout}
              onChange={(e) => patch({ socketTimeout: parseInt(e.target.value, 10) || 30 })}
              className="text-sm"
            />
          </FieldRow>
        </div>
      </div>
    </div>
  )
}

export default DownloadSettingsPage

