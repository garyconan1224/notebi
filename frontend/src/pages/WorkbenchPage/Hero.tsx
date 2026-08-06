import { useTranslation } from 'react-i18next'
export function Hero() {
  const { t } = useTranslation('pages')

  return (
    <section className="hero">
      <div className="hero-pill">v0.3 BETA</div>
      <h1>{t('workbench.heroTitle')}</h1>
      <p>{t('workbench.heroDesc')}</p>
    </section>
  )
}
