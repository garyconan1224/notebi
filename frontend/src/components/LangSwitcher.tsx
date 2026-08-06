import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGS, type LangCode } from '@/locales/i18n'

/**
 * 语言下拉（受控）：只负责选择语言草稿；真正切换与持久化由父级
 * （GeneralSettingsPage）在页头「确定/取消」触发——布局对齐「分析默认偏好」
 * 页的页头 保存/重置，避免语言行内联按钮过窄。
 */
export const LangSwitcher = ({
  value,
  onChange,
}: {
  value: LangCode
  onChange: (code: LangCode) => void
}) => {
  const { t } = useTranslation('settings')
  return (
    <select
      className="settings-select lang-switcher-select"
      aria-label={t('layout.language')}
      value={value}
      onChange={(event) => onChange(event.target.value as LangCode)}
    >
      {SUPPORTED_LANGS.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  )
}

export default LangSwitcher
