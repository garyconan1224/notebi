import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { FieldRow } from '@/components/ui/field-row'
import { useConfigStore } from '@/store/configStore'
import { useSettingsShellStore } from '@/store/settingsShellStore'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'

/**
 * 网络设置页（DESIGN_NOTES_SETTINGS.md §4.3）。
 *
 * - 三 Section：代理 / PO Token / Cookie 目录；
 * - 草稿-快照模型：本地 draft + useDirtyGuard(config) 基线；
 * - 顶层 SaveBar 由 settingsShellStore 桥接，不再使用页内 Save 按钮。
 */
interface NetworkDraft extends Record<string, unknown> {
  httpProxy: string
  poToken: string
  visitorData: string
  cookieBaseDirs: string
  tavilyApiKey: string
}

const NetworkSettingsPage = () => {
  const { t } = useTranslation('settings')

  // 分片订阅 configStore：仅在相关字段变化时 re-render
  const httpProxy      = useConfigStore((s) => s.httpProxy)
  const poToken        = useConfigStore((s) => s.poToken)
  const visitorData    = useConfigStore((s) => s.visitorData)
  const cookieBaseDirs = useConfigStore((s) => s.cookieBaseDirs)
  const tavilyApiKey   = useConfigStore((s) => s.tavilyApiKey)
  const setConfig      = useConfigStore((s) => s.setConfig)

  const setSaveBar   = useSettingsShellStore((s) => s.setSaveBar)
  const resetSaveBar = useSettingsShellStore((s) => s.resetSaveBar)

  // 基线快照：来自持久化 store；store 外部变更时（例如另一个 Tab 修改）通过 useEffect 同步
  const baseline = useMemo<NetworkDraft>(
    () => ({ httpProxy, poToken, visitorData, cookieBaseDirs, tavilyApiKey }),
    [httpProxy, poToken, visitorData, cookieBaseDirs, tavilyApiKey],
  )

  const [draft, setDraft] = useState<NetworkDraft>(baseline)
  const [isSaving, setIsSaving] = useState(false)
  const [tavilyTesting, setTavilyTesting] = useState(false)
  const [tavilyTestResult, setTavilyTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  // 基线刷新：仅在 store 侧值变化时同步（避免本地草稿被外部回填覆盖）
  useEffect(() => {
    setDraft((prev) =>
      prev.httpProxy === baseline.httpProxy &&
      prev.poToken === baseline.poToken &&
      prev.visitorData === baseline.visitorData &&
      prev.cookieBaseDirs === baseline.cookieBaseDirs &&
      prev.tavilyApiKey === baseline.tavilyApiKey
        ? prev
        : baseline,
    )
  }, [baseline])

  const guard = useDirtyGuard<NetworkDraft>({
    initial: baseline,
    current: draft,
    message: t('dirty.leaveConfirm'),
  })

  const patch = useCallback((p: Partial<NetworkDraft>) => {
    setDraft((prev) => ({ ...prev, ...p }))
  }, [])

  const handleReset = useCallback(() => {
    setDraft(baseline)
  }, [baseline])

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    try {
      const next: NetworkDraft = {
        httpProxy: draft.httpProxy.trim(),
        poToken: draft.poToken.trim(),
        visitorData: draft.visitorData.trim(),
        cookieBaseDirs: draft.cookieBaseDirs,
        tavilyApiKey: draft.tavilyApiKey.trim(),
      }
      setConfig(next)
      setDraft(next)
      guard.commit(next)
      // 同步 Tavily key 到后端
      if (next.tavilyApiKey !== baseline.tavilyApiKey) {
        const { http } = await import('@/services/client')
        await http.put('/providers/tavily', { api_key: next.tavilyApiKey })
      }
      toast.success(t('network.saved'))
    } finally {
      setIsSaving(false)
    }
  }, [draft, setConfig, guard, t, baseline.tavilyApiKey])

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

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <div>
          <h2>{t('network.title')}</h2>
          <div className="settings-header-desc">{t('network.subtitle')}</div>
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

      {/* ── Section A · 网络代理 ── */}
      <div className="settings-section">
        <div className="settings-section-title">{t('network.proxyTitle')}</div>
        <div className="settings-card">
          <FieldRow
            htmlFor="proxy"
            label={t('network.proxyLabel')}
            hint={t('network.proxySupport')}
            dirty={dirty.httpProxy}
          >
            <Input
              id="proxy"
              type="text"
              value={draft.httpProxy}
              onChange={(e) => patch({ httpProxy: e.target.value })}
              placeholder={t('network.proxyPlaceholder')}
              className="text-sm"
            />
          </FieldRow>
        </div>
      </div>

      {/* ── Section B · PO Token ── */}
      <div className="settings-section">
        <div className="settings-section-title">{t('network.poTokenSectionTitle')}</div>
        <div className="settings-card">
          <FieldRow
            htmlFor="po-token"
            label={t('network.poTokenLabel')}
            dirty={dirty.poToken}
          >
            <Input
              id="po-token"
              type="text"
              value={draft.poToken}
              onChange={(e) => patch({ poToken: e.target.value })}
              placeholder={t('network.poTokenPlaceholder')}
              className="text-sm font-mono"
            />
          </FieldRow>
          <FieldRow
            htmlFor="visitor-data"
            label={t('network.visitorDataLabel')}
            dirty={dirty.visitorData}
          >
            <Input
              id="visitor-data"
              type="text"
              value={draft.visitorData}
              onChange={(e) => patch({ visitorData: e.target.value })}
              placeholder={t('network.visitorDataPlaceholder')}
              className="text-sm font-mono"
            />
          </FieldRow>
        </div>
      </div>

      {/* ── Section C · Cookie 目录 ── */}
      <div className="settings-section">
        <div className="settings-section-title">{t('network.cookieSectionTitle')}</div>
        <div className="settings-card">
          <FieldRow
            htmlFor="cookie-dirs"
            label={t('network.cookieDirsLabel')}
            hint={t('network.cookieDirsDescription')}
            dirty={dirty.cookieBaseDirs}
          >
            <Textarea
              id="cookie-dirs"
              value={draft.cookieBaseDirs}
              onChange={(e) => patch({ cookieBaseDirs: e.target.value })}
              placeholder={t('network.cookieDirsPlaceholder')}
              className="min-h-[88px] text-sm font-mono"
            />
          </FieldRow>
        </div>
      </div>

      {/* ── Section D · 联网搜索 ── */}
      <div className="settings-section">
        <div className="settings-section-title">联网搜索</div>
        <div className="settings-card">
          <FieldRow
            htmlFor="tavily-key"
            label="Tavily API Key"
            hint="免费注册 tavily.com 即可获得（1000 次/月）"
            dirty={dirty.tavilyApiKey}
          >
            <Input
              id="tavily-key"
              type="password"
              value={draft.tavilyApiKey}
              onChange={(e) => patch({ tavilyApiKey: e.target.value })}
              placeholder="tvly-xxxxxxxxxx"
              className="text-sm font-mono"
            />
          </FieldRow>
          <div className="px-6 pb-4 flex items-center gap-3">
            <a
              href="https://app.tavily.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary underline"
            >
              → 去 tavily.com 免费注册（2 分钟）
            </a>
            <button
              type="button"
              disabled={tavilyTesting}
              onClick={async () => {
                setTavilyTesting(true)
                setTavilyTestResult(null)
                try {
                  const { http } = await import('@/services/client')
                  const res = await http.post('/providers/tavily/test', {
                    api_key: draft.tavilyApiKey.trim(),
                  })
                  setTavilyTestResult(res.data)
                } catch (err: unknown) {
                  const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || '请求失败'
                  setTavilyTestResult({ ok: false, message: msg })
                } finally {
                  setTavilyTesting(false)
                }
              }}
              className="rounded border px-3 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              {tavilyTesting ? '测试中…' : '测试连接'}
            </button>
            {tavilyTestResult && (
              <span className={`text-xs ${tavilyTestResult.ok ? 'text-green-600' : 'text-red-500'}`}>
                {tavilyTestResult.ok ? '✓' : '✗'} {tavilyTestResult.message}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default NetworkSettingsPage

