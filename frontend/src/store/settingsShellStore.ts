import { create } from 'zustand'
import type { SaveBarState } from '@/layouts/SettingsShell'

/**
 * 设置页通用 Shell 的状态桥（SETTINGS_REPLICA_PLAN.md §3.1 M0）。
 *
 * 用途：在 `<SettingsShell />` 的粘性 SaveBar 与各个子页面编辑草稿之间建立单向数据流——
 * 子页面在 `useEffect` 中调用 `setSaveBar({...})` 推送脏计数与保存/重置回调，
 * 卸载时调用 `resetSaveBar()` 归零；`<SettingsShell />` 订阅 `saveBarState` 渲染。
 *
 * 不引入 `persist`：SaveBar 状态天然随路由/草稿生命周期存在，落 localStorage 反而制造脏数据。
 */
export interface SettingsShellStore {
  saveBarState: SaveBarState
  setSaveBar: (state: SaveBarState) => void
  resetSaveBar: () => void
}

const DEFAULT_SAVE_BAR_STATE: SaveBarState = { dirtyCount: 0 }

export const useSettingsShellStore = create<SettingsShellStore>((set) => ({
  saveBarState: DEFAULT_SAVE_BAR_STATE,
  setSaveBar: (state) => set({ saveBarState: state }),
  resetSaveBar: () => set({ saveBarState: DEFAULT_SAVE_BAR_STATE }),
}))

