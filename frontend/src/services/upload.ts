import { http } from './client'

/** POST /api/upload 的内层 data 字段结构 */
interface UploadData {
  url: string
  filename: string
  project_id: string
}

/** BiliNote 风格统一响应包装 */
interface BiliNoteResponse<T> {
  code: number
  msg: string
  data: T
}

/** uploadLocalFile 返回类型 */
export interface UploadResponse {
  video_path: string
  project_id: string
}

/**
 * 上传本地音视频文件到后端 POST /api/upload
 *
 * @param file       - 用户选取的本地文件（File 对象）
 * @param projectId  - 可选的项目 ID；若传入，后端会将文件存入对应项目目录
 * @param onProgress - 可选的上传进度回调，参数为 0-100 的百分比整数
 * @returns 包含 video_path 和 project_id 的响应对象
 */
export async function uploadLocalFile(
  file: File,
  projectId?: string,
  onProgress?: (percent: number) => void,
): Promise<UploadResponse> {
  const formData = new FormData()
  formData.append('file', file)
  if (projectId) {
    formData.append('project_id', projectId)
  }

  // 后端路由前缀 /api，返回 BiliNote 风格 {code, msg, data}
  const res = await http.post<BiliNoteResponse<UploadData>>(
    '/api/upload',
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress(progressEvent) {
        if (onProgress && progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total)
          onProgress(percent)
        }
      },
    },
  )

  // res.data 是 {code, msg, data: {url, filename, project_id}}
  const { url, project_id } = res.data.data
  return {
    video_path: url,
    project_id,
  }
}

