import { useRouteError, isRouteErrorResponse, useNavigate } from 'react-router-dom'
import { AlertTriangle, Home, RefreshCw } from 'lucide-react'

/**
 * 路由错误兜底页（阶段 E）。
 *
 * 当路由 loader/action 或渲染抛错时，React Router 会渲染此组件。
 * 用户只看到简洁说明，不再看到 React Router 默认的 "Hey developer" 和完整堆栈。
 */
export default function RouteErrorPage() {
  const error = useRouteError()
  const navigate = useNavigate()

  // 开发环境可折叠显示简短错误；生产环境不展示堆栈
  const isDev = import.meta.env.DEV
  let errorMessage = ''
  if (isDev) {
    if (isRouteErrorResponse(error)) {
      errorMessage = `${error.status} ${error.statusText}`
    } else if (error instanceof Error) {
      errorMessage = error.message
    } else if (typeof error === 'string') {
      errorMessage = error
    }
  }

  const handleRetry = () => {
    window.location.reload()
  }

  const handleGoHome = () => {
    navigate('/')
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-background p-6">
      <div className="max-w-md space-y-6 text-center">
        <div className="flex justify-center">
          <div className="rounded-full bg-destructive/10 p-4">
            <AlertTriangle className="size-10 text-destructive" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">页面暂时无法显示</h1>
          <p className="text-sm text-muted-foreground">
            抱歉，页面遇到了问题。您可以尝试重新加载，或返回首页继续使用。
          </p>
        </div>

        {isDev && errorMessage && (
          <details className="rounded-md border border-border bg-muted/30 p-3 text-left">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              开发调试信息
            </summary>
            <pre className="mt-2 overflow-x-auto text-xs text-foreground/80">{errorMessage}</pre>
          </details>
        )}

        <div className="flex justify-center gap-3">
          <button
            type="button"
            onClick={handleRetry}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <RefreshCw size={16} />
            重新加载
          </button>
          <button
            type="button"
            onClick={handleGoHome}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/60"
          >
            <Home size={16} />
            返回首页
          </button>
        </div>
      </div>
    </div>
  )
}
