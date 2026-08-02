import { LangSwitcher } from '@/components/LangSwitcher'
import ThemeSwitcher from '@/components/ThemeSwitcher'
import { AccentPalettePicker } from '@/components/AccentPalettePicker'

export function GeneralSettingsPage() {
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
          <div className="settings-row">
            <div className="settings-row-label">
              <strong>强调配色</strong>
              <span>只改变按钮、选中态和重点标记，不改变内容类型颜色</span>
            </div>
            <div className="settings-row-control">
              <AccentPalettePicker />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default GeneralSettingsPage
