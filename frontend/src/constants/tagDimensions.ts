// Phase 3C: 7 标签维度配置
//
// 注意：这份必须与 shared/config.py::TAG_DIMENSIONS 保持一致。
// 改一边时记得同步另一边（后续若想消除这种重复，可加 GET /tags/config 端点动态拉取）。

import type { SystemTagDimension } from '@/types/workspace'

export interface DimensionSpec {
  key: SystemTagDimension
  label: string
  choices: string[]
}

export const SYSTEM_TAG_DIMENSIONS: DimensionSpec[] = [
  {
    key: 'content_type',
    label: '内容类型',
    choices: ['教程', '访谈', '解说', '纪实', 'Vlog', '新闻', '评测', '其它'],
  },
  {
    key: 'subject_domain',
    label: '主题领域',
    choices: ['科技', '人文', '财经', '教育', '娱乐', '生活', '体育', '其它'],
  },
  {
    key: 'difficulty',
    label: '难度等级',
    choices: ['入门', '进阶', '专家'],
  },
  {
    key: 'duration_band',
    label: '时长档位',
    choices: ['短', '中', '长'],
  },
  {
    key: 'information_density',
    label: '信息密度',
    choices: ['高', '中', '低'],
  },
  {
    key: 'emotion_tone',
    label: '情绪基调',
    choices: ['中性', '激励', '批判', '幽默', '严肃', '悲情'],
  },
]

export const SYSTEM_TAG_DIMENSION_KEYS = SYSTEM_TAG_DIMENSIONS.map(d => d.key)

/** 维度 key → label 反查表 */
export const TAG_DIMENSION_LABELS: Record<SystemTagDimension, string> =
  SYSTEM_TAG_DIMENSIONS.reduce(
    (acc, d) => {
      acc[d.key] = d.label
      return acc
    },
    {} as Record<SystemTagDimension, string>,
  )
