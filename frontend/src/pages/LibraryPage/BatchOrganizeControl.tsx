import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('pages')
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
      toast.warning(t('library.batchTagsPlaceholder'))
      return
    }
    setBusy(true)
    try {
      const result = await batchOrganizeItems(items, {
        tags: customTags.length ? { custom_tags: customTags } : undefined,
        folderId: folderId || undefined,
      })
      toast.success(t('library.batchOrganized', { changed: result.changed, failed: result.failed ? `，${result.failed} 项失败` : '' }))
      setTags('')
      await onDone()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('library.batchOrganizeFailed'))
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
        onChange={event => setTags(event.target.value)} placeholder={t('library.tagsCommaHint')} /></label>
      {workspaceId && (
        <>
          <select value={folderId} onChange={event => setFolderId(event.target.value)}>
            <option value="">{t('library.noMoveFolder')}</option>
            {folders.map(folder => (
              <option key={folder.folder_id} value={folder.folder_id}>{folder.name}</option>
            ))}
          </select>
          <input value={newFolderName}
            onChange={event => setNewFolderName(event.target.value)}
            placeholder={t('library.newFolder')} aria-label={t('library.newFolderName')} />
          <button className="btn btn-sm" onClick={() => void addFolder()}
            disabled={!newFolderName.trim()} title={t('library.createFolder')}>
            <FolderCog size={13} />
          </button>
        </>
      )}
      <button className="btn btn-sm" disabled={busy || items.length === 0}
        onClick={() => void apply()}>
        {busy ? t('library.organizing') : t('library.organize', { count: items.length })}
      </button>
    </div>
  )
}
