import { create } from 'zustand'
import type { SniffResult } from '@/services/workspaces'
import type { ItemType } from '@/types/workspace'

export interface AddMaterialLaunchOptions {
  urlValue?: string
  sourceText?: string
  sniffResult?: SniffResult | null
  localFile?: string
  localFileName?: string
  localFileType?: ItemType
  localWsId?: string
  onAdded?: () => void
}

interface AddMaterialStore extends AddMaterialLaunchOptions {
  open: boolean
  openAddMaterial: (options?: AddMaterialLaunchOptions) => void
  closeAddMaterial: () => void
}

const EMPTY_CONTEXT: AddMaterialLaunchOptions = {
  urlValue: undefined,
  sourceText: undefined,
  sniffResult: undefined,
  localFile: undefined,
  localFileName: undefined,
  localFileType: undefined,
  localWsId: undefined,
  onAdded: undefined,
}

export const useAddMaterialStore = create<AddMaterialStore>()((set) => ({
  open: false,
  ...EMPTY_CONTEXT,
  openAddMaterial: (options = {}) => set({
    open: true,
    ...EMPTY_CONTEXT,
    ...options,
  }),
  closeAddMaterial: () => set({
    open: false,
    ...EMPTY_CONTEXT,
  }),
}))
