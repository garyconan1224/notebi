import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import './index.css'
import '@/locales/i18n'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute={['class', 'data-theme']} defaultTheme="system" enableSystem>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
