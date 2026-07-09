import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Loader2, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { createPipelineTask } from '@/services/pipeline'
import { useTaskStore } from '@/store/taskStore'

interface StoryboardLaunchModalProps {
  open: boolean
  itemName: string
  workspaceId: string
  /** 已有截帧路径（默认选前 8 张） */
  framePaths?: string[]
  onClose: () => void
}

export function StoryboardLaunchModal({
  open,
  itemName,
  workspaceId,
  framePaths = [],
  onClose,
}: StoryboardLaunchModalProps) {
  const [productName, setProductName] = useState(itemName)
  const [coreFeatures, setCoreFeatures] = useState('')
  const [selectedFrames, setSelectedFrames] = useState(() => framePaths.slice(0, 8))
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()
  const addTask = useTaskStore((s) => s.addTask)

  // Reset when opened with new data
  if (open && productName !== itemName && !submitting) {
    setProductName(itemName)
    setSelectedFrames(framePaths.slice(0, 8))
  }

  const toggleFrame = (path: string) => {
    setSelectedFrames((s) =>
      s.includes(path) ? s.filter((p) => p !== path) : [...s, path],
    )
  }

  const handleSubmit = async () => {
    if (!productName.trim()) {
      toast.error('请填写产品名')
      return
    }
    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        project_id: workspaceId,
        product_name: productName.trim(),
        core_features: coreFeatures.trim(),
        image_paths: selectedFrames,
      }
      const res = await createPipelineTask({
        project_id: workspaceId,
        task_type: 'storyboard',
        payload,
      })

      addTask({
        task_id: res.task_id,
        project_id: workspaceId,
        task_type: 'storyboard',
        payload,
        status: 'PENDING',
        progress: 0,
        log: [],
        result: {},
        error: '',
        retry_of: '',
        cancel_requested: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })

      toast.success('分镜任务已启动')
      onClose()
      navigate(`/processing/${res.task_id}`)
    } catch {
      toast.error('创建分镜任务失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="wb-modal-backdrop" data-open={open} onClick={onClose} />
      <div className="pf-drawer" data-open={open} style={{ maxWidth: 480 }}>
        <div className="pf-drawer-head">
          <div>
            <div className="eyebrow">生成分镜</div>
            <h3 className="display" style={{ fontSize: 22, margin: '4px 0 0' }}>
              Storyboard
            </h3>
          </div>
          <button className="btn btn-ghost" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="pf-drawer-body">
          <section className="pf-section">
            <div className="pf-field">
              <label>产品名</label>
              <input
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="产品或内容名称"
              />
            </div>
            <div className="pf-field">
              <label>核心卖点</label>
              <textarea
                value={coreFeatures}
                onChange={(e) => setCoreFeatures(e.target.value)}
                placeholder="描述核心卖点或关键信息…"
                rows={3}
                style={{ resize: 'vertical' }}
              />
            </div>
          </section>

          {framePaths.length > 0 && (
            <section className="pf-section">
              <h4 className="pf-section-title">
                参考图 · 已选 {selectedFrames.length} 张
              </h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {framePaths.map((p) => (
                  <button
                    key={p}
                    onClick={() => toggleFrame(p)}
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 6,
                      border: selectedFrames.includes(p)
                        ? '2px solid var(--ink)'
                        : '2px solid transparent',
                      opacity: selectedFrames.includes(p) ? 1 : 0.4,
                      overflow: 'hidden',
                      cursor: 'pointer',
                      background: 'var(--bg-sunken)',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 9,
                      color: 'var(--ink-4)',
                      fontFamily: 'var(--mono)',
                    }}
                    title={p.split('/').pop()}
                  >
                    {p.split('/').pop()?.slice(0, 8)}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="pf-drawer-foot">
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <button
            className="wb-btn-run"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <><Loader2 size={14} className="animate-spin" /> 创建中…</>
            ) : (
              <>生成分镜 <span className="iconwrap"><ArrowRight size={14} /></span></>
            )}
          </button>
        </div>
      </div>
    </>
  )
}
