/** 6 个 Tab 的 id */
export type TabId =
  | 'materials'
  | 'favs'
  | 'chat'
  | 'export'
  | 'style'

/** 设计稿中素材卡片的状态 */
export type MaterialState = 'done' | 'running' | 'queued' | 'error'

/** Tab 定义（含图标 + 徽章数量） */
export interface TabDef {
  id: TabId
  label: string
  en: string
  icon: React.ElementType
  count: number | null
  disabled?: boolean
  disabledHint?: string
}
