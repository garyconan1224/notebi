/**
 * Milkdown 首挂保存守卫 —— 「初始 canonical 内容」边界
 *
 * 背景：Milkdown 首次挂载时 parser/serializer 会把 Markdown 规范化
 * （标题后补空行、`-` 变 `*`、表格/引用规范化），规范化结果与原始 seed 文本
 * 必然不等。若拿原始 seed 做比较，首挂即触发保存，产生与 BASELINE 只差约 2ms
 * 的幽灵 USER_EDIT 版本（见 docs/plans/2026-08-02-product-revision.md Q1）。
 *
 * 契约：
 * - 编辑器挂载完成后，用编辑器自己的序列化器捕获初始 doc 的序列化结果
 *   （canonical 基线），调用 captureBaseline；
 * - 之后每次 markdownUpdated：内容与已知内容相同 → 不保存；
 *   偏离已知内容 → 真实编辑 → 保存，并把已知内容更新为本次内容；
 * - 基线未能捕获时兜底：与原始 seed（trim 后）相同的首次 emission 不保存。
 *
 * 不使用延时 debounce 猜测用户是否编辑。
 */

export interface NoteSeedGuard {
  /** 挂载完成后捕获初始 canonical 序列化内容作为基线。 */
  captureBaseline(canonicalMd: string): void
  /** 判断一次（已反转义时间码的）序列化内容是否为真实编辑，需要持久化。 */
  shouldSave(normalizedMd: string): boolean
}

export function createNoteSeedGuard(initialRawMd: string): NoteSeedGuard {
  let knownCanonical: string | null = null

  return {
    captureBaseline(canonicalMd: string) {
      knownCanonical = canonicalMd
    },
    shouldSave(normalizedMd: string) {
      if (knownCanonical !== null) {
        if (normalizedMd === knownCanonical) return false
        knownCanonical = normalizedMd
        return true
      }
      // 兜底：基线未捕获时，只能与原始 seed 比较（trim 抵消首尾空白差异）
      if (normalizedMd.trim() === initialRawMd.trim()) {
        knownCanonical = normalizedMd
        return false
      }
      knownCanonical = normalizedMd
      return true
    },
  }
}
