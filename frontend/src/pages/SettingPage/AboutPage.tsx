import { useTranslation } from 'react-i18next'
import { useHealthPulse } from '@/hooks/useHealthPulse'

/**
 * 关于页面（M5）
 *
 * 用途：展示应用信息、版本号、技术栈与许可证
 * - 应用信息：从 /health 动态获取版本号
 * - 技术栈：列出核心前端后端依赖
 * - 许可证与开源：MIT License 和 GitHub 链接
 */

interface Dependency {
  name: string
  purpose: string
  version?: string
}

const FRONTEND_DEPS: Dependency[] = [
  { name: 'React', purpose: '前端框架', version: '19.x' },
  { name: 'Vite', purpose: '构建工具', version: '6.x' },
  { name: 'TypeScript', purpose: '类型系统', version: '5.x' },
  { name: 'Tailwind CSS', purpose: '样式框架' },
  { name: 'Zustand', purpose: '状态管理' },
  { name: 'React Router', purpose: '路由管理', version: '7.x' },
  { name: 'React-i18next', purpose: '国际化' },
  { name: 'Lucide React', purpose: 'Icon 库' },
]

const BACKEND_DEPS: Dependency[] = [
  { name: 'FastAPI', purpose: 'Web 框架' },
  { name: 'Pydantic', purpose: '数据验证' },
  { name: 'psutil', purpose: '系统监控' },
  { name: 'python-multipart', purpose: '文件上传' },
  { name: 'python-dotenv', purpose: '环境变量' },
]

export default function AboutPage() {
  const { t } = useTranslation('settings')
  const health = useHealthPulse(0) // 仅执行一次，不轮询

  const dynamicVersion = health.data?.version || t('about.versionNumber')

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <div>
          <h2>{t('about.title')}</h2>
          <div className="settings-header-desc">
            {t('about.subtitle')}
          </div>
        </div>
        <div className="settings-header-actions">
          <span className="status-tag online">
            <span className="status-dot" />
            {t('about.statusActive')}
          </span>
        </div>
      </div>

      {/* Section 1: 应用信息 */}
      <div className="settings-section">
        <div className="settings-section-title">{t('about.appInfoTitle')}</div>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-label">
              {t('about.appName')}
              <div className="settings-row-hint">{t('about.appDescription')}</div>
            </div>
            <div className="settings-row-control" style={{ justifyContent: 'flex-start' }}>
              <p className="text-sm" style={{ color: 'var(--fg2)' }}>{t('about.appSummary')}</p>
            </div>
          </div>

          {/* 版本信息行 */}
          <div className="settings-row">
            <div className="settings-row-label">{t('about.versionLabel')}</div>
            <div className="settings-row-control" style={{ justifyContent: 'flex-start' }}>
              <span style={{ fontFamily: 'var(--fm)', fontSize: 'var(--sm)', fontWeight: 600 }}>
                {dynamicVersion}
              </span>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-label">{t('about.statusLabel')}</div>
            <div className="settings-row-control" style={{ justifyContent: 'flex-start' }}>
              <span className="status-tag online">
                <span className="status-dot" />
                {t('about.statusActive')}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: 技术栈与依赖 */}
      <div className="settings-section">
        <div className="settings-section-title">{t('about.dependenciesTitle')}</div>
        <div className="settings-card">
          {/* 前端依赖 */}
          <div className="settings-row">
            <div className="settings-row-label">{t('about.frontendStack')}</div>
            <div className="settings-row-control" style={{ justifyContent: 'flex-start', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, width: '100%' }}>
              {FRONTEND_DEPS.map((dep) => (
                <div key={dep.name} style={{ fontSize: 'var(--xs)', color: 'var(--fg2)' }}>
                  <span style={{ fontWeight: 500, color: 'var(--fg)' }}>{dep.name}</span>
                  {dep.version ? ` ${dep.version}` : ''}
                  <span style={{ color: 'var(--mut)', marginLeft: 6 }}>{dep.purpose}</span>
                </div>
              ))}
            </div>
          </div>
          {/* 后端依赖 */}
          <div className="settings-row">
            <div className="settings-row-label">{t('about.backendStack')}</div>
            <div className="settings-row-control" style={{ justifyContent: 'flex-start', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, width: '100%' }}>
              {BACKEND_DEPS.map((dep) => (
                <div key={dep.name} style={{ fontSize: 'var(--xs)', color: 'var(--fg2)' }}>
                  <span style={{ fontWeight: 500, color: 'var(--fg)' }}>{dep.name}</span>
                  {dep.version ? ` ${dep.version}` : ''}
                  <span style={{ color: 'var(--mut)', marginLeft: 6 }}>{dep.purpose}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Section 3: 许可证与开源 */}
      <div className="settings-section">
        <div className="settings-section-title">{t('about.licenseTitle')}</div>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-label">
              {t('about.mitLicense')}
              <div className="settings-row-hint">{t('about.licenseText')}</div>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-label">
              {t('about.githubTitle')}
              <div className="settings-row-hint">{t('about.githubDescription')}</div>
            </div>
            <div className="settings-row-control" style={{ justifyContent: 'flex-start' }}>
              <a
                href="https://github.com/your-org/nibi"
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 'var(--sm)', fontWeight: 500, color: 'var(--acc)' }}
              >
                View on GitHub →
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
