export type BatchStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'partial_cancelled'

export interface BatchItem {
  batch_item_id: string
  source_url: string
  source_title: string
  action: 'process' | 'skip' | 'copy'
  task_id: string
  task_ids: string[]
  status: string
  attempt_no: number
  error: string
}

export interface TaskBatch {
  batch_id: string
  name: string
  source_type: string
  target_workspace_id: string
  items: BatchItem[]
  status: BatchStatus
  settings_snapshot: Record<string, unknown>
  total_count: number
  completed_count: number
  failed_count: number
  cancelled_count: number
  skipped_count: number
  created_at: string
  started_at: string
  completed_at: string
  pause_requested: boolean
  cancel_requested: boolean
}

export interface BatchPreviewItem {
  batch_item_id: string
  source_url: string
  source_title?: string
  status: 'new' | 'exists_in_target' | 'exists_elsewhere'
  existing_workspace_id: string
  existing_item_id?: string
  suggested_action: 'process' | 'skip' | 'copy'
}
