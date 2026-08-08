import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Download, RefreshCw } from 'lucide-react'

import {
  downloadLocalModel,
  activateLocalModel,
  listLocalModels,
  type LocalModelStatus,
} from '@/services/localModels'

/** S5: 模型家族 → 用途分组标题（以真实后端 family 值为准；未知家族归“其他”） */
const FAMILY_PURPOSE_KEY: Record<string, string> = {
  'fast-whisper': 'localModels.familyAsr',
  'mlx-whisper': 'localModels.familyAsr',
  'asr': 'localModels.familyAsr',
  'ocr': 'localModels.familyOcr',
  'vision': 'localModels.familyVision',
  'speaker-embedding': 'localModels.familySpeaker',
  'speaker-diarization': 'localModels.familySpeaker',
}

function purposeLabel(family: string, t: (k: string) => string): string {
  const key = FAMILY_PURPOSE_KEY[family]
  return key ? t(key) : t('localModels.familyOther')
}

function formatSize(size: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (!size) return t('localModels.sizeUnknown')
  return size >= 1024 ? t('localModels.sizeGb', { gb: (size / 1024).toFixed(1) }) : t('localModels.sizeMb', { mb: Math.round(size) })
}

function statusLabel(model: LocalModelStatus, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (model.status === 'needs_token') return t('localModels.statusNeedsToken')
  if (!model.compatible) return t('localModels.statusUnsupported')
  if (model.status === 'ready' || model.cached) return t('localModels.statusReady')
  if (model.status === 'downloading') return t('localModels.statusDownloading', { percent: Math.round(model.progress * 100) })
  if (model.status === 'failed') return t('localModels.statusFailed')
  if (model.status === 'not_verified') return t('localModels.statusNotVerified')
  return t('localModels.statusPending')
}

export default function LocalModelsPanel() {
  const { t } = useTranslation('settings')
  const [models, setModels] = useState<LocalModelStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')

  const refresh = useCallback(async () => {
    try {
      setModels(await listLocalModels())
    } catch {
      toast.error(t('localModels.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { void refresh() }, [refresh])
  const downloading = models.some((model) => model.status === 'downloading')
  useEffect(() => {
    if (!downloading) return
    const timer = window.setInterval(() => void refresh(), 2000)
    return () => window.clearInterval(timer)
  }, [downloading, refresh])

  const byPurpose = useMemo(() => {
    const groups = new Map<string, LocalModelStatus[]>()
    for (const model of models) {
      const purpose = purposeLabel(model.family, t)
      const current = groups.get(purpose) ?? []
      current.push(model)
      groups.set(purpose, current)
    }
    return [...groups.entries()]
  }, [models, t])

  const startDownload = async (model: LocalModelStatus) => {
    setBusyId(model.model_id)
    try {
      await downloadLocalModel(model.model_id)
      toast.success(t('localModels.downloadStarted', { title: model.title }))
      await refresh()
    } catch {
      toast.error(t('localModels.downloadStartFailed', { title: model.title }))
    } finally {
      setBusyId('')
    }
  }

  const activate = async (model: LocalModelStatus) => {
    setBusyId(model.model_id)
    try {
      await activateLocalModel(model.model_id)
      toast.success(t('localModels.activated', { title: model.title }))
      await refresh()
    } catch {
      toast.error(t('localModels.activateFailed', { title: model.title }))
    } finally {
      setBusyId('')
    }
  }

  if (loading) return <div className="settings-empty">{t('localModels.loading')}</div>

  return (
    <div className="settings-subpanel">
      <section className="settings-card">
        <div className="settings-row">
          <div>
            <div className="settings-row-label">{t('localModels.panelTitle')}</div>
            <div className="settings-row-hint">
              {t('localModels.panelHint')}
            </div>
          </div>
          <div className="settings-row-control">
            <button type="button" className="btn-ghost" onClick={() => void refresh()}>
              <RefreshCw size={14} /> {t('localModels.refresh')}
            </button>
          </div>
        </div>
        {byPurpose.map(([purpose, group]) => (
          <div className="local-model-family" key={purpose}>
            <div className="local-model-purpose-header">{purpose}</div>
            {group.map((model) => {
              const ready = model.status === 'ready' || model.cached
              const isBusy = busyId === model.model_id || model.status === 'downloading'
              return (
                <article className="local-model-row" key={model.model_id}>
                  <div>
                    <strong>{model.title}</strong>
                    <p>{model.description}</p>
                    <details className="local-model-details">
                      <summary>{t('localModels.techDetails')}</summary>
                      <small>{t('localModels.cache', { dir: model.cache_dir, size: formatSize(model.estimated_size_mb, t) })}</small>
                    </details>
                    {model.status === 'downloading' && (
                      <div className="local-model-progress" role="progressbar" aria-label={t('localModels.downloadAria', { title: model.title })} aria-valuenow={Math.round(model.progress * 100)}>
                        <span style={{ width: `${Math.round(model.progress * 100)}%` }} />
                      </div>
                    )}
                    {model.status === 'failed' && (
                      <p className="local-model-failure">{t('localModels.downloadFailedHint')}</p>
                    )}
                    {model.error && (
                      <details className="local-model-raw-error">
                        <summary>{t('localModels.rawError')}</summary>
                        <small>{model.error}</small>
                      </details>
                    )}
                  </div>
                  <div className="local-model-actions">
                    <span data-status={model.status}>{statusLabel(model, t)}</span>
                    {model.active && <span className="local-model-active">{t('localModels.activeNow')}</span>}
                    {(model.family === 'fast-whisper' || model.family === 'mlx-whisper') && (
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={!ready || isBusy || model.active}
                        onClick={() => void activate(model)}
                      >
                        {model.active ? t('localModels.using') : t('localModels.switchUse')}
                      </button>
                    )}
                    {!ready && (
                      <button
                        type="button"
                        className="btn"
                        disabled={!model.compatible || isBusy || model.status === 'needs_token'}
                        onClick={() => void startDownload(model)}
                      >
                        <Download size={14} /> {isBusy ? t('localModels.downloading') : model.status === 'failed' ? t('localModels.retry') : t('localModels.download')}
                      </button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        ))}
      </section>
    </div>
  )
}
