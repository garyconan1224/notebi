import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGS, type LangCode } from '@/locales/i18n'

/**
 * 语言切换器：选择语言只更新草稿，点「确定」才调用 i18n.changeLanguage 真正
 * 切换并持久化（locales/i18n.ts 监听 languageChanged 写 localStorage）；点「取消」还原。
 */
export const LangSwitcher = () => {
  const { i18n, t } = useTranslation('settings')
  const current: LangCode = i18n.language === 'en-US' ? 'en-US' : 'zh-CN'
  const [draft, setDraft] = useState<LangCode>(current)
  const dirty = draft !== current

  return (
    <div className="lang-switcher">
      <select
        className="settings-select lang-switcher-select"
        aria-label={t('layout.language')}
        value={draft}
        onChange={(event) => setDraft(event.target.value as LangCode)}
      >
        {SUPPORTED_LANGS.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
      {dirty && (
        <span className="lang-switcher-actions">
          <button
            type="button"
            className="settings-save-btn"
            onClick={() => void i18n.changeLanguage(draft)}
          >
            确定
          </button>
          <button
            type="button"
            className="settings-reset-btn"
            onClick={() => setDraft(current)}
          >
            取消
          </button>
        </span>
      )}
    </div>
  )
}

export default LangSwitcher
