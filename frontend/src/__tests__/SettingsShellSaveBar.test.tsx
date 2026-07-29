import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

import { SettingsShell } from '@/layouts/SettingsShell'
import { useSettingsShellStore } from '@/store/settingsShellStore'

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
