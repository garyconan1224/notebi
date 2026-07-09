/**
 * FramePickerModal — 学习模式视频帧选择器弹窗。
 *
 * 左侧：系统推荐列表（标 ⭐）
 * 右侧：全部关键帧列表
 * 选中后回调 onSelect。
 */

import { useCallback, useMemo, useState } from 'react'

import type { SuggestedFrame } from '@/services/inlineFrames'

import './frame-picker-modal.css'

export interface FrameItem {
  timestamp: number
  image_path: string
  scene_description?: string
}

interface FramePickerModalProps {
  frames: FrameItem[]
  suggested: SuggestedFrame[]
  currentSegmentIdx: number
  onSelect: (frame: FrameItem) => void
  onClose: () => void
}

function formatTs(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function FramePickerModal({
  frames,
  suggested,
  currentSegmentIdx,
  onSelect,
  onClose,
}: FramePickerModalProps) {
  const [selectedFrame, setSelectedFrame] = useState<FrameItem | null>(null)

  // 当前段落的推荐帧
  const currentSuggested = useMemo(
    () => suggested.filter((s) => s.segment_idx === currentSegmentIdx),
    [suggested, currentSegmentIdx],
  )

  // 推荐帧的 timestamp 集合（用于标 ⭐）
  const suggestedTsSet = useMemo(
    () => new Set(currentSuggested.map((s) => s.frame_timestamp)),
    [currentSuggested],
  )

  const handleConfirm = useCallback(() => {
    if (selectedFrame) {
      onSelect(selectedFrame)
    }
  }, [selectedFrame, onSelect])

  return (
    <div className="fpm-overlay" onClick={onClose}>
      <div className="fpm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fpm-header">
          <span className="fpm-title">选择关键帧</span>
          <span className="fpm-hint">从已截取的关键帧中选择（本期不支持自定义时间截帧）</span>
          <button className="fpm-close" onClick={onClose}>✕</button>
        </div>

        <div className="fpm-body">
          {/* 推荐帧 */}
          {currentSuggested.length > 0 && (
            <div className="fpm-section">
              <div className="fpm-section-label">系统推荐</div>
              <div className="fpm-grid">
                {currentSuggested.map((s) => {
                  const frame: FrameItem = {
                    timestamp: s.frame_timestamp,
                    image_path: s.frame_path,
                    scene_description: s.scene_description,
                  }
                  const isSelected = selectedFrame?.timestamp === s.frame_timestamp
                  return (
                    <div
                      key={s.frame_timestamp}
                      className={`fpm-card ${isSelected ? 'selected' : ''}`}
                      onClick={() => setSelectedFrame(frame)}
                    >
                      <div className="fpm-card-img-wrap">
                        <img src={s.frame_path} alt={s.scene_description} />
                        <span className="fpm-star">⭐</span>
                      </div>
                      <div className="fpm-card-info">
                        <span className="fpm-card-ts">{formatTs(s.frame_timestamp)}</span>
                        {s.scene_description && (
                          <span className="fpm-card-desc">{s.scene_description}</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 全部帧 */}
          <div className="fpm-section">
            <div className="fpm-section-label">全部关键帧</div>
            <div className="fpm-grid">
              {frames.map((f) => {
                const isSelected = selectedFrame?.timestamp === f.timestamp
                const isSuggested = suggestedTsSet.has(f.timestamp)
                return (
                  <div
                    key={f.timestamp}
                    className={`fpm-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedFrame(f)}
                  >
                    <div className="fpm-card-img-wrap">
                      <img src={f.image_path} alt={f.scene_description || ''} />
                      {isSuggested && <span className="fpm-star">⭐</span>}
                    </div>
                    <div className="fpm-card-info">
                      <span className="fpm-card-ts">{formatTs(f.timestamp)}</span>
                      {f.scene_description && (
                        <span className="fpm-card-desc">{f.scene_description}</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="fpm-footer">
          <button className="fpm-btn-cancel" onClick={onClose}>取消</button>
          <button
            className="fpm-btn-confirm"
            disabled={!selectedFrame}
            onClick={handleConfirm}
          >
            插入
          </button>
        </div>
      </div>
    </div>
  )
}
