/**
 * Q6：明暗模式分段（浅 / 深 / 跟随系统）。
 * 外观事实源为后端设置（appearanceStore），本组件只做展示与触发。
 */
import { Monitor, Moon, Sun } from 'lucide-react'
import type { FC } from 'react'

import { useAppearanceStore } from '@/store/appearanceStore'
import type { ThemeMode } from '@/services/settings'

const MODE_OPTIONS: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
]

const ThemeSwitcher: FC = () => {
  const mode = useAppearanceStore((state) => state.mode)
  const saving = useAppearanceStore((state) => state.saving)
  const setMode = useAppearanceStore((state) => state.setMode)

  return (
    <div className="mode-segment" role="radiogroup" aria-label="明暗模式">
      {MODE_OPTIONS.map((option) => {
        const Icon = option.icon
        const active = mode === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={saving}
            className={`mode-segment-option${active ? ' is-active' : ''}`}
            onClick={() => void setMode(option.value)}
            title={`${option.label}模式`}
          >
            <Icon size={14} />
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export default ThemeSwitcher
