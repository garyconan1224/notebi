import { type ReactNode, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Home,
  Plus,
  Sparkles,
  FileText,
  Star,
  Search,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useSystemStats } from '@/hooks/useSystemStats'
import { useHealthPulse } from '@/hooks/useHealthPulse'
import { FloatingTaskQueue } from '@/components/FloatingTaskQueue'
import { GlobalAddMaterialModal } from '@/components/workspace/GlobalAddMaterialModal'
import ThemeSwitcher from '@/components/ThemeSwitcher'
import { useAddMaterialStore } from '@/store/addMaterialStore'
import {
  APP_NAME,
  getProductStorageItem,
  setProductStorageItem,
} from '@/config/product'

interface NavItem {
  id: string
  path: string
  icon: LucideIcon
  label: string
  visible?: boolean
  badge?: string
  placeholder?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { id: 'home',       path: '/',           icon: Home,         label: '首页' },
  { id: 'notes',      path: '/notes',      icon: FileText,     label: '笔记' },
]

const BOTTOM_ITEMS: NavItem[] = [
  { id: 'favorites',   path: '/favorites',   icon: Star,       label: '收藏夹' },
  { id: 'search',      path: '/search',      icon: Search,     label: '智能检索' },
  { id: 'settings',    path: '/settings',    icon: Settings,   label: '设置' },
]

const VISIBLE_NAV_ITEMS = NAV_ITEMS.filter((item) => item.visible !== false)
const VISIBLE_BOTTOM_ITEMS = BOTTOM_ITEMS.filter((item) => item.visible !== false)

interface SidebarBtnProps {
  icon: LucideIcon
  label: string
  active: boolean
  badge?: string
  placeholder?: boolean
  collapsed: boolean
  onClick: () => void
}

function SidebarBtn({ icon: Icon, label, active, badge, placeholder, collapsed, onClick }: SidebarBtnProps) {
  const tooltip = [label, badge, placeholder ? '即将上线' : undefined].filter(Boolean).join(' · ')

  if (collapsed) {
    return (
      <button
        title={tooltip}
        onClick={placeholder ? () => toast('该功能即将上线') : onClick}
        className={cn(
          'relative flex size-11 items-center justify-center rounded-xl transition-all duration-150',
          placeholder
            ? 'cursor-default text-muted-foreground/50'
            : active
              ? 'bg-accent text-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        <Icon size={20} />
        {active && !placeholder && (
          <span className="absolute -left-2 top-2 bottom-2 w-[3px] rounded-full bg-foreground" />
        )}
      </button>
    )
  }

  return (
    <button
      title={label}
      onClick={placeholder ? () => toast('该功能即将上线') : onClick}
      className={cn(
        'relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-150',
        placeholder
          ? 'cursor-default text-muted-foreground/50'
          : active
            ? 'bg-accent text-foreground shadow-sm'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <Icon size={18} className="shrink-0" />
      <span className="truncate">{label}</span>
      {badge && (
        <span
          className={cn(
            'ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium leading-tight',
            badge !== 'Beta' && 'bg-muted text-muted-foreground',
          )}
          style={badge === 'Beta' ? { background: 'var(--accl)', color: 'var(--acc)' } : undefined}
        >
          {badge}
        </span>
      )}
      {active && !placeholder && (
        <span className="absolute -left-2 top-2 bottom-2 w-[3px] rounded-full bg-foreground" />
      )}
    </button>
  )
}

function SidebarStatus({
  collapsed,
  online,
  stats,
}: {
  collapsed: boolean
  online: boolean
  stats: ReturnType<typeof useSystemStats>['stats']
}) {
  if (collapsed) {
    return (
      <div className="mt-2 flex flex-col items-center gap-2">
        <ThemeSwitcher />
        <span
          className="size-2 rounded-full"
          style={{ background: online ? 'var(--accent-green)' : 'var(--accent-pink)' }}
          title={`后端 ${BACKEND_ADDR} · ${online ? '在线' : '离线'}`}
        />
      </div>
    )
  }

  return (
    <div className="mt-2 rounded-xl border border-border bg-muted/35 p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">状态</span>
        <ThemeSwitcher />
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span
          className="size-1.5 rounded-full"
          style={{ background: online ? 'var(--accent-green)' : 'var(--accent-pink)' }}
        />
        <span className="truncate">{BACKEND_ADDR}</span>
        <span className="ml-auto">{online ? '在线' : '离线'}</span>
      </div>
      {stats?.cpu && stats?.memory && (
        <div className="mt-1 text-[11px] text-muted-foreground">
          CPU {stats.cpu.percent.toFixed(0)}% · MEM {formatBytes(stats.memory.used)}/{formatBytes(stats.memory.total)}
        </div>
      )}
    </div>
  )
}

export interface AppShellProps {
  children: ReactNode
}

/** 字节数转可读格式 */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)}G`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)}M`
  return `${(bytes / 1024).toFixed(0)}K`
}

/** 后端地址（与 .env 默认一致） */
const BACKEND_ADDR = `127.0.0.1:${import.meta.env.VITE_BACKEND_PORT ?? '8001'}`

export function AppShell({ children }: AppShellProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { stats } = useSystemStats()
  // /admin/system/stats 是诊断接口，模型推理高负载时可能超时；在线灯只由轻量 /health 决定。
  const health = useHealthPulse(5000)
  // 允许一次健康探针抖动，不让侧栏状态在重负载时瞬间闪成 offline；连续约 15s 无成功握手才算离线。
  const online = health.online || Boolean(
    health.data && health.lastCheckedAt && Date.now() - health.lastCheckedAt < 15_000,
  )
  const openAddMaterial = useAddMaterialStore((state) => state.openAddMaterial)
  const [collapsed, setCollapsed] = useState<boolean>(
    () => getProductStorageItem('sidebar-collapsed', 'nibi-sidebar-collapsed') === '1',
  )

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      setProductStorageItem('sidebar-collapsed', v ? '0' : '1')
      return !v
    })
  }

  useEffect(() => {
    document.body.classList.toggle('nibi-sidebar-compact', collapsed)
    return () => {
      document.body.classList.remove('nibi-sidebar-compact')
    }
  }, [collapsed])

  const isActive = (item: NavItem) => {
    if (item.id === 'home') return location.pathname === '/'
    if (item.id === 'notes') return location.pathname.startsWith('/notes')
    return location.pathname.startsWith(item.path)
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden print:block print:h-auto print:overflow-visible">
      {/* ── Sidebar ── */}
      <nav
        aria-label="主导航"
        className={cn(
          'flex shrink-0 flex-col border-r border-border bg-background py-4 transition-[width] duration-200 print:hidden',
          collapsed ? 'w-[64px] items-center gap-1 px-0' : 'w-[216px] items-stretch gap-1 px-2',
        )}
      >
        {/* Logo slot + collapse toggle */}
        {collapsed ? (
          <>
            <button
              className="mb-1 flex size-11 items-center justify-center rounded-lg transition-colors hover:opacity-80"
              style={{ background: 'var(--accl)', color: 'var(--acc)' }}
              onClick={() => navigate('/')}
              title={APP_NAME}
              aria-label="返回工作台"
            >
              <Sparkles size={16} />
            </button>
            <button
              className="mb-2 flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={toggleCollapsed}
              title="展开导航"
              aria-label="展开导航"
            >
              <PanelLeftOpen size={16} />
            </button>
          </>
        ) : (
          <div className="mb-3 flex items-center gap-2.5 rounded-xl px-3 py-2">
            <button
              className="flex items-center gap-2.5 transition-colors hover:opacity-80"
              onClick={() => navigate('/')}
              title={APP_NAME}
              aria-label="返回工作台"
            >
              <span
                className="flex size-8 items-center justify-center rounded-lg shadow-sm"
                style={{ background: 'var(--accl)', color: 'var(--acc)' }}
              >
                <Sparkles size={16} />
              </span>
              <span className="text-sm font-semibold" style={{ fontFamily: 'var(--fd)', color: 'var(--fg)' }}>
                {APP_NAME}
              </span>
            </button>
            <button
              className="ml-auto flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={toggleCollapsed}
              title="折叠导航"
              aria-label="折叠导航"
            >
              <PanelLeftClose size={16} />
            </button>
          </div>
        )}

        {/* ＋新建 按钮 */}
        <button
          className={cn(
            'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            collapsed && 'justify-center px-0',
          )}
          style={{
            background: 'var(--accl)',
            color: 'var(--acc)',
          }}
          onClick={() => openAddMaterial()}
          title="新建内容"
          aria-label="新建内容"
        >
          <Plus size={16} />
          {!collapsed && <span>新建</span>}
        </button>

        {/* Separator */}
        <div className={cn('my-2 h-px bg-border', collapsed ? 'mx-3 w-6' : 'mx-2')} />

        {/* Main nav */}
        {VISIBLE_NAV_ITEMS.map((item) => (
          <SidebarBtn
            key={item.id}
            icon={item.icon}
            label={item.label}
            active={isActive(item)}
            badge={item.badge}
            placeholder={item.placeholder}
            collapsed={collapsed}
            onClick={() => navigate(item.path)}
          />
        ))}

        {/* Separator */}
        <div className={cn('my-2 h-px bg-border', collapsed ? 'mx-3 w-6' : 'mx-2')} />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom nav (search, settings) */}
        {VISIBLE_BOTTOM_ITEMS.map((item) => (
          <SidebarBtn
            key={item.id}
            icon={item.icon}
            label={item.label}
            active={isActive(item)}
            collapsed={collapsed}
            onClick={() => navigate(item.path)}
          />
        ))}

        <SidebarStatus collapsed={collapsed} online={online} stats={stats} />
      </nav>

      {/* ── Main content ── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden print:overflow-visible print:h-auto">
        {children}
      </div>

      {/* Global floating task queue — fixed position, outside layout flow */}
      <FloatingTaskQueue />
      <GlobalAddMaterialModal />
    </div>
  )
}

export default AppShell
