/**
 * Q1 红灯 3：Milkdown 首挂规范化不得触发保存；第一次真实键入仍必须保存。
 *
 * 背景（docs/plans/2026-08-02-product-revision.md）：
 * 旧守卫拿「原始 seed 文本」和序列化结果比较，而 Milkdown 首挂会把 Markdown
 * 规范化（标题后补空行、`-` 变 `*`、表格/引用规范化），二者必然不等 → 首挂即保存，
 * 产生与 v1 BASELINE 只差 ~2ms 的幽灵 USER_EDIT v2。
 *
 * 修复契约：建立「初始 canonical 内容」——挂载完成后用编辑器自己的序列化器
 * 捕获初始 doc 的序列化结果作为基线；内容与基线相同 → 规范化/无变化 → 不保存；
 * 内容偏离基线 → 真实编辑 → 保存。
 */
import { describe, expect, it } from 'vitest'
import { createNoteSeedGuard } from '@/pages/result/NoteShell/milkdownSeedGuard'

// 现场素材形状：原始笔记（v1 BASELINE）用 `-` 列表、标题后无空行
const RAW_SEED = [
  '## 背景与动机 [00:07]',
  '在AI浪潮席卷的今天。',
  '',
  '### 基本信息概览 [01:55]',
  '- **性质**：完全免费。',
  '- **平台**：支持Windows。',
].join('\n')

// Milkdown 序列化器的 canonical 形式：标题后补空行、`-` → `*`
const CANONICAL = [
  '## 背景与动机 [00:07]',
  '',
  '在AI浪潮席卷的今天。',
  '',
  '### 基本信息概览 [01:55]',
  '',
  '* **性质**：完全免费。',
  '',
  '* **平台**：支持Windows。',
].join('\n')

describe('createNoteSeedGuard（首挂 canonical 基线）', () => {
  it('挂载规范化：序列化结果等于 canonical 基线时不保存', () => {
    const guard = createNoteSeedGuard(RAW_SEED)
    guard.captureBaseline(CANONICAL)

    // 首挂规范化 emission：内容 == canonical 基线，但 != 原始 seed
    expect(CANONICAL.trim()).not.toBe(RAW_SEED.trim())
    expect(guard.shouldSave(CANONICAL)).toBe(false)
  })

  it('第一次真实键入必须保存', () => {
    const guard = createNoteSeedGuard(RAW_SEED)
    guard.captureBaseline(CANONICAL)

    const edited = `${CANONICAL}\n\n用户追加的一段话`
    expect(guard.shouldSave(edited)).toBe(true)
  })

  it('保存后相同内容不重复保存；再次编辑继续保存', () => {
    const guard = createNoteSeedGuard(RAW_SEED)
    guard.captureBaseline(CANONICAL)

    const edited = `${CANONICAL}\n\n用户追加的一段话`
    expect(guard.shouldSave(edited)).toBe(true)
    // 同一内容再次 emit（例如选区/样式事务）不重复保存
    expect(guard.shouldSave(edited)).toBe(false)
    // 继续编辑再次保存
    expect(guard.shouldSave(`${edited}，继续输入`)).toBe(true)
  })

  it('基线未捕获时的兜底：与原始 seed 相同（含首尾空白差异）不保存', () => {
    const guard = createNoteSeedGuard(RAW_SEED)

    expect(guard.shouldSave(`${RAW_SEED}\n`)).toBe(false)
    // 与 seed 不同的首次 emission 视为真实编辑
    expect(guard.shouldSave(`${RAW_SEED}\n新增内容`)).toBe(true)
  })

  it('原始 seed 恰好已是 canonical 形式时，首挂与真实编辑仍正确区分', () => {
    const guard = createNoteSeedGuard(CANONICAL)
    guard.captureBaseline(CANONICAL)

    expect(guard.shouldSave(CANONICAL)).toBe(false)
    expect(guard.shouldSave(`${CANONICAL}加一个字`)).toBe(true)
  })
})
