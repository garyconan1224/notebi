import { Settings2, Wand2 } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { PositiveIntInput } from '@/components/ui/positive-int-input'
import { computeAutoInterval, estimateFrames, formatDuration } from './MaterialSourcePanel'

/* ─── types ─── */

export type NoteMediaKind = 'auto' | 'video' | 'image_text' | 'audio' | 'mixed'
export type SpeakerCountChoice = 'auto' | '2' | '3' | '4' | '5'

export interface VisionModelOption {
  providerId: string
  providerName: string
  modelId: string
  modelName: string
}

export interface StyleOption {
  id: string
  label: string
  desc: string
}

export interface NoteSettingsPanelProps {
  selectedNoteType: NoteMediaKind
  onSelectedNoteTypeChange: (value: NoteMediaKind) => void
  noteTypeCards: { value: NoteMediaKind; label: string; desc: string }[]
  noteStyle: string
  onNoteStyleChange: (value: string) => void
  speakerAwareMedia: boolean
  visiblePrimaryStyleOptions: readonly StyleOption[]
  visibleMoreStyleOptions: readonly StyleOption[]
  showSpeakerSettings: boolean
  diarizeOn: boolean
  onDiarizeChange: (enabled: boolean) => void
  speakerCount: SpeakerCountChoice
  onSpeakerCountChange: (value: SpeakerCountChoice) => void
  showFrameAnalysisSettings: boolean
  embedFrames: boolean
  onEmbedFramesChange: (value: boolean) => void
  onUserToggled: () => void
  visionModels: VisionModelOption[]
  hasVisionModel: boolean
  selectedVisionModel: string
  onSelectedVisionModelChange: (value: string) => void
  captureMode: 'auto' | 'manual'
  onCaptureModeChange: (value: 'auto' | 'manual') => void
  frameInterval: number
  onFrameIntervalChange: (value: number) => void
  videoDuration: number
  userNotes: string
  onUserNotesChange: (value: string) => void
}

export function NoteSettingsPanel({
  selectedNoteType,
  onSelectedNoteTypeChange,
  noteTypeCards,
  noteStyle,
  onNoteStyleChange,
  speakerAwareMedia,
  visiblePrimaryStyleOptions,
  visibleMoreStyleOptions,
  showSpeakerSettings,
  diarizeOn,
  onDiarizeChange,
  speakerCount,
  onSpeakerCountChange,
  showFrameAnalysisSettings,
  embedFrames,
  onEmbedFramesChange,
  onUserToggled,
  visionModels,
  hasVisionModel,
  selectedVisionModel,
  onSelectedVisionModelChange,
  captureMode,
  onCaptureModeChange,
  frameInterval,
  onFrameIntervalChange,
  videoDuration,
  userNotes,
  onUserNotesChange,
}: NoteSettingsPanelProps) {
  return (
    <div className="m-section">
      <div className="eyebrow" style={{ marginBottom: 10 }}>③ 笔记设置</div>
      <>
        <div className="note-type-grid">
          {noteTypeCards.map(card => {
            const active = selectedNoteType === card.value
            return (
              <button
                key={card.value}
                type="button"
                className="note-type-card"
                data-active={active}
                onClick={() => onSelectedNoteTypeChange(card.value)}
              >
                <div className="ntc-l">{card.label}</div>
                <div className="ntc-d">{card.desc}</div>
              </button>
            )
          })}
        </div>
        <div style={{ marginTop: 14 }}>
          <div className="gen-field">
            <span className="gen-field-label">{speakerAwareMedia ? '区分说话人的总结方式' : '笔记风格'}</span>
            <Select value={noteStyle} onValueChange={onNoteStyleChange}>
              <SelectTrigger
                aria-label={speakerAwareMedia ? '区分说话人的总结方式' : '笔记风格'}
                style={{ fontSize: 13 }}
              >
                <SelectValue placeholder="选择风格" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel style={{ fontSize: 11, color: 'var(--mut)' }}>常用风格</SelectLabel>
                  {visiblePrimaryStyleOptions.map(opt => (
                    <SelectItem key={opt.id} value={opt.id}>
                      {opt.label}
                      <span style={{ fontSize: 11, color: 'var(--mut)', marginLeft: 6 }}>{opt.desc}</span>
                    </SelectItem>
                  ))}
                </SelectGroup>
                {visibleMoreStyleOptions.length > 0 && (
                  <>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel style={{ fontSize: 11, color: 'var(--mut)' }}>{speakerAwareMedia ? '其他风格' : '更多风格'}</SelectLabel>
                      {visibleMoreStyleOptions.map(opt => (
                        <SelectItem key={opt.id} value={opt.id}>
                          {opt.label}
                          <span style={{ fontSize: 11, color: 'var(--mut)', marginLeft: 6 }}>{opt.desc}</span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
        {showSpeakerSettings && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
            <label className="gen-toggle">
              <Switch checked={diarizeOn} onCheckedChange={onDiarizeChange} />
              <span className="gen-toggle-text">
                <span className="gen-field-label">区分说话人</span>
                <span className="kw" style={{ fontSize: 11 }}>
                  开启后在转写中标注不同说话人，并使用区分说话人的专属总结方式
                </span>
              </span>
            </label>
            {speakerAwareMedia && (
              <div className="gen-field">
                <span className="gen-field-label">预计说话人数</span>
                <Select
                  value={speakerCount}
                  onValueChange={(value) => onSpeakerCountChange(value as SpeakerCountChoice)}
                >
                  <SelectTrigger aria-label="预计说话人数" style={{ fontSize: 13 }}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">自动判断</SelectItem>
                    <SelectItem value="2">2 人</SelectItem>
                    <SelectItem value="3">3 人</SelectItem>
                    <SelectItem value="4">4 人</SelectItem>
                    <SelectItem value="5">5 人</SelectItem>
                  </SelectContent>
                </Select>
                <span className="kw" style={{ fontSize: 11 }}>
                  已知人数时建议明确选择；超过 5 人请使用自动判断。
                </span>
              </div>
            )}
          </div>
        )}
        {showFrameAnalysisSettings && (
          <div className="capture-panel" data-enabled={embedFrames}>
            <div className="capture-head">
              <label htmlFor="add-material-embed" className="capture-main-toggle">
                <Switch
                  id="add-material-embed"
                  checked={embedFrames}
                  onCheckedChange={(v) => {
                    onUserToggled()
                    onEmbedFramesChange(v)
                  }}
                />
                <span className="gen-toggle-text">
                  <span className="gen-field-label">笔记里配图</span>
                  <span className="kw">
                    带图笔记
                  </span>
                </span>
              </label>
              {!embedFrames && (
                <span className="kw">纯文字模式</span>
              )}
            </div>

            {embedFrames ? (
              <div className="capture-tools">
                {visionModels.length > 0 ? (
                  <div className="capture-model-row">
                    <span className="gen-field-label">视觉模型</span>
                    <Select value={selectedVisionModel} onValueChange={onSelectedVisionModelChange}>
                      <SelectTrigger className="capture-model-trigger">
                        <SelectValue placeholder="系统默认" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__default__">系统默认</SelectItem>
                        {visionModels.map(vm => (
                          <SelectItem key={vm.modelId} value={vm.modelId}>
                            {vm.providerName} · {vm.modelName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <span className="kw capture-warning">
                    未检测到视觉模型，将使用纯文字总结。可在「设置 → 模型」中添加。
                  </span>
                )}

                {hasVisionModel && (() => {
                  const autoInterval = computeAutoInterval(videoDuration)
                  const activeInterval = captureMode === 'auto' ? autoInterval : frameInterval
                  const frameEstimate = estimateFrames(videoDuration, activeInterval)
                  return (
                    <div className="capture-strip">
                      <span className="gen-field-label">取画面</span>
                      <div className="capture-segment" role="group" aria-label="取画面模式">
                        <button
                          type="button"
                          data-active={captureMode === 'auto'}
                          onClick={() => onCaptureModeChange('auto')}
                        >
                          <Wand2 size={12} />
                          智能
                        </button>
                        <button
                          type="button"
                          data-active={captureMode === 'manual'}
                          onClick={() => onCaptureModeChange('manual')}
                        >
                          <Settings2 size={12} />
                          手动
                        </button>
                      </div>
                      <label className="capture-interval">
                        <span>每</span>
                        <PositiveIntInput
                          aria-label="截帧间隔秒数"
                          value={activeInterval}
                          disabled={captureMode === 'auto'}
                          quickOptions={[5, 10, 30, 60]}
                          onChange={onFrameIntervalChange}
                        />
                        <span>秒</span>
                      </label>
                      <span className="capture-estimate">
                        {videoDuration > 0 ? `约 ${frameEstimate} 张` : '识别后估算'}
                      </span>
                      {videoDuration > 0 && (
                        <span className="kw">时长 {formatDuration(videoDuration)}</span>
                      )}
                    </div>
                  )
                })()}
              </div>
            ) : null}
          </div>
        )}
        <div style={{ marginTop: showFrameAnalysisSettings ? 12 : 14 }}>
          <div className="gen-field">
            <span className="gen-field-label">补充说明</span>
            <Textarea
              value={userNotes}
              onChange={(e) => onUserNotesChange(e.target.value)}
              placeholder="可选：输入额外要求或上下文，会在生成时附加给模型"
              style={{ fontSize: 13, minHeight: 60 }}
            />
          </div>
        </div>
      </>
    </div>
  )
}
