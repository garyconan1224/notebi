/**
 * NewSummaryModal — 新建总结弹窗。
 *
 * 模板选择 + 模型选择（复用 providerStore 双下拉）+ 联网搜索开关
 * + 可选「补充背景」textarea + 「生成」按钮。
 * 模型选择记忆上次（configStore）。
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import { HelpCircle } from 'lucide-react'
import { useProviderStore, type Model } from '@/store/providerStore'
import { useConfigStore } from '@/store/configStore'
import { fetchTemplates, type TemplateCategory, type VideoTemplateItem } from '@/services/templates'

import './new-summary-modal.css'

/* ── 模板选项 ────────────────────────────────────────────── */

const QUICK_CARDS: { value: string; label: string; desc: string }[] = [
  { value: 'standard', label: '标准总结', desc: '自适应教学笔记，短内容精简、长内容完整结构' },
  { value: 'concise', label: '精简摘要', desc: '100-200 字，适合快速浏览' },
  { value: 'detailed', label: '详细要点', desc: '多级要点 + 关键词，适合深度学习' },
  { value: 'outline', label: '大纲', desc: '多级层次提纲，一眼看清结构' },
  { value: 'lecture', label: '教学笔记', desc: '学完掌握→前置工具→步骤教程→常见坑→总结建议，适合教学音频' },
  { value: 'steps', label: '步骤教程', desc: '前置条件→步骤→常见坑→验收标准，适合操作类内容' },
  { value: 'quotes', label: '金句提取', desc: '5-10 条独立金句卡片，适合短视频/社媒' },
]

const MORE_STYLES: { value: string; label: string; desc: string }[] = [
  { value: 'meeting', label: '会议纪要', desc: '议题/结论/待办(负责人·截止)/风险，适合工作录音' },
  { value: 'interview', label: '访谈整理', desc: 'Q&A 对话 + 嘉宾观点摘录，适合播客/采访' },
  { value: 'shownotes', label: '播客 shownotes', desc: '时间戳章节 + 嘉宾介绍 + 推荐链接，适合自媒体' },
  { value: 'oral', label: '口播稿', desc: '可直接念的口语化文案，适合短视频/直播' },
  { value: 'xhs', label: '小红书风格', desc: '标题党+emoji+分段+话题 tag，适合转笔记' },
  { value: 'longform', label: '公众号长文', desc: '引言/正文(H2分节)/结尾，适合内容创作' },
  { value: 'qa', label: '问答卡(Anki)', desc: 'Q/A 卡片，便于记忆复习' },
  { value: 'actions', label: '行动清单', desc: '目标→行动项→依赖→完成标准，适合会议/规划' },
  { value: 'tool_recommendation', label: '工具推荐', desc: '工具名称/功能/适用场景/对比，适合工具测评' },
  { value: 'science_popularization', label: '知识科普', desc: '通俗语言讲原理+类比+常见误区，适合科普' },
]

/** 音频勾选“区分说话人”后，只展示与发言归属最相关的总结方式。 */
const SPEAKER_AWARE_CARDS: { value: string; label: string; desc: string }[] = [
  { value: 'speaker_meeting', label: '会议纪要', desc: '逐人立场、决议、负责人/截止与风险' },
  { value: 'speaker_interview', label: '线下采访', desc: 'Q&A、受访者主题观点、证据与分歧' },
  { value: 'speaker_customer_reception', label: '客户接待', desc: '痛点、需求、异议、决策链与双方承诺' },
]

const SPEAKER_AWARE_VALUES = new Set(SPEAKER_AWARE_CARDS.map((card) => card.value))

const TEMPLATE_ORDER = new Map(
  [...QUICK_CARDS, ...MORE_STYLES].map((style, index) => [style.value, index]),
)

/* ── 接口 ───────────────────────────────────────────────── */

interface NewSummaryModalProps {
  creating: boolean
  defaultTemplate?: string
  allowSpeakerAware?: boolean
  speakerAwareAvailable?: boolean
  templateCategory?: TemplateCategory
  onSubmit: (opts: {
    template: string
    summaryMode: 'general' | 'speaker_aware'
    background: string
    providerId: string
    model: string
    searchWeb: boolean
  }) => void
  onClose: () => void
}

export function NewSummaryModal({
  creating,
  defaultTemplate,
  allowSpeakerAware = false,
  speakerAwareAvailable = true,
  templateCategory,
  onSubmit,
  onClose,
}: NewSummaryModalProps) {
  const [template, setTemplate] = useState(defaultTemplate || 'standard')
  const [summaryMode, setSummaryMode] = useState<'general' | 'speaker_aware'>('general')
  const [background, setBackground] = useState('')
  const [searchWeb, setSearchWeb] = useState(false)
  const [styleTemplates, setStyleTemplates] = useState<VideoTemplateItem[]>([])
  const userPickedRef = useRef(false)

  // defaultTemplate 异步到达时自动选中，但不覆盖用户已手动选择的模板
  useEffect(() => {
    if (defaultTemplate && !userPickedRef.current) setTemplate(defaultTemplate)
  }, [defaultTemplate])

  const chooseTemplate = (value: string) => {
    userPickedRef.current = true
    setTemplate(value)
  }

  const handleSpeakerAwareChange = (checked: boolean) => {
    setSummaryMode(checked ? 'speaker_aware' : 'general')
    if (checked) {
      chooseTemplate(SPEAKER_AWARE_CARDS[0].value)
    } else if (SPEAKER_AWARE_VALUES.has(template)) {
      chooseTemplate(defaultTemplate || 'standard')
    }
  }

  useEffect(() => {
    let cancelled = false
    const category = templateCategory ?? (allowSpeakerAware ? 'style_audio' : 'style_video_with_frames')
    fetchTemplates(category)
      .then((items) => {
        if (!cancelled) setStyleTemplates(items)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [allowSpeakerAware, templateCategory])

  const templateOptions = useMemo(() => {
    if (styleTemplates.length === 0) return [...QUICK_CARDS, ...MORE_STYLES]
    return [...styleTemplates]
      .filter((item) => !item.speaker_aware_only)
      .sort((a, b) => {
        const ai = TEMPLATE_ORDER.get(a.template_id) ?? 1000
        const bi = TEMPLATE_ORDER.get(b.template_id) ?? 1000
        return ai - bi || a.name.localeCompare(b.name, 'zh-Hans-CN')
      })
      .map((item) => ({
        value: item.template_id,
        label: item.name,
        desc: item.description || item.use_case || '',
      }))
  }, [styleTemplates])
  const quickOptions = templateOptions.slice(0, 7)
  const moreOptions = templateOptions.slice(7)
  const visibleQuickOptions = summaryMode === 'speaker_aware' ? SPEAKER_AWARE_CARDS : quickOptions
  const visibleQuickValues = new Set(visibleQuickOptions.map((c) => c.value))
  const visibleMoreOptions = summaryMode === 'speaker_aware'
    ? templateOptions.filter((option) => !SPEAKER_AWARE_VALUES.has(option.value))
    : moreOptions

  // ── 模型选择：复用 providerStore + configStore 记忆 ──
  const providers = useProviderStore((s) => s.providers)
  const providerModels = useProviderStore((s) => s.providerModels)
  const modelsLoading = useProviderStore((s) => s.modelsLoading)
  const fetchProviders = useProviderStore((s) => s.fetchProviders)

  const savedProviderId = useConfigStore((s) => s.summaryProviderId)
  const savedModelId = useConfigStore((s) => s.summaryModelId)
  const setConfig = useConfigStore((s) => s.setConfig)

  const [providerId, setProviderId] = useState(savedProviderId)
  const [modelId, setModelId] = useState(savedModelId)

  // 拉取 provider 列表（如果还没有）
  useEffect(() => {
    if (providers.length === 0) fetchProviders()
  }, [providers.length, fetchProviders])

  // 可用 provider（有 chat 能力的）
  const chatProviders = providers.filter(
    (p) => p.enabled && (p.capabilities ?? []).includes('chat'),
  )

  // 独立拆分后的 NoteBi 可能只迁移了 API Key，没有迁移浏览器里的模型选择。
  // 优先恢复用户上次选择，其次使用后端默认 provider，最后选择第一个可用 chat provider。
  const effectiveProviderId =
    (providerId && chatProviders.some((p) => p.id === providerId) ? providerId : '') ||
    chatProviders.find((p) => p.id === savedProviderId)?.id ||
    chatProviders.find((p) => Boolean(p.default_models?.chat?.trim()))?.id ||
    chatProviders[0]?.id ||
    ''

  // 当前 provider 的模型列表
  const models: Model[] = effectiveProviderId ? providerModels[effectiveProviderId] ?? [] : []
  // 只保留能做文字总结的模型：capabilities 含 'chat'；无标签的旧数据放行
  const textModels = models.filter((m) => !m.capabilities || m.capabilities.includes('chat'))
  const isLoading = effectiveProviderId ? !!modelsLoading[effectiveProviderId] : false

  // 模型列表到达后，恢复已保存模型；没有保存值时使用 provider 默认模型，
  // 再没有则选第一个可用 chat 模型，避免把“已配置 API Key”误报成“未配置 LLM”。
  const providerDefault = providers
    .find((p) => p.id === effectiveProviderId)
    ?.default_models?.chat?.trim()
  const effectiveModelId =
    textModels.some((m) => m.id === modelId)
      ? modelId
      : textModels.find((m) => m.id === providerDefault)?.id ??
        textModels[0]?.id ??
        ''

  // 切换 provider 时清空 model
  const handleProviderChange = (id: string) => {
    setProviderId(id)
    setModelId('')
  }

  const handleGenerate = () => {
    // 记忆本次选择
    setConfig({ summaryProviderId: effectiveProviderId, summaryModelId: effectiveModelId })
    onSubmit({
      template,
      summaryMode,
      background,
      providerId: effectiveProviderId,
      model: effectiveModelId,
      searchWeb,
    })
  }

  return (
    <div className="nsm-overlay" onClick={onClose}>
      <div className="nsm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="nsm-header">
          <span className="nsm-title">新建总结</span>
          <button className="nsm-close" onClick={onClose}>✕</button>
        </div>

        <div className="nsm-body">
          {allowSpeakerAware && (
            <div className="nsm-section">
              <label className="nsm-toggle-row nsm-speaker-toggle">
                <input
                  type="checkbox"
                  aria-label="区分说话人"
                  checked={summaryMode === 'speaker_aware'}
                  disabled={!speakerAwareAvailable}
                  onChange={(event) => handleSpeakerAwareChange(event.target.checked)}
                />
                <span className="nsm-toggle-label">区分说话人</span>
                <span className="nsm-toggle-hint">
                  {speakerAwareAvailable ? '默认关闭' : '请重新分析并开启“区分说话人”'}
                </span>
              </label>
              {summaryMode === 'speaker_aware' && (
                <div className="nsm-speaker-aware-note">
                  将按说话人整理观点、共识、分歧、决策和行动项；需要先完成说话人识别。
                </div>
              )}
            </div>
          )}
          {/* 常用模板卡片 */}
          <div className="nsm-section">
            <div className="nsm-section-label">
              {summaryMode === 'speaker_aware' ? '区分说话人的总结方式' : '常用模板'}
            </div>
            <div className="nsm-grid">
              {visibleQuickOptions.map((c) => (
                <button
                  key={c.value}
                  className={`nsm-card ${template === c.value ? 'active' : ''}`}
                  onClick={() => chooseTemplate(c.value)}
                >
                  <span className="nsm-card-label">{c.label}</span>
                  <span className="nsm-card-desc">{c.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 更多模板下拉 */}
          <div className="nsm-section">
            <div className="nsm-row">
              <span className="nsm-section-label" style={{ margin: 0 }}>更多模板：</span>
              <select
                value={visibleQuickValues.has(template) ? '' : template}
                onChange={(e) => e.target.value && chooseTemplate(e.target.value)}
                className="nsm-select"
              >
                <option value="" disabled>选择其他模板</option>
                {visibleMoreOptions.map((o) => (
                  <option key={o.value} value={o.value} title={o.desc}>{o.label}</option>
                ))}
              </select>
              <span
                title={visibleMoreOptions.find((o) => o.value === template)?.desc}
                style={{ display: visibleQuickValues.has(template) ? 'none' : 'inline-flex', cursor: 'help' }}
              >
                <HelpCircle size={14} style={{ opacity: 0.5 }} />
              </span>
            </div>
            {!visibleQuickValues.has(template) && visibleMoreOptions.find((o) => o.value === template) && (
              <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                {visibleMoreOptions.find((o) => o.value === template)!.desc}
              </div>
            )}
          </div>

          {/* 模型选择（与 PreflightConfigPanel 对齐的双下拉） */}
          <div className="nsm-section">
            <div className="nsm-section-label">模型</div>
            <div className="nsm-model-row">
              <select
                value={effectiveProviderId}
                onChange={(e) => handleProviderChange(e.target.value)}
                className="nsm-select"
              >
                <option value="">默认供应商</option>
                {chatProviders.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <select
                value={effectiveModelId}
                onChange={(e) => setModelId(e.target.value)}
                disabled={!effectiveProviderId || isLoading}
                className="nsm-select"
              >
                <option value="">
                  {isLoading ? '加载中…' : textModels.length === 0 && providerId ? '无可用模型' : '默认模型'}
                </option>
                {textModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.name || m.id}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 联网搜索开关 */}
          <div className="nsm-section">
            <label className="nsm-toggle-row">
              <input
                type="checkbox"
                checked={searchWeb}
                onChange={(e) => setSearchWeb(e.target.checked)}
              />
              <span className="nsm-toggle-label">联网搜索补充上下文</span>
              <span className="nsm-toggle-hint">（需在设置中配置 Tavily API Key）</span>
            </label>
          </div>

          {/* 补充背景 */}
          <div className="nsm-section">
            <textarea
              value={background}
              onChange={(e) => setBackground(e.target.value)}
              placeholder="补充背景信息，帮助 LLM 更好理解…（可选）"
              className="nsm-textarea"
              rows={3}
            />
          </div>
        </div>

        <div className="nsm-footer">
          <button className="nsm-btn-cancel" onClick={onClose}>取消</button>
          <button
            className="nsm-btn-confirm"
            disabled={creating}
            onClick={handleGenerate}
          >
            {creating ? '生成中…' : '生成'}
          </button>
        </div>
      </div>
    </div>
  )
}
