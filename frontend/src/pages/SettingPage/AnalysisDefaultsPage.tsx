import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import TranscriberPage from './TranscriberPage'
import PerformanceTierPage from './PerformanceTierPage'
import LocalModelsPanel from './LocalModelsPanel'
import { useSettingsShellStore } from '@/store/settingsShellStore'
import { CARD_COLUMN_OPTIONS, useLibraryStore, type CardColumns } from '@/store/libraryStore'
import { AUDIO_ERROR_GUIDANCE } from '@/lib/errorCategories'
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
          <h2>分析默认偏好</h2>
          <div className="settings-header-desc">
            截帧、转写、性能档位等分析任务的默认配置
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
  return (
    <div className="settings-subpanel">
      <section className="settings-card">
        <div className="settings-row">
          <div>
            <div className="settings-row-label">音频笔记错误说明</div>
            <p className="settings-row-hint">结果页会根据错误原因给出同样的分类和处理建议。</p>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          {AUDIO_ERROR_GUIDANCE.map((item) => (
            <div key={item.title} style={{ padding: '12px 14px', border: '1px solid var(--bdr)', borderRadius: 10, background: 'var(--bgalt)' }}>
              <strong style={{ display: 'block', marginBottom: 4 }}>{item.title}</strong>
              <div style={{ color: 'var(--mut)', fontSize: 12, lineHeight: 1.6 }}>可能原因：{item.cause}</div>
              <div style={{ color: 'var(--fg2)', fontSize: 12, lineHeight: 1.6 }}>处理建议：{item.action}</div>
            </div>
          ))}
        </div>
      </section>
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
            <div className="settings-row-hint">控制笔记页和资料库网格视图默认每行显示几个卡片。</div>
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
      .catch(() => toast.error('加载任务默认值失败'))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await updateTaskDefaults(draft)
      const readBack = await getTaskDefaults()
      if (JSON.stringify(readBack) !== JSON.stringify(draft)) {
        toast.error('保存后读回不一致，请重试')
        return
      }
      setSaved(readBack)
      setDraft(readBack)
      toast.success('任务默认值已保存并读回验证')
    } catch {
      toast.error('保存任务默认值失败')
    } finally {
      setSaving(false)
    }
  }, [draft])

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
    return <div className="settings-empty">加载任务默认值…</div>
  }

  return (
    <div className="settings-subpanel">
      <section className="settings-card">
        <label className="settings-inline-field">
          <span>
            <strong>默认摘要模板</strong>
            <p>新建单素材或批量笔记时预先选择，仍可在本次任务中覆盖。</p>
          </span>
          <select
            aria-label="默认摘要模板"
            className="settings-native-select"
            value={draft.summary_template}
            onChange={(event) => setDraft((current) => ({
              ...current,
              summary_template: event.target.value,
            }))}
          >
            <option value="standard">标准总结</option>
            <option value="concise">精简摘要</option>
            <option value="detailed">详细要点</option>
            <option value="outline">大纲</option>
            <option value="lecture">教学笔记</option>
            <option value="steps">步骤教程</option>
            <option value="quotes">金句提取</option>
          </select>
        </label>
        <label className="settings-inline-field">
          <span>
            <strong>总结输出语言</strong>
            <p>不改变原始字幕；新建总结默认按这里的语言生成，单次生成时仍可覆盖。</p>
          </span>
          <select
            aria-label="总结输出语言"
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
            <option value="zh-Hans">简体中文</option>
            <option value="zh-Hant">繁体中文</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
            <option value="ko">한국어</option>
            <option value="source">跟随原文</option>
            <option value="custom">自定义语言标签</option>
          </select>
        </label>
        {draft.summary_language === 'custom' && (
          <label className="settings-inline-field">
            <span>
              <strong>自定义语言标签</strong>
              <p>使用 BCP-47 标签，例如 fr、de 或 pt-BR。</p>
            </span>
            <input
              aria-label="自定义语言标签"
              className="settings-native-select"
              value={draft.summary_language_custom}
              placeholder="例如 fr"
              onChange={(event) => setDraft((current) => ({
                ...current,
                summary_language_custom: event.target.value,
              }))}
            />
          </label>
        )}
        <label className="settings-inline-field">
          <span>
            <strong>视频画面分析与笔记配图</strong>
            <p>关闭后视频任务默认生成纯文字笔记。</p>
          </span>
          <input
            aria-label="视频画面分析与笔记配图"
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
            <strong>默认截帧间隔</strong>
            <p>视频画面分析时每隔多少秒取一帧，正整数秒，无上限。</p>
          </span>
          <input
            aria-label="默认截帧间隔"
            className="settings-native-select"
            type="number"
            min={1}
            value={draft.frame_interval_sec}
            onChange={(event) => setDraft((current) => ({
              ...current,
              frame_interval_sec: Number(event.target.value),
            }))}
          />
        </label>
        <label className="settings-inline-field">
          <span>
            <strong>默认区分说话人</strong>
            <p>适用于音频和视频转写，并影响说话人总结方式。</p>
          </span>
          <input
            aria-label="默认区分说话人"
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
            <strong>默认说话人数</strong>
            <p>不知道人数时保持自动判断。</p>
          </span>
          <select
            aria-label="默认说话人数"
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
            <option value="auto">自动判断</option>
            {[2, 3, 4, 5].map((count) => (
              <option key={count} value={count}>{count} 人</option>
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
