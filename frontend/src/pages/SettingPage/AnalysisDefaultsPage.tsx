import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import TranscriberPage from './TranscriberPage'
import PerformanceTierPage from './PerformanceTierPage'
import LocalModelsPanel from './LocalModelsPanel'
import { useSettingsShellStore } from '@/store/settingsShellStore'
import { CARD_COLUMN_OPTIONS, useLibraryStore, type CardColumns } from '@/store/libraryStore'
import { AUDIO_ERROR_GUIDANCE } from '@/lib/errorCategories'
import { PositiveIntInput } from '@/components/ui/positive-int-input'
import {
  getTaskDefaults,
  updateTaskDefaults,
  type TaskDefaults,
} from '@/services/taskDefaults'

type TabKey = 'performance' | 'display' | 'transcriber' | 'local-models' | 'defaults' | 'audio-errors'

/**
 * 分析默认偏好（SPEC §3.5 第 4 页）。
 *
 * 将转写、性能档位和任务勾选默认偏好集中在同一页，内部用 Tabs 切换子视图。
 *
 * 保存/重置入口：子页面继续通过 useSettingsShellStore 推送 SaveBar；
 * 本组件订阅 store 并在页头渲染 settings-save-btn / settings-reset-btn。
 */
export default function AnalysisDefaultsPage() {
  const { t } = useTranslation('settings')
  const [tab, setTab] = useState<TabKey>('performance')

  // 订阅 SaveBar state：子页 push，本组件渲染按钮
  const saveBar = useSettingsShellStore((s) => s.saveBarState)
  const dirty = saveBar.dirtyCount > 0
  const saving = saveBar.saving ?? false

  return (
    <div className="settings-panel">
      {/* 页头：标题 + 保存/重置 */}
      <div className="settings-header">
        <div>
          <h2>{t('analysisDefaults.title')}</h2>
          <div className="settings-header-desc">
            {t('analysisDefaults.subtitle')}
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
            {saving ? t('analysisDefaults.saving') : t('analysisDefaults.save')}
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
          active={tab === 'transcriber'}
          onClick={() => setTab('transcriber')}
        >
          {t('layout.menu.transcriber', '转写设置')}
        </TabBtn>
        <TabBtn
          active={tab === 'local-models'}
          onClick={() => setTab('local-models')}
        >
          本地模型
        </TabBtn>
        <TabBtn
          active={tab === 'defaults'}
          onClick={() => setTab('defaults')}
        >
          任务默认勾选
        </TabBtn>
        <TabBtn
          active={tab === 'audio-errors'}
          onClick={() => setTab('audio-errors')}
        >
          音频错误说明
        </TabBtn>
      </div>

      {/* 内容区：只渲染激活的子页面 */}
      <div>
        {tab === 'performance' && <PerformanceTierPage />}
        {tab === 'display' && <DisplayDefaultsPanel />}
        {tab === 'transcriber' && <TranscriberPage />}
        {tab === 'local-models' && <LocalModelsPanel />}
        {tab === 'defaults' && <TaskDefaultsPanel />}
        {tab === 'audio-errors' && <AudioErrorGuidancePanel />}
      </div>
    </div>
  )
}

function AudioErrorGuidancePanel() {
  const { t } = useTranslation('settings')
  return (
    <div className="settings-subpanel">
      <section className="settings-card">
        <div className="settings-row">
          <div>
            <div className="settings-row-label">{t('analysisDefaults.audioErrorsTitle')}</div>
            <p className="settings-row-hint">{t('analysisDefaults.audioErrorsHint')}</p>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          {AUDIO_ERROR_GUIDANCE.map((item) => (
            <div key={item.title} style={{ padding: '12px 14px', border: '1px solid var(--bdr)', borderRadius: 10, background: 'var(--bgalt)' }}>
              <strong style={{ display: 'block', marginBottom: 4 }}>{item.title}</strong>
              <div style={{ color: 'var(--mut)', fontSize: 12, lineHeight: 1.6 }}>{t('analysisDefaults.cause', { cause: item.cause })}</div>
              <div style={{ color: 'var(--fg2)', fontSize: 12, lineHeight: 1.6 }}>{t('analysisDefaults.action', { action: item.action })}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function DisplayDefaultsPanel() {
  const { t } = useTranslation('settings')
  const cardColumns = useLibraryStore((s) => s.cardColumns)
  const setCardColumns = useLibraryStore((s) => s.setCardColumns)

  return (
    <div className="settings-subpanel">
      <section className="settings-card">
        <div className="settings-row">
          <div>
            <div className="settings-row-label">{t('analysisDefaults.cardDensityTitle')}</div>
            <div className="settings-row-hint">{t('analysisDefaults.cardDensityHint')}</div>
          </div>
        </div>
        <label className="settings-inline-field">
          <span>
            <strong>{t('analysisDefaults.defaultPerRow')}</strong>
            <p>{t('analysisDefaults.cardDensityNote')}</p>
          </span>
          <select
            className="settings-native-select"
            value={cardColumns}
            onChange={(event) => setCardColumns(Number(event.target.value) as CardColumns)}
          >
            {CARD_COLUMN_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{t(`analysisDefaults.columns.${opt.value}`)}</option>
            ))}
          </select>
        </label>
      </section>
    </div>
  )
}

const CODE_TASK_DEFAULTS: TaskDefaults = {
  summary_template: 'standard',
  video_frame_analysis: true,
  frame_interval_sec: 5,
  diarize: false,
  speaker_count: null,
  summary_language: 'zh-Hans',
  summary_language_custom: '',
}

function TaskDefaultsPanel() {
  const { t } = useTranslation('settings')
  const setSaveBar = useSettingsShellStore((state) => state.setSaveBar)
  const resetSaveBar = useSettingsShellStore((state) => state.resetSaveBar)
  const [saved, setSaved] = useState<TaskDefaults>(CODE_TASK_DEFAULTS)
  const [draft, setDraft] = useState<TaskDefaults>(CODE_TASK_DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    getTaskDefaults()
      .then((value) => {
        if (cancelled) return
        setSaved(value)
        setDraft(value)
      })
      .catch(() => toast.error(t('analysisDefaults.loadTaskDefaultsFailed')))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [t])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await updateTaskDefaults(draft)
      const readBack = await getTaskDefaults()
      if (JSON.stringify(readBack) !== JSON.stringify(draft)) {
        toast.error(t('analysisDefaults.saveMismatch'))
        return
      }
      setSaved(readBack)
      setDraft(readBack)
      toast.success(t('analysisDefaults.taskDefaultsSaved'))
    } catch {
      toast.error(t('analysisDefaults.taskDefaultsSaveFailed'))
    } finally {
      setSaving(false)
    }
  }, [draft, t])

  const dirty = JSON.stringify(saved) !== JSON.stringify(draft)
  useEffect(() => {
    setSaveBar({
      dirtyCount: dirty ? 1 : 0,
      saving,
      onSave: handleSave,
      onReset: () => setDraft(saved),
    })
  }, [dirty, handleSave, saved, saving, setSaveBar])
  useEffect(() => () => resetSaveBar(), [resetSaveBar])

  if (loading) {
    return <div className="settings-empty">{t('analysisDefaults.loadingTaskDefaults')}</div>
  }

  return (
    <div className="settings-subpanel">
      <section className="settings-card">
        <label className="settings-inline-field">
          <span>
            <strong>{t('analysisDefaults.summaryTemplateLabel')}</strong>
            <p>{t('analysisDefaults.summaryTemplateHint')}</p>
          </span>
          <select
            aria-label={t('analysisDefaults.summaryTemplateLabel')}
            className="settings-native-select"
            value={draft.summary_template}
            onChange={(event) => setDraft((current) => ({
              ...current,
              summary_template: event.target.value,
            }))}
          >
            <option value="standard">{t('analysisDefaults.templateStandard')}</option>
            <option value="concise">{t('analysisDefaults.templateConcise')}</option>
            <option value="detailed">{t('analysisDefaults.templateDetailed')}</option>
            <option value="outline">{t('analysisDefaults.templateOutline')}</option>
            <option value="lecture">{t('analysisDefaults.templateLecture')}</option>
            <option value="steps">{t('analysisDefaults.templateSteps')}</option>
            <option value="quotes">{t('analysisDefaults.templateQuotes')}</option>
          </select>
        </label>
        <label className="settings-inline-field">
          <span>
            <strong>{t('analysisDefaults.summaryLanguageLabel')}</strong>
            <p>{t('analysisDefaults.summaryLanguageHint')}</p>
          </span>
          <select
            aria-label={t('analysisDefaults.summaryLanguageLabel')}
            className="settings-native-select"
            value={draft.summary_language}
            onChange={(event) => setDraft((current) => ({
              ...current,
              summary_language: event.target.value as TaskDefaults['summary_language'],
              summary_language_custom: event.target.value === 'custom'
                ? current.summary_language_custom
                : '',
            }))}
          >
            <option value="zh-Hans">{t('analysisDefaults.langZhHans')}</option>
            <option value="zh-Hant">{t('analysisDefaults.langZhHant')}</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
            <option value="ko">한국어</option>
            <option value="source">{t('analysisDefaults.langSource')}</option>
            <option value="custom">{t('analysisDefaults.langCustom')}</option>
          </select>
        </label>
        {draft.summary_language === 'custom' && (
          <label className="settings-inline-field">
            <span>
              <strong>{t('analysisDefaults.customLanguageLabel')}</strong>
              <p>{t('analysisDefaults.customLanguageHint')}</p>
            </span>
            <input
              aria-label={t('analysisDefaults.customLanguageLabel')}
              className="settings-native-select"
              value={draft.summary_language_custom}
              placeholder={t('analysisDefaults.customLanguagePlaceholder')}
              onChange={(event) => setDraft((current) => ({
                ...current,
                summary_language_custom: event.target.value,
              }))}
            />
          </label>
        )}
        <label className="settings-inline-field">
          <span>
            <strong>{t('analysisDefaults.frameAnalysisLabel')}</strong>
            <p>{t('analysisDefaults.frameAnalysisHint')}</p>
          </span>
          <input
            aria-label={t('analysisDefaults.frameAnalysisLabel')}
            type="checkbox"
            checked={draft.video_frame_analysis}
            onChange={(event) => setDraft((current) => ({
              ...current,
              video_frame_analysis: event.target.checked,
            }))}
          />
        </label>
        <label className="settings-inline-field">
          <span>
            <strong>{t('analysisDefaults.frameIntervalLabel')}</strong>
            <p>{t('analysisDefaults.frameIntervalHint')}</p>
          </span>
          <PositiveIntInput
            aria-label={t('analysisDefaults.frameIntervalLabel')}
            className="settings-native-select"
            value={draft.frame_interval_sec}
            quickOptions={[5, 10, 30, 60]}
            onChange={(next) => setDraft((current) => ({
              ...current,
              frame_interval_sec: next,
            }))}
          />
        </label>
        <label className="settings-inline-field">
          <span>
            <strong>{t('analysisDefaults.diarizeLabel')}</strong>
            <p>{t('analysisDefaults.diarizeHint')}</p>
          </span>
          <input
            aria-label={t('analysisDefaults.diarizeLabel')}
            type="checkbox"
            checked={draft.diarize}
            onChange={(event) => setDraft((current) => ({
              ...current,
              diarize: event.target.checked,
              speaker_count: event.target.checked
                ? current.speaker_count
                : null,
            }))}
          />
        </label>
        <label className="settings-inline-field">
          <span>
            <strong>{t('analysisDefaults.speakerCountLabel')}</strong>
            <p>{t('analysisDefaults.speakerCountHint')}</p>
          </span>
          <select
            aria-label={t('analysisDefaults.speakerCountLabel')}
            className="settings-native-select"
            disabled={!draft.diarize}
            value={draft.speaker_count?.toString() ?? 'auto'}
            onChange={(event) => setDraft((current) => ({
              ...current,
              speaker_count: event.target.value === 'auto'
                ? null
                : Number(event.target.value),
            }))}
          >
            <option value="auto">{t('analysisDefaults.autoDetect')}</option>
            {[2, 3, 4, 5].map((count) => (
              <option key={count} value={count}>{t('analysisDefaults.peopleCount', { count })}</option>
            ))}
          </select>
        </label>
      </section>
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
