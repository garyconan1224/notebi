import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { useProviderStore, type Model } from '@/store/providerStore'
import type {
  ItemType,
  PreflightSaveRequest,
  WorkspaceItem,
} from '@/types/workspace'
import {
  getTaskParams,
  getTopLevelTasks,
  isTaskEnabled,
  normalizeTasksShape,
  setTaskParams,
} from '@/lib/preflightTasks'
import { TaskDetails } from './PreflightTaskDetails'

/**
 * 前置配置面板（设计文档第 4 章）。
 *
 * 三大区：
 *   1. 背景信息——内容类型 / 参与人员 / 主题 / 专有名词 / 分析目的
 *   2. 模型选择——文本 / 视频两类模型下拉，从已配置 provider 拉
 *   3. 任务勾选——按 item.type 显示不同的勾选项 + 子参数
 *
 * 用法：
 *   <PreflightConfigPanel
 *     open={open}
 *     onOpenChange={setOpen}
 *     item={item}
 *     onSave={(config) => savePreflight(...).then(() => startItemPipeline(...))}
 *   />
 */

interface PreflightConfigPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: WorkspaceItem
  /** 点击「保存并开始分析」时回调，传入待提交的 PreflightSaveRequest */
  onSave: (config: PreflightSaveRequest) => Promise<void> | void
  /** 是否处于提交中 */
  submitting?: boolean
}

// ── 内容类型下拉选项（设计文档 4.2） ─────────────────
const CONTENT_TYPE_OPTIONS = [
  '课程',
  '会议',
  '宣传片',
  'Vlog',
  '访谈',
  '纯音乐',
  '其他',
]

const PURPOSE_OPTIONS = ['复刻参考', '竞品分析', '内容学习', '其他']

export default function PreflightConfigPanel({
  open,
  onOpenChange,
  item,
  onSave,
  submitting = false,
}: PreflightConfigPanelProps) {
  // ── 1. 背景信息 state ─────────────────────────────
  const [contentType, setContentType] = useState('')
  const [participants, setParticipants] = useState('')
  const [topic, setTopic] = useState('')
  const [glossary, setGlossary] = useState('')
  const [purpose, setPurpose] = useState('')

  // ── 2. 模型选择 state ─────────────────────────────
  const [textProviderId, setTextProviderId] = useState('')
  const [videoProviderId, setVideoProviderId] = useState('')
  const [textModelId, setTextModelId] = useState('')
  const [videoModelId, setVideoModelId] = useState('')

  // ── 3. 任务勾选 state（N5：值是嵌套对象 {enabled, ...params}） ─────
  const [tasks, setTasks] = useState<Record<string, unknown>>({})

  // ── 3.5 ④16 CC-first：字幕优先开关（默认开）───
  const [preferSubtitle, setPreferSubtitle] = useState(true)

  const {
    providers,
    loading: providersLoading,
    fetchProviders,
    providerModels,
    modelsLoading,
  } = useProviderStore()

  // 首次打开拉一次 providers
  useEffect(() => {
    if (open && providers.length === 0) {
      fetchProviders()
    }
  }, [open, providers.length, fetchProviders])

  // 打开时：用 item.preflight 回填，避免每次都从空开始
  useEffect(() => {
    if (!open) return
    const bg = item.preflight.background_overrides ?? {}
    setContentType(bg.content_type ?? '')
    setParticipants((bg.participants ?? []).join(', '))
    setTopic(bg.topic ?? '')
    setGlossary((bg.glossary ?? []).join(', '))
    setPurpose(bg.purpose ?? '')

    // models 里存的是模型 ID，回填时反查它属于哪家 provider
    const findProviderByModel = (modelId: string): string => {
      if (!modelId) return ''
      for (const [pid, list] of Object.entries(providerModels)) {
        if (list?.some((m) => m.id === modelId)) return pid
      }
      return ''
    }
    const tId = item.preflight.models?.text ?? ''
    const vidId = item.preflight.models?.video ?? ''
    setTextModelId(tId)
    setVideoModelId(vidId)
    setTextProviderId(findProviderByModel(tId))
    setVideoProviderId(findProviderByModel(vidId))

    // N5：用 normalizeTasksShape 把老 boolean / 缺字段 task 都升级到 {enabled, ...} 形状
    setTasks(normalizeTasksShape(item.preflight.tasks, item.type))
  }, [open, item, providerModels])

  // 一级任务列表（含图片多图对比 / 文字多文对比）
  const topLevelTasks = useMemo(() => getTopLevelTasks(item.type), [item.type])

  const enabledProviders = providers.filter((p) => p.enabled && p.has_api_key)
  const textProviders = enabledProviders.filter((p) =>
    (p.capabilities ?? []).includes('chat'),
  )
  const videoProviders = enabledProviders // 视频模型暂无专用 capability，全部可选

  const handleSave = () => {
    const payload: PreflightSaveRequest = {
      background_overrides: {
        content_type: contentType.trim(),
        participants: splitCsv(participants),
        topic: topic.trim(),
        glossary: splitCsv(glossary),
        purpose: purpose.trim(),
      },
      models: {
        ...(textModelId && { text: textModelId }),
        ...(videoModelId && { video: videoModelId }),
      },
      tasks: normalizeTasksShape(tasks, item.type),
      prefer_subtitle: preferSubtitle,
    }
    onSave(payload)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>前置配置 · {item.name}</DialogTitle>
          <DialogDescription>
            填好背景信息和模型，勾选要执行的分析项，点底部「保存并开始分析」。
            未勾选的步骤会被完全跳过。
          </DialogDescription>
        </DialogHeader>

        {/* 第一区：背景信息 */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">第一区 · 背景信息（可选）</h3>
          <p className="text-xs text-muted-foreground">
            注入到所有后续 AI 调用，提升识别和总结准确率。
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="content-type">内容类型</Label>
              <Select value={contentType} onValueChange={setContentType}>
                <SelectTrigger id="content-type">
                  <SelectValue placeholder="选择内容类型" />
                </SelectTrigger>
                <SelectContent>
                  {CONTENT_TYPE_OPTIONS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="purpose">分析目的</Label>
              <Select value={purpose} onValueChange={setPurpose}>
                <SelectTrigger id="purpose">
                  <SelectValue placeholder="选择分析目的" />
                </SelectTrigger>
                <SelectContent>
                  {PURPOSE_OPTIONS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="topic">主题背景</Label>
            <Input
              id="topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="例：Q3 战略会议"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="participants">参与人员（逗号分隔）</Label>
            <Input
              id="participants"
              value={participants}
              onChange={(e) => setParticipants(e.target.value)}
              placeholder="张总, 李总, 产品负责人"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="glossary">专有名词（逗号分隔）</Label>
            <Textarea
              id="glossary"
              value={glossary}
              onChange={(e) => setGlossary(e.target.value)}
              placeholder="产品名, 技术术语, 内部代号"
              rows={2}
            />
          </div>
        </section>

        <Separator />

        {/* 第二区：模型选择 */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">第二区 · 模型选择</h3>
          {providersLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> 加载 provider 列表中…
            </div>
          ) : enabledProviders.length === 0 ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
              还没有可用的 provider。请先去
              <a href="/settings/providers" className="mx-1 underline">
                设置 → 提供商管理
              </a>
              添加并启用至少一个。
            </div>
          ) : (
            <div className="space-y-3">
              <ModelPicker
                label="文本大模型（总结 / 归纳 / 对话）"
                providers={textProviders}
                providerValue={textProviderId}
                modelValue={textModelId}
                onProviderChange={(pid) => {
                  setTextProviderId(pid)
                  setTextModelId('')
                }}
                onModelChange={setTextModelId}
                providerModels={providerModels}
                modelsLoading={modelsLoading}
              />
              <ModelPicker
                label="视频大模型（仅勾选「视频模型直接分析」时启用）"
                providers={videoProviders}
                providerValue={videoProviderId}
                modelValue={videoModelId}
                onProviderChange={(pid) => {
                  setVideoProviderId(pid)
                  setVideoModelId('')
                }}
                onModelChange={setVideoModelId}
                providerModels={providerModels}
                modelsLoading={modelsLoading}
              />
            </div>
          )}
        </section>

        <Separator />

        {/* 第三区：任务勾选 */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">
            第三区 · 任务勾选（{ITEM_TYPE_LABEL[item.type]}）
          </h3>
          <p className="text-xs text-muted-foreground">
            未勾选项完全跳过，不消耗模型调用。
          </p>

          {/* ④16 CC-first：字幕优先开关（仅视频类型显示） */}
          {item.type === 'video' && (
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-blue-200 bg-blue-50/50 p-3 text-sm">
              <Checkbox
                checked={preferSubtitle}
                onCheckedChange={(v) => setPreferSubtitle(!!v)}
              />
              <div>
                <div className="font-medium">优先用平台字幕（更快）</div>
                <div className="text-xs text-muted-foreground">
                  B站/YouTube 有 CC 字幕时直接取，跳过 Whisper 转写。无字幕自动回退。
                </div>
              </div>
            </label>
          )}

          <div className="space-y-2">
            {topLevelTasks.map((opt) => {
              const enabled = isTaskEnabled(tasks, opt.id)
              const params = getTaskParams<Record<string, unknown>>(
                tasks,
                item.type,
                opt.id,
              )
              return (
                <div
                  key={opt.id}
                  className="space-y-2 rounded-md border p-3 transition hover:bg-muted/30"
                >
                  <label className="flex cursor-pointer items-start gap-2">
                    <Checkbox
                      checked={enabled}
                      onCheckedChange={(v) =>
                        setTasks((prev) =>
                          setTaskParams(prev, opt.id, {
                            ...getTaskParams(prev, item.type, opt.id),
                            enabled: !!v,
                          }),
                        )
                      }
                    />
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium">{opt.label}</div>
                      {opt.desc && (
                        <div className="text-xs text-muted-foreground">
                          {opt.desc}
                        </div>
                      )}
                    </div>
                  </label>
                  {enabled && (
                    <div className="ml-6 border-l-2 border-violet-200 pl-3">
                      <TaskDetails
                        type={item.type}
                        taskId={opt.id}
                        params={params}
                        onChange={(next) =>
                          setTasks((prev) => setTaskParams(prev, opt.id, next))
                        }
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            取消
          </Button>
          <Button onClick={handleSave} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                提交中…
              </>
            ) : (
              '保存并开始分析'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── 子组件：provider + model 两级下拉 ─────────────────

function ModelPicker({
  label,
  providers,
  providerValue,
  modelValue,
  onProviderChange,
  onModelChange,
  providerModels,
  modelsLoading,
}: {
  label: string
  providers: { id: string; name: string }[]
  providerValue: string
  modelValue: string
  onProviderChange: (id: string) => void
  onModelChange: (id: string) => void
  providerModels: Record<string, Model[]>
  modelsLoading: Record<string, boolean>
}) {
  const models = providerValue ? providerModels[providerValue] ?? [] : []
  const isLoading = providerValue ? !!modelsLoading[providerValue] : false
  const modelDisabled = !providerValue || isLoading || models.length === 0

  let modelPlaceholder = '请先选供应商'
  if (providerValue) {
    if (isLoading) modelPlaceholder = '加载模型中…'
    else if (models.length === 0) modelPlaceholder = '该供应商无可用模型'
    else modelPlaceholder = '选择模型'
  }

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="grid grid-cols-2 gap-2">
        <Select value={providerValue} onValueChange={onProviderChange}>
          <SelectTrigger>
            <SelectValue placeholder="选择供应商" />
          </SelectTrigger>
          <SelectContent>
            {providers.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                没有具备此能力的 provider
              </div>
            ) : (
              providers.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        <Select
          value={modelValue}
          onValueChange={onModelChange}
          disabled={modelDisabled}
        >
          <SelectTrigger>
            <SelectValue placeholder={modelPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {models.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name || m.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

// ── 工具：素材类型中文标签 ───────────────

const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  video: '视频内容',
  audio: '音频内容',
  image: '图片内容',
  text: '文字内容',
}

function splitCsv(input: string): string[] {
  return input
    .split(/[,，;；\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}
