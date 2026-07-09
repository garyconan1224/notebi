import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { toast } from 'sonner'
import { useAddMaterialStore } from '@/store/addMaterialStore'
import {
  isWorkspaceKindAllowed,
  productConfig,
  type WorkspaceKind,
} from '@/config/product'
import type { WorkspaceRecord } from '@/types/workspace'
import {
  createWorkspace,
  ensureInbox,
  listWorkspaces,
  removeWorkspaceItem,
  uploadWorkspaceItem,
} from '@/services/workspaces'
import type { ItemType } from '@/types/workspace'
import { AddMaterialModal } from './AddMaterialModal'

function inferLocalFileType(file: File): ItemType {
  const mime = file.type.toLowerCase()
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('text/')) return 'text'
  if (mime.startsWith('video/')) return 'video'
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'].includes(ext)) return 'audio'
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic'].includes(ext)) return 'image'
  if (['txt', 'md', 'markdown', 'srt', 'vtt', 'csv', 'json', 'html'].includes(ext)) return 'text'
  return 'video'
}

export function GlobalAddMaterialModal() {
  const {
    open,
    urlValue,
    sourceText,
    sniffResult,
    localFile,
    localFileName,
    localFileType,
    localWsId,
    workspaceKind,
    onAdded,
    openAddMaterial,
    closeAddMaterial,
  } = useAddMaterialStore()
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([])
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([])
  const [uploadingLocal, setUploadingLocal] = useState(false)
  const submittedRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const workspaceBackgrounds = useMemo(
    () => Object.fromEntries(workspaces.map((workspace) => [workspace.workspace_id, workspace.background])),
    [workspaces],
  )
  const forcedWorkspaceKind = workspaceKind ?? (
    productConfig.allowedKinds.length === 1 ? productConfig.defaultKind : undefined
  )

  const refreshWorkspaces = useCallback(() => {
    listWorkspaces({ kinds: productConfig.allowedKinds }).then(setWorkspaces).catch(() => {
      toast.error('加载合集列表失败，请检查后端是否已启动')
    })
  }, [])

  useEffect(() => {
    if (!open) return
    submittedRef.current = false
    setWorkspaceIds([])
    refreshWorkspaces()
  }, [open, refreshWorkspaces])

  const handleCreateWorkspace = useCallback(async (rawName: string, kind?: WorkspaceKind) => {
    const nextKind = kind ?? forcedWorkspaceKind ?? productConfig.defaultKind
    if (!isWorkspaceKindAllowed(nextKind)) {
      throw new Error(`${productConfig.name} 不支持创建该类型合集`)
    }
    const name = rawName.trim() || (nextKind === 'replica' ? '新复刻合集' : '新笔记合集')
    const created = await createWorkspace({ name, kind: nextKind })
    setWorkspaces((prev) => [...prev, created])
    toast.success(`合集「${name}」已创建`)
    return created
  }, [forcedWorkspaceKind])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) return
    if (!submittedRef.current && localFile && localWsId) {
      removeWorkspaceItem(localWsId, localFile).catch(() => {})
    }
    closeAddMaterial()
  }, [closeAddMaterial, localFile, localWsId])

  const handleAdded = useCallback(() => {
    submittedRef.current = true
    onAdded?.()
    refreshWorkspaces()
    closeAddMaterial()
  }, [closeAddMaterial, onAdded, refreshWorkspaces])

  const handlePickLocalFile = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleLocalFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setUploadingLocal(true)
    try {
      const fileType = inferLocalFileType(file)
      const ws = productConfig.defaultKind === 'replica'
        ? await createWorkspace({ name: '新复刻合集', kind: 'replica' })
        : await ensureInbox()
      const updated = await uploadWorkspaceItem(ws.workspace_id, file, {
        name: file.name,
        type: fileType,
      })
      const item = [...updated.items].reverse().find((entry) => entry.name === file.name) ?? updated.items[updated.items.length - 1]
      if (!item) throw new Error('上传后未找到素材')
      openAddMaterial({
        localFile: item.item_id,
        localFileName: file.name,
        localFileType: item.type,
        localWsId: ws.workspace_id,
        workspaceKind: forcedWorkspaceKind,
        onAdded,
      })
      toast.success('本地文件已上传', { description: file.name })
    } catch (error) {
      const message = error instanceof Error ? error.message : '上传失败'
      toast.error(`文件上传失败: ${message}`)
    } finally {
      setUploadingLocal(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [forcedWorkspaceKind, onAdded, openAddMaterial])

  return (
    <>
      <AddMaterialModal
        open={open}
        onOpenChange={handleOpenChange}
        workspaceIds={workspaceIds}
        workspaceBackgrounds={workspaceBackgrounds}
        availableWorkspaces={workspaces}
        onWorkspaceIdsChange={setWorkspaceIds}
        onCreateWorkspace={handleCreateWorkspace}
        onWorkspaceUpdated={(updated) => {
          setWorkspaces((prev) => prev.map((workspace) => (
            workspace.workspace_id === updated.workspace_id ? updated : workspace
          )))
        }}
        sniffResult={sniffResult}
        urlValue={urlValue}
        sourceText={sourceText}
        onAdded={handleAdded}
        localFile={localFile}
        localFileName={localFileName}
        localFileType={localFileType}
        localWsId={localWsId}
        workspaceKind={forcedWorkspaceKind}
        onPickLocalFile={handlePickLocalFile}
        localUploadPending={uploadingLocal}
      />
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleLocalFileChange}
      />
    </>
  )
}
