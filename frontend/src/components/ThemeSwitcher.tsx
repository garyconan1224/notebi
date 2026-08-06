/**
 * Q6：明暗模式分段（浅 / 深 / 跟随系统）。
 * 外观事实源为后端设置（appearanceStore），本组件只做展示与触发。
 *
 * iconOnly：侧栏（折叠/展开共用）场景——只显示当前模式图标，每次点击在
 * 浅色 → 深色 → 跟随系统 之间循环切换；避免三段式（含文字标签）在窄侧栏
 * 里横向溢出，也避免展开态占一整行。
 */
import { Monitor, Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FC } from 'react'

import { useAppearanceStore } from '@/store/appearanceStore'
import type { ThemeMode } from '@/services/settings'

const MODE_OPTIONS: Array<{ value: ThemeMode; icon: typeof Sun }> = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Monitor },
]

const MODE_ICON: Record<ThemeMode, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
}

interface ThemeSwitcherProps {
  /** 只显示当前模式图标，点击按 浅色→深色→跟随系统 循环 */
  iconOnly?: boolean
}

const ThemeSwitcher: FC<ThemeSwitcherProps> = ({ iconOnly = false }) => {
  const { t } = useTranslation('common')
  const mode = useAppearanceStore((state) => state.mode)
  const saving = useAppearanceStore((state) => state.saving)
  const setMode = useAppearanceStore((state) => state.setMode)

  if (iconOnly) {
    const ActiveIcon = MODE_ICON[mode]
    const currentLabel = t(`theme.${mode}`)
    const cycle = () => {
      const index = MODE_OPTIONS.findIndex((option) => option.value === mode)
      const next = MODE_OPTIONS[(index + 1) % MODE_OPTIONS.length].value
      void setMode(next)
    }
    return (
      <button
        type="button"
        aria-label={t('theme.modeAria')}
        title={t('theme.modeTitle', { mode: currentLabel })}
        disabled={saving}
        onClick={cycle}
        className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        <ActiveIcon size={16} />
      </button>
    )
  }

  return (
    <div className="mode-segment" role="radiogroup" aria-label={t('theme.modeAria')}>
      {MODE_OPTIONS.map((option) => {
        const Icon = option.icon
        const active = mode === option.value
        const label = t(`theme.${option.value}`)
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={saving}
            className={`mode-segment-option${active ? ' is-active' : ''}`}
            onClick={() => void setMode(option.value)}
            title={label}
          >
            <Icon size={14} />
            {label}
          </button>
        )
      })}
    </div>
  )
}

export default ThemeSwitcher
