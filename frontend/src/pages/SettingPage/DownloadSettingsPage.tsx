import { useCallback, useEffect, useState } from 'react'
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
      toast.error('加载下载配置失败')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

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
      toast.success('已保存并读回验证')
    } catch (err) {
      toast.error('保存失败')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }, [draft])

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
      toast.error('Cookie 测试失败')
      console.error(err)
    }
  }, [])

  const handleCookieImport = useCallback(async (file: File | undefined) => {
    if (!file) return
    const body = new FormData()
    body.append('file', file)
    try {
      const res = await http.post<{ success: boolean; error?: string }>(
        '/download_config/import-cookie',
        body,
      )
      if (!res.data.success) throw new Error(res.data.error || '导入失败')
      await loadConfig()
      toast.success('Cookie 文件已安全导入')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Cookie 导入失败')
    }
  }, [loadConfig])

  const handleCookieDelete = useCallback(async () => {
    try {
      await http.delete('/download_config/cookie')
      await loadConfig()
      toast.success('Cookie 文件已删除')
    } catch (err) {
      toast.error('删除 Cookie 文件失败')
      console.error(err)
    }
  }, [loadConfig])

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
    { label: '仅标题', value: '%(title)s.%(ext)s' },
    { label: '标题-ID', value: '%(title)s-%(id)s.%(ext)s' },
    { label: '上传者-标题', value: '%(uploader)s-%(title)s.%(ext)s' },
  ]

  const generatePreview = (template: string): string => {
    const example = { title: 'Example Video', id: 'abc123', uploader: 'Creator', ext: 'mp4' }
    return Object.entries(example).reduce(
      (prev, [key, val]) => prev.replace(`%(${key})s`, val),
      template,
    )
  }

  if (loading) {
    return <div className="settings-panel p-6">加载中…</div>
  }

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <div>
          <h2>下载配置</h2>
          <div className="settings-header-desc">配置媒体下载的存储路径、文件命名和并发参数</div>
        </div>
      </div>

      {/* ── Section A · 存储与命名 ── */}
      <div className="settings-section">
        <div className="settings-section-title">存储与命名</div>
        <div className="settings-card">
          <FieldRow
            htmlFor="output-dir"
            label="输出目录"
            hint="留空将使用默认目录（data/videos/）"
          >
            <Input
              id="output-dir"
              type="text"
              value={draft.output_dir}
              onChange={(e) => setDraft((prev) => ({ ...prev, output_dir: e.target.value }))}
              placeholder="留空使用默认目录"
              className="text-sm"
            />
          </FieldRow>

          <FieldRow
            htmlFor="filename-template"
            label="文件名模板"
            hint="使用 yt-dlp 模板语法，如 %(title)s / %(id)s"
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
                示例预览: {generatePreview(draft.filename_template)}
              </div>
            </div>
          </FieldRow>
        </div>
      </div>

      {/* ── Section B · 代理策略 ── */}
      <div className="settings-section">
        <div className="settings-section-title">代理策略</div>
        <div className="settings-card">
          <div className="px-6 py-4 space-y-3">
            {([
              { value: 'inherit', label: '继承网络设置', desc: '使用网络页的全局代理策略' },
              { value: 'direct', label: '强制直连', desc: '下载时不使用任何代理' },
              { value: 'proxy', label: '强制代理', desc: '下载时使用全局代理' },
            ] as const).map((mode) => (
              <label key={mode.value} className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="proxy_mode"
                  checked={draft.proxy_mode === mode.value}
                  onChange={() => setDraft((prev) => ({ ...prev, proxy_mode: mode.value }))}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium">{mode.label}</div>
                  <div className="text-sm text-muted-foreground">{mode.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* ── Section C · Cookie 设置 ── */}
      <div className="settings-section">
        <div className="settings-section-title">Cookie 设置</div>
        <div className="settings-card">
          <div className="px-6 py-4 space-y-3">
            {([
              { value: 'none', label: '不使用 Cookie', desc: '匿名下载，部分视频可能无法获取' },
              { value: 'browser', label: '从浏览器读取', desc: '下载时自动从浏览器获取 Cookie' },
              { value: 'file', label: '使用 Cookie 文件', desc: '使用导入的 cookies.txt 文件' },
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
              <FieldRow htmlFor="cookie-browser" label="浏览器" hint="选择要读取 Cookie 的浏览器">
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
                label="浏览器 Profile"
                hint="多用户浏览器可填写 Profile 目录名；默认用户请留空"
              >
                <Input
                  id="cookie-profile"
                  value={draft.cookie_profile}
                  onChange={(e) => setDraft((prev) => ({ ...prev, cookie_profile: e.target.value }))}
                  placeholder="例如 Profile 1"
                />
              </FieldRow>
            </>
          )}

          <div className="border-t px-6 py-4 space-y-3 text-sm">
            <p className="text-muted-foreground">
              浏览器 Cookie 被占用时，请关闭浏览器后再测试；指定 Profile 只在多用户场景填写。
            </p>
            <p className="text-muted-foreground">
              文件回退仅接受 Netscape 格式 cookies.txt。请从可信扩展导出，不要把 Cookie 正文粘贴到页面或日志。
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
                  aria-label="导入 cookies.txt"
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

      {/* ── Section D · 高级参数 ── */}
      <div className="settings-section">
        <div className="settings-section-title">高级参数</div>
        <div className="settings-card">
          <FieldRow
            htmlFor="concurrency-limit"
            label="并发下载数"
            hint="同时下载的分片数量，范围 1-8，默认 2"
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
            label="重试次数"
            hint="连接失败时的重试次数，范围 0-10，默认 2"
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
            label="连接超时（秒）"
            hint="网络连接超时时间，范围 5-300 秒，默认 30"
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
