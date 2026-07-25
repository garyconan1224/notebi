import { useEffect, useMemo, useState } from 'react'
import { FolderCog, Tags } from 'lucide-react'
import { toast } from 'sonner'

import { batchOrganizeItems } from '@/services/library'
import {
  createWorkspaceFolder,
  listWorkspaceFolders,
  type WorkspaceFolder,
} from '@/services/workspaces'

interface Props {
  items: { workspace_id: string; item_id: string }[]
  onDone: () => Promise<void>
}

export function BatchOrganizeControl({ items, onDone }: Props) {
  const [tags, setTags] = useState('')
  const [folders, setFolders] = useState<WorkspaceFolder[]>([])
  const [folderId, setFolderId] = useState('')
  const [newFolderName, setNewFolderName] = useState('')
  const [busy, setBusy] = useState(false)
  const workspaceId = useMemo(() => {
    const ids = new Set(items.map(item => item.workspace_id))
    return ids.size === 1 ? [...ids][0] : ''
  }, [items])

  useEffect(() => {
    setFolderId('')
    if (!workspaceId) {
      setFolders([])
      return
    }
    void listWorkspaceFolders(workspaceId).then(setFolders).catch(() => setFolders([]))
  }, [workspaceId])

  const apply = async () => {
    const customTags = tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean)
    if (!customTags.length && !folderId) {
      toast.warning('请输入标签或选择文件夹')
      return
    }
    setBusy(true)
    try {
      const result = await batchOrganizeItems(items, {
        tags: customTags.length ? { custom_tags: customTags } : undefined,
        folderId: folderId || undefined,
      })
      toast.success(`已整理 ${result.changed} 项${result.failed ? `，${result.failed} 项失败` : ''}`)
      setTags('')
      await onDone()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '批量整理失败')
    } finally {
      setBusy(false)
    }
  }

  const addFolder = async () => {
    if (!workspaceId) return
    const name = newFolderName.trim()
    if (!name) return
    const folder = await createWorkspaceFolder(workspaceId, name)
    setFolders(previous => [...previous, folder])
    setFolderId(folder.folder_id)
    setNewFolderName('')
  }

  return (
    <div className="batch-organize-control">
      <label><Tags size={13} /><input value={tags}
        onChange={event => setTags(event.target.value)} placeholder="标签，用逗号分隔" /></label>
      {workspaceId && (
        <>
          <select value={folderId} onChange={event => setFolderId(event.target.value)}>
            <option value="">不移动文件夹</option>
            {folders.map(folder => (
              <option key={folder.folder_id} value={folder.folder_id}>{folder.name}</option>
            ))}
          </select>
          <input value={newFolderName}
            onChange={event => setNewFolderName(event.target.value)}
            placeholder="新文件夹" aria-label="新文件夹名称" />
          <button className="btn btn-sm" onClick={() => void addFolder()}
            disabled={!newFolderName.trim()} title="新建文件夹">
            <FolderCog size={13} />
          </button>
        </>
      )}
      <button className="btn btn-sm" disabled={busy || items.length === 0}
        onClick={() => void apply()}>
        {busy ? '整理中…' : `整理 (${items.length})`}
      </button>
    </div>
  )
}
