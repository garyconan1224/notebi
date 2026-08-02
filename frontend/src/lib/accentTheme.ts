export const ACCENT_THEME_STORAGE_KEY = 'nibi.accent-theme'

export const ACCENT_THEMES = [
  { id: 'amber', label: '朱橙', color: 'oklch(62% 0.20 55)' },
  { id: 'sage', label: '青苔', color: 'oklch(52% 0.12 155)' },
  { id: 'terra', label: '陶土', color: 'oklch(56% 0.14 35)' },
  { id: 'lavender', label: '紫藤', color: 'oklch(58% 0.14 295)' },
] as const

export type AccentTheme = (typeof ACCENT_THEMES)[number]['id']

function isAccentTheme(value: string | null): value is AccentTheme {
  return ACCENT_THEMES.some((theme) => theme.id === value)
}

export function getStoredAccentTheme(): AccentTheme {
  if (typeof window === 'undefined') return 'amber'
  const stored = window.localStorage.getItem(ACCENT_THEME_STORAGE_KEY)
  return isAccentTheme(stored) ? stored : 'amber'
}

export function applyAccentTheme(theme: AccentTheme, persist = true) {
  if (typeof document === 'undefined') return
  if (theme === 'amber') document.documentElement.removeAttribute('data-accent')
  else document.documentElement.setAttribute('data-accent', theme)
  if (persist && typeof window !== 'undefined') {
    window.localStorage.setItem(ACCENT_THEME_STORAGE_KEY, theme)
  }
}

export function initializeAccentTheme() {
  applyAccentTheme(getStoredAccentTheme(), false)
}
