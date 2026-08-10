export interface DesktopBootstrapResult {
  status: 'ready'
  backendUrl: string
}

export function isDesktopRuntime(): boolean {
  return '__TAURI_INTERNALS__' in window
}

export async function bootstrapBackend(): Promise<DesktopBootstrapResult> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<DesktopBootstrapResult>('bootstrap_backend')
}
