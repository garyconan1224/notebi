import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { FieldRow } from '@/components/ui/field-row'
import { useSettingsShellStore } from '@/store/settingsShellStore'
import { http } from '@/services/client'

/**
 * 下载设置页（S1 重构）。
 *
 * - 存储与命名：输出目录、文件名模板
 * - 代理策略：inherit/direct/proxy
 * - Cookie 模式：none/browser/file
 * - 高级参数：并发、重试、超时
 * - 已移除：PO Token、Visitor Data、Cookie 目录
 * - 保存闭环：GET → 修改 → PATCH → GET 读回
 */

interface DownloadConfig {
  output_dir: string
  filename_template: string
  proxy_mode: 'inherit' | 'direct' | 'proxy'
  cookie_mode: 'none' | 'browser' | 'file'
  cookie_browser: string
  cookie_profile: string
  cookie_file_path: string
  concurrency_limit: number
  retry_count: number
  socket_timeout: number
}

const DEFAULT_CONFIG: DownloadConfig = {
  output_dir: '',
  filename_template: '%(title)s.%(ext)s',
  proxy_mode: 'inherit',
  cookie_mode: 'browser',
  cookie_browser: 'chrome',
  cookie_profile: '',
  cookie_file_path: '',
  concurrency_limit: 2,
  retry_count: 2,
  socket_timeout: 30,
}

const DownloadSettingsPage = () => {
  const { t } = useTranslation('settings')
  const setSaveBar = useSettingsShellStore((s) => s.setSaveBar)
  const resetSaveBar = useSettingsShellStore((s) => s.resetSaveBar)

  const [config, setConfig] = useState<DownloadConfig>(DEFAULT_CONFIG)
  const [draft, setDraft] = useState<DownloadConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [cookieMessage, setCookieMessage] = useState('')

  // 加载配置
  const loadConfig = useCallback(async () => {
    try {
      const res = await http.get<DownloadConfig>('/download_config')
      setConfig(res.data)
      setDraft(res.data)
    } catch (err) {
      toast.error(t('download.loadFailed'))
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  // 脏检查
  const isDirty = JSON.stringify(draft) !== JSON.stringify(config)

  // 保存
  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await http.patch('/download_config', draft)
      // GET 读回验证
      const res = await http.get<DownloadConfig>('/download_config')
      setConfig(res.data)
      toast.success(t('download.savedVerified'))
    } catch (err) {
      toast.error(t('download.saveFailed'))
      console.error(err)
    } finally {
      setSaving(false)
    }
  }, [draft, t])

  // 重置
  const handleReset = useCallback(() => {
    setDraft(config)
  }, [config])

  const handleCookieTest = useCallback(async () => {
    try {
      const res = await http.post<{ readable: boolean; message: string }>(
        '/download_config/test-cookie',
      )
      setCookieMessage(res.data.message)
    } catch (err) {
      toast.error(t('download.cookieTestFailed'))
      console.error(err)
    }
  }, [t])

  const handleCookieImport = useCallback(async (file: File | undefined) => {
    if (!file) return
    const body = new FormData()
    body.append('file', file)
    try {
      const res = await http.post<{ success: boolean; error?: string }>(
        '/download_config/import-cookie',
        body,
      )
      if (!res.data.success) throw new Error(res.data.error || t('download.importFailed'))
      await loadConfig()
      toast.success(t('download.cookieImported'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('download.cookieImportFailed'))
    }
  }, [loadConfig, t])

  const handleCookieDelete = useCallback(async () => {
    try {
      await http.delete('/download_config/cookie')
      await loadConfig()
      toast.success(t('download.cookieDeleted'))
    } catch (err) {
      toast.error(t('download.cookieDeleteFailed'))
      console.error(err)
    }
  }, [loadConfig, t])

  // SaveBar 桥接
  useEffect(() => {
    setSaveBar({
      dirtyCount: isDirty ? 1 : 0,
      saving,
      onSave: handleSave,
      onReset: handleReset,
    })
    return () => resetSaveBar()
  }, [isDirty, saving, handleSave, handleReset, setSaveBar, resetSaveBar])

  // 文件名模板预设
  const filenamePresets = [
    { label: t('download.presetTitleOnly'), value: '%(title)s.%(ext)s' },
    { label: t('download.presetTitleId'), value: '%(title)s-%(id)s.%(ext)s' },
    { label: t('download.presetUploaderTitle'), value: '%(uploader)s-%(title)s.%(ext)s' },
  ]

  const generatePreview = (template: string): string => {
    const example = { title: 'Example Video', id: 'abc123', uploader: 'Creator', ext: 'mp4' }
    return Object.entries(example).reduce(
      (prev, [key, val]) => prev.replace(`%(${key})s`, val),
      template,
    )
  }

  if (loading) {
    return <div className="settings-panel p-6">{t('download.loading')}</div>
  }

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <div>
          <h2>{t('download.title')}</h2>
          <div className="settings-header-desc">{t('download.subtitle')}</div>
        </div>
      </div>

      {/* ── Section A · 存储与命名 ── */}
      <div className="settings-section">
        <div className="settings-section-title">{t('download.storageSection')}</div>
        <div className="settings-card">
          <FieldRow
            htmlFor="output-dir"
            label={t('download.outputDirLabel')}
            hint={t('download.outputDirHint')}
          >
            <Input
              id="output-dir"
              type="text"
              value={draft.output_dir}
              onChange={(e) => setDraft((prev) => ({ ...prev, output_dir: e.target.value }))}
              placeholder={t('download.outputDirPlaceholder')}
              className="text-sm"
            />
          </FieldRow>

          <FieldRow
            htmlFor="filename-template"
            label={t('download.templateLabel')}
            hint={t('download.templateHint')}
          >
            <div className="space-y-3">
              <Input
                id="filename-template"
                type="text"
                value={draft.filename_template}
                onChange={(e) => setDraft((prev) => ({ ...prev, filename_template: e.target.value }))}
                className="text-sm font-mono"
              />
              <div className="flex flex-wrap gap-2">
                {filenamePresets.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, filename_template: preset.value }))}
                    className="chip"
                    style={{
                      background: draft.filename_template === preset.value ? 'var(--fg)' : 'var(--bgalt)',
                      color: draft.filename_template === preset.value ? 'var(--bg)' : 'var(--fg2)',
                      border: draft.filename_template === preset.value ? '1px solid var(--fg)' : '1px solid var(--bdr)',
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div style={{ padding: 8, borderRadius: 'var(--rs)', background: 'var(--bgalt)', fontSize: 'var(--xs)', color: 'var(--mut)' }}>
                {t('download.preview')}{generatePreview(draft.filename_template)}
              </div>
            </div>
          </FieldRow>
        </div>
      </div>

      {/* ── Section B · Cookie 设置 ── */}
      <div className="settings-section">
        <div className="settings-section-title">{t('download.cookieSection')}</div>
        <div className="settings-card">
          <div className="px-6 py-4 space-y-3">
            {([
              { value: 'none', label: t('download.cookieNone'), desc: t('download.cookieNoneDesc') },
              { value: 'browser', label: t('download.cookieBrowser'), desc: t('download.cookieBrowserDesc') },
              { value: 'file', label: t('download.cookieFile'), desc: t('download.cookieFileDesc') },
            ] as const).map((mode) => (
              <label key={mode.value} className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="cookie_mode"
                  checked={draft.cookie_mode === mode.value}
                  onChange={() => setDraft((prev) => ({ ...prev, cookie_mode: mode.value }))}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium">{mode.label}</div>
                  <div className="text-sm text-muted-foreground">{mode.desc}</div>
                </div>
              </label>
            ))}
          </div>

          {draft.cookie_mode === 'browser' && (
            <>
              <FieldRow htmlFor="cookie-browser" label={t('download.browserLabel')} hint={t('download.browserHint')}>
                <select
                  id="cookie-browser"
                  value={draft.cookie_browser}
                  onChange={(e) => setDraft((prev) => ({ ...prev, cookie_browser: e.target.value }))}
                  className="w-full rounded border px-3 py-2 text-sm"
                >
                  <option value="chrome">Chrome</option>
                  <option value="firefox">Firefox</option>
                  <option value="safari">Safari</option>
                  <option value="edge">Edge</option>
                </select>
              </FieldRow>
              <FieldRow
                htmlFor="cookie-profile"
                label={t('download.profileLabel')}
                hint={t('download.profileHint')}
              >
                <Input
                  id="cookie-profile"
                  value={draft.cookie_profile}
                  onChange={(e) => setDraft((prev) => ({ ...prev, cookie_profile: e.target.value }))}
                  placeholder={t('download.profilePlaceholder')}
                />
              </FieldRow>
            </>
          )}

          <div className="border-t px-6 py-4 space-y-3 text-sm">
            <p className="text-muted-foreground">
              {t('download.cookieNote1')}
            </p>
            <p className="text-muted-foreground">
              {t('download.cookieNote2')}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="chip" onClick={() => void handleCookieTest()}>
                测试 Cookie
              </button>
              <label className="chip cursor-pointer">
                导入 cookies.txt
                <input
                  className="sr-only"
                  type="file"
                  accept=".txt,text/plain"
                  aria-label={t('download.importCookieAria')}
                  onChange={(event) => void handleCookieImport(event.target.files?.[0])}
                />
              </label>
              <button type="button" className="chip" onClick={() => void handleCookieDelete()}>
                删除 Cookie 文件
              </button>
            </div>
            {cookieMessage && <div role="status">{cookieMessage}</div>}
          </div>
        </div>
      </div>

      {/* ── Section C · 高级参数 ── */}
      <div className="settings-section">
        <div className="settings-section-title">{t('download.advancedSection')}</div>
        <div className="settings-card">
          <FieldRow
            htmlFor="concurrency-limit"
            label={t('download.concurrencyLabel')}
            hint={t('download.concurrencyHint')}
          >
            <Input
              id="concurrency-limit"
              type="number"
              min="1"
              max="8"
              value={draft.concurrency_limit}
              onChange={(e) => setDraft((prev) => ({ ...prev, concurrency_limit: parseInt(e.target.value, 10) || 2 }))}
              className="text-sm"
            />
          </FieldRow>

          <FieldRow
            htmlFor="retry-count"
            label={t('download.retryLabel')}
            hint={t('download.retryHint')}
          >
            <Input
              id="retry-count"
              type="number"
              min="0"
              max="10"
              value={draft.retry_count}
              onChange={(e) => setDraft((prev) => ({ ...prev, retry_count: parseInt(e.target.value, 10) || 2 }))}
              className="text-sm"
            />
          </FieldRow>

          <FieldRow
            htmlFor="socket-timeout"
            label={t('download.timeoutLabel')}
            hint={t('download.timeoutHint')}
          >
            <Input
              id="socket-timeout"
              type="number"
              min="5"
              max="300"
              value={draft.socket_timeout}
              onChange={(e) => setDraft((prev) => ({ ...prev, socket_timeout: parseInt(e.target.value, 10) || 30 }))}
              className="text-sm"
            />
          </FieldRow>
        </div>
      </div>
    </div>
  )
}

export default DownloadSettingsPage
