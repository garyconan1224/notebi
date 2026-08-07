/**
 * 设置页「笔记显示」：笔记结果页正文的阅读偏好（字体 / 字号 / 行高 / 颜色 / 字重）。
 *
 * 这些偏好经 localStorage 持久化，由 NoteShell 以 --note-copy-* 变量
 * 作用于整篇正文，属于页面级显示设置，因此从浮动格式工具栏迁到这里。
 */
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Minus, Plus } from 'lucide-react'

import {
  DEFAULT_EDITOR_PREFS,
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
  FONT_FAMILY_OPTIONS,
  FONT_WEIGHT_OPTIONS,
  LINE_HEIGHT_OPTIONS,
  TONE_OPTIONS,
  readEditorPrefs,
  writeEditorPrefs,
  type NoteEditorPrefs,
} from '@/pages/result/NoteShell/editorPrefs'
import './note-display-settings.css'

export function NoteDisplaySettingsPage() {
  const { t } = useTranslation('settings')
  const [prefs, setPrefs] = useState<NoteEditorPrefs>(readEditorPrefs)

  const update = useCallback((patch: Partial<NoteEditorPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch }
      writeEditorPrefs(next)
      return next
    })
  }, [])

  const reset = useCallback(() => {
    setPrefs((prev) => {
      // textAlign 是文本笔记的逐篇对齐操作，不属于页面级显示偏好
      const next = { ...DEFAULT_EDITOR_PREFS, textAlign: prev.textAlign }
      writeEditorPrefs(next)
      return next
    })
  }, [])

  return (
    <section className="settings-panel" aria-labelledby="note-display-title">
      <header className="settings-header">
        <div>
          <h2 id="note-display-title">{t('noteDisplay.title')}</h2>
          <p className="settings-header-desc">{t('noteDisplay.subtitle')}</p>
        </div>
      </header>

      <div className="settings-section">
        <div className="settings-card">
          <div className="note-display-groups" role="group" aria-label={t('noteDisplay.title')}>
            <div className="nibi-note-pref-group">
              <span className="nibi-note-pref-label">{t('note:editor.fontFamily')}</span>
              <div className="nibi-note-pref-segment">
                {FONT_FAMILY_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={`nibi-note-pref-chip${prefs.fontFamily === option.key ? ' is-active' : ''}`}
                    aria-pressed={prefs.fontFamily === option.key}
                    onClick={() => update({ fontFamily: option.key })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="nibi-note-pref-group">
              <span className="nibi-note-pref-label">{t('note:editor.fontSize')}</span>
              <div className="nibi-note-pref-stepper">
                <button
                  type="button"
                  className="nibi-note-pref-icon-btn"
                  aria-label={t('noteDisplay.decreaseFontSize')}
                  disabled={prefs.fontSize <= EDITOR_FONT_SIZE_MIN}
                  onClick={() => update({ fontSize: Math.max(EDITOR_FONT_SIZE_MIN, prefs.fontSize - 1) })}
                >
                  <Minus size={13} />
                </button>
                <strong>{prefs.fontSize}px</strong>
                <button
                  type="button"
                  className="nibi-note-pref-icon-btn"
                  aria-label={t('noteDisplay.increaseFontSize')}
                  disabled={prefs.fontSize >= EDITOR_FONT_SIZE_MAX}
                  onClick={() => update({ fontSize: Math.min(EDITOR_FONT_SIZE_MAX, prefs.fontSize + 1) })}
                >
                  <Plus size={13} />
                </button>
              </div>
            </div>

            <div className="nibi-note-pref-group">
              <span className="nibi-note-pref-label">{t('note:editor.lineHeight')}</span>
              <div className="nibi-note-pref-segment">
                {LINE_HEIGHT_OPTIONS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`nibi-note-pref-chip${prefs.lineHeight === value ? ' is-active' : ''}`}
                    aria-pressed={prefs.lineHeight === value}
                    onClick={() => update({ lineHeight: value })}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>

            <div className="nibi-note-pref-group">
              <span className="nibi-note-pref-label">{t('note:editor.color')}</span>
              <div className="nibi-note-pref-swatches">
                {TONE_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={`nibi-note-pref-swatch${prefs.textTone === option.key ? ' is-active' : ''}`}
                    style={{ '--swatch-color': option.color } as React.CSSProperties}
                    aria-label={t('note:editor.color')}
                    aria-pressed={prefs.textTone === option.key}
                    onClick={() => update({ textTone: option.key })}
                  >
                    <span aria-hidden="true">{option.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="nibi-note-pref-group">
              <span className="nibi-note-pref-label">{t('note:editor.fontWeight')}</span>
              <div className="nibi-note-pref-segment">
                {FONT_WEIGHT_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={`nibi-note-pref-chip${prefs.fontWeight === option.key ? ' is-active' : ''}`}
                    aria-pressed={prefs.fontWeight === option.key}
                    onClick={() => update({ fontWeight: option.key })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="nibi-note-pref-actions">
              <button type="button" className="nibi-note-pref-ghost" onClick={reset}>
                {t('note:editor.reset')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default NoteDisplaySettingsPage
