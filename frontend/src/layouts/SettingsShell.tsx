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
  Languages,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useHealthPulse } from '@/hooks/useHealthPulse'
import { useSettingsShellStore } from '@/store/settingsShellStore'

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

interface NavGroup {
  label: string
  items: NavItem[]
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
  const health = useHealthPulse(0)
  const version = health.data?.version ?? 'v0.4.0'
  const location = useLocation()
  const saveBar = useSettingsShellStore((state) => state.saveBarState)
  const dirty = saveBar.dirtyCount > 0
  const saving = saveBar.saving ?? false
  const childOwnsSaveBar = location.pathname === '/settings/analysis-defaults'

  const navGroups: NavGroup[] = [
    {
      label: '常规与外观',
      items: [
        { path: '/settings/general', icon: <Languages size={16} />, label: '界面与语言' },
      ],
    },
    {
      label: 'AI 与模型',
      items: [
        { path: '/settings/providers-models', icon: <Cpu size={16} />, label: '服务渠道与模型' },
      ],
    },
    {
      label: '分析与生成',
      items: [
        { path: '/settings/analysis-defaults', icon: <Sliders size={16} />, label: '分析默认偏好' },
      ],
    },
    {
      label: '导入与网络',
      items: [
        { path: '/settings/download', icon: <IcDownload size={16} />, label: '下载与存储路径' },
        { path: '/settings/network', icon: <Wifi size={16} />, label: '网络与代理' },
      ],
    },
    {
      label: '笔记与数据',
      items: [
        { path: '/settings/style-templates', icon: <Palette size={16} />, label: '笔记模板' },
        { path: '/settings/trash', icon: <Trash2 size={16} />, label: '垃圾桶' },
      ],
    },
    {
      label: '诊断与关于',
      items: [
        { path: '/settings/monitor', icon: <Monitor size={16} />, label: '运行监控' },
        { path: '/settings/about', icon: <Info size={16} />, label: '关于 NoteBi' },
      ],
    },
  ]

  return (
    <div className="settings-wrap">
      {/* 设置页只保留一个紧凑页面头；全局品牌与返回路径由 AppShell 负责。 */}
      <div className="settings-head">
        <h1>设置</h1>
        <p>
          管理界面、模型、分析、下载与诊断。每项变更会在保存后读回确认。
        </p>
      </div>

      {/* ── 左 + 右布局 ── */}
      <div className="settings-layout">
        {/* 左侧导航 */}
        <aside className="settings-sidebar">
          <div className="settings-nav-title">设置分类</div>
          <nav className="settings-nav" role="navigation" aria-label="settings-navigation">
            {navGroups.map((group) => (
              <div className="settings-nav-group" key={group.label}>
                <div className="settings-nav-group-label">{group.label}</div>
                {group.items.map((item) => {
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
              </div>
            ))}
          </nav>

          {/* Build 信息 */}
          <div className="settings-nav-footer">
            <div className="eyebrow">Build</div>
            <div className="build-version">{version}</div>
            <div className="build-meta">local · NoteBi</div>
          </div>
        </aside>

        {/* 右侧内容 */}
        <main className="settings-content">
          <Outlet />
          {!childOwnsSaveBar && (saveBar.onSave || saveBar.onReset) && (
            <div className="settings-header-actions settings-shared-savebar">
              <span className="text-xs text-[var(--mut)]">
                {dirty ? `${saveBar.dirtyCount} 项未保存` : '所有变更已保存'}
              </span>
              <button
                type="button"
                className="settings-reset-btn"
                onClick={saveBar.onReset}
                disabled={!dirty || saving}
              >
                重置
              </button>
              <button
                type="button"
                className="settings-save-btn"
                onClick={saveBar.onSave}
                disabled={!dirty || saving}
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default SettingsShell
