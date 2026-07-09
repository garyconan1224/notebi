// Phase 3C.6：结果页顶部标签展示 + 重新生成按钮
//
// 纯展示 + 重新生成；不做编辑（编辑留给后续迭代）。

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { RefreshCw } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { SYSTEM_TAG_DIMENSIONS } from '@/constants/tagDimensions'
import { getItemTags, regenerateItemTags } from '@/services/tags'
import type { ItemTags, SystemTagDimension } from '@/types/workspace'

interface ItemTagsPanelProps {
  workspaceId: string
  itemId: string
}

export function ItemTagsPanel({ workspaceId, itemId }: ItemTagsPanelProps) {
  const [tags, setTags] = useState<ItemTags | null>(null)
  const [loading, setLoading] = useState(true)
  const [regenerating, setRegenerating] = useState(false)

  // 首次 mount 拉数据
  useEffect(() => {
    let cancelled = false
    getItemTags(workspaceId, itemId)
      .then((data) => {
        if (!cancelled) setTags(data)
      })
      .catch(() => {
        // 静默：标签拉取失败不影响结果页主体
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [workspaceId, itemId])

  const handleRegenerate = async () => {
    setRegenerating(true)
    try {
      const newTags = await regenerateItemTags(workspaceId, itemId)
      setTags(newTags)
      toast.success('标签已重新生成')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '重新生成失败'
      toast.error(msg)
    } finally {
      setRegenerating(false)
    }
  }

  const isEmpty =
    !tags ||
    SYSTEM_TAG_DIMENSIONS.every((d) => !tags[d.key]) ||
    (SYSTEM_TAG_DIMENSIONS.every((d) => !tags[d.key]) && (!tags.custom_tags || tags.custom_tags.length === 0))

  return (
    <Card className="p-3">
      {/* 标题行 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>内容标签</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRegenerate}
          disabled={regenerating || loading}
          style={{ height: 26, fontSize: 12, gap: 4 }}
        >
          <RefreshCw size={12} className={regenerating ? 'animate-spin' : ''} />
          {regenerating ? '生成中…' : '重新生成'}
        </Button>
      </div>

      {/* 标签内容 */}
      {loading ? (
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>加载标签…</span>
      ) : isEmpty ? (
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          暂无标签，点右上角「重新生成」让 AI 自动打标。
        </span>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {SYSTEM_TAG_DIMENSIONS.map((dim) => {
            const value = tags[dim.key as SystemTagDimension]
            if (!value) return null
            return (
              <Badge key={dim.key} variant="secondary">
                {dim.label} · {value}
              </Badge>
            )
          })}
          {(tags.custom_tags ?? []).map((ct) => (
            <Badge key={ct} variant="outline">
              {ct}
            </Badge>
          ))}
        </div>
      )}
    </Card>
  )
}
