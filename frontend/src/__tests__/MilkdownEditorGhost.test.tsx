/**
 * Q1 红灯 3（集成）：真实 Milkdown 编辑器首挂静默 + 真实插入必须上抛。
 *
 * 说明：jsdom 无法复现浏览器首挂的规范化事务（探测证实），因此幽灵保存的
 * 判定逻辑由 MilkdownSeedGuard.test.ts 单元测试覆盖；本文件守护编辑器接线：
 * 1. 首挂后 onMarkdownChange 不被调用（不产生幽灵保存）；
 * 2. 通过 lnEditorStore.insertFn 的真实事务必须触发一次保存，且内容包含插入文本；
 * 3. 首挂静默不因守卫改动被破坏（防「首次编辑被吞」回归）。
 */
import '@testing-library/jest-dom'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import MilkdownEditor from '@/pages/result/NoteShell/MilkdownEditor'
import { useLnEditorStore } from '@/store/lnEditorStore'

// 非 canonical 的原始 seed（`-` 列表、标题后无空行）——与现场素材同形
const RAW_SEED = [
  '## 背景与动机 [00:07]',
  '在AI浪潮席卷的今天。',
  '',
  '### 基本信息概览 [01:55]',
  '- **性质**：完全免费。',
  '- **平台**：支持Windows。',
].join('\n')

async function waitForEditor(timeoutMs = 8000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (useLnEditorStore.getState().insertFn) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('Milkdown 编辑器未在限时内完成挂载（insertFn 未注册）')
}

describe('MilkdownEditor 首挂保存边界（真实编辑器）', () => {
  it('首挂静默；真实插入触发一次保存且包含插入文本', async () => {
    const onChange = vi.fn()
    render(<MilkdownEditor markdown={RAW_SEED} onMarkdownChange={onChange} registerCommands />)

    await waitForEditor()
    // listener 内部 debounce 200ms；再留足时间确认首挂无 emission
    await new Promise((r) => setTimeout(r, 600))
    expect(onChange).not.toHaveBeenCalled()

    // 通过已注册的 insertFn 走真实 ProseMirror 事务
    const insertFn = useLnEditorStore.getState().insertFn
    expect(insertFn).toBeTruthy()
    const ok = insertFn!('【用户真实输入】')
    expect(ok).toBe(true)

    await new Promise((r) => setTimeout(r, 800))
    expect(onChange).toHaveBeenCalledTimes(1)
    const saved = String(onChange.mock.calls[0][0])
    expect(saved).toContain('【用户真实输入】')
    expect(saved).toContain('背景与动机')
  }, 20000)
})
