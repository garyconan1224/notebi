import { useState } from 'react'
import { Loader2, Mic, Music } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { confirmMusicMode } from '@/services/pipeline'

interface MusicModeConfirmModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  taskId: string
  speechRatio: number       // 0.0 ~ 1.0
  totalDuration: number     // 秒
  onConfirmed: () => void
  onCancelled: () => void
}

function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function MusicModeConfirmModal({
  open,
  onOpenChange,
  taskId,
  speechRatio,
  totalDuration,
  onConfirmed,
  onCancelled,
}: MusicModeConfirmModalProps) {
  const [submitting, setSubmitting] = useState(false)
  const pct = Math.round(speechRatio * 100)

  const handleConfirm = async () => {
    setSubmitting(true)
    try {
      await confirmMusicMode(taskId)
      onOpenChange(false)
      onConfirmed()
    } catch (_err) {
      // toast is handled by caller
    } finally {
      setSubmitting(false)
    }
  }

  const handleCancel = () => {
    onOpenChange(false)
    onCancelled()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>未检测到人声</DialogTitle>
          <DialogDescription>
            VAD 人声检测发现该音频人声占比仅 <strong>{pct}%</strong>（总时长{' '}
            {formatDuration(totalDuration)}），可能为纯音乐或环境音。
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border p-3 text-center">
            <Mic className="mx-auto mb-1 h-5 w-5 text-muted-foreground" />
            <div className="text-xs font-medium">人声内容总结</div>
            <div className="text-[11px] text-muted-foreground">
              Whisper 转写 + LLM 总结
            </div>
            <div className="mt-1 text-[11px] text-amber-600">
              当前路径 · 无人声将空跑
            </div>
          </div>
          <div className="rounded-md border border-violet-200 bg-violet-50/30 p-3 text-center">
            <Music className="mx-auto mb-1 h-5 w-5 text-violet-600" />
            <div className="text-xs font-medium text-violet-800">音乐特征分析</div>
            <div className="text-[11px] text-muted-foreground">
              BPM · 风格 · 乐器 · 氛围 · Suno/Udio 提示词
            </div>
            <div className="mt-1 text-[11px] text-violet-600">推荐切换</div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={submitting}>
            保持原样
          </Button>
          <Button onClick={handleConfirm} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                切换中...
              </>
            ) : (
              '切换为音乐分析'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
