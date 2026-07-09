import { useCallback, useEffect, useState } from 'react'
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

const TIERS: { key: PerformanceTier; label: string; desc: string; icon: typeof Cpu }[] = [
  { key: 'low', label: '低配', desc: 'Whisper base · 截帧稀疏（8秒/帧，上限30）', icon: ZapOff },
  { key: 'medium', label: '中配', desc: 'Whisper medium · 截帧适中（5秒/帧，上限60）', icon: Zap },
  { key: 'high', label: '高配', desc: 'Whisper large-v3 · 截帧密集（3秒/帧，上限100）', icon: Gauge },
]

export default function PerformanceTierPage() {
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
  }, [])

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    try {
      const res = await updatePerformanceTier(selected)
      setInfo(res)
      setConfig({ performanceTier: selected })
      toast.success('性能档位已保存')
    } catch {
      toast.error('保存失败')
    } finally {
      setIsSaving(false)
    }
  }, [selected, setConfig])

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
      toast.success(`推荐档位：${res.recommended_tier === 'low' ? '低配' : res.recommended_tier === 'medium' ? '中配' : '高配'}（${res.total_ram_gb} GB 内存）`)
    } catch {
      toast.error('内存探测失败')
    }
  }, [])

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight">性能档位</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          按电脑配置选择档位，自动调节转录模型大小和截帧密度。低配省资源，高配效果更好。
        </p>
      </div>

      {/* 内存探测 */}
      <Section
        title="自动探测"
        description="读取电脑内存大小，推荐合适的档位"
      >
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleAutoDetect}>
            <Cpu className="mr-2 h-4 w-4" />
            自动探测推荐
          </Button>
          {info && (
            <span className="text-sm text-muted-foreground">
              {info.total_ram_gb} GB 内存
              {info.recommended_tier && (
                <>
                  {' → 推荐 '}
                  <Badge variant="secondary">
                    {info.recommended_tier === 'low' ? '低配' : info.recommended_tier === 'medium' ? '中配' : '高配'}
                  </Badge>
                </>
              )}
            </span>
          )}
        </div>
      </Section>

      {/* 档位选择 */}
      <Section title="选择档位" description="手动选择性能档位（优先于自动探测）">
        <div className="grid gap-3">
          {TIERS.map(({ key, label, desc, icon: Icon }) => {
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
                    <span className="font-medium">{label}</span>
                    {recommended && (
                      <Badge variant="outline" className="border-emerald-500 text-emerald-700 text-[10px]">
                        推荐
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{desc}</p>
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
        <Section title="当前生效参数" description="档位对应的转录模型和截帧参数">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Whisper 模型</p>
              <p className="font-medium">{info.whisper_model_size}</p>
            </div>
            <div>
              <p className="text-muted-foreground">截帧间隔</p>
              <p className="font-medium">{info.interval_sec} 秒</p>
            </div>
            <div>
              <p className="text-muted-foreground">帧数上限</p>
              <p className="font-medium">{info.max_frames} 帧</p>
            </div>
          </div>
        </Section>
      )}
    </div>
  )
}
