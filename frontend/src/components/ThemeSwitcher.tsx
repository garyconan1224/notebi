/**
 * Q6：明暗模式分段（浅 / 深 / 跟随系统）。
 * 外观事实源为后端设置（appearanceStore），本组件只做展示与触发。
 *
 * compact：折叠侧栏场景——只显示当前模式图标，点击弹出选项菜单，
 * 避免三段式（含文字标签，约 180px）在 64px 窄侧栏里横向溢出。
 */
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import type { FC } from 'react'

import { useAppearanceStore } from '@/store/appearanceStore'
import type { ThemeMode } from '@/services/settings'

const MODE_OPTIONS: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
]

const MODE_ICON: Record<ThemeMode, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
}

interface ThemeSwitcherProps {
  compact?: boolean
}

const ThemeSwitcher: FC<ThemeSwitcherProps> = ({ compact = false }) => {
  const mode = useAppearanceStore((state) => state.mode)
  const saving = useAppearanceStore((state) => state.saving)
  const setMode = useAppearanceStore((state) => state.setMode)

  if (compact) {
    const ActiveIcon = MODE_ICON[mode]
    return (
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label="明暗模式"
            title="明暗模式"
            disabled={saving}
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <ActiveIcon size={16} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="top"
            align="start"
            sideOffset={6}
            className="z-50 min-w-[132px] rounded-xl border border-border bg-background p-1 shadow-lg"
          >
            {MODE_OPTIONS.map((option) => {
              const Icon = option.icon
              const active = mode === option.value
              return (
                <DropdownMenu.Item
                  key={option.value}
                  disabled={saving}
                  onSelect={() => void setMode(option.value)}
                  className="flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-foreground outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-foreground"
                >
                  <Icon size={14} />
                  <span className="flex-1">{option.label}</span>
                  {active && <Check size={14} className="shrink-0" />}
                </DropdownMenu.Item>
              )
            })}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    )
  }

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
