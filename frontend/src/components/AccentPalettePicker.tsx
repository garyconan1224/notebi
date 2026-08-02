import { useState } from 'react'

import {
  ACCENT_THEMES,
  applyAccentTheme,
  getStoredAccentTheme,
  type AccentTheme,
} from '@/lib/accentTheme'

export function AccentPalettePicker() {
  const [accent, setAccent] = useState<AccentTheme>(getStoredAccentTheme)

  const selectAccent = (next: AccentTheme) => {
    setAccent(next)
    applyAccentTheme(next)
  }

  return (
    <div className="accent-palette" role="radiogroup" aria-label="强调配色">
      {ACCENT_THEMES.map((theme) => (
        <button
          key={theme.id}
          type="button"
          role="radio"
          aria-checked={accent === theme.id}
          className={`accent-palette-option${accent === theme.id ? ' is-active' : ''}`}
          onClick={() => selectAccent(theme.id)}
          title={`${theme.label}配色`}
        >
          <span className="accent-palette-swatch" style={{ background: theme.color }} />
          {theme.label}
        </button>
      ))}
    </div>
  )
}
