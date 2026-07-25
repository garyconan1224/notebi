import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  Link2, Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { detectPlatform } from './platforms'
import { normalizeMediaUrl } from '@/lib/url'
import {
  sniffUrl,
  ensureInbox,
  uploadWorkspaceItem,
} from '@/services/workspaces'
import type { SniffResult } from '@/services/workspaces'
import { useAddMaterialStore } from '@/store/addMaterialStore'

interface ComposerProps {
  onTaskCreated?: () => void
}

export function Composer({ onTaskCreated }: ComposerProps) {
  const [url, setUrl] = useState('')
  const [sniffResult, setSniffResult] = useState<SniffResult | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const sniffTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const dragDepth = useRef(0)
  const openAddMaterial = useAddMaterialStore((state) => state.openAddMaterial)

  const normalizedUrl = useMemo(() => normalizeMediaUrl(url), [url])
  const platform = detectPlatform(normalizedUrl || url)

  const handleUrlChange = useCallback((value: string) => {
    setUrl(value)
    setSniffResult(null)
  }, [])

  // Debounced URL sniff
  useEffect(() => {
    if (!normalizedUrl) return
    clearTimeout(sniffTimer.current)
    sniffTimer.current = setTimeout(async () => {
      try {
        const result = await sniffUrl(normalizedUrl)
        setSniffResult(result)
      } catch {
        setSniffResult(null)
      }
    }, 500)
    return () => clearTimeout(sniffTimer.current)
  }, [normalizedUrl])

  const handleAdd = () => {
    const nextUrl = normalizedUrl || url.trim()
    if (!nextUrl) return
    openAddMaterial({
      urlValue: nextUrl,
      sourceText: url.trim(),
      sniffResult,
      onAdded: () => {
        setUrl('')
        setSniffResult(null)
        onTaskCreated?.()
      },
    })
  }

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  // 单文件上传流程：文件（选择或拖入）→ 落入收纳箱 → upload → 打开预检配置 → 用户确认后 start
  const processFile = async (file: File) => {
    setUploading(true)
    try {
      const ws = await ensureInbox()
      const updated = await uploadWorkspaceItem(ws.workspace_id, file, {
        name: file.name,
      })
      const item = updated.items[updated.items.length - 1]
      const itemId = item.item_id
      openAddMaterial({
        localFile: itemId,
        localFileName: file.name,
        localFileType: item.type,
        localWsId: ws.workspace_id,
        onAdded: onTaskCreated,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '上传失败'
      toast.error(`文件上传失败: ${msg}`)
    } finally {
      setUploading(false)
      // 重置 file input，允许再次选同一个文件
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await processFile(file)
  }

  // 拖放：整个输入区接受文件，与 Hero「拖入文件」文案对齐
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (!e.dataTransfer.types.includes('Files')) return
    dragDepth.current += 1
    setDragActive(true)
  }
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragActive(false)
  }
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
  }
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = 0
    setDragActive(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void processFile(file)
  }

  return (
    <div className="composer">
      <div
        className={dragActive ? 'cp cp--drag' : 'cp'}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* URL row — 设计稿 cp-row */}
        <div className="cp-row">
          {platform ? (
            <div className="platform platform--branded" style={{ background: platform.color, width: 'auto', padding: '0 10px' }}>
              {platform.name}
            </div>
          ) : (
            <div className="platform">
              <Link2 size={18} />
            </div>
          )}

          <input
            className="cp-input"
            value={url}
            onChange={(e) => handleUrlChange(e.target.value)}
            placeholder="粘贴 B站/YouTube/小红书/抖音/本地文件路径..."
          />

          {platform && (
            <span className="cp-type">{platform.types[0]}</span>
          )}

          <button
            className="cp-upload"
            onClick={handleUploadClick}
            disabled={uploading}
          >
            <Upload size={13} />
            {uploading ? '上传中…' : '上传'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>

        {/* Run row — 对齐设计稿 cp-actions */}
        <div className="composer-run">
          <button className="cp-submit" onClick={handleAdd} disabled={!url.trim()}>
            添加素材
          </button>
        </div>
      </div>

    </div>
  )
}
