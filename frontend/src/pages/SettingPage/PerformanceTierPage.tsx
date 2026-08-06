import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Cpu, Zap, ZapOff, Gauge } from 'lucide-react'
import { toast } from 'sonner'
import { useConfigStore, type PerformanceTier } from '@/store/configStore'
import { useSettingsShellStore } from '@/store/settingsShellStore'
import {
  fetchPerformanceTier,
  updatePerformanceTier,
  type PerformanceTierResponse,
} from '@/services/performance'
import { Section } from '@/components/ui/section'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const TIER_DEFS: { key: PerformanceTier; descKey: string; icon: typeof Cpu }[] = [
  { key: 'low', descKey: 'performance.tier.lowDesc', icon: ZapOff },
  { key: 'medium', descKey: 'performance.tier.mediumDesc', icon: Zap },
  { key: 'high', descKey: 'performance.tier.highDesc', icon: Gauge },
]

export default function PerformanceTierPage() {
  const { t } = useTranslation('settings')
  const performanceTier = useConfigStore((s) => s.performanceTier)
  const setConfig = useConfigStore((s) => s.setConfig)
  const setSaveBar = useSettingsShellStore((s) => s.setSaveBar)
  const resetSaveBar = useSettingsShellStore((s) => s.resetSaveBar)

  const [info, setInfo] = useState<PerformanceTierResponse | null>(null)
  const [selected, setSelected] = useState<PerformanceTier>(performanceTier)
  const [isSaving, setIsSaving] = useState(false)

  // 加载当前档位 + 内存探测；同步 store 避免首次打开"假脏"
  useEffect(() => {
    fetchPerformanceTier()
      .then((res) => {
        setInfo(res)
        setSelected(res.tier)
        setConfig({ performanceTier: res.tier })
      })
      .catch(() => {})
  }, [setConfig])

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    try {
      const res = await updatePerformanceTier(selected)
      setInfo(res)
      setConfig({ performanceTier: selected })
      toast.success(t('performance.saved'))
    } catch {
      toast.error(t('performance.saveFailed'))
    } finally {
      setIsSaving(false)
    }
  }, [selected, setConfig, t])

  // SaveBar 集成
  useEffect(() => {
    const dirtyCount = selected !== performanceTier ? 1 : 0
    setSaveBar({
      dirtyCount,
      saving: isSaving,
      onSave: handleSave,
      onReset: () => setSelected(performanceTier),
    })
    return () => resetSaveBar()
  }, [selected, performanceTier, isSaving, handleSave, setSaveBar, resetSaveBar])

  const handleAutoDetect = useCallback(async () => {
    try {
      const res = await fetchPerformanceTier()
      setInfo(res)
      setSelected(res.recommended_tier)
      toast.success(t('performance.recommendedToast', { tier: t(`performance.tier.${res.recommended_tier}`), gb: res.total_ram_gb }))
    } catch {
      toast.error(t('performance.detectFailed'))
    }
  }, [t])

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight">{t('performance.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('performance.subtitle')}
        </p>
      </div>

      {/* 内存探测 */}
      <Section
        title={t('performance.detectTitle')}
        description={t('performance.detectDesc')}
      >
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleAutoDetect}>
            <Cpu className="mr-2 h-4 w-4" />
            {t('performance.detectButton')}
          </Button>
          {info && (
            <span className="text-sm text-muted-foreground">
              {t('performance.ramInfo', { gb: info.total_ram_gb })}
              {info.recommended_tier && (
                <>
                  {t('performance.recommended')}
                  <Badge variant="secondary">
                    {t(`performance.tier.${info.recommended_tier}`)}
                  </Badge>
                </>
              )}
            </span>
          )}
        </div>
      </Section>

      {/* 档位选择 */}
      <Section title={t('performance.selectTitle')} description={t('performance.selectDesc')}>
        <div className="grid gap-3">
          {TIER_DEFS.map(({ key, descKey, icon: Icon }) => {
            const active = selected === key
            const recommended = info?.recommended_tier === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelected(key)}
                className={`flex items-center gap-4 rounded-lg border p-4 text-left transition-colors ${
                  active
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <Icon className={`h-5 w-5 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t(`performance.tier.${key}`)}</span>
                    {recommended && (
                      <Badge variant="outline" className="border-emerald-500 text-emerald-700 text-[10px]">
                        推荐
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{t(descKey)}</p>
                </div>
                <div className={`h-4 w-4 rounded-full border-2 ${active ? 'border-primary bg-primary' : 'border-muted-foreground/30'}`}>
                  {active && <div className="h-full w-full rounded-full bg-white scale-[0.4]" />}
                </div>
              </button>
            )
          })}
        </div>
      </Section>

      {/* 当前生效参数 */}
      {info && (
        <Section title={t('performance.activeParamsTitle')} description={t('performance.activeParamsDesc')}>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">{t('performance.whisperModel')}</p>
              <p className="font-medium">{info.whisper_model_size}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t('performance.interval')}</p>
              <p className="font-medium">{t('performance.intervalValue', { sec: info.interval_sec })}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t('performance.maxFrames')}</p>
              <p className="font-medium">{t('performance.maxFramesValue', { count: info.max_frames })}</p>
            </div>
          </div>
        </Section>
      )}
    </div>
  )
}
