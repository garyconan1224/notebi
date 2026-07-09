import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Star, Download, ChevronDown } from 'lucide-react'
import { getWorkspace, getLnMarkdown, getItemResult, patchLnMarkdown, exportLnObsidian } from '@/services/workspaces'
import type { VideoResultTranscriptLine } from '@/services/workspaces'
import type { WorkspaceRecord, WorkspaceItem, TranscriptTranslations } from '@/types/workspace'
import LNVideoPanel, { type LNVideoPanelHandle } from './LNVideoPanel'
import LNNotesPanel from './LNNotesPanel'
import LNTranscriptPanel from './LNTranscriptPanel'
import ChatDrawer from './ChatDrawer'
import './learning-notes.css'

type PageState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; workspace: WorkspaceRecord; videoItem: WorkspaceItem; markdown: string; transcript: VideoResultTranscriptLine[]; videoSrc: string; translations: TranscriptTranslations | null }

export default function LearningNotesPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const [pageState, setPageState] = useState<PageState>({ kind: 'loading' })
  const [currentTime, setCurrentTime] = useState(0)
  const videoPanelRef = useRef<LNVideoPanelHandle>(null)

  // B-3: 可编辑的 markdown state
  const [markdown, setMarkdown] = useState('')

  // B-3: 视图偏好（localStorage 持久化，默认 html 美化阅读）
  const [view, setView] = useState<'html' | 'md'>(() => {
    const saved = localStorage.getItem('ln-view')
    return saved === 'md' ? 'md' : 'html'
  })

  const switchView = useCallback((v: 'html' | 'md') => {
    setView(v)
    localStorage.setItem('ln-view', v)
  }, [])

  // B-1: 学习笔记空态（/ln 404 时显示友好提示）
  const [lnNotFound, setLnNotFound] = useState(false)

  // 导出菜单状态
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭导出菜单
  useEffect(() => {
    if (!exportMenuOpen) return
    const handleClick = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false)
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [exportMenuOpen])

  // 从 markdown 提取 H1 标题作为导出文件名
  const noteTitle = useMemo(() => {
    const h1 = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim()
    if (h1) return h1
    if (pageState.kind === 'ready') return pageState.videoItem.name || '学习笔记'
    return '学习笔记'
  }, [markdown, pageState])
  const safeExportName = noteTitle.replace(/[/\\:*?"<>|]/g, '_').slice(0, 80)

  // 导出 Markdown（纯前端）
  const handleExportMarkdown = useCallback(() => {
    if (pageState.kind !== 'ready') return
    const blob = new Blob([markdown], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeExportName}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setExportMenuOpen(false)
  }, [markdown, pageState, safeExportName])

  // 导出 Obsidian 包（后端 zip，走 axios http client）
  const handleExportObsidian = useCallback(async () => {
    if (pageState.kind !== 'ready') return
    try {
      const blob = await exportLnObsidian(pageState.workspace.workspace_id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${safeExportName}-obsidian.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Obsidian 导出失败:', err)
      alert('Obsidian 包导出失败，请重试')
    }
    setExportMenuOpen(false)
  }, [pageState, safeExportName])

  // B-4: 自动保存
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [lastSavedAt, setLastSavedAt] = useState('')
  // 记录最后一次与服务端一致的内容（含初始加载值），用于判断是否真有编辑
  const lastSavedMarkdownRef = useRef<string | null>(null)
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (pageState.kind !== 'ready') return
    // 内容与服务端一致（含初始加载那次 setMarkdown）时不触发保存，避免"白存"
    if (markdown === lastSavedMarkdownRef.current) return

    clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(async () => {
      setSaveState('saving')
      try {
        const { saved_at } = await patchLnMarkdown(workspaceId, markdown)
        lastSavedMarkdownRef.current = markdown
        setSaveState('saved')
        setLastSavedAt(new Date(saved_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
      } catch {
        setSaveState('error')
      }
    }, 1500)

    return () => clearTimeout(debounceTimer.current)
  }, [markdown, workspaceId, pageState.kind])

  // B-8: 构建 AI 问答的 system prompt（ln.md + transcript 上下文）
  const chatSystemPrompt = useMemo(() => {
    if (pageState.kind !== 'ready') return ''
    const parts: string[] = [
      '你正在协助用户理解一篇学习笔记。回答时基于下方提供的笔记全文和视频字幕，不要编造笔记里没有的信息。',
      '',
      '【学习笔记全文】',
      markdown || '（暂无笔记内容）',
    ]
    if (pageState.transcript.length > 0) {
      parts.push('', '【视频字幕】')
      for (const line of pageState.transcript) {
        parts.push(`[${line.t_str}] ${line.text}`)
      }
    }
    parts.push('', '回答指引：基于上述笔记和字幕作答；如果用户问到具体时间点，请引用对应字幕；回答使用中文。')
    return parts.join('\n')
  }, [pageState, markdown])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [ws, md] = await Promise.all([
          getWorkspace(workspaceId),
          getLnMarkdown(workspaceId).catch((err: unknown) => {
            // 404 = 尚未生成学习笔记（预期），其他错误也降级为空
            const status = (err as { response?: { status?: number } })?.response?.status
            if (status === 404) setLnNotFound(true)
            return ''
          }),
        ])
        if (cancelled) return

        const videoItem = ws.items.find((i) => i.type === 'video')
        if (!videoItem) {
          setPageState({ kind: 'error', message: '该合集没有视频素材' })
          return
        }

        // 取 transcript + video.url（getItemResult 返回已适配 /static 的 url）
        let transcript: VideoResultTranscriptLine[] = []
        let videoSrc = ''
        try {
          const result = await getItemResult(workspaceId, videoItem.item_id)
          transcript = result.transcript || []
          const vr = result.video as { url?: string } | undefined
          if (vr?.url) videoSrc = vr.url
        } catch {
          transcript = []
        }
        if (cancelled) return

        setPageState({
          kind: 'ready',
          workspace: ws,
          videoItem,
          markdown: md,
          transcript,
          videoSrc,
          translations: (videoItem.results?.translations as TranscriptTranslations | undefined) ?? null,
        })
        setMarkdown(md)
        lastSavedMarkdownRef.current = md
      } catch (err: unknown) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : '加载失败'
        setPageState({ kind: 'error', message })
      }
    }
    load()
    return () => { cancelled = true }
  }, [workspaceId])

  // 视频源：优先用 getItemResult 返回的 video.url（已 /static 适配）
  const { videoSrc, externalUrl } = useMemo(() => {
    if (pageState.kind !== 'ready') return { videoSrc: '', externalUrl: '' }
    const url = pageState.videoSrc
    if (!url) return { videoSrc: '', externalUrl: '' }
    const isPlayable = url.startsWith('/static') || /\.(mp4|webm|ogg|mov|m4v)(\?|$)/i.test(url)
    if (isPlayable) return { videoSrc: url, externalUrl: '' }
    return { videoSrc: '', externalUrl: url }
  }, [pageState])

  const handleTimeUpdate = useCallback((time: number) => {
    setCurrentTime(time)
  }, [])

  return (
    <div className="vm-ln-scope">
      {/* Nav bar */}
      <div className="ln-nav">
        <button className="ln-back" onClick={() => navigate(-1)}>
          <ArrowLeft size={14} /> 返回
        </button>
        <span className="ln-title">学习笔记</span>
        <span className="ln-badge">
          <Star size={10} /> Learning Notes
        </span>
        <span className="ln-save-status">
          {saveState === 'saving' && '保存中…'}
          {saveState === 'saved' && `已保存 ${lastSavedAt}`}
          {saveState === 'error' && '保存失败，重试中…'}
        </span>
        {/* 导出菜单 */}
        <div className="ln-export-menu-wrapper" ref={exportMenuRef}>
          <button
            className="btn-ghost"
            style={{ height: 28, padding: '0 10px', fontSize: 12, marginLeft: 8 }}
            onClick={() => setExportMenuOpen(!exportMenuOpen)}
            title="导出"
          >
            <Download size={13} /> 导出 <ChevronDown size={12} />
          </button>
          {exportMenuOpen && (
            <div className="ln-export-menu">
              <button onClick={() => {
                const prev = document.title
                document.title = safeExportName
                window.addEventListener('afterprint', () => { document.title = prev }, { once: true })
                window.print()
                setExportMenuOpen(false)
              }}>
                导出 PDF
              </button>
              <button onClick={handleExportMarkdown}>
                导出 Markdown
              </button>
              <button onClick={handleExportObsidian}>
                Obsidian 包
              </button>
              <button disabled title="阶段③启用">
                写入 Obsidian 库
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Loading / Error */}
      {pageState.kind === 'loading' && (
        <div className="ln-status">加载中…</div>
      )}
      {pageState.kind === 'error' && (
        <div className="ln-status ln-error">{pageState.message}</div>
      )}

      {/* Main body: dual-column */}
      {pageState.kind === 'ready' && (
        <>
          {/* 空态：尚未生成学习笔记 */}
          {lnNotFound && !markdown ? (
            <div className="ln-status" style={{ padding: '48px 24px', textAlign: 'center' }}>
              <p style={{ fontSize: 15, marginBottom: 8 }}>该视频还没有生成学习笔记</p>
              <p style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>
                请先完成视频分析，系统会自动生成学习笔记
              </p>
            </div>
          ) : (
          <>
            <div className="ln-body">
              <LNNotesPanel
                markdown={markdown}
                onMarkdownChange={setMarkdown}
                view={view}
                onSwitchView={switchView}
                onSeek={(sec) => videoPanelRef.current?.seekTo(sec)}
              />
              <div className="ln-left-col">
                <LNVideoPanel
                  ref={videoPanelRef}
                  src={videoSrc}
                  externalUrl={externalUrl}
                  title={pageState.videoItem.name}
                  workspaceId={workspaceId}
                  onTimeUpdate={handleTimeUpdate}
                />
                <LNTranscriptPanel
                  transcript={pageState.transcript}
                  currentTime={currentTime}
                  onSeek={(sec) => videoPanelRef.current?.seekTo(sec)}
                  workspaceId={workspaceId}
                  itemId={pageState.videoItem.item_id}
                  translations={pageState.translations}
                />
              </div>
            </div>
            <ChatDrawer workspaceId={workspaceId} systemPrompt={chatSystemPrompt} />
          </>
          )}
        </>
      )}
    </div>
  )
}
