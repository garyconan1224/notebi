import { http } from './client'
import type { ItemTags, ItemType } from '@/types/workspace'

export interface KnowledgeMapItem {
  item_id: string
  workspace_id: string
  workspace_name: string
  type: ItemType
  source: 'url' | 'local'
  name: string
  source_value: string
  favorite: boolean
  tags: ItemTags
  collection_ids: string[]
  collection_names: string[]
  created_at: string
  updated_at: string
}

export interface KnowledgeMapNode {
  id: string
  kind: 'tag'
  label: string
  count: number
  item_ids: string[]
}

export interface KnowledgeMapEdge {
  id: string
  source: string
  target: string
  kind: 'co_tag'
  weight: number
  item_ids: string[]
}

export interface KnowledgeMapData {
  nodes: KnowledgeMapNode[]
  edges: KnowledgeMapEdge[]
  items: KnowledgeMapItem[]
  stats: {
    items: number
    tagged_items: number
    tags: number
    hidden_tags: number
  }
  facets: {
    workspaces: [string, string][]
    collections: [string, string][]
    types: string[]
    sources: string[]
  }
}

export interface KnowledgeMapFilters {
  workspace_id?: string
  collection_id?: string
  item_type?: ItemType | ''
  source?: 'url' | 'local' | ''
  tag?: string
  favorite?: boolean
  include_inbox?: boolean
  limit?: number
}

export async function fetchKnowledgeMap(
  filters: KnowledgeMapFilters = {},
): Promise<KnowledgeMapData> {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value))
  })
  const response = await http.get<KnowledgeMapData>('/workspaces/knowledge-map', {
    params,
    timeout: 30000,
  })
  return response.data
}
