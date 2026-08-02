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
import { exportItemNoteToFeishu, type FeishuExportResult } from '@/services/workspaces'

export function FeishuExportDialog({
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
  onSuccess: (result: FeishuExportResult) => void
}) {
  const [accessToken, setAccessToken] = useState('')
  const [folderToken, setFolderToken] = useState('')
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
    if (!accessToken.trim() || submitting) return
    setSubmitting(true)
    try {
      const result = await exportItemNoteToFeishu(workspaceId, itemId, {
        accessToken: accessToken.trim(),
        folderToken: folderToken.trim(),
        title,
        markdown,
      })
      onSuccess(result)
      close(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '飞书导出失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>导出到飞书</DialogTitle>
          <DialogDescription>
            将当前显示内容创建为新版飞书文档，并保留标题、列表、引用与代码块。令牌只用于本次请求，不会保存到 NoteBi。
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={event => void submit(event)}>
          <label className="grid gap-1.5 text-sm font-medium">
            飞书访问令牌
            <Input
              type="password"
              autoComplete="off"
              value={accessToken}
              onChange={event => setAccessToken(event.target.value)}
              placeholder="tenant_access_token 或 user_access_token"
              aria-label="飞书访问令牌"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            飞书文件夹 Token（可选）
            <Input
              value={folderToken}
              onChange={event => setFolderToken(event.target.value)}
              placeholder="留空则创建到当前令牌可用的根目录"
              aria-label="飞书文件夹 Token（可选）"
            />
          </label>
          <p className="text-xs leading-5 text-muted-foreground">
            请在飞书开发者后台为应用开通“创建及编辑新版文档”权限；使用应用令牌时，目标文件夹也需要授权给该应用。
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" disabled={submitting || !accessToken.trim()}>
              {submitting ? <Loader2 className="animate-spin" /> : null}
              导出到飞书
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
