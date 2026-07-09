import { useTranslation } from 'react-i18next'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SUPPORTED_LANGS } from '@/locales/i18n'

/**
 * 语言切换器：基于已有 shadcn Select 实现，从 SUPPORTED_LANGS 读取可选项。
 * 选中后通过 i18n.changeLanguage 触发全局语言切换，locales/i18n.ts 内部监听
 * languageChanged 事件写入 localStorage，实现持久化。
 */
export const LangSwitcher = () => {
  const { i18n, t } = useTranslation('settings')

  return (
    <Select value={i18n.language} onValueChange={(v) => void i18n.changeLanguage(v)}>
      <SelectTrigger className="w-[132px] h-8 text-sm" aria-label={t('layout.language')}>
        <SelectValue placeholder={t('layout.language')} />
      </SelectTrigger>
      <SelectContent>
        {SUPPORTED_LANGS.map((l) => (
          <SelectItem key={l.code} value={l.code}>
            {l.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export default LangSwitcher

