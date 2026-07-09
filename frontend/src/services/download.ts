/**
 * 下载器配置 API 服务（DESIGN_NOTES_SETTINGS.md §3.1 阶段 3 / §4.3 冻结契约）。
 *
 * 后端 `GET/POST /download_config` 统一返回完整 `DownloadConfigPayload`：
 *   {
 *     output_dir, filename_template, http_proxy, po_token, visitor_data,
 *     cookie_base_dirs: string[], concurrency_limit, retry_count, socket_timeout
 *   }
 * POST 支持部分更新语义（字段为 null/undefined 时保留旧值，非空显式覆盖）。
 *
 * 数值字段后端用 Pydantic `ge/le` 前置校验：
 *   - concurrency_limit ∈ [1, 8]
 *   - retry_count       ∈ [0, 10]
 *   - socket_timeout    ∈ [5, 300]
 * 越界返回 422，服务层不做前置拦截（统一由后端作为唯一校验源，D13 裸对象契约）。
 */

import { http } from './client'

/** 后端 wire 格式（snake_case，与 `DownloadConfig` 数据类字段一一对应）。 */
export interface DownloadConfigPayload {
  output_dir: string
  filename_template: string
  http_proxy: string
  po_token: string
  visitor_data: string
  cookie_base_dirs: string[]
  concurrency_limit: number
  retry_count: number
  socket_timeout: number
}

/** 部分更新入参：全部字段可选，后端按"未提供 = 保留"语义处理。 */
export type DownloadConfigPatchPayload = Partial<DownloadConfigPayload>

/** 获取下载器配置（全量回显）。 */
export async function fetchDownloadConfig(): Promise<DownloadConfigPayload> {
  const res = await http.get<DownloadConfigPayload>('/download_config')
  return res.data
}

/**
 * 更新下载器配置。
 *
 * - 仅下发明确变更字段；
 * - 后端返回体即为最新完整快照，前端 store 以此为真相源回写。
 */
export async function updateDownloadConfig(
  patch: DownloadConfigPatchPayload,
): Promise<DownloadConfigPayload> {
  const res = await http.post<DownloadConfigPayload>('/download_config', patch)
  return res.data
}

