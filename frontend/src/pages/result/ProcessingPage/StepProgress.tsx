import { Download, Subtitles, BookMarked, Check, Eye } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/* ── 步骤定义 ── */

interface StepDef {
  id: string
  name: string
  icon: LucideIcon
}

const STEP_DEFS: Record<string, StepDef> = {
  PENDING:       { id: 'PENDING',       name: '排队',     icon: Download },
  DOWNLOAD:      { id: 'DOWNLOAD',      name: '下载',     icon: Download },
  TRANSCRIBE:    { id: 'TRANSCRIBE',    name: '音频转录', icon: Subtitles },
  ANALYZE:       { id: 'ANALYZE',       name: '画面分析', icon: Eye },
  ANALYZE_NOTE:  { id: 'ANALYZE_NOTE',  name: '生成笔记', icon: BookMarked },
  SUCCESS:       { id: 'SUCCESS',       name: '完成',     icon: Check },
}

/* ── 步骤序列矩阵 ── */

type SourceType = 'local' | 'link' | ''
type NoteKind = 'video' | 'audio' | 'image' | 'image_text' | 'text' | ''

/**
 * 按 source_type × note_kind 返回 UI 步骤 id 序列。
 *
 * 链接视频：排队→下载→转录→分析→生成笔记→完成
 * 本地视频：转录→分析→生成笔记→完成（无下载）
 * 音频：    （链接含下载）→转录→生成笔记→完成（无分析）
 * 图文：    （链接含下载）→分析→生成笔记→完成（无转录）
 * 文字：    生成笔记→完成
 */
function buildStepSequence(sourceType: SourceType, noteKind: NoteKind): string[] {
  const isLocal = sourceType === 'local'
  const isImageLike = noteKind === 'image' || noteKind === 'image_text'
  const isMedia = noteKind === 'video' || noteKind === 'audio' || isImageLike
  const ids: string[] = []

  // 排队（始终有）
  ids.push('PENDING')

  // 下载（仅链接来源的媒体内容；文字链接走 FETCH 不走 DOWNLOAD，无类型时先不显示）
  if (!isLocal && isMedia) ids.push('DOWNLOAD')

  // 转录（视频 + 音频）
  if (noteKind === 'video' || noteKind === 'audio') ids.push('TRANSCRIBE')

  // 分析（视频 + 图文，音频无）
  if (noteKind === 'video' || isImageLike) ids.push('ANALYZE')

  // 生成笔记 + 完成（始终有）
  ids.push('ANALYZE_NOTE', 'SUCCESS')

  return ids
}

/* ── 状态映射 ── */

// #19: 后端 transcribe / analyze 两轨并行执行，对应这两个 UI 步骤同进同出
const PARALLEL_STEP_IDS = new Set(['TRANSCRIBE', 'ANALYZE'])

type StepState = 'queued' | 'running' | 'done'

export interface StepWithState {
  id: string
  name: string
  icon: LucideIcon
  state: StepState
  pct: number
}

/** 后端 status → 当前激活的 UI 步骤 id */
function statusToActiveId(currentStatus: string, stepIds: string[]): string {
  // 终态
  if (currentStatus === 'SUCCESS') return 'SUCCESS'

  // 下载 / 探测
  if (currentStatus === 'DOWNLOAD' || currentStatus === 'PROBE') {
    return stepIds.includes('DOWNLOAD') ? 'DOWNLOAD' : 'PENDING'
  }

  // 转录
  if (currentStatus === 'ASR') {
    return stepIds.includes('TRANSCRIBE') ? 'TRANSCRIBE' : 'ANALYZE_NOTE'
  }

  // 分析（截帧 + 视觉理解）
  if (currentStatus === 'FRAMES' || currentStatus === 'VLM') {
    return stepIds.includes('ANALYZE') ? 'ANALYZE' : 'ANALYZE_NOTE'
  }

  // 生成笔记 / 入库
  if (currentStatus === 'SUM' || currentStatus === 'STORE') return 'ANALYZE_NOTE'

  // PENDING / 其它
  if (currentStatus === 'PENDING') return 'PENDING'

  return 'PENDING'
}

/**
 * 核心函数：根据后端状态 + 内容类型 → 带状态的步骤列表。
 */
export function deriveSteps(
  currentStatus: string,
  progress: number,
  sourceType: SourceType = '',
  noteKind: NoteKind = '',
): StepWithState[] {
  const stepIds = buildStepSequence(sourceType, noteKind)
  const steps: StepDef[] = stepIds.map(id => STEP_DEFS[id]).filter(Boolean)

  // 终态 / 非进度状态
  if (currentStatus === 'SUCCESS') {
    return steps.map(s => ({ ...s, state: 'done' as StepState, pct: 1 }))
  }
  if (currentStatus === 'FAILED' || currentStatus === 'CANCELLED' || currentStatus === 'AWAITING_CONFIRM') {
    return steps.map(s => ({ ...s, state: 'queued' as StepState, pct: 0 }))
  }

  const activeId = statusToActiveId(currentStatus, stepIds)
  const activeIdx = steps.findIndex(s => s.id === activeId)
  // #19: 转录(ASR)与分析(FRAMES/VLM)在后端并行，不能因 status 落在其一就把另一轨标完成。
  // 激活步骤属于并行组时，组内步骤统一 running，直到进入「生成笔记」(activeId 离开并行组) 才整体判完成。
  const activeInParallel = PARALLEL_STEP_IDS.has(activeId)

  return steps.map((step, idx) => {
    if (activeInParallel && PARALLEL_STEP_IDS.has(step.id)) {
      return { ...step, state: 'running', pct: progress }
    }
    if (idx < activeIdx) return { ...step, state: 'done', pct: 1 }
    if (idx === activeIdx) return { ...step, state: progress >= 1 ? 'done' : 'running', pct: progress }
    return { ...step, state: 'queued', pct: 0 }
  })
}

/* ── 组件 ── */

interface StepProgressProps {
  currentStatus: string
  progress: number
  sourceType?: SourceType
  noteKind?: NoteKind
}

export function StepProgress({
  currentStatus,
  progress,
  sourceType = '',
  noteKind = '',
}: StepProgressProps) {
  const steps = deriveSteps(currentStatus, progress, sourceType, noteKind)

  return (
    <div className="step-rail">
      {steps.map((s, idx) => {
        const Icon = s.icon
        return (
          <div key={s.id} className="step-node" data-state={s.state}>
            <div className="node-top">
              {idx > 0 && <span className="connector left" />}
              <span className="dot">
                {s.state === 'done' ? (
                  <Check size={14} strokeWidth={3} />
                ) : s.state === 'running' ? (
                  <span className="ping" />
                ) : (
                  <Icon size={12} />
                )}
              </span>
              {idx < steps.length - 1 && <span className="connector right" />}
            </div>
            <div className="node-label">{s.name}</div>
            <div className="node-sub">
              {s.state === 'running'
                ? `${Math.round(s.pct * 100)}%`
                : s.state === 'done'
                  ? '完成'
                  : ''}
            </div>
          </div>
        )
      })}
    </div>
  )
}
