import { useCallback, useEffect, useState } from 'react'
import { Pencil, RotateCcw, Trash2, Copy, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTemplateStore } from '@/store/templateStore'
import type { VideoTemplateItem, TemplateCategory } from '@/services/templates'
import { productConfig } from '@/config/product'
import {
  fetchTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  duplicateTemplate,
  resetTemplate,
} from '@/services/templates'

type ModalMode = 'closed' | 'create' | 'edit'

const CATEGORY_META: Record<TemplateCategory, { label: string; desc: string }> = {
  video: { label: '旧视频分类', desc: '兼容旧视频分类模板。新总结请使用下面的风格模板。' },
  text: { label: '旧文字模板', desc: '兼容旧文字模板。新总结请使用下面的风格模板。' },
  style_video_with_frames: { label: '视频笔记（带图）', desc: '视频转写 + 关键帧配图的真实总结提示词。' },
  style_video_text_only: { label: '视频笔记（不带图）', desc: '只基于视频转写生成纯文本笔记的提示词。' },
  style_audio: { label: '音频笔记', desc: '音频转写、章节整理、会议/播客等风格提示词。' },
  style_image_text: { label: '图文笔记', desc: '图片、OCR、图文内容总结的提示词。' },
  style_replica: { label: '复刻提示词', desc: '内容复刻、结构拆解、创作参考提示词。' },
  style_text: { label: '文本 / 网页', desc: '网页、长文本、粘贴文本总结提示词。' },
}

const ALL_STYLE_CATEGORIES: TemplateCategory[] = [
  'style_video_with_frames',
  'style_video_text_only',
  'style_audio',
  'style_image_text',
  'style_replica',
  'style_text',
]

const STYLE_CATEGORIES = ALL_STYLE_CATEGORIES.filter((cat) =>
  productConfig.showReplica || cat !== 'style_replica',
)

export default function VideoTemplatesPage() {
  const [category, setCategory] = useState<TemplateCategory>('style_video_with_frames')
  const [templates, setTemplates] = useState<VideoTemplateItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Modal state
  const [modalMode, setModalMode] = useState<ModalMode>('closed')
  const [editingId, setEditingId] = useState('')
  const [formName, setFormName] = useState('')
  const [formPrompt, setFormPrompt] = useState('')

  const reload = useCallback(async (cat?: TemplateCategory) => {
    const c = cat ?? category
    setLoading(true)
    setError(null)
    try {
      setTemplates(await fetchTemplates(c))
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [category])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await fetchTemplates(category)
        if (!cancelled) setTemplates(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [category])

  const openCreate = () => {
    setModalMode('create')
    setEditingId('')
    setFormName('')
    setFormPrompt('')
  }

  const openEdit = (t: VideoTemplateItem) => {
    setModalMode('edit')
    setEditingId(t.template_id)
    setFormName(t.name)
    setFormPrompt(t.prompt)
  }

  const closeModal = () => {
    setModalMode('closed')
    setEditingId('')
    setFormName('')
    setFormPrompt('')
  }

  const handleSave = async () => {
    const name = formName.trim()
    const prompt = formPrompt.trim()
    if (!name || !prompt) {
      toast.error('名称和 prompt 不能为空')
      return
    }
    try {
      if (modalMode === 'create') {
        await createTemplate({ name, prompt, category })
        toast.success(`模板「${name}」已创建`)
      } else {
        await updateTemplate(editingId, { name, prompt, category })
        toast.success(`模板「${name}」已更新`)
      }
      useTemplateStore.getState().invalidate(category)
      closeModal()
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  const handleDelete = async (t: VideoTemplateItem) => {
    if (!confirm(`确定删除模板「${t.name}」？此操作不可撤销。`)) return
    setBusyId(t.template_id)
    try {
      await deleteTemplate(t.template_id)
      useTemplateStore.getState().invalidate(category)
      toast.success(`模板「${t.name}」已删除`)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    } finally {
      setBusyId(null)
    }
  }

  const handleDuplicate = async (t: VideoTemplateItem) => {
    setBusyId(t.template_id)
    try {
      const copy = await duplicateTemplate(t.template_id, {
        source_prompt: t.prompt,
      })
      useTemplateStore.getState().invalidate(category)
      toast.success(`已复制为「${copy.name}」`)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '复制失败')
    } finally {
      setBusyId(null)
    }
  }

  const handleReset = async (t: VideoTemplateItem) => {
    if (!confirm(`确定将「${t.name}」恢复为默认提示词？`)) return
    setBusyId(t.template_id)
    try {
      await resetTemplate(t.template_id)
      useTemplateStore.getState().invalidate(category)
      toast.success(`「${t.name}」已恢复默认`)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '重置失败')
    } finally {
      setBusyId(null)
    }
  }

  const meta = CATEGORY_META[category]

  return (
    <div className="flex flex-col h-full">
      <Tabs
        value={category}
        onValueChange={(v) => setCategory(v as TemplateCategory)}
        className="flex flex-col h-full"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
              <TabsList className="flex flex-wrap">
                {STYLE_CATEGORIES.map((cat) => (
                  <TabsTrigger key={cat} value={cat}>{CATEGORY_META[cat].label}</TabsTrigger>
                ))}
              </TabsList>
            <p className="text-sm text-muted-foreground mt-2">{meta.desc}</p>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" />
            新建模板
          </Button>
        </div>

        <TabsContent value={category} className="flex-1 overflow-auto p-6 mt-0">
        {loading && (
          <p className="text-sm text-muted-foreground text-center py-12">加载中…</p>
        )}
        {error && (
          <p className="text-sm text-red-500 text-center py-12">{error}</p>
        )}
        {!loading && !error && templates.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-12">暂无模板</p>
        )}
        {!loading &&
          !error &&
          templates.map((t) => (
            <div
              key={t.template_id}
              className="flex items-start gap-4 py-3 border-b border-border last:border-0"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm">{t.name}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      t.is_builtin
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-green-100 text-green-700'
                    }`}
                  >
                    {t.is_builtin ? (t.overridden ? '内置已改' : '内置') : '自定义'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground truncate max-w-lg">
                  {t.prompt.slice(0, 80)}
                  {t.prompt.length > 80 ? '…' : ''}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => openEdit(t)}
                  disabled={busyId === t.template_id}
                  title={t.is_builtin ? '编辑内置风格覆盖' : '编辑'}
                >
                  <Pencil className="size-3.5" />
                </Button>
                {t.is_builtin ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => handleReset(t)}
                    disabled={busyId === t.template_id || !t.overridden}
                    title="重置默认"
                  >
                    <RotateCcw className="size-3.5" />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => handleDelete(t)}
                    disabled={busyId === t.template_id}
                    title="删除"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => handleDuplicate(t)}
                  disabled={busyId === t.template_id}
                  title="复制为可编辑副本"
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </TabsContent>
      </Tabs>

      {/* Create / Edit Modal */}
      {modalMode !== 'closed' && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={closeModal} />
          <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
            <div className="bg-background rounded-lg shadow-xl w-full max-w-lg mx-4 pointer-events-auto">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h3 className="font-semibold">
                  {modalMode === 'create'
                    ? `新建${CATEGORY_META[category].label}风格`
                    : `编辑${CATEGORY_META[category].label}风格`}
                </h3>
                <Button variant="ghost" size="icon" className="size-7" onClick={closeModal}>
                  <X className="size-4" />
                </Button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">
                    模板名称
                  </label>
                  <Input
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="例：技术教程精读"
                    maxLength={60}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">
                    提示词
                  </label>
                  <Textarea
                    value={formPrompt}
                    onChange={(e) => setFormPrompt(e.target.value)}
                    placeholder={
                      '写清楚这个风格的角色、结构、输出要求。如果需要完全控制用户提示词，可包含 {transcript} 占位符。'
                    }
                    rows={8}
                    maxLength={20000}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {formPrompt.length}/20000
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
                <Button variant="ghost" size="sm" onClick={closeModal}>
                  取消
                </Button>
                <Button size="sm" onClick={handleSave}>
                  保存
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
