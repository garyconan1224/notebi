/**
 * SpeakerDiarizationRow — D1 说话人四状态行（Q2）。
 *
 * - none：未请求区分说话人且无数据 → 整层不渲染（无常驻入口）；
 * - running：已请求且处理中 → 紧凑状态行，无重试；
 * - failed：已请求但未得到结果 → 紧凑状态行 + 重试；
 * - data：有说话人数据 → 默认折叠「N 位说话人」，展开可重命名/看统计。
 *
 * 判定依据是后端 speaker_status（task payload 的 diarization 参数兼容推断），
 * 不再只看 speakerIds / speaker_retry_task_id。
 */
import { useState } from 'react'
import type { CSSProperties } from 'react'
import { ChevronDown } from 'lucide-react'

export type SpeakerDiarizationStatus = 'none' | 'running' | 'failed' | 'data'

export interface SpeakerDiarizationInfo {
  id: string
  displayName: string
  role: string
  color: string
  count: number
  durationSec: number
  percent: number
}

interface SpeakerDiarizationRowProps {
  status: SpeakerDiarizationStatus
  speakers: SpeakerDiarizationInfo[]
  onRetry: () => void
  retrying?: boolean
  onRename?: (speakerId: string, name: string, role: string) => void
  roleOptions?: readonly string[]
}

function formatTimecode(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function SpeakerDiarizationRow({
  status,
  speakers,
  onRetry,
  retrying = false,
  onRename,
  roleOptions = [],
}: SpeakerDiarizationRowProps) {
  const [expanded, setExpanded] = useState(false)

  if (status === 'none') return null

  if (status === 'running') {
    return (
      <div className="nibi-speaker-row nibi-speaker-row--running" role="status">
        <span className="nibi-speaker-row-dot" aria-hidden="true" />
        <span>正在区分说话人…</span>
        <small>完成后字幕将按人物显示</small>
      </div>
    )
  }

  if (status === 'failed') {
    return (
      <div className="nibi-speaker-row nibi-speaker-row--failed" role="alert">
        <span className="nibi-speaker-row-dot" aria-hidden="true" />
        <span>区分说话人失败</span>
        <small>现有字幕按单说话人保留，可只补做说话人识别</small>
        <button type="button" onClick={onRetry} disabled={retrying}>
          {retrying ? '正在提交…' : '重试'}
        </button>
      </div>
    )
  }

  // status === 'data'
  const commitEdit = (speakerId: string, name: string, role: string) => {
    onRename?.(speakerId, name, role)
  }

  return (
    <div className={`nibi-speaker-row nibi-speaker-row--data${expanded ? ' is-expanded' : ''}`}>
      <button
        type="button"
        className="nibi-speaker-row-head"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="nibi-speaker-row-swatches" aria-hidden="true">
          {speakers.slice(0, 3).map((speaker) => (
            <span
              key={speaker.id}
              className="nibi-speaker-row-swatch"
              style={{ '--speaker-color': speaker.color } as CSSProperties}
            />
          ))}
        </span>
        <span>{speakers.length} 位说话人</span>
        <ChevronDown size={13} className="nibi-speaker-row-caret" />
      </button>
      {expanded && (
        <div className="nibi-speaker-row-body">
          {speakers.map((speaker) => (
            <SpeakerEditRow
              key={speaker.id}
              speaker={speaker}
              roleOptions={roleOptions}
              onCommit={commitEdit}
            />
          ))}
          <p className="nibi-speaker-row-hint">名称会同步用于字幕标签与历史总结中的人物称呼。</p>
        </div>
      )}
    </div>
  )
}

interface SpeakerEditRowProps {
  speaker: SpeakerDiarizationInfo
  roleOptions: readonly string[]
  onCommit: (speakerId: string, name: string, role: string) => void
}

function SpeakerEditRow({ speaker, roleOptions, onCommit }: SpeakerEditRowProps) {
  const [name, setName] = useState(speaker.displayName)
  const [role, setRole] = useState(speaker.role)

  // 外部保存成功后 displayName 变化时同步输入框（不丢失未保存输入以外的状态）
  const [knownName, setKnownName] = useState(speaker.displayName)
  if (speaker.displayName !== knownName) {
    setKnownName(speaker.displayName)
    setName(speaker.displayName)
    setRole(speaker.role)
  }

  const dirty = name !== speaker.displayName || role !== speaker.role

  return (
    <div className="nibi-speaker-row-item">
      <span
        className="nibi-speaker-row-dot"
        style={{ '--speaker-color': speaker.color } as CSSProperties}
        aria-hidden="true"
      />
      <input
        className="nibi-speaker-row-input"
        value={name}
        aria-label={`${speaker.id} 姓名`}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && dirty) onCommit(speaker.id, name, role)
          if (event.key === 'Escape') {
            setName(speaker.displayName)
            setRole(speaker.role)
          }
        }}
        onBlur={() => {
          if (dirty) onCommit(speaker.id, name, role)
        }}
      />
      {roleOptions.length > 0 && (
        <select
          className="nibi-speaker-row-role"
          aria-label={`${speaker.id} 角色`}
          value={role}
          onChange={(event) => setRole(event.target.value)}
          onBlur={() => {
            if (dirty) onCommit(speaker.id, name, role)
          }}
        >
          <option value="">未设置角色</option>
          {roleOptions.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      )}
      <small>
        {speaker.count} 段 · {formatTimecode(speaker.durationSec)} · {speaker.percent}%
      </small>
    </div>
  )
}
