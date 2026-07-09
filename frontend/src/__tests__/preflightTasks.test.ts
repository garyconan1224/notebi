import { describe, expect, it } from 'vitest'
import { applyCascades, buildInitialTasks, TASK_GROUPS } from '@/pages/WorkbenchPage/preflightTasks'
import type { MediaKind, TaskState } from '@/pages/WorkbenchPage/preflightTasks'

function makeState(kind: MediaKind, overrides: Record<string, Partial<{ on: boolean; [k: string]: unknown }>> = {}): TaskState {
  const base = buildInitialTasks(kind)
  for (const [gid, patch] of Object.entries(overrides)) {
    base[gid] = { ...base[gid], ...patch } as TaskState[string]
  }
  return base
}

describe('applyCascades', () => {
  it('video: 音视频综合 → 强制 frame_prompt on + srt on + locked', () => {
    const state = makeState('video', {
      frame_prompt: { on: false },
      srt: { on: false },
      summary: { on: true, summary_path: '音视频综合' },
    })
    const { state: eff, locks } = applyCascades('video', state)
    expect(eff.frame_prompt.on).toBe(true)
    expect(eff.srt.on).toBe(true)
    expect(locks.frame_prompt).toBe('音视频综合需要截帧 · 强制开启')
    expect(locks.srt).toBe('音视频综合需要字幕/转写 · 强制开启')
  })

  it('video: 只看画面 → 强制 frame_prompt on + srt disabled', () => {
    const state = makeState('video', {
      frame_prompt: { on: false },
      srt: { on: true },
      summary: { on: true, summary_path: '只看画面' },
    })
    const { state: eff, locks, disabled } = applyCascades('video', state)
    expect(eff.frame_prompt.on).toBe(true)
    expect(locks.frame_prompt).toBe('只看画面需要截帧 · 强制开启')
    expect(eff.srt.on).toBe(false)
    expect(disabled.srt).toBe('只看画面模式不分析音频')
  })

  it('video: 只听字幕/音频转写 不触发级联', () => {
    const state = makeState('video', {
      frame_prompt: { on: false },
      srt: { on: false },
      summary: { on: true, summary_path: '只听字幕/音频转写' },
    })
    const { state: eff, locks } = applyCascades('video', state)
    expect(eff.frame_prompt.on).toBe(false)
    expect(locks.frame_prompt).toBeUndefined()
  })

  it('video: 只听字幕/音频转写 不触发 frame_prompt 级联', () => {
    const state = makeState('video', {
      summary: { on: true, summary_path: '只听字幕/音频转写' },
    })
    const { locks } = applyCascades('video', state)
    expect(locks.frame_prompt).toBeUndefined()
  })

  it('audio: speaker_diarize on → 强制 transcribe_summary on + locked', () => {
    const state = makeState('audio', {
      transcribe_summary: { on: false, speaker_diarize: true, subtitle_export: false },
    })
    const { state: eff, locks } = applyCascades('audio', state)
    expect(eff.transcribe_summary.on).toBe(true)
    expect(locks.transcribe_summary).toBe('说话人区分/字幕导出需要转写')
  })

  it('audio: subtitle_export on → 强制 transcribe_summary on + locked', () => {
    const state = makeState('audio', {
      transcribe_summary: { on: false, speaker_diarize: false, subtitle_export: true },
    })
    const { state: eff, locks } = applyCascades('audio', state)
    expect(eff.transcribe_summary.on).toBe(true)
    expect(locks.transcribe_summary).toBe('说话人区分/字幕导出需要转写')
  })

  it('audio: speaker_diarize 和 subtitle_export 都关时 transcribe_summary 不受影响', () => {
    const state = makeState('audio', {
      transcribe_summary: { on: false, speaker_diarize: false, subtitle_export: false },
    })
    const { state: eff, locks } = applyCascades('audio', state)
    expect(eff.transcribe_summary.on).toBe(false)
    expect(locks.transcribe_summary).toBeUndefined()
  })

  it('audio: transcribe_summary 已 on 时不重复设置锁', () => {
    const state = makeState('audio', {
      transcribe_summary: { on: true, speaker_diarize: true, subtitle_export: true },
    })
    const { state: eff, locks } = applyCascades('audio', state)
    expect(eff.transcribe_summary.on).toBe(true)
    expect(locks.transcribe_summary).toBeUndefined()
  })

  it('image: 1 张图片时 compare 强制 off + disabled', () => {
    const state = makeState('image', { compare: { on: true } })
    const { state: eff, disabled } = applyCascades('image', state, 1)
    expect(eff.compare.on).toBe(false)
    expect(disabled.compare).toBe('仅 1 张图片 · 至少需要 2 张')
  })

  it('image: 2 张图片时 compare 不限制', () => {
    const state = makeState('image', { compare: { on: true } })
    const { state: eff, locks, disabled } = applyCascades('image', state, 2)
    expect(eff.compare.on).toBe(true)
    expect(locks.compare).toBeUndefined()
    expect(disabled.compare).toBeUndefined()
  })

  it('text: 1 篇素材时 multi 强制 off + disabled', () => {
    const state = makeState('text', { multi: { on: true } })
    const { state: eff, disabled } = applyCascades('text', state, 1)
    expect(eff.multi.on).toBe(false)
    expect(disabled.multi).toBe('仅 1 篇 · 至少需要 2 篇')
  })

  it('text: 3 篇素材时 multi 不限制', () => {
    const state = makeState('text', { multi: { on: true } })
    const { state: eff, locks, disabled } = applyCascades('text', state, 3)
    expect(eff.multi.on).toBe(true)
    expect(locks.multi).toBeUndefined()
    expect(disabled.multi).toBeUndefined()
  })

  it('不修改原始引用 (structuredClone)', () => {
    const state = makeState('video', {
      summary: { on: true, summary_path: '音视频综合' },
    })
    const snapshot = state.summary.on
    applyCascades('video', state)
    expect(state.summary.on).toBe(snapshot)
  })

  it('applyCascades(video, visual_only) 禁用 srt 和 music', () => {
    const init = buildInitialTasks('video')
    const { state, disabled } = applyCascades('video', init, 1, 'visual_only')
    expect(disabled.srt).toBeTruthy()
    expect(disabled.music).toBeTruthy()
    expect(state.summary.summary_path).toBe('只看画面')
  })
})

describe('buildInitialTasks', () => {
  it('video 初始化 4 个任务且 on 值等于 TASK_GROUPS default', () => {
    const tasks = buildInitialTasks('video')
    expect(Object.keys(tasks)).toHaveLength(4)
    expect(tasks.frame_prompt.on).toBe(true)
    expect(tasks.summary.on).toBe(true)
    expect(tasks.music.on).toBe(false)
    expect(tasks.srt.on).toBe(true)
  })

  it('video frame_prompt 包含子参数默认值', () => {
    const tasks = buildInitialTasks('video')
    expect(tasks.frame_prompt.frame_mode).toBe('AI 镜头分析')
    expect(tasks.frame_prompt.shot_frames).toBe('3 帧 · 首+中+尾')
    expect(tasks.summary.summary_path).toBe('音视频综合')
  })

  it('audio 初始化 2 个任务', () => {
    const tasks = buildInitialTasks('audio')
    expect(Object.keys(tasks)).toHaveLength(2)
    expect(tasks.transcribe_summary.on).toBe(true)
    expect(tasks.transcribe_summary.summary_template).toBe('concise')
  })

  it('image 初始化 5 个任务', () => {
    const tasks = buildInitialTasks('image')
    expect(Object.keys(tasks)).toHaveLength(5)
  })

  it('text 初始化 5 个任务', () => {
    const tasks = buildInitialTasks('text')
    expect(Object.keys(tasks)).toHaveLength(5)
    expect(tasks.summary.on).toBe(true)
    expect(tasks.translate.on).toBe(false)
    expect(tasks.translate.tr_lang).toBe('English')
  })

  it('audio 总结模板默认 concise', () => {
    const tasks = buildInitialTasks('audio')
    expect(tasks.transcribe_summary.summary_template).toBe('concise')
  })

  it('audio 字幕导出关时 include_timestamps 和 proper_nouns 有 whenParent 约束', () => {
    const groups = TASK_GROUPS.audio
    const ts = groups.find(g => g.id === 'transcribe_summary')!
    const incTs = ts.children!.find(c => c.id === 'include_timestamps')!
    expect(incTs.whenParent).toBe('subtitle_export')
    expect(incTs.whenValue).toBe(true)
    const pn = ts.children!.find(c => c.id === 'proper_nouns')!
    expect(pn.whenParent).toBe('subtitle_export')
    expect(pn.whenValue).toBe(true)
    const tasks = buildInitialTasks('audio')
    expect(tasks.transcribe_summary.subtitle_export).toBe(false)
  })

  it('video 截帧模式切到 AI 镜头分析时 shot_frames 有 whenParent 约束', () => {
    const groups = TASK_GROUPS.video
    const fp = groups.find(g => g.id === 'frame_prompt')!
    const shotFrames = fp.children!.find(c => c.id === 'shot_frames')!
    expect(shotFrames.whenParent).toBe('frame_mode')
    expect(shotFrames.whenValue).toBe('AI 镜头分析')
    const secPerFrame = fp.children!.find(c => c.id === 'sec_per_frame')!
    expect(secPerFrame.whenParent).toBe('frame_mode')
    expect(secPerFrame.whenValue).toBe('按秒截帧')
  })
})
