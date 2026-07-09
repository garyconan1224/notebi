import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  Loader2,
  Plus,
  Check,
  Zap,
  Pencil,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { http } from '@/services/client'
import {
  useProviderStore,
  type ProviderItem,
} from '@/store/providerStore'
import type { EditDraft, ProviderDetail } from '@/components/settings/providers/ProviderDetailPanel'

/** 新增对话框草稿 */
interface CreateForm {
  name: string
  kind: 'openai_compatible' | 'anthropic'
  api_key: string
  base_url: string
}

const EMPTY_CREATE_FORM: CreateForm = {
  name: '',
  kind: 'openai_compatible',
  api_key: '',
  base_url: '',
}

function baselineFromDetail(detail: ProviderDetail): EditDraft {
  return {
    api_key: '',
    base_url: detail.base_url,
    enabled: detail.enabled,
    name: detail.name,
  }
}

const EMPTY_DRAFT: EditDraft = { api_key: '', base_url: '', enabled: false, name: '' }

/** Provider 颜色映射（用于 pc-logo 背景） — 用 Nibi token 色域 */
function providerColor(kind: string): string {
  const map: Record<string, string> = {
    anthropic:      'var(--acc)',   // amber accent
    openai_compatible: 'var(--ok)', // green success
    ollama:         'var(--acc)',   // 未注册类型回退
  }
  return map[kind] ?? 'var(--acc)'
}

const ProvidersManagementPage = () => {
  const { t } = useTranslation(['providers', 'settings', 'common'])

  // ── 列表状态 ──
  const [providers, setProviders] = useState<ProviderItem[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── 详情缓存 ──
  const [detailCache, setDetailCache] = useState<Record<string, ProviderDetail>>({})

  // ── 编辑弹窗 ──
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft>(EMPTY_DRAFT)
  const [editingDetail, setEditingDetail] = useState<ProviderDetail | null>(null)

  // ── 过渡态 ──
  const [savingId, setSavingId] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<
    Record<string, { ok: boolean; msg: string }>
  >({})

  // ── 新增 / 删除对话框 ──
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_CREATE_FORM)
  const [creating, setCreating] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<ProviderItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const removeProviderInStore = useProviderStore((s) => s.removeProvider)

  /* ── 拉取列表 ── */
  const fetchProviders = async () => {
    try {
      setListLoading(true)
      const res = await http.get('/providers')
      const list: ProviderItem[] = res.data.data ?? res.data
      setProviders(list)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common:status.unknownError'))
    } finally {
      setListLoading(false)
    }
  }
  useEffect(() => {
    void fetchProviders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ── 懒加载详情 ── */
  const loadDetail = async (id: string) => {
    if (detailCache[id]) return detailCache[id]
    const res = await http.get(`/providers/${id}`)
    const detail: ProviderDetail = res.data.data ?? res.data
    setDetailCache((prev) => ({ ...prev, [id]: detail }))
    return detail
  }

  /* ── 打开编辑弹窗 ── */
  const handleOpenEdit = async (id: string) => {
    try {
      const detail = await loadDetail(id)
      setEditingId(id)
      setEditingDetail(detail)
      setEditDraft(baselineFromDetail(detail))
    } catch {
      toast.error(t('detail.fetchFailed'))
    }
  }

  /* ── 保存编辑 ── */
  const handleSaveEdit = async () => {
    if (!editingId || !editingDetail) return
    const id = editingId
    setSavingId(id)
    try {
      const body: Record<string, unknown> = {
        base_url: editDraft.base_url,
        enabled: editDraft.enabled,
        name: editDraft.name,
        default_models: editingDetail.default_models,
      }
      if (editDraft.api_key.trim() !== '') body.api_key = editDraft.api_key

      await http.put(`/providers/${id}`, body)
      toast.success(t('save.success'))

      const updated: ProviderDetail = {
        ...editingDetail,
        base_url: editDraft.base_url,
        enabled: editDraft.enabled,
        name: editDraft.name,
        has_api_key:
          editDraft.api_key.trim() !== '' ? true : editingDetail.has_api_key,
      }
      setDetailCache((prev) => ({ ...prev, [id]: updated }))
      setProviders((prev) =>
        prev.map((p) =>
          p.id === id
            ? { ...p, enabled: editDraft.enabled, name: editDraft.name, base_url: editDraft.base_url }
            : p,
        ),
      )
      setEditingId(null)
      setEditingDetail(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('save.failed'))
    } finally {
      setSavingId(null)
    }
  }

  /* ── 连接测试 ── */
  const handleTest = async (id: string) => {
    const prov = providers.find((p) => p.id === id)
    if (!prov) return
    setTestingId(id)
    try {
      const res = await http.post('/providers/test', { provider_id: id })
      const data = res.data.data ?? res.data
      setTestResult((prev) => ({
        ...prev,
        [id]: { ok: true, msg: data.message || t('test.successDefault') },
      }))
      toast.success(t('test.successToast', { name: prov.name }))
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('test.failedDefault')
      setTestResult((prev) => ({ ...prev, [id]: { ok: false, msg } }))
      toast.error(t('test.failedToast', { name: prov.name, msg }))
    } finally {
      setTestingId(null)
    }
  }

  /* ── 切换启用 ── */
  const handleToggleEnabled = async (p: ProviderItem) => {
    try {
      const detail = await loadDetail(p.id)
      const newEnabled = !detail.enabled
      const body = {
        base_url: detail.base_url,
        enabled: newEnabled,
        name: detail.name,
        default_models: detail.default_models,
      }
      await http.put(`/providers/${p.id}`, body)
      const updated: ProviderDetail = { ...detail, enabled: newEnabled }
      setDetailCache((prev) => ({ ...prev, [p.id]: updated }))
      setProviders((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, enabled: newEnabled } : x)),
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('save.failed'))
    }
  }

  /* ── 删除 ── */
  const handleConfirmDelete = async () => {
    if (!pendingDelete) return
    const target = pendingDelete
    setDeleting(true)
    try {
      await removeProviderInStore(target.id)
      setProviders((prev) => prev.filter((p) => p.id !== target.id))
      setDetailCache((prev) => {
        const n = { ...prev }
        delete n[target.id]
        return n
      })
      setTestResult((prev) => {
        const n = { ...prev }
        delete n[target.id]
        return n
      })
      toast.success(t('delete.successToast', { name: target.name }))
      setPendingDelete(null)
    } catch {
      toast.error(t('delete.failed'))
    } finally {
      setDeleting(false)
    }
  }

  /* ── 新增 ── */
  const handleCreate = async () => {
    if (!createForm.name.trim()) {
      toast.error(t('create.nameRequired'))
      return
    }
    setCreating(true)
    try {
      await http.post('/providers', createForm)
      toast.success(t('create.successToast', { name: createForm.name }))
      setCreateOpen(false)
      setCreateForm(EMPTY_CREATE_FORM)
      await fetchProviders()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('create.failed'))
    } finally {
      setCreating(false)
    }
  }

  /* ── 渲染 ── */
  if (listLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2" style={{ color: 'var(--mut)' }}>
        <Loader2 className="size-5 animate-spin" />
        <span>{t('common:status.loading')}</span>
      </div>
    )
  }

  return (
    <div className="settings-panel">
      {/* ── 全局错误横幅 ── */}
      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 mb-5">
          <AlertCircle className="size-4 shrink-0" />
          <span>{error}</span>
          <button
            type="button"
            className="ml-auto text-red-400 hover:text-red-600"
            onClick={() => setError(null)}
            aria-label="dismiss-error"
          >
            ✕
          </button>
        </div>
      ) : null}

      {/* ── 区段头部 ── */}
      <div className="settings-header">
        <div>
          <h2>模型与渠道</h2>
          <div className="settings-header-desc">
            API 提供方管理 · 认证配置 · 连接测试
          </div>
        </div>
        <div className="settings-header-actions">
          <button
            type="button"
            className="settings-save-btn"
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={14} />
            {t('list.addButton')}
          </button>
        </div>
      </div>

      {/* ── 提供商卡片网格 ── */}
      <div className="settings-section">
        <div className="settings-section-title">API 提供方 · Providers</div>
        {providers.length === 0 ? (
          <div className="settings-empty">
            <Zap className="settings-empty-icon size-8" />
            <p>{t('emptyState.description')}</p>
          </div>
        ) : (
          <div className="provider-grid">
            {providers.map((p) => {
              const tr = testResult[p.id]
              const testing = testingId === p.id
              return (
                <div key={p.id} className="provider-card" data-on={p.enabled}>
                  {/* 顶部：logo + 名称 + 开关 */}
                  <div className="pc-top">
                    <div className="pc-logo" style={{ background: providerColor(p.kind) }}>
                      {p.name[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="pc-name">{p.name}</div>
                      <div className="pc-sub">{p.kind === 'anthropic' ? 'Anthropic · 对话/视觉' : 'OpenAI 兼容 · 通用'}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleEnabled(p)}
                      className="settings-toggle"
                      role="switch"
                      aria-checked={p.enabled}
                      aria-label={p.enabled ? t('badge.enabled') : t('badge.disabled')}
                    >
                      <input type="checkbox" checked={p.enabled} readOnly />
                      <span className="settings-toggle-track">
                        <span className="settings-toggle-thumb" />
                      </span>
                    </button>
                  </div>

                  {/* API Key 行 */}
                  <div className="pc-key">
                    <span className="key-eyebrow">API KEY</span>
                    <code>
                      {p.has_api_key
                        ? '●●●●●●●●●●●●●●●●'
                        : t('detail.apiKeyNotSet', '未配置')}
                    </code>
                    <button
                      type="button"
                      className="key-edit-btn"
                      onClick={() => handleOpenEdit(p.id)}
                    >
                      <Pencil size={11} />
                      编辑
                    </button>
                  </div>

                  {/* 状态栏 */}
                  <div className="pc-stats">
                    <div>
                      <span className="stat-label">STATUS</span>
                      <span className="stat-value" style={{ color: p.enabled ? 'var(--ok)' : 'var(--mut)' }}>
                        {p.enabled ? '● 已启用' : '○ 已停用'}
                      </span>
                    </div>
                    <div>
                      <span className="stat-label">类型</span>
                      <span className="stat-value">{p.kind === 'anthropic' ? 'Anthropic' : 'OpenAI'}</span>
                    </div>
                    <div>
                      <span className="stat-label">测试</span>
                      <span className="stat-value">
                        {tr
                          ? tr.ok
                            ? <span style={{ color: 'var(--ok)' }}>✓ 通过</span>
                            : <span style={{ color: 'var(--err)' }}>✗ 失败</span>
                          : '—'}
                      </span>
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button
                      type="button"
                      onClick={() => handleTest(p.id)}
                      disabled={testing}
                      className="pc-test-btn"
                    >
                      {testing ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin" />
                          测试中…
                        </>
                      ) : tr ? (
                        <>
                          <Check size={12} style={{ color: tr.ok ? 'var(--ok)' : 'var(--err)' }} />
                          {tr.ok ? '连接正常' : '重新测试'}
                        </>
                      ) : (
                        <>
                          <Zap size={12} />
                          测试连接
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(p.id)}
                      style={{
                        height: 32,
                        padding: '0 12px',
                        borderRadius: 'var(--r)',
                        fontSize: 'var(--xs)',
                        fontWeight: 600,
                        border: '1px solid var(--bdr)',
                        cursor: 'pointer',
                        background: 'transparent',
                        color: 'var(--fg2)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        transition: 'all 140ms ease',
                      }}
                    >
                      <Pencil size={12} />
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(p)}
                      style={{
                        height: 32,
                        width: 32,
                        borderRadius: 'var(--r)',
                        fontSize: 'var(--xs)',
                        border: '1px solid var(--bdr)',
                        cursor: 'pointer',
                        background: 'transparent',
                        color: 'var(--mut)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 140ms ease',
                        marginLeft: 'auto',
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── 编辑弹窗 ── */}
      <Dialog
        open={!!editingId}
        onOpenChange={(open) => {
          if (!open) {
            setEditingId(null)
            setEditingDetail(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>编辑提供商 — {editingDetail?.name}</DialogTitle>
          </DialogHeader>
          {editingId && editingDetail ? (
            <div style={{ display: 'grid', gap: 16, paddingTop: 8 }}>
              {/* 名称 */}
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', alignItems: 'center', gap: 10 }}>
                <label style={{ fontSize: 'var(--xs)', fontWeight: 500, color: 'var(--fg2)', textAlign: 'right' }}>
                  {t('detail.nameLabel')}
                </label>
                <Input
                  value={editDraft.name}
                  onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder={t('create.namePlaceholder')}
                />
              </div>
              {/* Base URL */}
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', alignItems: 'center', gap: 10 }}>
                <label style={{ fontSize: 'var(--xs)', fontWeight: 500, color: 'var(--fg2)', textAlign: 'right' }}>
                  Base URL
                </label>
                <Input
                  value={editDraft.base_url}
                  onChange={(e) => setEditDraft((d) => ({ ...d, base_url: e.target.value }))}
                  placeholder="https://api.example.com/v1"
                />
              </div>
              {/* API Key */}
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', alignItems: 'center', gap: 10 }}>
                <label style={{ fontSize: 'var(--xs)', fontWeight: 500, color: 'var(--fg2)', textAlign: 'right' }}>
                  API Key
                </label>
                <Input
                  type="password"
                  value={editDraft.api_key}
                  onChange={(e) => setEditDraft((d) => ({ ...d, api_key: e.target.value }))}
                  placeholder={editingDetail.has_api_key ? '●●●●●●●● (已设置)' : t('detail.apiKeyPlaceholder')}
                />
              </div>
              {/* 启用 */}
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', alignItems: 'center', gap: 10 }}>
                <label style={{ fontSize: 'var(--xs)', fontWeight: 500, color: 'var(--fg2)', textAlign: 'right' }}>
                  {t('detail.enabledLabel')}
                </label>
                <Switch
                  checked={editDraft.enabled}
                  onCheckedChange={(v) => setEditDraft((d) => ({ ...d, enabled: v }))}
                />
              </div>
              {/* 元信息 */}
              <div style={{ padding: '10px 12px', background: 'var(--bgalt)', borderRadius: 'var(--r)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 'var(--xs)', color: 'var(--mut)' }}>
                <span style={{ fontFamily: 'var(--fm)', fontSize: 10 }}>类型: {editingDetail.kind}</span>
                <span style={{ fontFamily: 'var(--fm)', fontSize: 10 }}>ID: {editingDetail.id}</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )}
          <DialogFooter style={{ gap: 8 }}>
            <Button variant="ghost" onClick={() => { setEditingId(null); setEditingDetail(null) }}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={handleSaveEdit} disabled={savingId === editingId} style={{ gap: 6 }}>
              {savingId === editingId ? <Loader2 className="size-4 animate-spin" /> : null}
              {t('common:actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 新增提供商 Dialog ── */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (creating) return
          setCreateOpen(open)
          if (!open) setCreateForm(EMPTY_CREATE_FORM)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('create.title')}</DialogTitle>
          </DialogHeader>
          <div style={{ display: 'grid', gap: 16, paddingTop: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', alignItems: 'center', gap: 10 }}>
              <label style={{ fontSize: 'var(--xs)', fontWeight: 500, color: 'var(--fg2)', textAlign: 'right' }}>
                {t('create.nameLabel')}
              </label>
              <Input
                value={createForm.name}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder={t('create.namePlaceholder')}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', alignItems: 'center', gap: 10 }}>
              <label style={{ fontSize: 'var(--xs)', fontWeight: 500, color: 'var(--fg2)', textAlign: 'right' }}>
                {t('create.kindLabel')}
              </label>
              <Select
                value={createForm.kind}
                onValueChange={(v) =>
                  setCreateForm((f) => ({ ...f, kind: v as CreateForm['kind'] }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="openai_compatible">OpenAI 兼容</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', alignItems: 'center', gap: 10 }}>
              <label style={{ fontSize: 'var(--xs)', fontWeight: 500, color: 'var(--fg2)', textAlign: 'right' }}>
                API Key
              </label>
              <Input
                type="password"
                value={createForm.api_key}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, api_key: e.target.value }))
                }
                placeholder={t('create.apiKeyPlaceholder')}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', alignItems: 'center', gap: 10 }}>
              <label style={{ fontSize: 'var(--xs)', fontWeight: 500, color: 'var(--fg2)', textAlign: 'right' }}>
                Base URL
              </label>
              <Input
                value={createForm.base_url}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, base_url: e.target.value }))
                }
                placeholder={t('create.baseUrlPlaceholder')}
              />
            </div>
          </div>
          <DialogFooter style={{ gap: 8 }}>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={creating} style={{ gap: 6 }}>
              {creating ? <Loader2 className="size-4 animate-spin" /> : null}
              {t('create.title')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 删除确认对话框 ── */}
      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('delete.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('delete.confirmDescription', { name: pendingDelete?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {t('common:actions.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              {t('actions.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default ProvidersManagementPage
