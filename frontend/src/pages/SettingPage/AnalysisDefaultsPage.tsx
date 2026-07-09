import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ScreenshotPage from './ScreenshotPage'
import TranscriberPage from './TranscriberPage'
import PromptFormatPage from './PromptFormatPage'
import PerformanceTierPage from './PerformanceTierPage'
import { useSettingsShellStore } from '@/store/settingsShellStore'
import { CARD_COLUMN_OPTIONS, useLibraryStore, type CardColumns } from '@/store/libraryStore'
import { isFeatureEnabled } from '@/config/product'

type TabKey = 'performance' | 'display' | 'screenshot' | 'transcriber' | 'prompt' | 'defaults'

/**
 * 分析默认偏好（SPEC §3.5 第 4 页）。
 *
 * 合并原 ScreenshotPage + TranscriberPage + PromptFormatPage + 任务勾选默认偏好
 * 为一个设置页，内部用 Tabs 切换子视图。
 *
 * 保存/重置入口：子页面继续通过 useSettingsShellStore 推送 SaveBar；
 * 本组件订阅 store 并在页头渲染 settings-save-btn / settings-reset-btn。
 */
export default function AnalysisDefaultsPage() {
  const { t } = useTranslation('settings')
  const [tab, setTab] = useState<TabKey>('performance')
  const showPromptTab = isFeatureEnabled('showPromptFormat')

  useEffect(() => {
    if (!showPromptTab && tab === 'prompt') {
      setTab('performance')
    }
  }, [showPromptTab, tab])

  // 订阅 SaveBar state：子页 push，本组件渲染按钮
  const saveBar = useSettingsShellStore((s) => s.saveBarState)
  const dirty = saveBar.dirtyCount > 0
  const saving = saveBar.saving ?? false

  return (
    <div className="settings-panel">
      {/* 页头：标题 + 保存/重置 */}
      <div className="settings-header">
        <div>
          <h2>分析默认偏好</h2>
          <div className="settings-header-desc">
            截帧、转写、提示词、性能档位等分析任务的默认配置
          </div>
        </div>
        <div className="settings-header-actions">
          <button
            type="button"
            className="settings-reset-btn"
            onClick={saveBar.onReset}
            disabled={!dirty || saving}
          >
            重置
          </button>
          <button
            type="button"
            className="settings-save-btn"
            onClick={saveBar.onSave}
            disabled={!dirty || saving}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      {/* 内部 Tab 切换 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        borderBottom: '1px solid var(--bdr)',
        marginBottom: 20,
      }}>
        <TabBtn
          active={tab === 'performance'}
          onClick={() => setTab('performance')}
        >
          性能档位
        </TabBtn>
        <TabBtn
          active={tab === 'display'}
          onClick={() => setTab('display')}
        >
          显示偏好
        </TabBtn>
        <TabBtn
          active={tab === 'screenshot'}
          onClick={() => setTab('screenshot')}
        >
          {t('layout.menu.screenshot', '截帧设置')}
        </TabBtn>
        <TabBtn
          active={tab === 'transcriber'}
          onClick={() => setTab('transcriber')}
        >
          {t('layout.menu.transcriber', '转写设置')}
        </TabBtn>
        {showPromptTab && (
          <TabBtn
            active={tab === 'prompt'}
            onClick={() => setTab('prompt')}
          >
            {t('layout.menu.promptFormats', '提示词模板')}
          </TabBtn>
        )}
        <TabBtn
          active={tab === 'defaults'}
          onClick={() => setTab('defaults')}
        >
          任务默认勾选
        </TabBtn>
      </div>

      {/* 内容区：只渲染激活的子页面 */}
      <div>
        {tab === 'performance' && <PerformanceTierPage />}
        {tab === 'display' && <DisplayDefaultsPanel />}
        {tab === 'screenshot' && <ScreenshotPage />}
        {tab === 'transcriber' && <TranscriberPage />}
        {showPromptTab && tab === 'prompt' && <PromptFormatPage />}
        {tab === 'defaults' && <TaskDefaultsPlaceholder />}
      </div>
    </div>
  )
}

function DisplayDefaultsPanel() {
  const cardColumns = useLibraryStore((s) => s.cardColumns)
  const setCardColumns = useLibraryStore((s) => s.setCardColumns)

  return (
    <div className="settings-subpanel">
      <section className="settings-card">
        <div className="settings-row">
          <div>
            <div className="settings-row-label">资料库卡片密度</div>
            <div className="settings-row-hint">控制笔记页和复刻页网格视图默认每行显示几个卡片。</div>
          </div>
        </div>
        <label className="settings-inline-field">
          <span>
            <strong>默认每行</strong>
            <p>侧栏收起时会自动多显示一列，方便宽屏快速浏览。</p>
          </span>
          <select
            className="settings-native-select"
            value={cardColumns}
            onChange={(event) => setCardColumns(Number(event.target.value) as CardColumns)}
          >
            {CARD_COLUMN_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
      </section>
    </div>
  )
}

/** 任务默认勾选偏好（SPEC §2.6）——占位，后续实现 */
function TaskDefaultsPlaceholder() {
  return (
    <div className="settings-empty">
      <p>任务默认勾选偏好功能开发中。用户将可自定义「添加素材时默认勾选哪些分析任务」。</p>
    </div>
  )
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        padding: '10px 16px',
        fontSize: 'var(--sm)',
        fontWeight: 500,
        color: active ? 'var(--fg)' : 'var(--mut)',
        borderBottom: active ? '2px solid var(--fg)' : '2px solid transparent',
        transition: 'all 140ms ease',
        background: 'transparent',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}
