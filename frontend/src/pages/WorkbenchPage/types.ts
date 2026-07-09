export interface PlatformInfo {
  name: string
  color: string
  types: Array<'video' | 'audio' | 'image' | 'article'>
}

export interface TaskCard {
  id: string
  title: string
  src: string
  type: string
  state: 'done' | 'running' | 'error' | 'cancelled' | 'queued'
  thumb?: string
}
