import * as React from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import {
  Cpu,
  Download as IcDownload,
  Sliders,
  Wifi,
  Monitor,
  Trash2,
  Palette,
  Info,
  ArrowLeft,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { LangSwitcher } from '@/components/LangSwitcher'
import { cn } from '@/lib/utils'
import { useHealthPulse } from '@/hooks/useHealthPulse'
import { productConfig } from '@/config/product'

/** SaveBar 状态类型（保留向后兼容，Step 2+ 逐步移入各 panel 内） */
export interface SaveBarState {
  dirtyCount: number
  saving?: boolean
  onSave?: () => void
  onReset?: () => void
  extra?: React.ReactNode
}

/**
 * 设置页左侧导航项定义
 */
interface NavItem {
  path: string
  icon: React.ReactNode
  label: string
}

/**
 * 设置页通用布局 — 对齐设计稿 pg-settings。
 *
 * 布局：
 * - 顶部 settings-head：返回 + eyebrow + 标题 + 描述
 * - 左栏 settings-sidebar：导航项 + Build 信息卡
 * - 右栏 settings-content：嵌套路由 <Outlet />
 *
 * 导航项按照现有 router 子页组织，不强行凑设计稿数量。
 */
export function SettingsShell() {
  const { t } = useTranslation('settings')
  const health = useHealthPulse(0)
  const version = health.data?.version ?? 'v0.4.0'
  const location = useLocation()

  const navItems: NavItem[] = [
    { path: '/settings/providers-models', icon: <Cpu size={16} />, label: '模型与渠道' },
    { path: '/settings/analysis-defaults', icon: <Sliders size={16} />, label: '分析默认偏好' },
    { path: '/settings/download', icon: <IcDownload size={16} />, label: t('layout.menu.download') },
    { path: '/settings/network', icon: <Wifi size={16} />, label: t('layout.menu.network') },
    { path: '/settings/monitor', icon: <Monitor size={16} />, label: t('layout.menu.monitor') },
    { path: '/settings/trash', icon: <Trash2 size={16} />, label: '垃圾桶' },
    { path: '/settings/style-templates', icon: <Palette size={16} />, label: '风格模板' },
    { path: '/settings/about', icon: <Info size={16} />, label: t('layout.menu.about') },
  ]

  return (
    <div className="settings-wrap">
      {/* ── 顶部头部 ── */}
      <div className="settings-head">
        <div className="flex items-center gap-3 mb-2">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--mut)] hover:text-[var(--fg)] transition-colors"
          >
            <ArrowLeft size={14} />
            <span style={{ fontFamily: 'var(--fd)' }} className="text-base font-semibold text-[var(--fg)]">
              {productConfig.name}
            </span>
          </Link>
          <span className="text-[var(--mut)] text-xs">/</span>
          <LangSwitcher />
        </div>
        <div className="eyebrow">SETTINGS · LOCAL · {productConfig.name.toUpperCase()}</div>
        <h1>设置</h1>
        <p>
          模型、API 密钥、下载路径、分析默认偏好。所有设置本地存储，不上传到服务器。
        </p>
      </div>

      {/* ── 左 + 右布局 ── */}
      <div className="settings-layout">
        {/* 左侧导航 */}
        <aside className="settings-sidebar">
          <div className="settings-nav-title">设置分类</div>
          <nav className="settings-nav" role="navigation" aria-label="settings-navigation">
            {navItems.map((item) => {
              const active = location.pathname === item.path
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn('sn-item')}
                  data-active={active}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className="sn-icon">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              )
            })}
          </nav>

          {/* Build 信息 */}
          <div className="settings-nav-footer">
            <div className="eyebrow">Build</div>
            <div className="build-version">{version}</div>
            <div className="build-meta">local · {productConfig.mode}</div>
          </div>
        </aside>

        {/* 右侧内容 */}
        <main className="settings-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default SettingsShell
