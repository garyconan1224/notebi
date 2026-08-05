import { LangSwitcher } from '@/components/LangSwitcher'
import ThemeSwitcher from '@/components/ThemeSwitcher'
import FontSlotEditor from '@/components/FontSlotEditor'
import { THEME_PACKAGES } from '@/lib/appearanceThemes'
import { useAppearanceStore } from '@/store/appearanceStore'
import type { FontSlotId } from '@/services/settings'

const FONT_SLOTS: FontSlotId[] = ['ui', 'cap', 'sum']

export function GeneralSettingsPage() {
  const theme = useAppearanceStore((state) => state.theme)
  const saving = useAppearanceStore((state) => state.saving)
  const setTheme = useAppearanceStore((state) => state.setTheme)
  const applyFontPreset = useAppearanceStore((state) => state.applyFontPreset)
  const pendingMigration = useAppearanceStore((state) => state.pendingMigration)
  const acceptMigration = useAppearanceStore((state) => state.acceptMigration)
  const dismissMigration = useAppearanceStore((state) => state.dismissMigration)

  return (
    <section className="settings-panel" aria-labelledby="general-settings-title">
      <header className="settings-header">
        <div>
          <h2 id="general-settings-title">常规与外观</h2>
          <p className="settings-header-desc">
            界面语言和外观只影响 NoteBi 的显示，不改变总结输出语言。
          </p>
        </div>
      </header>

      {pendingMigration && (
        <div className="settings-migration-banner" role="status">
          <span>
            旧的强调配色「{pendingMigration.legacyAccent}」已升级为完整主题，建议切换到
            「{THEME_PACKAGES.find((t) => t.id === pendingMigration.suggestedTheme)?.name}」，也可以任选其他主题。
          </span>
          <span className="settings-migration-actions">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => void acceptMigration(pendingMigration.suggestedTheme)}
            >
              使用建议主题
            </button>
            <button type="button" className="btn-ghost" onClick={dismissMigration}>
              保持当前
            </button>
          </span>
        </div>
      )}

      <div className="settings-section">
        <div className="settings-section-title">界面</div>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-label">
              <strong>界面语言</strong>
              <span>菜单、按钮和提示文字</span>
            </div>
            <div className="settings-row-control">
              <LangSwitcher />
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-label">
              <strong>外观主题</strong>
              <span>浅色、深色或跟随系统</span>
            </div>
            <div className="settings-row-control">
              <ThemeSwitcher />
            </div>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">主题套餐</div>
        <div className="theme-package-grid" role="radiogroup" aria-label="主题套餐">
          {THEME_PACKAGES.map((pkg) => (
            <button
              key={pkg.id}
              type="button"
              role="radio"
              aria-checked={theme === pkg.id}
              disabled={saving}
              className={`theme-package-card${theme === pkg.id ? ' is-active' : ''}`}
              onClick={() => void setTheme(pkg.id)}
            >
              <span className="theme-package-swatches" aria-hidden="true">
                <span style={{ background: pkg.swatches.bg }} />
                <span style={{ background: pkg.swatches.srf }} />
                <span style={{ background: pkg.swatches.acc }} />
              </span>
              <strong>{pkg.name}</strong>
              <span className="theme-package-desc">{pkg.desc}</span>
              <span
                className="theme-package-preset"
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation()
                  void applyFontPreset(pkg.id)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    event.stopPropagation()
                    void applyFontPreset(pkg.id)
                  }
                }}
              >
                套用该主题推荐字体
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">字体</div>
        <div className="font-slot-grid">
          {FONT_SLOTS.map((slot) => (
            <FontSlotEditor key={slot} slot={slot} />
          ))}
        </div>
      </div>
    </section>
  )
}

export default GeneralSettingsPage
