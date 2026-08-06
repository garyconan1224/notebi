/* eslint-disable react-refresh/only-export-components */
/**
 * AI 产物的语义渲染器（按 kind 渲染后端校验过的 content_json）。
 *
 * - mind_map：由 `./MindMapView`（mind-elixir 包装）渲染，见该文件；
 * - action_items / key_cards / flashcards / glossary / timeline：语义组件；
 * - 旧产物（无 content_json）：由调用方回退 Markdown 并标注「旧版产物」。
 */
import { useMemo, useState } from 'react'

import type { MindMapData } from './MindMapView'

export function ActionItemsView({ items }: { items: Array<{ id: string; text: string; done: boolean }> }) {
  return (
    <ul className="artifact-action-items">
      {items.map((item) => (
        <li key={item.id} className={item.done ? 'is-done' : ''}>
          <input type="checkbox" readOnly checked={item.done} aria-label={item.text} />
          <span>{item.text}</span>
        </li>
      ))}
    </ul>
  )
}

export function KeyCardsView({ cards }: { cards: Array<{ id: string; title: string; body: string }> }) {
  return (
    <div className="artifact-key-cards">
      {cards.map((card) => (
        <article key={card.id} className="artifact-key-card">
          <h4>{card.title}</h4>
          <p>{card.body}</p>
        </article>
      ))}
    </div>
  )
}

export function FlashcardsView({ cards }: { cards: Array<{ id: string; question: string; answer: string }> }) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  return (
    <div className="artifact-flashcards">
      {cards.map((card) => (
        <button
          key={card.id}
          type="button"
          className="artifact-flashcard"
          aria-expanded={Boolean(revealed[card.id])}
          onClick={() => setRevealed((current) => ({ ...current, [card.id]: !current[card.id] }))}
        >
          <span className="artifact-flashcard-q">Q · {card.question}</span>
          {revealed[card.id] && <span className="artifact-flashcard-a">A · {card.answer}</span>}
          {!revealed[card.id] && <span className="artifact-flashcard-hint">点击显示答案</span>}
        </button>
      ))}
    </div>
  )
}

export function GlossaryView({ rows }: { rows: Array<{ term: string; definition: string; context: string }> }) {
  return (
    <table className="artifact-table">
      <thead>
        <tr><th>术语</th><th>通俗解释</th><th>材料中的语境</th></tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.term}-${index}`}>
            <td>{row.term}</td>
            <td>{row.definition}</td>
            <td>{row.context}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function TimelineView({ rows }: { rows: Array<{ time: string; event: string; who: string; impact: string }> }) {
  return (
    <table className="artifact-table">
      <thead>
        <tr><th>时间/顺序</th><th>事件或观点</th><th>参与者</th><th>影响</th></tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.time}-${index}`}>
            <td>{row.time}</td>
            <td>{row.event}</td>
            <td>{row.who}</td>
            <td>{row.impact}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/* ── 统一入口：按 kind + content_json 选择渲染器 ────────────── */

export type ArtifactContentJson =
  | MindMapData
  | { items: Array<{ id: string; text: string; done: boolean }> }
  | { cards: Array<{ id?: string; title?: string; body?: string; question?: string; answer?: string }> }
  | { columns?: string[]; rows: Array<Record<string, string>> }
  | null

export function useHasStructuredContent(kind: string, contentJson: ArtifactContentJson): boolean {
  return useMemo(() => {
    if (!contentJson) return false
    if (kind === 'mind_map') return Boolean((contentJson as MindMapData).root)
    if (kind === 'action_items') return Array.isArray((contentJson as { items?: unknown[] }).items)
    if (kind === 'key_cards' || kind === 'flashcards') return Array.isArray((contentJson as { cards?: unknown[] }).cards)
    if (kind === 'glossary' || kind === 'timeline') return Array.isArray((contentJson as { rows?: unknown[] }).rows)
    return false
  }, [kind, contentJson])
}
