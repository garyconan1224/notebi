import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import '@/locales/i18n'
import App from './App.tsx'
import { initializeAccentTheme } from '@/lib/accentTheme'

// 旧强调色即时回显（后端外观设置加载完成后由主题套餐接管）
initializeAccentTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
