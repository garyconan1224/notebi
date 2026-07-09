import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import zhCommon from './zh-CN/common.json'
import zhSettings from './zh-CN/settings.json'
import zhProviders from './zh-CN/providers.json'
import enCommon from './en-US/common.json'
import enSettings from './en-US/settings.json'
import enProviders from './en-US/providers.json'

export const SUPPORTED_LANGS = [
  { code: 'zh-CN', label: '简体中文' },
  { code: 'en-US', label: 'English' },
] as const

export type LangCode = typeof SUPPORTED_LANGS[number]['code']

const STORAGE_KEY = 'vm.lang'

const resolveInitialLang = (): LangCode => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'zh-CN' || saved === 'en-US') return saved
  } catch {
    /* SSR 或隐身模式下读 localStorage 失败，静默回退 */
  }
  return 'zh-CN'
}

void i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { common: zhCommon, settings: zhSettings, providers: zhProviders },
    'en-US': { common: enCommon, settings: enSettings, providers: enProviders },
  },
  lng: resolveInitialLang(),
  fallbackLng: 'en-US',
  ns: ['common', 'settings', 'providers'],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  returnNull: false,
})

i18n.on('languageChanged', lng => {
  try {
    localStorage.setItem(STORAGE_KEY, lng)
  } catch {
    /* 忽略 localStorage 写入失败 */
  }
})

export default i18n

