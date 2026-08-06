import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LangSwitcher } from '@/components/LangSwitcher'
import ThemeSwitcher from '@/components/ThemeSwitcher'
import FontSlotEditor from '@/components/FontSlotEditor'
import { THEME_PACKAGES } from '@/lib/appearanceThemes'
import { useAppearanceStore } from '@/store/appearanceStore'
import type { FontSlotId } from '@/services/settings'
import type { LangCode } from '@/locales/i18n'

const FONT_SLOTS: FontSlotId[] = ['ui', 'cap', 'sum']

export function GeneralSettingsPage() {
  const { i18n, t } = useTranslation('settings')
  const theme = useAppearanceStore((state) => state.theme)
  const saving = useAppearanceStore((state) => state.saving)
  const setTheme = useAppearanceStore((state) => state.setTheme)
  const applyFontPreset = useAppearanceStore((state) => state.applyFontPreset)
  const pendingMigration = useAppearanceStore((state) => state.pendingMigration)
  const acceptMigration = useAppearanceStore((state) => state.acceptMigration)
  const dismissMigration = useAppearanceStore((state) => state.dismissMigration)

  // 语言草稿：下拉只改草稿；页头「确定/取消」真正切换/还原（对齐分析默认偏好页的页头按钮布局）
  const currentLang: LangCode = i18n.language === 'en-US' ? 'en-US' : 'zh-CN'
  const [langDraft, setLangDraft] = useState<LangCode>(currentLang)
  const langDirty = langDraft !== currentLang
  useEffect(() => {
    setLangDraft(currentLang)
  }, [currentLang])

  return (
    <section className="settings-panel" aria-labelledby="general-settings-title">
      <header className="settings-header">
        <div>
          <h2 id="general-settings-title">{t('general.title')}</h2>
          <p className="settings-header-desc">{t('general.subtitle')}</p>
        </div>
        {langDirty && (
          <div className="settings-header-actions">
            <button
              type="button"
              className="settings-reset-btn"
              onClick={() => setLangDraft(currentLang)}
            >
              {t('general.langCancel')}
            </button>
            <button
              type="button"
              className="settings-save-btn"
              onClick={() => void i18n.changeLanguage(langDraft)}
            >
              {t('general.langConfirm')}
            </button>
          </div>
        )}
      </header>

      {pendingMigration && (
        <div className="settings-migration-banner" role="status">
          <span>
            {t('general.migrationTitle', {
              legacy: pendingMigration.legacyAccent,
              suggested: THEME_PACKAGES.find((pkg) => pkg.id === pendingMigration.suggestedTheme)?.name,
            })}
          </span>
          <span className="settings-migration-actions">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => void acceptMigration(pendingMigration.suggestedTheme)}
            >
              {t('general.migrationApply')}
            </button>
            <button type="button" className="btn-ghost" onClick={dismissMigration}>
              {t('general.migrationKeep')}
            </button>
          </span>
        </div>
      )}

      <div className="settings-section">
        <div className="settings-section-title">{t('general.interfaceSection')}</div>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-label">
              <strong>{t('general.languageLabel')}</strong>
              <span>{t('general.languageHint')}</span>
            </div>
            <div className="settings-row-control">
              <LangSwitcher value={langDraft} onChange={setLangDraft} />
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-label">
              <strong>{t('general.themeLabel')}</strong>
              <span>{t('general.themeHint')}</span>
            </div>
            <div className="settings-row-control">
              <ThemeSwitcher />
            </div>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">{t('general.themePackageSection')}</div>
        <div className="theme-package-grid" role="radiogroup" aria-label={t('general.themePackageAria')}>
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
              <span className="theme-package-desc">{t(`general.themePackage.${pkg.id}`)}</span>
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
                {t('general.applyFontPreset')}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">{t('general.fontSection')}</div>
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
