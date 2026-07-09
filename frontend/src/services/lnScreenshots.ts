import { http } from './client'

interface UploadScreenshotResponse {
  url: string
  filename: string
}

export async function uploadLnScreenshot(
  workspaceId: string,
  blob: Blob,
  ts: number,
): Promise<UploadScreenshotResponse> {
  const form = new FormData()
  form.append('file', blob, `screenshot-${Date.now()}.png`)
  form.append('ts', String(ts))
  const res = await http.post<UploadScreenshotResponse>(
    `/workspaces/${workspaceId}/ln/screenshots`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  )
  return res.data
}
