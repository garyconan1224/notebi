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

/** 批次详情附带的可见任务状态；不包含模型私有推理。 */
export interface BatchTaskDetail {
  task_id: string
  status: string
  progress: number
  stage: string
  visible_events: string[]
  summary_preview: string
  error: string
  workspace_id: string
  item_id: string
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
  task_details?: Record<string, BatchTaskDetail>
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
