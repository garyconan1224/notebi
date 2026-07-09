/**
 * Server-Sent Events (SSE) 通用封装（M4 部署监控）。
 *
 * 设计目标：
 * - 屏蔽浏览器 EventSource 的 API 细节，暴露 React 友好的订阅接口；
 * - 统一错误处理与自动重连（EventSource 自带重连，这里只做幂等 close）；
 * - 支持命名事件（`named event`）与默认 message 事件。
 *
 * 后端若当前未提供 SSE 端点，仍可先在前端完成订阅骨架，
 * 端点就绪后仅需替换 `url` 即可接入，不需修改业务代码。
 */

const BASE = import.meta.env.VITE_BACKEND_BASE_URL ?? 'http://127.0.0.1:8000'

export interface SseHandlers<T = unknown> {
  /** 默认 message 事件回调（解析为 T） */
  onMessage?: (data: T, raw: MessageEvent) => void
  /** 命名事件回调表：key 为事件名，value 为解析后的数据 */
  onEvent?: Record<string, (data: T, raw: MessageEvent) => void>
  /** 网络或解析错误回调（不会终止连接，EventSource 自带重连） */
  onError?: (err: Event) => void
  /** 连接成功建立时回调 */
  onOpen?: () => void
}

export interface SseSubscription {
  /** 手动关闭连接 */
  close: () => void
  /** 当前 readyState（CONNECTING=0, OPEN=1, CLOSED=2） */
  readonly readyState: number
}

/**
 * 订阅一个 SSE 端点。
 *
 * @param path 相对后端 base 的路径，例如 `/admin/logs/stream`
 * @param handlers 事件回调集合
 * @param withCredentials 是否随携 Cookie（跨域场景默认 false）
 *
 * @returns 一个 SseSubscription 句柄，调用 close() 可主动中断。
 *
 * 示例：
 *   const sub = subscribeSse<LogLine>('/admin/logs/stream', {
 *     onMessage: (line) => append(line),
 *   })
 *   return () => sub.close()
 */
export function subscribeSse<T = unknown>(
  path: string,
  handlers: SseHandlers<T> = {},
  withCredentials = false,
): SseSubscription {
  const url = path.startsWith('http') ? path : `${BASE}${path}`
  const source = new EventSource(url, { withCredentials })

  const parse = (raw: MessageEvent): T => {
    try {
      return JSON.parse(raw.data) as T
    } catch {
      // 允许后端直接发送纯文本（如日志行）；此时上层按 unknown 接收
      return raw.data as unknown as T
    }
  }

  if (handlers.onOpen) {
    source.addEventListener('open', handlers.onOpen)
  }

  if (handlers.onMessage) {
    source.addEventListener('message', (evt) => {
      handlers.onMessage!(parse(evt as MessageEvent), evt as MessageEvent)
    })
  }

  if (handlers.onEvent) {
    for (const [name, cb] of Object.entries(handlers.onEvent)) {
      source.addEventListener(name, (evt) => {
        cb(parse(evt as MessageEvent), evt as MessageEvent)
      })
    }
  }

  if (handlers.onError) {
    source.addEventListener('error', handlers.onError)
  }

  return {
    close: () => source.close(),
    get readyState() {
      return source.readyState
    },
  }
}

/**
 * 便捷封装：仅订阅默认 message 事件并返回 cleanup。
 *
 * 适合在 React useEffect 中直接 `return` 使用：
 *   useEffect(() => subscribeMessages('/x', (d) => setLogs((p)=>[...p,d])), [])
 */
export function subscribeMessages<T = unknown>(
  path: string,
  onMessage: (data: T) => void,
  onError?: (err: Event) => void,
): () => void {
  const sub = subscribeSse<T>(path, { onMessage, onError })
  return () => sub.close()
}

