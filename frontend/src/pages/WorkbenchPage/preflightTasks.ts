/* Preflight task groups + cascade rules — 1:1 replicas from Remix preflight.jsx */

import type { AnalysisScope } from '@/types/workspace'

export type MediaKind = 'video' | 'audio' | 'image' | 'text'

export interface RadioOption {
  value: string
  label: string
  tooltip?: string
}

export interface TaskChild {
  id: string
  label: string
  type: 'radio' | 'check' | 'number' | 'text' | 'textarea' | 'tag-list'
  options?: (string | RadioOption)[]
  default: string | number | boolean | string[]
  unit?: string
  placeholder?: string
  hint?: string
  whenParent?: string
  whenValue?: string | boolean
}

export interface TaskGroup {
  id: string
  label: string
  sub?: string
  default: boolean
  children?: TaskChild[]
}

export interface TaskState {
  [groupId: string]: { on: boolean; [childId: string]: unknown }
}

export interface CascadeResult {
  state: TaskState
  locks: Record<string, string>
  disabled: Record<string, string>
}

export const MEDIA_KINDS: { id: MediaKind; label: string; tone: string }[] = [
  { id: 'video', label: '视频', tone: 'pink' },
  { id: 'audio', label: '音频', tone: 'purple' },
  { id: 'image', label: '图片', tone: 'blue' },
  { id: 'text', label: '文字', tone: 'amber' },
]

export const MODEL_PRESETS = {
  vision: ['GPT-4o · OpenAI', 'Claude 3.5 Sonnet · Anthropic', 'Qwen-VL-Max · 阿里', 'Gemini 1.5 Pro · Google'],
  text: ['GPT-4o-mini · OpenAI', 'Claude 3.5 Haiku · Anthropic', 'Qwen-Plus · 阿里', 'DeepSeek-V3 · DeepSeek'],
  video: ['Gemini 1.5 Pro · Google', 'Qwen-VL-Max · 阿里', 'GPT-4o · OpenAI'],
}

export const CONTENT_TYPES = ['课程', '会议', '宣传片', 'Vlog', '访谈', '纯音乐', '其他']
export const PURPOSES = ['复刻参考', '竞品分析', '内容学习', '其他']

/* ─── Task checkbox groups per media kind (PRD §4.4) ─── */
export const TASK_GROUPS: Record<MediaKind, TaskGroup[]> = {
  video: [
    {
      id: 'frame_prompt', label: '画面提示词生成', sub: '截帧 · VLM · 提示词', default: true,
      children: [
        { id: 'frame_mode', label: '截帧模式', type: 'radio', options: ['按秒截帧', 'AI 镜头分析'], default: 'AI 镜头分析' },
        { id: 'sec_per_frame', label: '按秒间隔', type: 'number', default: 2, unit: '秒/帧', whenParent: 'frame_mode', whenValue: '按秒截帧' },
        { id: 'max_frames', label: '最大帧数', type: 'number', default: 120, unit: '帧', whenParent: 'frame_mode', whenValue: '按秒截帧' },
        { id: 'shot_frames', label: '镜头取帧', type: 'radio', options: ['2 帧 · 首+尾', '3 帧 · 首+中+尾'], default: '3 帧 · 首+中+尾', whenParent: 'frame_mode', whenValue: 'AI 镜头分析' },
      ],
    },
    {
      id: 'summary', label: '视频文案总结', sub: '只看画面 · 字幕转写 · 音视频综合 · 视频模型', default: true,
      children: [
        { id: 'summary_path', label: '总结路径', type: 'radio', options: ['只看画面', '只听字幕/音频转写', '音视频综合'], default: '音视频综合' },
        { id: 'summary_depth', label: '总结深度', type: 'radio', options: ['简洁', '详细', '带画面引用'], default: '详细', whenParent: 'summary_path', whenValue: '音视频综合' },
        { id: 'embed_frames', label: '嵌入关键帧图片', type: 'check', default: true, hint: '在标准总结中插入截帧配图' },
        { id: 'max_embed_frames', label: '最多嵌入帧数', type: 'number', default: 12, unit: '张', whenParent: 'embed_frames', whenValue: true },
      ],
    },
    { id: 'music', label: '音乐分析', sub: 'BPM / 调性 / 乐器 / 提示词', default: false,
      children: [
        { id: 'music_suno', label: '同时生成 Suno / Udio 格式提示词', type: 'check', default: true },
      ],
    },
    { id: 'srt', label: '字幕导出', sub: '.srt 文件', default: true },
  ],
  audio: [
    {
      id: 'transcribe_summary', label: '人声转写 + 内容总结', sub: 'Whisper · 多语言 · 模板总结', default: true,
      children: [
        { id: 'speaker_diarize', label: '区分说话人音色', type: 'check', default: false,
          hint: '声纹聚类 → 给每个 segment 加 [说话人 A/B] 标签' },
        { id: 'subtitle_export', label: '导出字幕文件', type: 'check', default: false },
        { id: 'include_timestamps', label: '含时间轴', type: 'check', default: true,
          whenParent: 'subtitle_export', whenValue: true,
          hint: '勾上导出 .srt（可二压视频）；不勾导出 .txt 纯文本' },
        { id: 'proper_nouns', label: '专有名词修正', type: 'textarea', default: '',
          placeholder: '人名 / 术语 / 品牌（逗号或换行分隔）',
          hint: '在转写完成后调用 LLM 找读音相近但拼错的词，替换为清单中正确写法',
          whenParent: 'subtitle_export', whenValue: true },
        { id: 'summary_template', label: '总结模板', type: 'radio',
          options: [
            { value: 'concise', label: '简洁摘要', tooltip: '100-200 字一段，适合快速浏览' },
            { value: 'detailed', label: '详细要点', tooltip: '多级 bullet + 关键词，适合深度学习' },
            { value: 'quotes', label: '金句提取', tooltip: '5-10 条独立金句卡片，适合短视频/社媒' },
            { value: 'meeting', label: '会议纪要', tooltip: '议题/决议/待办/参会人 4 段式' },
            { value: 'xhs', label: '小红书风格', tooltip: '标题党+emoji+分段+话题 tag' },
            { value: 'longform', label: '公众号长文', tooltip: '引言/正文(H2分节)/结尾' },
            { value: 'lecture', label: '教学笔记', tooltip: '知识点/例子/重点/延伸阅读' },
            { value: 'interview', label: '访谈整理', tooltip: 'Q&A 对话 + 嘉宾观点摘录' },
            { value: 'shownotes', label: '播客 shownotes', tooltip: '时间戳章节 + 嘉宾介绍 + 推荐链接' },
          ],
          default: 'concise' },
      ],
    },
    { id: 'music', label: '音乐分析', sub: 'BPM / 调性 / 乐器', default: false,
      children: [
        { id: 'music_suno', label: '生成 Suno / Udio 格式提示词', type: 'check', default: true },
      ],
    },
  ],
  image: [
    { id: 'describe', label: '内容识别描述', sub: '主体 / 场景 / 色调 / 构图 / 风格', default: true },
    { id: 'ocr', label: 'OCR 文字提取', sub: '中英混合 · 手写 · 竖排', default: false },
    { id: 'prompt', label: '画面提示词生成', sub: '7 维度自动标签', default: true,
      children: [
        { id: 'prompt_fmt', label: '输出格式', type: 'radio', options: ['Midjourney', 'Stable Diffusion', 'JSON'], default: 'Midjourney' },
      ],
    },
    { id: 'assoc', label: '内容联想总结', sub: '用途 / 设计 / 竞品 / 情绪', default: false,
      children: [
        { id: 'assoc_dirs', label: '联想方向', type: 'tag-list', options: ['用途推断', '设计分析', '竞品洞察', '情绪解读'], default: ['用途推断'] },
      ],
    },
    { id: 'compare', label: '多图对比分析', sub: '仅多张图片时可选', default: false },
  ],
  text: [
    { id: 'summary', label: '摘要 / 要点 / 金句', sub: '一次调用 · 三类输出', default: true,
      children: [
        { id: 'sum_len', label: '摘要长度', type: 'radio', options: ['50 字', '100 字', '200 字'], default: '100 字' },
      ],
    },
    { id: 'assoc', label: '联想归纳', sub: '深度解读 / 观点 / 趋势 / 行动', default: true,
      children: [
        { id: 'assoc_dirs', label: '方向', type: 'tag-list', options: ['深度解读', '观点提炼', '趋势判断', '行动建议'], default: ['深度解读'] },
      ],
    },
    { id: 'rewrite', label: '改写 / 润色', sub: '与原文并排对照', default: false,
      children: [
        { id: 'rw_style', label: '风格', type: 'radio', options: ['正式', '口语', '简洁', '丰富'], default: '简洁' },
      ],
    },
    { id: 'translate', label: '翻译', sub: '目标语言', default: false,
      children: [
        { id: 'tr_lang', label: '目标语言', type: 'text', default: 'English' },
      ],
    },
    { id: 'multi', label: '多文对比', sub: '观点 / 立场 / 时间线', default: false },
  ],
}

/* ─── Cascade rules · spec §4.4 ─────────────────────────────────────
   - 音视频综合 → 强制画面提示词 + 字幕导出
   - 只看画面 → 强制画面提示词，禁用字幕导出
   - 说话人区分 → 强制人声转写
   - 字幕导出 ↔ 人声转写 (同勾同取)
   - 多图/多文对比仅在素材 ≥2 时可选
   返回 { state, locks, disabled } —— locks[gid] = reason 时禁止取消勾选
   ───────────────────────────────────────────────────────────────────── */
export function applyCascades(
  kind: MediaKind,
  raw: TaskState,
  materialCount = 1,
  scope?: AnalysisScope,
  _features?: Record<string, boolean>,
): CascadeResult {
  const s = structuredClone(raw)
  const locks: Record<string, string> = {}
  const disabled: Record<string, string> = {}

  if (kind === 'video' && scope) {
    if (scope === 'visual_only') {
      if (s.summary) {
        s.summary = { ...s.summary, summary_path: '只看画面' }
        locks['summary.summary_path'] = '只看画面模式 · 路径已锁定'
      }
      if (s.srt) { s.srt = { ...s.srt, on: false }; disabled.srt = '只看画面无 ASR' }
      if (s.music) { s.music = { ...s.music, on: false }; disabled.music = '只看画面不分析音频' }
    }
  }

  if (kind === 'video' && s.summary) {
    const path = s.summary.summary_path as string | undefined
    if (s.summary.on && path === '音视频综合') {
      s.frame_prompt = { ...s.frame_prompt, on: true }
      locks.frame_prompt = '音视频综合需要截帧 · 强制开启'
      if (s.srt) {
        s.srt = { ...s.srt, on: true }
        locks.srt = '音视频综合需要字幕/转写 · 强制开启'
      }
    }
    if (s.summary.on && path === '只看画面') {
      s.frame_prompt = { ...s.frame_prompt, on: true }
      locks.frame_prompt = '只看画面需要截帧 · 强制开启'
      if (s.srt) {
        s.srt = { ...s.srt, on: false }
        disabled.srt = '只看画面模式不分析音频'
      }
    }
  }
  if (kind === 'audio') {
    if (s.transcribe_summary) {
      const ts = s.transcribe_summary
      if (ts.speaker_diarize || ts.subtitle_export) {
        if (!ts.on) {
          s.transcribe_summary = { ...ts, on: true }
          locks.transcribe_summary = '说话人区分/字幕导出需要转写'
        }
      }
    }
  }
  if (kind === 'image' && s.compare) {
    if (materialCount < 2) {
      s.compare = { ...s.compare, on: false }
      disabled.compare = `仅 ${materialCount} 张图片 · 至少需要 2 张`
    }
  }
  if (kind === 'text' && s.multi) {
    if (materialCount < 2) {
      s.multi = { ...s.multi, on: false }
      disabled.multi = `仅 ${materialCount} 篇 · 至少需要 2 篇`
    }
  }
  return { state: s, locks, disabled }
}

/** Build initial task state for a given kind from TASK_GROUPS defaults */
export function buildInitialTasks(kind: MediaKind): TaskState {
  const tasks: TaskState = {}
  const groups = TASK_GROUPS[kind] ?? []
  for (const g of groups) {
    const entry: Record<string, unknown> = { on: g.default }
    if (g.children) {
      for (const c of g.children) {
        entry[c.id] = c.default
      }
    }
    tasks[g.id] = entry as TaskState[string]
  }
  return tasks
}
