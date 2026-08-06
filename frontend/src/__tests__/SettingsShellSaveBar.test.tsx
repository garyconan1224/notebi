import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

import { SettingsShell } from '@/layouts/SettingsShell'
import { useSettingsShellStore } from '@/store/settingsShellStore'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'shell.saveBar.save': '保存',
      'shell.saveBar.reset': '重置',
      'shell.saveBar.saving': '保存中…',
      'shell.saveBar.dirtyCount': '{{count}} 项未保存',
      'shell.saveBar.allSaved': '所有变更已保存',
      'shell.nav.title': '设置',
      'shell.nav.subtitle': '管理界面、模型、分析、下载与诊断。每项变更会在保存后读回确认。',
      'shell.nav.navTitle': '设置分类',
      'shell.nav.groupGeneral': '常规与外观',
      'shell.nav.groupAi': 'AI 与模型',
      'shell.nav.groupAnalysis': '分析与生成',
      'shell.nav.groupImport': '导入与网络',
      'shell.nav.groupNotes': '笔记与数据',
      'shell.nav.groupDiagnostics': '诊断与关于',
      'shell.nav.interfaceLanguage': '界面与语言',
      'shell.nav.providersModels': '服务渠道与模型',
      'shell.nav.analysisDefaults': '分析默认偏好',
      'shell.nav.downloadStorage': '下载与存储路径',
      'shell.nav.networkProxy': '网络与代理',
      'shell.nav.noteTemplates': '笔记模板',
      'shell.nav.exportSync': '导出与同步',
      'shell.nav.trash': '垃圾桶',
      'shell.nav.diagnosticsLogs': '诊断日志',
      'shell.nav.aboutNoteBi': '关于 NoteBi',
    }[key] ?? key),
  }),
}))

vi.mock('@/hooks/useHealthPulse', () => ({
  useHealthPulse: () => ({ online: true, data: { version: 'test' } }),
}))
vi.mock('@/components/LangSwitcher', () => ({
  LangSwitcher: () => <span>语言</span>,
}))

afterEach(() => {
  useSettingsShellStore.getState().resetSaveBar()
})

it('renders child settings save and reset actions in the shared shell', () => {
  const onSave = vi.fn()
  const onReset = vi.fn()
  useSettingsShellStore.getState().setSaveBar({
    dirtyCount: 1,
    onSave,
    onReset,
  })

  render(
    <MemoryRouter initialEntries={['/settings/network']}>
      <Routes>
        <Route path="/settings" element={<SettingsShell />}>
          <Route path="network" element={<div>网络设置内容</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

  const saveBar = screen.getByRole('button', { name: '保存' }).closest('.settings-shared-savebar')
  if (!(saveBar instanceof HTMLElement)) {
    throw new Error('找不到保存条 .settings-shared-savebar')
  }
  expect(screen.getByRole('main')).not.toContainElement(saveBar)

  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  fireEvent.click(screen.getByRole('button', { name: '重置' }))

  expect(onSave).toHaveBeenCalledOnce()
  expect(onReset).toHaveBeenCalledOnce()

  for (const group of [
    '常规与外观',
    'AI 与模型',
    '分析与生成',
    '导入与网络',
    '笔记与数据',
    '诊断与关于',
  ]) {
    expect(screen.getByText(group)).toBeInTheDocument()
  }
  expect(screen.queryByText('SETTINGS · LOCAL · NOTEBI')).not.toBeInTheDocument()
})
