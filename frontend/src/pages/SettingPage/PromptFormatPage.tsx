import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { Skeleton } from '@/components/ui/skeleton'

import {
  type PromptFormat,
  type PromptFormatCategory,
  type PromptFormatsConfig,
  getPromptFormatsConfig,
  resetPromptFormatsConfig,
  savePromptFormatsConfig,
} from '@/services/promptFormats'

const PLACEHOLDER_HINT = [
  '{ts}  帧时间戳 (MM:SS)',
  '{title} / {subtitle}',
  '{description}  英文描述',
  '{tags}  全部标签平铺',
  '{tags.style} / {tags.lighting} / {tags.composition} / {tags.color} / {tags.lens} / {tags.subject} / {tags.scene}',
  '{prompt_mj} / {prompt_video}',
  '未识别 {xxx} 会原样保留，不会报错',
].join('\n')

type EditorState =
  | { kind: 'closed' }
  | { kind: 'add'; category: PromptFormatCategory }
  | { kind: 'edit'; original: PromptFormat }

interface FormatDraft {
  id: string
  name: string
  template: string
  description: string
}

const emptyDraft: FormatDraft = { id: '', name: '', template: '', description: '' }

export default function PromptFormatPage() {
  const [cfg, setCfg] = useState<PromptFormatsConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<PromptFormatCategory>('image')
  const [editor, setEditor] = useState<EditorState>({ kind: 'closed' })
  const [draft, setDraft] = useState<FormatDraft>(emptyDraft)
  const [pendingDelete, setPendingDelete] = useState<PromptFormat | null>(null)
  const [resetPending, setResetPending] = useState(false)

  useEffect(() => {
    let cancelled = false
    getPromptFormatsConfig()
      .then((data) => {
        if (!cancelled) setCfg(data)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          toast.error('加载提示词格式失败：' + (err instanceof Error ? err.message : '未知错误'))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const imageFormats = useMemo(
    () => cfg?.formats.filter((f) => f.category === 'image') ?? [],
    [cfg],
  )
  const videoFormats = useMemo(
    () => cfg?.formats.filter((f) => f.category === 'video') ?? [],
    [cfg],
  )

  const persist = useCallback(
    async (nextFormats: PromptFormat[], successMsg: string) => {
      if (!cfg) return
      try {
        const saved = await savePromptFormatsConfig({
          formats: nextFormats,
          active_image_ids: cfg.active_image_ids,
          active_video_ids: cfg.active_video_ids,
        })
        setCfg(saved)
        toast.success(successMsg)
      } catch (err) {
        toast.error('保存失败：' + (err instanceof Error ? err.message : '未知错误'))
      }
    },
    [cfg],
  )

  const openAdd = (category: PromptFormatCategory) => {
    setDraft(emptyDraft)
    setEditor({ kind: 'add', category })
  }

  const openEdit = (fmt: PromptFormat) => {
    setDraft({ id: fmt.id, name: fmt.name, template: fmt.template, description: fmt.description })
    setEditor({ kind: 'edit', original: fmt })
  }

  const submitEditor = async () => {
    if (!cfg) return
    const id = draft.id.trim()
    const name = draft.name.trim()
    if (!id) {
      toast.error('ID 不能为空')
      return
    }
    if (!name) {
      toast.error('名字不能为空')
      return
    }
    if (editor.kind === 'add') {
      if (cfg.formats.some((f) => f.id === id)) {
        toast.error(`ID "${id}" 已存在`)
        return
      }
      const next: PromptFormat = {
        id,
        name,
        category: editor.category,
        template: draft.template,
        description: draft.description.trim(),
        is_default: false,
      }
      await persist([...cfg.formats, next], `已新增「${name}」`)
    } else if (editor.kind === 'edit') {
      const { original } = editor
      if (id !== original.id && cfg.formats.some((f) => f.id === id)) {
        toast.error(`ID "${id}" 已存在`)
        return
      }
      const next = cfg.formats.map((f) =>
        f.id === original.id
          ? {
              ...f,
              id,
              name,
              template: draft.template,
              description: draft.description.trim(),
            }
          : f,
      )
      await persist(next, `已更新「${name}」`)
    }
    setEditor({ kind: 'closed' })
  }

  const confirmDelete = async () => {
    if (!cfg || !pendingDelete) return
    const removed = pendingDelete
    const next = cfg.formats.filter((f) => f.id !== removed.id)
    setPendingDelete(null)
    await persist(next, `已删除「${removed.name}」`)
  }

  const confirmReset = async () => {
    setResetPending(false)
    try {
      const fresh = await resetPromptFormatsConfig()
      setCfg(fresh)
      toast.success('已恢复默认模板')
    } catch (err) {
      toast.error('重置失败：' + (err instanceof Error ? err.message : '未知错误'))
    }
  }

  if (loading) {
    return (
      <div className="p-6 space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }
  if (!cfg) {
    return <div className="p-6 text-sm text-destructive">未能加载提示词格式配置</div>
  }

  return (
    <div className="p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold">提示词格式</h2>
          <p className="text-sm text-muted-foreground mt-1">
            管理图片类与视频类提示词模板。模板内可用 <code>{'{placeholder}'}</code> 占位符，
            结果页按当前帧数据渲染。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setResetPending(true)}>
          <RotateCcw className="size-4" /> 恢复默认
        </Button>
      </div>

      <details className="rounded-lg border bg-muted/30 px-4 py-2 text-xs">
        <summary className="cursor-pointer font-medium text-foreground">
          可用占位符（点击展开）
        </summary>
        <pre className="mt-2 whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
          {PLACEHOLDER_HINT}
        </pre>
      </details>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as PromptFormatCategory)}>
        <TabsList>
          <TabsTrigger value="image">图片类 ({imageFormats.length})</TabsTrigger>
          <TabsTrigger value="video">视频类 ({videoFormats.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="image" className="space-y-3">
          <FormatList
            formats={imageFormats}
            onAdd={() => openAdd('image')}
            onEdit={openEdit}
            onDelete={setPendingDelete}
          />
        </TabsContent>

        <TabsContent value="video" className="space-y-3">
          <FormatList
            formats={videoFormats}
            onAdd={() => openAdd('video')}
            onEdit={openEdit}
            onDelete={setPendingDelete}
          />
        </TabsContent>
      </Tabs>

      {/* 新增 / 编辑 Dialog */}
      <Dialog
        open={editor.kind !== 'closed'}
        onOpenChange={(open) => {
          if (!open) setEditor({ kind: 'closed' })
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editor.kind === 'add'
                ? `新增${editor.category === 'image' ? '图片类' : '视频类'}格式`
                : editor.kind === 'edit'
                  ? `编辑「${editor.original.name}」`
                  : ''}
            </DialogTitle>
            <DialogDescription>
              ID 是稳定的内部 key（仅英文字母 / 数字 / 下划线建议），名字是显示用文案。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="fmt-id">ID</Label>
              <Input
                id="fmt-id"
                value={draft.id}
                onChange={(e) => setDraft({ ...draft, id: e.target.value })}
                placeholder="例：custom_a"
                disabled={editor.kind === 'edit' && editor.original.is_default}
              />
              {editor.kind === 'edit' && editor.original.is_default && (
                <p className="mt-1 text-xs text-muted-foreground">
                  默认模板的 ID 不可改，避免破坏前端引用
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="fmt-name">名字</Label>
              <Input
                id="fmt-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="例：自定义格式 A"
              />
            </div>
            <div>
              <Label htmlFor="fmt-template">模板</Label>
              <Textarea
                id="fmt-template"
                value={draft.template}
                onChange={(e) => setDraft({ ...draft, template: e.target.value })}
                placeholder="{description}, {tags.style}, --ar 16:9"
                rows={5}
                className="font-mono text-xs"
              />
            </div>
            <div>
              <Label htmlFor="fmt-desc">描述（可选）</Label>
              <Input
                id="fmt-desc"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="一行简介，在列表里显示"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditor({ kind: 'closed' })}>
              取消
            </Button>
            <Button onClick={submitEditor}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除「{pendingDelete?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.is_default
                ? '这是默认模板。删除后可通过「恢复默认」找回。'
                : '此操作会从配置中移除该格式。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 重置确认 */}
      <AlertDialog open={resetPending} onOpenChange={setResetPending}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>恢复默认模板？</AlertDialogTitle>
            <AlertDialogDescription>
              所有自定义模板会丢失，预置的 12 条模板会回到初始状态。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmReset}>恢复默认</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

interface FormatListProps {
  formats: PromptFormat[]
  onAdd: () => void
  onEdit: (fmt: PromptFormat) => void
  onDelete: (fmt: PromptFormat) => void
}

function FormatList({ formats, onAdd, onEdit, onDelete }: FormatListProps) {
  return (
    <>
      <div className="space-y-2">
        {formats.map((fmt) => (
          <Card key={fmt.id}>
            <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
              <div className="flex-1 min-w-0">
                <CardTitle className="text-base flex items-center gap-2">
                  {fmt.name}
                  <code className="text-xs font-mono text-muted-foreground">{fmt.id}</code>
                  {fmt.is_default && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      默认
                    </span>
                  )}
                </CardTitle>
                {fmt.description && (
                  <p className="text-xs text-muted-foreground mt-1">{fmt.description}</p>
                )}
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <Button variant="ghost" size="sm" onClick={() => onEdit(fmt)}>
                  <Pencil className="size-3.5" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onDelete(fmt)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-muted/40 p-2 rounded">
                {fmt.template || '(空 — 走 JSON 特殊渲染)'}
              </pre>
            </CardContent>
          </Card>
        ))}
      </div>
      <Button variant="outline" onClick={onAdd}>
        <Plus className="size-4" /> 新增格式
      </Button>
    </>
  )
}
