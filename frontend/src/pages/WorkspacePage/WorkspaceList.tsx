import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, FolderOpen } from 'lucide-react'

import { TagFilterBar } from '@/components/workspace/TagFilterBar'
import { useTagFilter } from './useTagFilter'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
} from '@/services/workspaces'
import {
  countItemsByType,
  ITEM_TYPE_TEXT,
  WORKSPACE_STATUS_TEXT,
  type WorkspaceRecord,
} from '@/types/workspace'

/**
 * 工作空间列表页（设计文档 2.3「任务列表页」）。
 *
 * 路由：/workspaces
 *
 * 关键交互：
 *   - 顶部「新建工作空间」按钮 → 弹模态输入名字 → 创建后跳转详情
 *   - 卡片网格展示，每张卡显示：名称 / 创建时间 / 素材类型分布 / 状态
 *   - 点击卡片 → 进入详情页
 *   - 卡片角的删除按钮 → 二次确认
 */
export default function WorkspaceList() {
  const navigate = useNavigate()
  const [items, setItems] = useState<WorkspaceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 新建模态状态
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState<'note' | 'replica'>('note')
  const [creating, setCreating] = useState(false)

  // 删除确认状态
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceRecord | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Phase 3C.5：tag 筛选（与 URL search params 双向同步）
  const { filter, setFilter, filterItems, hasActiveFilter } = useTagFilter()

  // 合集类型筛选
  const [kindFilter, setKindFilter] = useState<'all' | 'note' | 'replica'>('all')

  // 工作空间显示规则：若有 tag 筛选，仅展示「至少一个 item 命中筛选」的 workspace；
  // 同时把每个 ws 的 items 过滤一次给 WorkspaceCard 做计数；再按 kind 筛选
  const filteredItems = useMemo(() => {
    let result = items
    if (hasActiveFilter) {
      result = result
        .map(ws => ({ ...ws, items: filterItems(ws.items) }))
        .filter(ws => ws.items.length > 0)
    }
    if (kindFilter !== 'all') {
      result = result.filter(ws => ws.kind === kindFilter)
    }
    return result
  }, [items, hasActiveFilter, filterItems, kindFilter])

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listWorkspaces()
      setItems(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      const created = await createWorkspace({ name, kind: newKind })
      setCreateOpen(false)
      setNewName('')
      setNewKind('note')
      // 跳转到详情页（详情页自己会再 GET 一次，确保拿到最新数据）
      navigate(`/workspaces/${created.workspace_id}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '创建失败')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteWorkspace(deleteTarget.workspace_id)
      setDeleteTarget(null)
      await refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
      {/* 顶部：标题 + 新建 */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">合集</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            每个合集可装多种素材（笔记 / 视频 / 音频 / 图片），共享同一个 LLM 上下文。
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          新建合集
        </Button>
      </header>

      {/* 错误提示 */}
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Phase 3C.5：tag 筛选栏 */}
      {!loading && items.length > 0 && (
        <TagFilterBar value={filter} onChange={setFilter} />
      )}

      {/* 合集类型筛选 */}
      {!loading && items.length > 0 && (
        <div className="flex gap-2">
          {(['all', 'note', 'replica'] as const).map(k => (
            <Button
              key={k}
              variant={kindFilter === k ? 'default' : 'outline'}
              size="sm"
              onClick={() => setKindFilter(k)}
            >
              {k === 'all' ? '全部' : k === 'note' ? '📝 笔记' : '🎬 复刻'}
            </Button>
          ))}
        </div>
      )}

      {/* 主体：列表 / 加载 / 空态 */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          illustration={<FolderOpen className="size-6" />}
          title="还没有合集"
          description="新建一个合集，开始添加笔记/视频/音频/图片素材并分析。"
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              新建合集
            </Button>
          }
        />
      ) : filteredItems.length === 0 ? (
        <EmptyState
          illustration={<FolderOpen className="size-6" />}
          title="没有匹配的合集"
          description="当前筛选条件下没有素材命中。试着清除一些维度或调整自定义关键词。"
          action={
            <Button variant="outline" onClick={() => setFilter({ dimensions: {}, customQuery: '' })}>
              清除筛选
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredItems.map((ws) => (
            <WorkspaceCard
              key={ws.workspace_id}
              workspace={ws}
              onOpen={() => navigate(`/workspaces/${ws.workspace_id}`)}
              onDelete={() => setDeleteTarget(ws)}
            />
          ))}
        </div>
      )}

      {/* 新建模态 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建合集</DialogTitle>
            <DialogDescription>
              先取个名字，例如「参考素材 - 某创作者风格」。后续可在详情页添加素材和配置。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="ws-name">合集名称</Label>
            <Input
              id="ws-name"
              autoFocus
              placeholder="参考素材 - 某创作者风格"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newName.trim() && !creating) {
                  handleCreate()
                }
              }}
            />
            <Label>合集类型</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={newKind === 'note' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setNewKind('note')}
              >
                📝 笔记
              </Button>
              <Button
                type="button"
                variant={newKind === 'replica' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setNewKind('replica')}
              >
                🎬 复刻
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              取消
            </Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || creating}>
              {creating ? '创建中…' : '创建并打开'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除？</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除合集「{deleteTarget?.name}」及其内所有素材的引用。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting}>
              {deleting ? '删除中…' : '删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ── 卡片子组件 ────────────────────────────────────────────

interface WorkspaceCardProps {
  workspace: WorkspaceRecord
  onOpen: () => void
  onDelete: () => void
}

function WorkspaceCard({ workspace, onOpen, onDelete }: WorkspaceCardProps) {
  const counts = countItemsByType(workspace)
  const total = workspace.items.length
  const created = formatRelativeTime(workspace.created_at)

  return (
    <Card
      className="group cursor-pointer transition-shadow hover:shadow-md"
      onClick={onOpen}
    >
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="flex items-center gap-2">
          <CardTitle className="line-clamp-2 text-base">{workspace.name}</CardTitle>
          <Badge variant="secondary" className={workspace.kind === 'replica' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}>
            {workspace.kind === 'replica' ? '🎬 复刻' : '📝 笔记'}
          </Badge>
        </div>
        <button
          type="button"
          className="ml-2 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
          aria-label="删除合集"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground">{created}</div>

        {/* 素材类型分布 */}
        {total === 0 ? (
          <div className="text-xs text-muted-foreground">还没有素材</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {(Object.entries(counts) as [keyof typeof ITEM_TYPE_TEXT, number][])
              .filter(([, n]) => n > 0)
              .map(([type, n]) => (
                <Badge key={type} variant="secondary">
                  {n} {ITEM_TYPE_TEXT[type]}
                </Badge>
              ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <Badge variant="outline">{WORKSPACE_STATUS_TEXT[workspace.status]}</Badge>
          <span className="text-xs text-muted-foreground">{total} 个素材</span>
        </div>
      </CardContent>
    </Card>
  )
}

// ── 工具函数 ──────────────────────────────────────────────

function formatRelativeTime(iso: string): string {
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return iso
  const diff = Date.now() - ts
  const min = Math.round(diff / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.round(hr / 24)
  if (day < 30) return `${day} 天前`
  return new Date(iso).toLocaleDateString('zh-CN')
}
