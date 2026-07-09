import { useState, useEffect } from 'react'
import { Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { updateWorkspace } from '@/services/workspaces'
import type { WorkspaceBackground, WorkspaceItem, WorkspaceRecord } from '@/types/workspace'
import { withStatusToast } from '@/lib/statusToast'

interface BackgroundEditorProps {
  open: boolean
  workspaceId: string
  initialName: string
  initial: WorkspaceBackground
  items?: WorkspaceItem[]
  onClose: () => void
  onSaved: (updated: WorkspaceRecord) => void
}

export function BackgroundEditor({
  open,
  workspaceId,
  initialName,
  initial,
  items = [],
  onClose,
  onSaved,
}: BackgroundEditorProps) {
  const [name, setName] = useState('')
  const [contentType, setContentType] = useState('')
  const [participants, setParticipants] = useState('')
  const [topic, setTopic] = useState('')
  const [glossary, setGlossary] = useState('')
  const [purpose, setPurpose] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Form reset on open
      setName(initialName)
      setContentType(initial.content_type ?? '')
      setParticipants(initial.participants?.join('、') ?? '')
      setTopic(initial.topic ?? '')
      setGlossary(initial.glossary?.join('、') ?? '')
      setPurpose(initial.purpose ?? '')
    }
  }, [open, initial, initialName])

  const handleSave = async () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.error('合集名称不能为空')
      return
    }
    setSaving(true)
    try {
      const background: WorkspaceBackground = {
        content_type: contentType.trim(),
        participants: participants.split(/[、,，]/).map((s) => s.trim()).filter(Boolean),
        topic: topic.trim(),
        glossary: glossary.split(/[、,，]/).map((s) => s.trim()).filter(Boolean),
        purpose: purpose.trim(),
      }
      const updated = await withStatusToast(
        () => updateWorkspace(workspaceId, { name: trimmedName, background }),
        {
          id: `workspace-settings-${workspaceId}`,
          loading: '正在保存合集设置…',
          success: '合集设置已保存',
          error: '合集设置保存失败，请重试',
        },
      )
      onSaved(updated)
      onClose()
    } catch {
      /* withStatusToast 已提示 */
    } finally {
      setSaving(false)
    }
  }

  const handleSmartFill = () => {
    const typeText: Record<string, string> = { video: '视频', audio: '音频', image: '图片', text: '文本' }
    const counts = items.reduce<Record<string, number>>((acc, item) => {
      acc[item.type] = (acc[item.type] ?? 0) + 1
      return acc
    }, {})
    const mix = Object.entries(counts)
      .map(([type, count]) => `${typeText[type] ?? type} ${count}`)
      .join('、')
    const names = items
      .map((item) => item.name || item.source_value)
      .filter(Boolean)
      .slice(0, 3)
      .join('、')

    if (!contentType.trim()) setContentType(mix || '主题合集')
    if (!topic.trim()) setTopic(names ? `${initialName}：${names}` : initialName)
    if (!purpose.trim()) setPurpose(items.length > 1 ? '多素材整理、对比与融合总结' : '单素材整理与后续扩展')
    toast.success('已根据当前素材填充背景信息，可继续修改')
  }

  if (!open) return null

  return (
    <div className="tb-modal-overlay" onClick={onClose}>
      <div className="tb-modal tb-settings-modal" onClick={(event) => event.stopPropagation()}>
        <div className="pf-drawer-head">
          <div>
            <div className="eyebrow">合集设置</div>
            <h3 className="display" style={{ fontSize: 22, margin: '4px 0 0' }}>
              名称与背景
            </h3>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="tb-smart-fill" onClick={handleSmartFill}>
              <Sparkles size={13} />
              智能填充简介
            </button>
            <button className="btn btn-ghost" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="pf-drawer-body">
          <section className="pf-section">
            <div className="pf-field">
              <label>合集名称</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="输入合集名称"
              />
            </div>
          </section>

          <section className="pf-section">
            <h4 className="pf-section-title">背景信息</h4>
            <div className="pf-field">
              <label>内容类型</label>
              <input
                value={contentType}
                onChange={(e) => setContentType(e.target.value)}
                placeholder="例：课程、会议、Vlog"
              />
            </div>
            <div className="pf-field">
              <label>人物</label>
              <input
                value={participants}
                onChange={(e) => setParticipants(e.target.value)}
                placeholder="用 、 分隔多人"
              />
            </div>
            <div className="pf-field">
              <label>背景/主题</label>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="例：Q3 战略会议"
              />
            </div>
            <div className="pf-field">
              <label>专有词</label>
              <input
                value={glossary}
                onChange={(e) => setGlossary(e.target.value)}
                placeholder="用 、 分隔多个术语"
              />
            </div>
            <div className="pf-field">
              <label>目的</label>
              <input
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="例：复刻参考、竞品分析"
              />
            </div>
          </section>
        </div>

        <div className="pf-drawer-foot">
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <button className="wb-btn-run" onClick={handleSave} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
