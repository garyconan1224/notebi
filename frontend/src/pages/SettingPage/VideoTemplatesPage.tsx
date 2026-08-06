import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, Pencil, RotateCcw, Trash2, Copy, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { useTemplateStore } from '@/store/templateStore'
import type { VideoTemplateItem, TemplateCategory } from '@/services/templates'
import {
  fetchTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  duplicateTemplate,
  resetTemplate,
  setTemplateVisibility,
} from '@/services/templates'

type ModalMode = 'closed' | 'create' | 'edit'

const CATEGORY_LABEL_KEY: Record<TemplateCategory, string> = {
  video: 'templates.catVideo',
  text: 'templates.catText',
  style_video_with_frames: 'templates.catVideoFrames',
  style_video_text_only: 'templates.catVideoTextOnly',
  style_audio: 'templates.catAudio',
  style_image_text: 'templates.catImageText',
  style_text: 'templates.catTextWeb',
}
const CATEGORY_DESC_KEY: Record<TemplateCategory, string> = {
  video: 'templates.catVideoDesc',
  text: 'templates.catTextDesc',
  style_video_with_frames: 'templates.catVideoFramesDesc',
  style_video_text_only: 'templates.catVideoTextOnlyDesc',
  style_audio: 'templates.catAudioDesc',
  style_image_text: 'templates.catImageTextDesc',
  style_text: 'templates.catTextWebDesc',
}

const ALL_STYLE_CATEGORIES: TemplateCategory[] = [
  'style_video_with_frames',
  'style_video_text_only',
  'style_audio',
  'style_image_text',
  'style_text',
]

const STYLE_CATEGORIES = ALL_STYLE_CATEGORIES

export default function VideoTemplatesPage() {
  const { t: translate } = useTranslation('settings')
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
      setError(err instanceof Error ? err.message : translate('templates.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [category, translate])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await fetchTemplates(category)
        if (!cancelled) setTemplates(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : translate('templates.loadFailed'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [category, translate])

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
      toast.error(translate('templates.emptyNamePrompt'))
      return
    }
    try {
      if (modalMode === 'create') {
        await createTemplate({ name, prompt, category })
        toast.success(translate('templates.created', { name }))
      } else {
        await updateTemplate(editingId, { name, prompt, category })
        toast.success(translate('templates.updated', { name }))
      }
      useTemplateStore.getState().invalidate(category)
      closeModal()
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('templates.saveFailed'))
    }
  }

  const handleDelete = async (t: VideoTemplateItem) => {
    if (!confirm(translate('templates.confirmDelete', { name: t.name }))) return
    setBusyId(t.template_id)
    try {
      await deleteTemplate(t.template_id)
      useTemplateStore.getState().invalidate(category)
      toast.success(translate('templates.deleted', { name: t.name }))
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('templates.deleteFailed'))
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
      toast.success(translate('templates.duplicated', { name: copy.name }))
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('templates.duplicateFailed'))
    } finally {
      setBusyId(null)
    }
  }

  const handleReset = async (t: VideoTemplateItem) => {
    if (!confirm(translate('templates.confirmReset', { name: t.name }))) return
    setBusyId(t.template_id)
    try {
      await resetTemplate(t.template_id)
      useTemplateStore.getState().invalidate(category)
      toast.success(translate('templates.resetDone', { name: t.name }))
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('templates.resetFailed'))
    } finally {
      setBusyId(null)
    }
  }

  // Q5：切换模板「新建可见」，以服务端回读值更新本地状态
  const handleToggleVisibility = async (t: VideoTemplateItem) => {
    const nextVisible = t.show_in_create === false
    setBusyId(t.template_id)
    try {
      const saved = await setTemplateVisibility(t.template_id, nextVisible)
      setTemplates((prev) => prev.map((item) => (
        item.template_id === t.template_id
          ? { ...item, show_in_create: saved.show_in_create }
          : item
      )))
      useTemplateStore.getState().invalidate(category)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('templates.visibilityFailed'))
    } finally {
      setBusyId(null)
    }
  }

  const metaDesc = translate(CATEGORY_DESC_KEY[category])

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
                  <TabsTrigger key={cat} value={cat}>{translate(CATEGORY_LABEL_KEY[cat])}</TabsTrigger>
                ))}
              </TabsList>
            <p className="text-sm text-muted-foreground mt-2">{metaDesc}</p>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" />
            新建模板
          </Button>
        </div>

        <TabsContent value={category} className="flex-1 overflow-auto p-6 mt-0">
        {loading && (
          <div className="space-y-3 py-6" role="status" aria-label={translate('templates.loadingAria')}>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        )}
        {error && (
          <p className="text-sm text-red-500 text-center py-12">{error}</p>
        )}
        {!loading && !error && templates.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-12">{translate('templates.empty')}</p>
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
                    {t.is_builtin ? (t.overridden ? translate('templates.builtinOverridden') : translate('templates.builtin')) : translate('templates.custom')}
                  </span>
                  {t.speaker_aware_only && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-violet-100 text-violet-700">
                      {translate('templates.speakerAware')}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate max-w-lg">
                  {t.prompt.slice(0, 80)}
                  {t.prompt.length > 80 ? '…' : ''}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => handleToggleVisibility(t)}
                  disabled={busyId === t.template_id}
                  aria-pressed={t.show_in_create !== false}
                  title={t.show_in_create !== false ? translate('templates.visibleHint') : translate('templates.hiddenHint')}
                >
                  {t.show_in_create !== false ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                  {t.show_in_create !== false ? translate('templates.visible') : translate('templates.hidden')}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => openEdit(t)}
                  disabled={busyId === t.template_id}
                  title={t.is_builtin ? translate('templates.editBuiltinHint') : translate('templates.editHint')}
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
                    title={translate('templates.resetHint')}
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
                    title={translate('templates.deleteHint')}
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
                  title={translate('templates.duplicateHint')}
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
                    ? translate('templates.createTitle', { category: translate(CATEGORY_LABEL_KEY[category]) })
                    : translate('templates.editTitle', { category: translate(CATEGORY_LABEL_KEY[category]) })}
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
                    placeholder={translate('templates.namePlaceholder')}
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
                    placeholder={translate('templates.promptPlaceholder')}
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
