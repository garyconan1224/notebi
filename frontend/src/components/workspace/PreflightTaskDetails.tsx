import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  RadioGroup,
  RadioGroupItem,
} from '@/components/ui/radio-group'
import {
  ASSOCIATION_DIRECTION_LABELS,
  VIDEO_TEMPLATE_OPTIONS,
  type AssociationDirection,
  type AudioAsrParams,
  type ImageAssociationParams,
  type ImageFramePromptsParams,
  type MusicAnalysisParams,
  type TextAssociationParams,
  type TextRewriteParams,
  type TextSummaryParams,
  type TextTranslateParams,
  type VideoFramePromptsParams,
  type VideoSummaryParams,
} from '@/lib/preflightTasks'
import type { ItemType } from '@/types/workspace'

/**
 * Preflight 抽屉里"任务详情"区域：当某个一级任务被勾选后展开的子参数表单。
 *
 * 每种素材-任务组合一个小组件，统一从 `params` props 读、`onChange` 写。
 * 父组件 `PreflightConfigPanel` 负责把 `tasks[id]` 通过 `getTaskParams` 拍平后传入。
 */

export interface TaskDetailsProps {
  type: ItemType
  taskId: string
  params: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}

export function TaskDetails({ type, taskId, params, onChange }: TaskDetailsProps) {
  // 视频
  if (type === 'video' && taskId === 'frame_prompt') {
    return (
      <VideoFramePromptsDetails
        params={params as unknown as VideoFramePromptsParams}
        onChange={(p) => onChange(p as unknown as Record<string, unknown>)}
      />
    )
  }
  if (type === 'video' && taskId === 'summary') {
    return (
      <VideoSummaryDetails
        params={params as unknown as VideoSummaryParams}
        onChange={(p) => onChange(p as unknown as Record<string, unknown>)}
      />
    )
  }
  // 音频
  if (type === 'audio' && taskId === 'asr_summary') {
    return (
      <AudioAsrDetails
        params={params as unknown as AudioAsrParams}
        onChange={(p) => onChange(p as unknown as Record<string, unknown>)}
      />
    )
  }
  if ((type === 'video' || type === 'audio') && taskId === 'music_analysis') {
    return (
      <MusicAnalysisDetails
        params={params as unknown as MusicAnalysisParams}
        onChange={(p) => onChange(p as unknown as Record<string, unknown>)}
      />
    )
  }
  // 图片
  if (type === 'image' && taskId === 'prompt') {
    return (
      <ImageFramePromptsDetails
        params={params as unknown as ImageFramePromptsParams}
        onChange={(p) => onChange(p as unknown as Record<string, unknown>)}
      />
    )
  }
  if (type === 'image' && taskId === 'assoc') {
    return (
      <AssociationDetails
        params={params as unknown as ImageAssociationParams}
        onChange={(p) => onChange(p as unknown as Record<string, unknown>)}
      />
    )
  }
  // 文字
  if (type === 'text' && taskId === 'summary') {
    return (
      <TextSummaryDetails
        params={params as unknown as TextSummaryParams}
        onChange={(p) => onChange(p as unknown as Record<string, unknown>)}
      />
    )
  }
  if (type === 'text' && taskId === 'assoc') {
    return (
      <AssociationDetails
        params={params as unknown as TextAssociationParams}
        onChange={(p) => onChange(p as unknown as Record<string, unknown>)}
      />
    )
  }
  if (type === 'text' && taskId === 'rewrite') {
    return (
      <TextRewriteDetails
        params={params as unknown as TextRewriteParams}
        onChange={(p) => onChange(p as unknown as Record<string, unknown>)}
      />
    )
  }
  if (type === 'text' && taskId === 'translate') {
    return (
      <TextTranslateDetails
        params={params as unknown as TextTranslateParams}
        onChange={(p) => onChange(p as unknown as Record<string, unknown>)}
      />
    )
  }
  return null
}

// ── 视频 · 画面提示词 ───────────────────────────────────
function VideoFramePromptsDetails({
  params,
  onChange,
}: {
  params: VideoFramePromptsParams
  onChange: (next: VideoFramePromptsParams) => void
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">截帧模式</Label>
        <RadioGroup
          value={params.capture_mode}
          onValueChange={(v) =>
            onChange({ ...params, capture_mode: v as 'interval' | 'scene' })
          }
          className="grid grid-cols-2 gap-2"
        >
          <label className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-xs">
            <RadioGroupItem value="scene" />
            <span>AI 镜头分析（默认）</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-xs">
            <RadioGroupItem value="interval" />
            <span>按秒截帧</span>
          </label>
        </RadioGroup>
      </div>

      {params.capture_mode === 'interval' && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">间隔秒数</Label>
            <Input
              type="number"
              min={1}
              max={120}
              value={params.interval_sec}
              onChange={(e) =>
                onChange({ ...params, interval_sec: Number(e.target.value) || 1 })
              }
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">最大帧数</Label>
            <Input
              type="number"
              min={1}
              max={1000}
              value={params.max_frames}
              onChange={(e) =>
                onChange({ ...params, max_frames: Number(e.target.value) || 1 })
              }
            />
          </div>
        </div>
      )}

      {params.capture_mode === 'scene' && (
        <div className="space-y-1">
          <Label className="text-xs">每镜头取帧数</Label>
          <RadioGroup
            value={String(params.scene_frames_per_shot)}
            onValueChange={(v) =>
              onChange({
                ...params,
                scene_frames_per_shot: (Number(v) as 2 | 3) ?? 3,
              })
            }
            className="grid grid-cols-2 gap-2"
          >
            <label className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-xs">
              <RadioGroupItem value="2" />
              <span>2 帧（首 + 尾，简单运镜）</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-xs">
              <RadioGroupItem value="3" />
              <span>3 帧（首 + 中 + 尾，复杂镜头）</span>
            </label>
          </RadioGroup>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">提示词格式</Label>
          <Select
            value={params.format}
            onValueChange={(v) =>
              onChange({ ...params, format: v as 'mj' | 'sd' | 'json' })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mj">Midjourney</SelectItem>
              <SelectItem value="sd">Stable Diffusion</SelectItem>
              <SelectItem value="json">JSON</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">提示词语言</Label>
          <Select
            value={params.lang}
            onValueChange={(v) =>
              onChange({ ...params, lang: v as 'zh' | 'en' })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English（默认）</SelectItem>
              <SelectItem value="zh">中文</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}

// ── 视频 · 文案总结 ─────────────────────────────────────
function VideoSummaryDetails({
  params,
  onChange,
}: {
  params: VideoSummaryParams
  onChange: (next: VideoSummaryParams) => void
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">摘要路径</Label>
        <RadioGroup
          value={params.path}
          onValueChange={(v) =>
            onChange({
              ...params,
              path: v as 'subtitle' | 'detailed' | 'video_model',
            })
          }
          className="space-y-1"
        >
          <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-xs">
            <RadioGroupItem value="subtitle" className="mt-0.5" />
            <div>
              <div className="font-medium">路径 1：字幕直接总结</div>
              <div className="text-muted-foreground">便宜快，适合口播/访谈</div>
            </div>
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-xs">
            <RadioGroupItem value="detailed" className="mt-0.5" />
            <div>
              <div className="font-medium">路径 2：详细总结（套视频类型模板）</div>
              <div className="text-muted-foreground">推荐 · 字幕 + 截帧画面合并分析</div>
            </div>
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-xs">
            <RadioGroupItem value="video_model" className="mt-0.5" />
            <div>
              <div className="font-medium">路径 3：视频大模型直传（Gemini）</div>
              <div className="text-muted-foreground">~$0.05/min，整段视频送大模型</div>
            </div>
          </label>
        </RadioGroup>
      </div>

      {/* 路径 2 时显示视频类型模板 */}
      {params.path === 'detailed' && (
        <div className="space-y-1">
          <Label className="text-xs">视频类型模板</Label>
          <Select
            value={params.video_template}
            onValueChange={(v) =>
              onChange({ ...params, video_template: v as VideoSummaryParams['video_template'] })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VIDEO_TEMPLATE_OPTIONS.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-1">
        <Label className="text-xs">总结深度</Label>
        <Select
          value={params.depth}
          onValueChange={(v) =>
            onChange({ ...params, depth: v as 'brief' | 'normal' | 'deep' })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="brief">简略</SelectItem>
            <SelectItem value="normal">正常（默认）</SelectItem>
            <SelectItem value="deep">深度</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

// ── 音频 · ASR ──────────────────────────────────────────
function AudioAsrDetails({
  params,
  onChange,
}: {
  params: AudioAsrParams
  onChange: (next: AudioAsrParams) => void
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">Whisper 识别语言</Label>
      <Select
        value={params.whisper_lang}
        onValueChange={(v) =>
          onChange({ ...params, whisper_lang: v as AudioAsrParams['whisper_lang'] })
        }
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">自动检测</SelectItem>
          <SelectItem value="zh">中文</SelectItem>
          <SelectItem value="en">英文</SelectItem>
          <SelectItem value="ja">日文</SelectItem>
          <SelectItem value="ko">韩文</SelectItem>
          <SelectItem value="fr">法文</SelectItem>
          <SelectItem value="de">德文</SelectItem>
          <SelectItem value="es">西班牙文</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

// ── 视频/音频 · 音乐分析 ────────────────────────────────
function MusicAnalysisDetails({
  params,
  onChange,
}: {
  params: MusicAnalysisParams
  onChange: (next: MusicAnalysisParams) => void
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs">输出格式</Label>
      <label className="flex cursor-pointer items-center gap-2 text-xs">
        <Checkbox
          checked={params.suno_format}
          onCheckedChange={(v) => onChange({ ...params, suno_format: !!v })}
        />
        <span>Suno 提示词格式</span>
      </label>
      <label className="flex cursor-pointer items-center gap-2 text-xs">
        <Checkbox
          checked={params.udio_format}
          onCheckedChange={(v) => onChange({ ...params, udio_format: !!v })}
        />
        <span>Udio 提示词格式</span>
      </label>
    </div>
  )
}

// ── 图片 · 提示词 ───────────────────────────────────────
function ImageFramePromptsDetails({
  params,
  onChange,
}: {
  params: ImageFramePromptsParams
  onChange: (next: ImageFramePromptsParams) => void
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">提示词格式</Label>
      <Select
        value={params.format}
        onValueChange={(v) =>
          onChange({ ...params, format: v as 'mj' | 'sd' | 'json' })
        }
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="mj">Midjourney</SelectItem>
          <SelectItem value="sd">Stable Diffusion</SelectItem>
          <SelectItem value="json">JSON</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

// ── 图片/文字 · 联想方向 ────────────────────────────────
function AssociationDetails({
  params,
  onChange,
}: {
  params: { enabled: boolean; directions: AssociationDirection[] }
  onChange: (next: { enabled: boolean; directions: AssociationDirection[] }) => void
}) {
  const toggle = (dir: AssociationDirection) => {
    const has = params.directions.includes(dir)
    const next = has
      ? params.directions.filter((d) => d !== dir)
      : [...params.directions, dir]
    onChange({ ...params, directions: next })
  }
  return (
    <div className="space-y-2">
      <Label className="text-xs">联想方向（多选）</Label>
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(ASSOCIATION_DIRECTION_LABELS) as AssociationDirection[]).map(
          (dir) => (
            <label
              key={dir}
              className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-xs"
            >
              <Checkbox
                checked={params.directions.includes(dir)}
                onCheckedChange={() => toggle(dir)}
              />
              <span>{ASSOCIATION_DIRECTION_LABELS[dir]}</span>
            </label>
          ),
        )}
      </div>
    </div>
  )
}

// ── 文字 · 摘要 ─────────────────────────────────────────
function TextSummaryDetails({
  params,
  onChange,
}: {
  params: TextSummaryParams
  onChange: (next: TextSummaryParams) => void
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">摘要长度</Label>
      <Select
        value={params.length}
        onValueChange={(v) =>
          onChange({ ...params, length: v as 'short' | 'medium' | 'long' })
        }
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="short">短（一段话）</SelectItem>
          <SelectItem value="medium">中（默认）</SelectItem>
          <SelectItem value="long">长（多段 + 要点）</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

// ── 文字 · 改写 ─────────────────────────────────────────
function TextRewriteDetails({
  params,
  onChange,
}: {
  params: TextRewriteParams
  onChange: (next: TextRewriteParams) => void
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">改写风格</Label>
      <Select
        value={params.style}
        onValueChange={(v) =>
          onChange({
            ...params,
            style: v as 'formal' | 'casual' | 'concise' | 'rich',
          })
        }
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="formal">正式</SelectItem>
          <SelectItem value="casual">口语</SelectItem>
          <SelectItem value="concise">简洁</SelectItem>
          <SelectItem value="rich">丰富</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

// ── 文字 · 翻译 ─────────────────────────────────────────
function TextTranslateDetails({
  params,
  onChange,
}: {
  params: TextTranslateParams
  onChange: (next: TextTranslateParams) => void
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">目标语言</Label>
      <Select
        value={params.target_lang}
        onValueChange={(v) => onChange({ ...params, target_lang: v })}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="en">English</SelectItem>
          <SelectItem value="zh">中文</SelectItem>
          <SelectItem value="ja">日本語</SelectItem>
          <SelectItem value="ko">한국어</SelectItem>
          <SelectItem value="fr">Français</SelectItem>
          <SelectItem value="de">Deutsch</SelectItem>
          <SelectItem value="es">Español</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
