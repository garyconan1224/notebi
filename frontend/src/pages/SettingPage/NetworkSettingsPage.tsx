import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { FieldRow } from '@/components/ui/field-row'
import { useSettingsShellStore } from '@/store/settingsShellStore'
import {
  getNetworkConfig,
  updateNetworkConfig,
  testNetworkTarget,
  type NetworkConfig,
  type NetworkTestResult,
} from '@/services/network'

/**
 * 网络设置页（S1 重构）。
 *
 * - 路由模式：智能分流 / 全部直连 / 全部代理
 * - 全局代理
 * - 已移除：PO Token、Visitor Data、Cookie 目录（移至下载页）
 * - 保存闭环：GET → 修改 → PATCH → GET 读回
 */
const NetworkSettingsPage = () => {
  const { t } = useTranslation('settings')
  const setSaveBar = useSettingsShellStore((s) => s.setSaveBar)
  const resetSaveBar = useSettingsShellStore((s) => s.resetSaveBar)

  const [config, setConfig] = useState<NetworkConfig>({ routing_mode: 'smart', global_proxy: '' })
  const [draft, setDraft] = useState<NetworkConfig>({ routing_mode: 'smart', global_proxy: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingTarget, setTestingTarget] = useState('')
  const [testResult, setTestResult] = useState<NetworkTestResult | null>(null)

  // 加载配置
  const loadConfig = useCallback(async () => {
    try {
      const data = await getNetworkConfig()
      setConfig(data)
      setDraft(data)
    } catch (err) {
      toast.error(t('network.loadFailed'))
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  // 脏检查
  const isDirty = draft.routing_mode !== config.routing_mode || draft.global_proxy !== config.global_proxy

  // 保存
  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      // PATCH 保存
      await updateNetworkConfig(draft)
      // GET 读回验证
      const readBack = await getNetworkConfig()
      if (readBack.routing_mode === draft.routing_mode && readBack.global_proxy === draft.global_proxy) {
        setConfig(readBack)
        toast.success(t('network.savedVerified'))
      } else {
        toast.error(t('network.saveMismatch'))
      }
    } catch (err) {
      toast.error(t('network.saveFailed'))
      console.error(err)
    } finally {
      setSaving(false)
    }
  }, [draft, t])

  // 重置
  const handleReset = useCallback(() => {
    setDraft(config)
  }, [config])

  const handleTest = useCallback(async (target: string) => {
    setTestingTarget(target)
    try {
      setTestResult(await testNetworkTarget(target))
    } catch (err) {
      toast.error(t('network.testFailed'))
      console.error(err)
    } finally {
      setTestingTarget('')
    }
  }, [t])

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

  if (loading) {
    return <div className="settings-panel p-6">{t('network.loading')}</div>
  }

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <div>
          <h2>{t('network.title')}</h2>
          <div className="settings-header-desc">{t('network.subtitle')}</div>
        </div>
      </div>

      {/* ── Section A · 连接模式 ── */}
      <div className="settings-section">
        <div className="settings-section-title">{t('network.connectMode')}</div>
        <div className="settings-card">
          <div className="px-6 py-4 space-y-3">
            {(['smart', 'direct', 'proxy'] as const).map((mode) => (
              <label key={mode} className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="routing_mode"
                  checked={draft.routing_mode === mode}
                  onChange={() => setDraft((prev) => ({ ...prev, routing_mode: mode }))}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium">
                    {mode === 'smart' && t('network.routingModes.smart')}
                    {mode === 'direct' && t('network.routingModes.direct')}
                    {mode === 'proxy' && t('network.routingModes.proxy')}
                  </div>
                  <div className="text-sm text-muted-foreground">{t(`network.routingModes.${mode}Desc`)}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* ── Section B · 全局代理 ── */}
      <div className="settings-section">
        <div className="settings-section-title">{t('network.globalProxy')}</div>
        <div className="settings-card">
          <FieldRow
            htmlFor="global-proxy"
            label={t('network.proxyLabel')}
            hint={t('network.proxyHint')}
          >
            <Input
              id="global-proxy"
              type="text"
              value={draft.global_proxy}
              onChange={(e) => setDraft((prev) => ({ ...prev, global_proxy: e.target.value }))}
              placeholder={t('network.proxyPlaceholder')}
              className="text-sm font-mono"
            />
          </FieldRow>
          {draft.routing_mode === 'proxy' && !draft.global_proxy && (
            <div className="px-6 pb-4 text-sm text-amber-600">
              {t('network.proxyWarning')}
            </div>
          )}
        </div>
      </div>

      {/* ── Section C · 智能路由说明 ── */}
      <div className="settings-section">
        <div className="settings-section-title">{t('network.smartRules')}</div>
        <div className="settings-card">
          <div className="px-6 py-4 text-sm space-y-2">
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
              <span>{t('network.ruleDirect')}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
              <span>{t('network.ruleProxy')}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-gray-400" />
              <span>{t('network.ruleOther')}</span>
            </div>
          </div>
          <div className="border-t px-6 py-4">
            <div className="mb-3 text-sm font-medium">{t('network.testTitle')}</div>
            <div className="flex flex-wrap gap-2">
              {[
                ['Bilibili', 'https://www.bilibili.com/'],
                ['YouTube', 'https://www.youtube.com/'],
                ['Tavily', 'https://api.tavily.com/'],
                ['Model', 'https://api.openai.com/'],
              ].map(([label, target]) => (
                <button
                  key={target}
                  type="button"
                  className="chip"
                  disabled={testingTarget === target}
                  onClick={() => void handleTest(target)}
                >
                  {testingTarget === target ? t('network.testing') : t(`network.test${label}`)}
                </button>
              ))}
            </div>
            {testResult && (
              <div
                className="mt-3 rounded border p-3 text-sm"
                role="status"
              >
                <div>{testResult.ok ? t('network.ok') : t('network.fail')} · {testResult.elapsed_ms} ms</div>
                <div className="text-muted-foreground">
                  {testResult.route} · {testResult.proxy_used ? t('network.proxyUsed') : t('network.proxyNotUsed')} · {testResult.message}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default NetworkSettingsPage
