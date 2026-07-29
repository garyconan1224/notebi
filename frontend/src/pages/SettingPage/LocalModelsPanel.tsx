import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Download, RefreshCw } from 'lucide-react'

import {
  downloadLocalModel,
  listLocalModels,
  type LocalModelStatus,
} from '@/services/localModels'

function formatSize(size: number): string {
  if (!size) return '大小由模型运行时确认'
  return size >= 1024 ? `${(size / 1024).toFixed(1)} GB` : `${Math.round(size)} MB`
}

function statusLabel(model: LocalModelStatus): string {
  if (!model.compatible) return '当前设备不支持'
  if (model.status === 'ready' || model.cached) return '已就绪'
  if (model.status === 'downloading') return `下载中 ${Math.round(model.progress * 100)}%`
  if (model.status === 'failed') return '下载失败'
  if (model.status === 'not_verified') return '尚未验证'
  return '待下载'
}

export default function LocalModelsPanel() {
  const [models, setModels] = useState<LocalModelStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')

  const refresh = useCallback(async () => {
    try {
      setModels(await listLocalModels())
    } catch {
      toast.error('读取本地模型状态失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  const downloading = models.some((model) => model.status === 'downloading')
  useEffect(() => {
    if (!downloading) return
    const timer = window.setInterval(() => void refresh(), 2000)
    return () => window.clearInterval(timer)
  }, [downloading, refresh])

  const byFamily = useMemo(() => {
    const groups = new Map<string, LocalModelStatus[]>()
    for (const model of models) {
      const current = groups.get(model.family) ?? []
      current.push(model)
      groups.set(model.family, current)
    }
    return [...groups.values()]
  }, [models])

  const startDownload = async (model: LocalModelStatus) => {
    setBusyId(model.model_id)
    try {
      await downloadLocalModel(model.model_id)
      toast.success(`${model.title} 已开始后台下载`)
      await refresh()
    } catch {
      toast.error(`${model.title} 无法开始下载`)
    } finally {
      setBusyId('')
    }
  }

  if (loading) return <div className="settings-empty">正在读取本地模型状态…</div>

  return (
    <div className="settings-subpanel">
      <section className="settings-card">
        <div className="settings-row">
          <div>
            <div className="settings-row-label">本地模型下载与切换</div>
            <div className="settings-row-hint">
              仅在点击下载后联网；下载完成后到“转写设置”选择相应引擎和规格。状态每 2 秒更新一次。
            </div>
          </div>
          <div className="settings-row-control">
            <button type="button" className="btn-ghost" onClick={() => void refresh()}>
              <RefreshCw size={14} /> 刷新状态
            </button>
          </div>
        </div>
        {byFamily.map((group) => (
          <div className="local-model-family" key={group[0].family}>
            {group.map((model) => {
              const ready = model.status === 'ready' || model.cached
              const isBusy = busyId === model.model_id || model.status === 'downloading'
              return (
                <article className="local-model-row" key={model.model_id}>
                  <div>
                    <strong>{model.title}</strong>
                    <p>{model.description}</p>
                    <small>缓存：{model.cache_dir} · {formatSize(model.estimated_size_mb)}</small>
                    {model.status === 'downloading' && (
                      <div className="local-model-progress" role="progressbar" aria-label={`${model.title}下载进度`} aria-valuenow={Math.round(model.progress * 100)}>
                        <span style={{ width: `${Math.round(model.progress * 100)}%` }} />
                      </div>
                    )}
                    {model.error && <small className="local-model-error">{model.error}</small>}
                  </div>
                  <div className="local-model-actions">
                    <span data-status={model.status}>{statusLabel(model)}</span>
                    <button
                      type="button"
                      className="btn"
                      disabled={!model.compatible || ready || isBusy}
                      onClick={() => void startDownload(model)}
                    >
                      <Download size={14} /> {isBusy ? '下载中…' : ready ? '已下载' : '下载'}
                    </button>
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
