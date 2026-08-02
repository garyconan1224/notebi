import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { exportItemNoteToNotion, type NotionExportResult } from '@/services/workspaces'

export function NotionExportDialog({
  open,
  onOpenChange,
  workspaceId,
  itemId,
  title,
  markdown,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  itemId: string
  title: string
  markdown: string
  onSuccess: (result: NotionExportResult) => void
}) {
  const [accessToken, setAccessToken] = useState('')
  const [parentPageId, setParentPageId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const close = (nextOpen: boolean) => {
    if (!nextOpen) {
      setAccessToken('')
      setSubmitting(false)
    }
    onOpenChange(nextOpen)
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!accessToken.trim() || !parentPageId.trim() || submitting) return
    setSubmitting(true)
    try {
      const result = await exportItemNoteToNotion(workspaceId, itemId, {
        accessToken: accessToken.trim(),
        parentPageId: parentPageId.trim(),
        title,
        markdown,
      })
      onSuccess(result)
      close(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Notion 导出失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>导出到 Notion</DialogTitle>
          <DialogDescription>
            将当前显示内容创建为父页面下的新页面。令牌只用于本次请求，不会保存到 NoteBi。
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={event => void submit(event)}>
          <label className="grid gap-1.5 text-sm font-medium">
            Notion 集成令牌
            <Input
              type="password"
              autoComplete="off"
              value={accessToken}
              onChange={event => setAccessToken(event.target.value)}
              placeholder="粘贴 Notion integration token"
              aria-label="Notion 集成令牌"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Notion 父页面 ID 或链接
            <Input
              value={parentPageId}
              onChange={event => setParentPageId(event.target.value)}
              placeholder="页面 ID 或页面链接"
              aria-label="Notion 父页面 ID 或链接"
            />
          </label>
          <p className="text-xs leading-5 text-muted-foreground">
            请先在 Notion 将目标父页面共享给你的集成，并允许它插入内容。
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)} disabled={submitting}>
              取消
            </Button>
            <Button
              type="submit"
              disabled={submitting || !accessToken.trim() || !parentPageId.trim()}
            >
              {submitting ? <Loader2 className="animate-spin" /> : null}
              导出到 Notion
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
