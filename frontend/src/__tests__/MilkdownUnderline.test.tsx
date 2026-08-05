import '@testing-library/jest-dom'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import MilkdownEditor from '@/pages/result/NoteShell/MilkdownEditor'
import { useLnEditorStore } from '@/store/lnEditorStore'

async function waitForEditor(timeoutMs = 8000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (useLnEditorStore.getState().formatFn) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('Milkdown 编辑器未在限时内完成挂载')
}

describe('MilkdownEditor 下划线 mark', () => {
  it('解析 <u>text</u> 为下划线 mark（非字面文本）', async () => {
    const onChange = vi.fn()
    const { container } = render(
      <MilkdownEditor markdown={'## 标题 [00:00]\n\n这是<u>关键内容</u>的正文。'} onMarkdownChange={onChange} />,
    )
    await waitForEditor()
    await new Promise((r) => setTimeout(r, 800))

    const u = container.querySelector('u')
    expect(u).not.toBeNull()
    expect(u?.textContent).toBe('关键内容')
    // 不应出现字面 <u> 文本
    expect(container.textContent).not.toContain('<u>')
  }, 20000)

  it('下划线序列化往返为 <u>text</u>', async () => {
    const onChange = vi.fn()
    render(<MilkdownEditor markdown={'## 标题 [00:00]\n\n这是<u>关键内容</u>。'} onMarkdownChange={onChange} />)
    await waitForEditor()
    await new Promise((r) => setTimeout(r, 600))

    // 触发一次真实事务，让 listener 上抛当前文档的 markdown
    const insertFn = useLnEditorStore.getState().insertFn
    expect(insertFn).toBeTruthy()
    expect(insertFn!('【追加】')).toBe(true)
    await new Promise((r) => setTimeout(r, 900))

    expect(onChange).toHaveBeenCalled()
    const saved = String(onChange.mock.calls[0][0])
    expect(saved).toContain('<u>关键内容</u>')
  }, 20000)
})
