import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { bootstrapBackend, isDesktopRuntime } from './bridge'
import './desktop-bootstrap.css'

interface DesktopBootstrapProps {
  children: ReactNode
}

type BootstrapState = 'checking' | 'ready' | 'error'

export default function DesktopBootstrap({ children }: DesktopBootstrapProps) {
  const desktop = isDesktopRuntime()
  const [state, setState] = useState<BootstrapState>(desktop ? 'checking' : 'ready')
  const [error, setError] = useState('')

  const start = useCallback(async () => {
    setState('checking')
    setError('')
    try {
      const result = await bootstrapBackend()
      if (result.status !== 'ready') {
        throw new Error('本地服务没有返回就绪状态')
      }
      setState('ready')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '本地服务启动失败')
      setState('error')
    }
  }, [])

  useEffect(() => {
    if (desktop) {
      void start()
    }
  }, [desktop, start])

  if (!desktop || state === 'ready') {
    return children
  }

  return (
    <main className="desktop-bootstrap" aria-live="polite">
      <section className="desktop-bootstrap__card">
        <div className="desktop-bootstrap__brand">NOTEBI · LOCAL FIRST</div>
        <div className="desktop-bootstrap__rule" />
        <p className="desktop-bootstrap__step">启动检查</p>
        <h1>{state === 'error' ? 'NoteBi 暂时无法启动' : '正在准备 NoteBi'}</h1>
        <p className="desktop-bootstrap__copy">
          {state === 'error'
            ? '应用文件或本地服务没有通过检查。你可以重试；模型稍后在设置页按需下载。'
            : '正在检查应用资源并启动本地服务。检查完成后会自动进入工作台。'}
        </p>
        {state === 'checking' ? (
          <div className="desktop-bootstrap__progress" aria-label="正在启动本地服务">
            <span />
          </div>
        ) : (
          <div className="desktop-bootstrap__error" role="alert">{error}</div>
        )}
        <div className="desktop-bootstrap__footer">
          <span>本地数据不会在此步骤上传</span>
          {state === 'error' && (
            <button type="button" onClick={() => void start()}>重试</button>
          )}
        </div>
      </section>
    </main>
  )
}
