/**
 * NoteMediaCompanion — R3.2/R3.3 伴随区媒体组件（video + audio 分支）。
 *
 * 复用 ln 的 LNVideoPanel + LNTranscriptPanel（video）；
 * 新建 NoteAudioPanel + LNTranscriptPanel（audio）。
 * 内部维护 currentTime 实现播放器 ↔ 转录轴双向联动。
 */
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react'

import LNVideoPanel, { type LNVideoPanelHandle } from '@/pages/results/LearningNotesPage/LNVideoPanel'
import LNTranscriptPanel from '@/pages/results/LearningNotesPage/LNTranscriptPanel'
import NoteAudioPanel, { type NoteAudioPanelHandle } from './NoteAudioPanel'
import type { NoteMedia, TranscriptTranslations } from '@/types/workspace'

// 复用 ln 样式（全部 scoped 在 .vm-ln-scope 下，不会污染 NoteShell）
import '@/pages/results/LearningNotesPage/learning-notes.css'

/** 转录行结构（与 LNTranscriptPanel 的 VideoResultTranscriptLine 一致） */
interface TranscriptLine {
  t_sec: number
  t_str: string
  text: string
  speaker?: string
}

interface NoteMediaCompanionProps {
  media: NoteMedia
  transcript: TranscriptLine[]
  workspaceId?: string
  itemId?: string
  /** 原始来源URL（B站/抖音等网页链接），视频文件URL无法播放时降级展示 */
  sourceUrl?: string
  translations?: TranscriptTranslations | null
}

export interface NoteMediaCompanionHandle {
  seekTo: (sec: number) => void
}

const NoteMediaCompanion = forwardRef<NoteMediaCompanionHandle, NoteMediaCompanionProps>(function NoteMediaCompanion(
  { media, transcript, workspaceId, itemId, sourceUrl, translations },
  ref,
) {
  const [currentTime, setCurrentTime] = useState(0)
  const videoRef = useRef<LNVideoPanelHandle>(null)
  const audioRef = useRef<NoteAudioPanelHandle>(null)

  // 播放器时间更新 → 驱动转录轴高亮
  const handleTimeUpdate = useCallback((t: number) => {
    setCurrentTime(t)
  }, [])

  // 转录轴点击 → 跳转播放器（video 或 audio）
  const handleSeek = useCallback((sec: number) => {
    videoRef.current?.seekTo(sec)
    audioRef.current?.seekTo(sec)
  }, [])

  useImperativeHandle(ref, () => ({
    seekTo: handleSeek,
  }), [handleSeek])

  // video 分支
  if (media.video?.url || sourceUrl) {
    // 判断 video URL 是否可播放（视频文件）还是网页链接
    const videoUrl = media.video?.url || ''
    const isPlayableVideo = videoUrl.startsWith('/static/') || /\.(mp4|webm|mkv|mov)(\?|$)/i.test(videoUrl)
    const videoSrc = isPlayableVideo ? videoUrl : ''
    const externalUrl = !isPlayableVideo ? (sourceUrl || videoUrl) : undefined

    return (
      <div className="vm-ln-scope" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {/* 播放器 */}
        <div>
          <LNVideoPanel
            ref={videoRef}
            src={videoSrc}
            externalUrl={externalUrl}
            title=""
            workspaceId={workspaceId}
            onTimeUpdate={handleTimeUpdate}
          />
        </div>
        {/* 转录轴 */}
        {transcript.length > 0 && (
          <div className="nibi-note-transcript-wrap">
            <LNTranscriptPanel
              transcript={transcript}
              currentTime={currentTime}
              onSeek={handleSeek}
              workspaceId={workspaceId || ''}
              itemId={itemId || ''}
              translations={translations}
            />
          </div>
        )}
      </div>
    )
  }

  // R3.3: audio 分支
  if (media.audio) {
    return (
      <div className="vm-ln-scope" style={{ display: 'flex', flexDirection: 'column', gap: 0, borderTop: '1px solid var(--bdr)' }}>
        {/* 音频播放器 */}
        <div style={{ padding: '8px 16px' }}>
          <NoteAudioPanel
            ref={audioRef}
            src={media.audio}
            onTimeUpdate={handleTimeUpdate}
          />
        </div>
        {/* 转录轴 */}
        {transcript.length > 0 && (
          <div style={{ maxHeight: 200, overflowY: 'auto', borderTop: '1px solid var(--bdr)' }}>
            <LNTranscriptPanel
              transcript={transcript}
              currentTime={currentTime}
              onSeek={handleSeek}
              workspaceId={workspaceId || ''}
              itemId={itemId || ''}
              translations={translations}
            />
          </div>
        )}
      </div>
    )
  }

  return null
})

export default NoteMediaCompanion
