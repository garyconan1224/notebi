import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { createTaskBatch, previewTaskBatch } from '@/services/taskBatches'
import type { BatchPreviewItem } from '@/types/taskBatch'
import { getTaskDefaults } from '@/services/taskDefaults'

export default function BatchCreatePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [sourceType, setSourceType] = useState('urls')
  const [sourceText, setSourceText] = useState('')
  const [workspaceId, setWorkspaceId] = useState(searchParams.get('workspace_id') || '')
  const [batchName, setBatchName] = useState('新批量笔记')
  const [noteStyle, setNoteStyle] = useState('standard')
  const [recognitionType, setRecognitionType] = useState('auto')
  const [diarize, setDiarize] = useState(false)
  const [frameAnalysis, setFrameAnalysis] = useState(true)
  const [frameInterval, setFrameInterval] = useState(5)
  const [speakerCount, setSpeakerCount] = useState('auto')
  const [items, setItems] = useState<BatchPreviewItem[]>([])
  const [error, setError] = useState('')
  const settingsEditedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    getTaskDefaults()
      .then((defaults) => {
        if (cancelled || settingsEditedRef.current) return
        setNoteStyle(defaults.summary_template)
        setFrameAnalysis(defaults.video_frame_analysis)
        setFrameInterval(defaults.frame_interval_sec)
        setDiarize(defaults.diarize)
        setSpeakerCount(defaults.speaker_count?.toString() ?? 'auto')
      })
      .catch(() => setError('加载任务默认值失败，已使用内置默认值'))
    return () => {
      cancelled = true
    }
  }, [])

  const sources = useMemo(
    () => sourceText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
    [sourceText],
  )

  const preview = async () => {
    try {
      const result = await previewTaskBatch({
        source_type: sourceType,
        urls: sourceType === 'local_files' ? [] : sources,
        local_files: sourceType === 'local_files' ? sources : [],
        workspace_id: workspaceId,
      })
      setItems(result.items)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '预览失败')
    }
  }

  const submit = async () => {
    try {
      const batch = await createTaskBatch({
        name: batchName,
        workspace_id: workspaceId,
        source_type: sourceType,
        idempotency_key: crypto.randomUUID(),
        items: items.map((item) => ({
          ...item,
          action: item.suggested_action,
        })),
        settings: {
          task_type: 'note',
          note_style: noteStyle,
          note_type: recognitionType,
          diarize,
          frame_analysis: frameAnalysis,
          frame_interval: frameInterval,
          speaker_count: speakerCount === 'auto' ? null : Number(speakerCount),
        },
      })
      navigate(`/tasks/batches/${batch.batch_id}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建失败')
    }
  }

  return (
    <main className="h-full overflow-y-auto p-6">
      <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-2">
        <section className="space-y-4 rounded-xl border p-5">
          <h1 className="text-2xl font-bold">新建批量任务</h1>
          <label className="block">来源类型
            <select aria-label="来源类型" className="mt-1 w-full rounded border p-2" value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
              <option value="urls">多 URL</option><option value="local_files">本地文件</option>
              <option value="bilibili_collection">Bilibili 合集</option><option value="bilibili_favorites">Bilibili 收藏夹</option>
              <option value="bilibili_uploader">Bilibili UP 主</option><option value="bilibili_parts">Bilibili 分 P</option>
              <option value="youtube_playlist">YouTube playlist</option>
            </select>
          </label>
          <label className="block">素材来源
            <textarea aria-label="素材来源" className="mt-1 min-h-36 w-full rounded border p-2" value={sourceText} onChange={(e) => setSourceText(e.target.value)} placeholder="每行一个链接或本地文件路径" />
          </label>
          <label className="block">目标合集（可留空新建）
            <input aria-label="目标合集" className="mt-1 w-full rounded border p-2" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} />
          </label>
          <label className="block">批次名称
            <input aria-label="批次名称" className="mt-1 w-full rounded border p-2" value={batchName} onChange={(e) => setBatchName(e.target.value)} />
          </label>
          <button className="btn" type="button" onClick={() => void preview()}>预览素材</button>
        </section>
        <section className="space-y-4 rounded-xl border p-5">
          <h2 className="text-xl font-bold">常用笔记设置</h2>
          <label className="block">笔记风格<select aria-label="笔记风格" className="mt-1 w-full rounded border p-2" value={noteStyle} onChange={(e) => { settingsEditedRef.current = true; setNoteStyle(e.target.value) }}><option value="standard">标准总结</option><option value="concise">精简摘要</option><option value="detailed">详细要点</option></select></label>
          <label className="block">识别类型<select aria-label="识别类型" className="mt-1 w-full rounded border p-2" value={recognitionType} onChange={(e) => setRecognitionType(e.target.value)}><option value="auto">自动识别</option><option value="video">视频</option><option value="audio">音频</option><option value="image_text">图文</option><option value="mixed">混合</option></select></label>
          <label className="flex gap-2"><input aria-label="区分说话人" type="checkbox" checked={diarize} onChange={(e) => { settingsEditedRef.current = true; setDiarize(e.target.checked) }} />区分说话人</label>
          <label className="block">说话人数<select aria-label="说话人数" className="mt-1 w-full rounded border p-2" disabled={!diarize} value={speakerCount} onChange={(e) => { settingsEditedRef.current = true; setSpeakerCount(e.target.value) }}><option value="auto">自动判断</option>{[2, 3, 4, 5].map((count) => <option key={count} value={count}>{count} 人</option>)}</select></label>
          <label className="flex gap-2"><input aria-label="画面分析" type="checkbox" checked={frameAnalysis} onChange={(e) => { settingsEditedRef.current = true; setFrameAnalysis(e.target.checked) }} />画面分析</label>
          <label className="block">截帧间隔<input aria-label="截帧间隔" className="mt-1 w-full rounded border p-2" type="number" min={1} max={120} value={frameInterval} onChange={(e) => { settingsEditedRef.current = true; setFrameInterval(Number(e.target.value)) }} /></label>
          <div className="max-h-72 overflow-y-auto rounded border">
            {items.length === 0 ? <div className="p-5 text-center text-sm">预览后可逐项选择跳过、复制或重新处理</div> : items.map((item, index) => (
              <div key={item.batch_item_id} className="flex items-center gap-2 border-b p-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{item.source_title || item.source_url}</span>
                <select aria-label={`动作 ${index + 1}`} value={item.suggested_action} onChange={(e) => setItems((current) => current.map((value) => value.batch_item_id === item.batch_item_id ? { ...value, suggested_action: e.target.value as BatchPreviewItem['suggested_action'] } : value))}>
                  <option value="process">重新处理</option><option value="copy">复制</option><option value="skip">跳过</option>
                </select>
              </div>
            ))}
          </div>
          <button className="btn" type="button" disabled={items.length === 0} onClick={() => void submit()}>开始生成笔记</button>
          {error && <div role="alert">{error}</div>}
        </section>
      </div>
    </main>
  )
}
