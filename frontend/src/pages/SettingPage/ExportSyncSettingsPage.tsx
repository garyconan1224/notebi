import { useEffect, useState } from 'react'

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
        if (active) setStatus('读取失败，请稍后重试')
      })
    return () => {
      active = false
    }
  }, [])

  const save = async () => {
    setSaving(true)
    setStatus('')
    try {
      const saved = await patchSettings({ obsidian, export_sync: exportSync })
      if (saved.obsidian) setObsidian(saved.obsidian)
      if (saved.export_sync) setExportSync(saved.export_sync)
      setStatus('已保存')
    } catch {
      setStatus('保存失败，请检查后重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="settings-panel" aria-labelledby="export-sync-title">
      <header className="settings-header">
        <div>
          <h2 id="export-sync-title">导出与同步</h2>
          <p className="settings-header-desc">
            集中管理导出目的地默认值；API Token 不会保存到 NoteBi，仅在单次导出时输入。
          </p>
        </div>
      </header>

      <div className="settings-section">
        <div className="settings-section-title">Obsidian</div>
        <div className="settings-card">
          <label className="settings-row">
            <span className="settings-row-label">
              <strong>Vault 路径</strong>
              <span className="settings-row-hint">Obsidian 仓库在本机的完整路径</span>
            </span>
            <span className="settings-row-control">
              <input
                className="settings-input"
                aria-label="Obsidian Vault 路径"
                value={obsidian.vault_path}
                placeholder="例如 /Users/你/Documents/My Vault"
                onChange={(event) =>
                  setObsidian((current) => ({ ...current, vault_path: event.target.value }))
                }
              />
            </span>
          </label>
          <label className="settings-row">
            <span className="settings-row-label">
              <strong>笔记子目录</strong>
              <span className="settings-row-hint">留空时写入 Vault 根目录</span>
            </span>
            <span className="settings-row-control">
              <input
                className="settings-input"
                aria-label="Obsidian 子目录"
                value={obsidian.subdir}
                placeholder="例如 NoteBi"
                onChange={(event) =>
                  setObsidian((current) => ({ ...current, subdir: event.target.value }))
                }
              />
            </span>
          </label>
          <div className="settings-row">
            <span className="settings-row-label">
              <strong>允许本地直写</strong>
              <span className="settings-row-hint">关闭后仍可下载 Obsidian ZIP 包</span>
            </span>
            <span className="settings-row-control">
              <label>
                <input
                  type="checkbox"
                  aria-label="启用 Obsidian 直写"
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
        <div className="settings-section-title">云笔记默认值</div>
        <div className="settings-card">
          <label className="settings-row">
            <span className="settings-row-label">
              <strong>Notion 默认父页面</strong>
              <span className="settings-row-hint">导出对话框会预填，仍可临时修改</span>
            </span>
            <span className="settings-row-control">
              <input
                className="settings-input"
                aria-label="Notion 默认父页面 ID 或链接"
                value={exportSync.notion_parent_page_id}
                placeholder="页面 ID 或页面链接"
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
              <strong>飞书默认文件夹</strong>
              <span className="settings-row-hint">导出对话框会预填，仍可临时修改</span>
            </span>
            <span className="settings-row-control">
              <input
                className="settings-input"
                aria-label="飞书默认文件夹 Token"
                value={exportSync.feishu_folder_token}
                placeholder="文件夹 Token"
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
              <strong>Token 安全说明</strong>
              <span className="settings-row-hint">
                Notion 集成令牌 / 飞书访问令牌不在此保存，仅在单次导出时输入，请求结束即丢弃。
              </span>
            </span>
            <span className="settings-row-control">
              <button
                type="button"
                className="settings-save-btn"
                disabled={saving}
                onClick={() => void save()}
              >
                {saving ? '保存中…' : '保存导出与同步设置'}
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
