import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, useRouteError } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RouteErrorPage from '@/components/RouteErrorPage'

// Mock useRouteError
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useRouteError: vi.fn(),
  }
})

const mockReload = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'location', {
    value: { reload: mockReload },
    writable: true,
  })
})

// Helper to render with router context
function renderWithError(error: unknown) {
  vi.mocked(useRouteError).mockReturnValue(error)
  return render(
    <MemoryRouter>
      <RouteErrorPage />
    </MemoryRouter>,
  )
}

describe('RouteErrorPage 路由错误兜底（阶段 E）', () => {
  it('显示友好的错误说明，不显示原始 React 堆栈', () => {
    renderWithError(new Error('Some internal error'))

    expect(screen.getByText('页面暂时无法显示')).toBeTruthy()
    expect(screen.getByText(/抱歉，页面遇到了问题/)).toBeTruthy()
    // 生产环境不展示堆栈（测试环境 import.meta.env.DEV 为 true，但这里只验证不显示堆栈关键词）
    expect(screen.queryByText(/at Object/)).toBeNull()
  })

  it('提供重新加载按钮，点击触发 window.location.reload', () => {
    renderWithError(new Error('test'))

    const retryButton = screen.getByRole('button', { name: /重新加载/ })
    fireEvent.click(retryButton)

    expect(mockReload).toHaveBeenCalled()
  })

  it('提供返回首页按钮', () => {
    renderWithError(new Error('test'))

    const homeButton = screen.getByRole('button', { name: /返回首页/ })
    expect(homeButton).toBeTruthy()
  })

  it('开发环境可折叠显示脱敏后的简短错误信息', () => {
    renderWithError(new Error('Dev error message'))

    // 开发环境应显示 details 折叠区域
    const details = screen.getByText('开发调试信息')
    expect(details).toBeTruthy()
  })

  it('处理 RouteErrorResponse 类型的错误', () => {
    const routeError = {
      status: 404,
      statusText: 'Not Found',
    }
    renderWithError(routeError)

    expect(screen.getByText('页面暂时无法显示')).toBeTruthy()
  })

  it('处理字符串类型的错误', () => {
    renderWithError('String error')

    expect(screen.getByText('页面暂时无法显示')).toBeTruthy()
  })
})
