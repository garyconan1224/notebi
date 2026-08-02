import { describe, expect, it } from 'vitest'

import { buildVersionDiff } from '@/pages/result/NoteShell/NoteHistoryPanel'

describe('buildVersionDiff', () => {
  it('按段落保留共同内容，并标记左右版本各自的改动', () => {
    expect(buildVersionDiff(
      '# 标题\n\n共同段落\n\n旧结论',
      '# 标题\n\n共同段落\n\n新结论',
    )).toEqual([
      { kind: 'same', text: '# 标题' },
      { kind: 'same', text: '共同段落' },
      { kind: 'removed', text: '旧结论' },
      { kind: 'added', text: '新结论' },
    ])
  })
})
