import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Camera, Grid3X3, Image as ImageIcon } from 'lucide-react'
import { Section } from '@/components/ui/section'
import { FieldRow } from '@/components/ui/field-row'
import { useConfigStore } from '@/store/configStore'
import { useSettingsShellStore } from '@/store/settingsShellStore'
import { useDirtyGuard } from '@/hooks/useDirtyGuard'
import {
  updateScreenshotConfig,
  getQualityLevels,
  getGridPresets,
} from '@/services/screenshot'
import type { ScreenshotConfig } from '@/store/configStore'

/**
 * 视频截图设置页（DESIGN_NOTES_SETTINGS.md §4.3 · Screenshot）。
 *
 * - 三 Section：抽帧间隔 / 拼图尺寸 / 图片质量 & 嵌入；
 * - 草稿-快照模型：本地 draft + useDirtyGuard(screenshotSettings) 基线；
 * - 顶层 SaveBar 由 settingsShellStore 桥接，不再使用页内 Save 按钮；
 * - 保存流程：后端 POST /screenshot_config → 成功后落 configStore.screenshotSettings。
 */
interface ScreenshotDraft extends Record<string, unknown> {
  defaultInterval: number
  /** UI 侧以 "colsxrows" 字符串承载，便于 Select 绑定 */
  gridSize: string
  jpegQuality: number
  embedInNote: boolean
}

/** 将 store 中的 gridSize 元组规范化为 "colsxrows" 字符串 */
function toGridKey(tuple: [number, number]): string {
  return `${tuple[0]}x${tuple[1]}`
}

/** 将 "colsxrows" 还原为元组；非法值返回 null */
function parseGridKey(key: string): [number, number] | null {
  const parts = key.split('x').map(Number)
  if (parts.length !== 2) return null
  const [c, r] = parts
  if (!Number.isFinite(c) || !Number.isFinite(r)) return null
  if (c < 1 || c > 10 || r < 1 || r > 10) return null
  return [c, r]
}

const ScreenshotPage = () => {
  const { t } = useTranslation('settings')

  // 分片订阅 configStore：仅在截图配置变化时 re-render
  const screenshotSettings = useConfigStore((s) => s.screenshotSettings)
  const setConfig          = useConfigStore((s) => s.setConfig)

  const setSaveBar   = useSettingsShellStore((s) => s.setSaveBar)
  const resetSaveBar = useSettingsShellStore((s) => s.resetSaveBar)

  // 基线快照：来自持久化 store；gridSize 元组映射为字符串
  const baseline = useMemo<ScreenshotDraft>(
    () => ({
      defaultInterval: screenshotSettings.defaultInterval,
      gridSize: toGridKey(screenshotSettings.gridSize),
      jpegQuality: screenshotSettings.jpegQuality,
      embedInNote: screenshotSettings.embedInNote,
    }),
    [screenshotSettings],
  )

  const [draft, setDraft] = useState<ScreenshotDraft>(baseline)
  const [isSaving, setIsSaving] = useState(false)
  const [gridError, setGridError] = useState<string | null>(null)

  // 基线刷新：仅在 store 侧值变化时同步。
  // 不依赖 draft，避免打开截图页时形成草稿同步循环。
  useEffect(() => {
    setDraft(baseline)
    setGridError(null)
  }, [baseline])

  const guard = useDirtyGuard<ScreenshotDraft>({
    initial: baseline,
    current: draft,
    message: t('dirty.leaveConfirm'),
  })
  const draftRef = useRef(draft)
  const baselineRef = useRef(baseline)
  const commitRef = useRef(guard.commit)

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    baselineRef.current = baseline
  }, [baseline])

  useEffect(() => {
    commitRef.current = guard.commit
  }, [guard.commit])

  const patch = useCallback((p: Partial<ScreenshotDraft>) => {
    setDraft((prev) => ({ ...prev, ...p }))
    setGridError(null)
  }, [])

  const handleReset = useCallback(() => {
    setDraft(baselineRef.current)
    setGridError(null)
  }, [])

  const handleSave = useCallback(async () => {
    const currentDraft = draftRef.current
    const grid = parseGridKey(currentDraft.gridSize)
    if (!grid) {
      setGridError(t('screenshot.grid.invalid', '网格大小必须为 1-10 的整数'))
      return
    }
    setIsSaving(true)
    try {
      const nextConfig: ScreenshotConfig = {
        defaultInterval: currentDraft.defaultInterval,
        gridSize: grid,
        jpegQuality: currentDraft.jpegQuality,
        embedInNote: currentDraft.embedInNote,
      }
      // 先尝试落后端；失败时保留草稿不触达 store
      await updateScreenshotConfig(nextConfig)
      setConfig({ screenshotSettings: nextConfig })
      const next: ScreenshotDraft = {
        defaultInterval: nextConfig.defaultInterval,
        gridSize: toGridKey(nextConfig.gridSize),
        jpegQuality: nextConfig.jpegQuality,
        embedInNote: nextConfig.embedInNote,
      }
      setDraft(next)
      commitRef.current(next)
      toast.success(t('screenshot.saved', '截图配置已保存'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(t('screenshot.saveFailed', '截图配置保存失败') + (msg ? `：${msg}` : ''))
    } finally {
      setIsSaving(false)
    }
  }, [setConfig, t])

  // SaveBar 桥：推送脏计数 + 保存/重置回调
  useEffect(() => {
    setSaveBar({
      dirtyCount: guard.dirtyCount,
      saving: isSaving,
      onSave: handleSave,
      onReset: handleReset,
    })
  }, [guard.dirtyCount, isSaving, handleSave, handleReset, setSaveBar])

  // 只在卸载时归零，避免依赖更新时 reset/setSaveBar 循环。
  useEffect(() => {
    return () => resetSaveBar()
  }, [resetSaveBar])

  const dirty = guard.dirtyMap
  const gridTuple = parseGridKey(draft.gridSize)

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight">{t('screenshot.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('screenshot.subtitle')}</p>
      </div>

      {/* ── Section A · 抽帧参数 ── */}
      <Section
        icon={<Camera className="size-4" />}
        title={t('screenshot.interval.title')}
        description={t('screenshot.interval.description')}
      >
        <FieldRow
          htmlFor="screenshot-interval"
          label={t('screenshot.interval.title')}
          hint={t('screenshot.interval.description')}
          dirty={dirty.defaultInterval}
        >
          <div className="flex items-center gap-4">
            <input
              id="screenshot-interval"
              type="range"
              min={1}
              max={60}
              step={1}
              value={draft.defaultInterval}
              onChange={(e) => patch({ defaultInterval: Number(e.target.value) })}
              className="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-zinc-200"
              aria-label={t('screenshot.interval.title')}
            />
            <span className="w-14 text-right text-sm font-semibold tabular-nums">
              {draft.defaultInterval}s
            </span>
          </div>
        </FieldRow>
      </Section>

      {/* ── Section B · 网格拼图 ── */}
      <Section
        icon={<Grid3X3 className="size-4" />}
        title={t('screenshot.grid.title')}
        description={t('screenshot.grid.description')}
      >
        <FieldRow
          htmlFor="screenshot-grid"
          label={t('screenshot.grid.title')}
          hint={
            gridTuple
              ? t('screenshot.grid.totalFrames', '总共 {{count}} 帧', {
                  count: gridTuple[0] * gridTuple[1],
                })
              : undefined
          }
          error={gridError ?? undefined}
          dirty={dirty.gridSize}
        >
          <select
            id="screenshot-grid"
            className="settings-native-select"
            value={draft.gridSize}
            onChange={(event) => patch({ gridSize: event.target.value })}
          >
            {getGridPresets().map((preset) => (
              <option
                key={preset.label}
                value={`${preset.value[0]}x${preset.value[1]}`}
              >
                {preset.label}
              </option>
            ))}
          </select>
        </FieldRow>
      </Section>

      {/* ── Section C · 画质与嵌入 ── */}
      <Section
        icon={<ImageIcon className="size-4" />}
        title={t('screenshot.quality.title')}
        description={t('screenshot.quality.description')}
      >
        <FieldRow
          htmlFor="screenshot-quality"
          label={t('screenshot.quality.title')}
          hint={t('screenshot.quality.description')}
          dirty={dirty.jpegQuality}
        >
          <select
            id="screenshot-quality"
            className="settings-native-select"
            value={String(draft.jpegQuality)}
            onChange={(event) => patch({ jpegQuality: Number(event.target.value) })}
          >
            {getQualityLevels().map((opt) => (
              <option key={opt.value} value={String(opt.value)}>
                {opt.label}
              </option>
            ))}
          </select>
        </FieldRow>

        <FieldRow
          htmlFor="screenshot-embed"
          label={t('screenshot.embed.title')}
          hint={t('screenshot.embed.description')}
          dirty={dirty.embedInNote}
          inline
        >
          <label className="settings-toggle" htmlFor="screenshot-embed">
            <input
              id="screenshot-embed"
              type="checkbox"
              checked={draft.embedInNote}
              onChange={(event) => patch({ embedInNote: event.target.checked })}
            />
            <span className="settings-toggle-track">
              <span className="settings-toggle-thumb" />
            </span>
          </label>
        </FieldRow>
      </Section>
    </div>
  )
}

export default ScreenshotPage
