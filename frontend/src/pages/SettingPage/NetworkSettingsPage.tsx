import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { FieldRow } from '@/components/ui/field-row'
import { useSettingsShellStore } from '@/store/settingsShellStore'
import {
  getNetworkConfig,
  updateNetworkConfig,
  ROUTING_MODE_DESCRIPTIONS,
  type NetworkConfig,
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
  const setSaveBar = useSettingsShellStore((s) => s.setSaveBar)
  const resetSaveBar = useSettingsShellStore((s) => s.resetSaveBar)

  const [config, setConfig] = useState<NetworkConfig>({ routing_mode: 'smart', global_proxy: '' })
  const [draft, setDraft] = useState<NetworkConfig>({ routing_mode: 'smart', global_proxy: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // 加载配置
  const loadConfig = useCallback(async () => {
    try {
      const data = await getNetworkConfig()
      setConfig(data)
      setDraft(data)
    } catch (err) {
      toast.error('加载网络配置失败')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

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
        toast.success('已保存并读回验证')
      } else {
        toast.error('保存后读回不一致，请重试')
      }
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
    return <div className="settings-panel p-6">加载中…</div>
  }

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <div>
          <h2>网络设置</h2>
          <div className="settings-header-desc">配置联网方式和代理</div>
        </div>
      </div>

      {/* ── Section A · 连接模式 ── */}
      <div className="settings-section">
        <div className="settings-section-title">连接模式</div>
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
                    {mode === 'smart' && '智能分流'}
                    {mode === 'direct' && '全部直连'}
                    {mode === 'proxy' && '全部代理'}
                  </div>
                  <div className="text-sm text-muted-foreground">{ROUTING_MODE_DESCRIPTIONS[mode]}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* ── Section B · 全局代理 ── */}
      <div className="settings-section">
        <div className="settings-section-title">全局代理</div>
        <div className="settings-card">
          <FieldRow
            htmlFor="global-proxy"
            label="代理地址"
            hint="支持 HTTP、HTTPS、SOCKS。示例：http://127.0.0.1:7890 或 socks5://127.0.0.1:1080"
          >
            <Input
              id="global-proxy"
              type="text"
              value={draft.global_proxy}
              onChange={(e) => setDraft((prev) => ({ ...prev, global_proxy: e.target.value }))}
              placeholder="http://127.0.0.1:7890"
              className="text-sm font-mono"
            />
          </FieldRow>
          {draft.routing_mode === 'proxy' && !draft.global_proxy && (
            <div className="px-6 pb-4 text-sm text-amber-600">
              提示：全部代理模式需要配置代理地址，否则海外站点将直连
            </div>
          )}
        </div>
      </div>

      {/* ── Section C · 智能路由说明 ── */}
      <div className="settings-section">
        <div className="settings-section-title">智能路由规则</div>
        <div className="settings-card">
          <div className="px-6 py-4 text-sm space-y-2">
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
              <span>直连：Bilibili、抖音、小红书、腾讯视频、优酷、爱奇艺</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
              <span>代理：YouTube、Twitter/X、Instagram、TikTok</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-gray-400" />
              <span>其他：默认直连</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default NetworkSettingsPage
