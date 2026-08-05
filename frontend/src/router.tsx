/* eslint-disable react-refresh/only-export-components */
import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate, redirect, type Params } from 'react-router-dom'
import Index from '@/pages/Index'
import RouteErrorPage from '@/components/RouteErrorPage'
import { Skeleton } from '@/components/ui/skeleton'

// 按路由做代码分割：每个页面组件通过动态 import 拆成独立 chunk
const SettingPage = lazy(() => import('@/pages/SettingPage/index'))
const GeneralSettingsPage = lazy(
  () => import('@/pages/SettingPage/GeneralSettingsPage'),
)
const ProvidersAndModelsPage = lazy(
  () => import('@/pages/SettingPage/ProvidersAndModelsPage'),
)
const AnalysisDefaultsPage = lazy(
  () => import('@/pages/SettingPage/AnalysisDefaultsPage'),
)
const NetworkSettingsPage = lazy(
  () => import('@/pages/SettingPage/NetworkSettingsPage'),
)
const DownloadSettingsPage = lazy(
  () => import('@/pages/SettingPage/DownloadSettingsPage'),
)
const DeployMonitorPage = lazy(() => import('@/pages/SettingPage/DeployMonitorPage'))
const AboutPage = lazy(() => import('@/pages/SettingPage/AboutPage'))
const TrashPage = lazy(() => import('@/pages/SettingPage/TrashPage'))
const VideoTemplatesPage = lazy(
  () => import('@/pages/SettingPage/VideoTemplatesPage'),
)
const ExportSyncSettingsPage = lazy(
  () => import('@/pages/SettingPage/ExportSyncSettingsPage'),
)
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))
const WorkspaceList = lazy(() => import('@/pages/WorkspacePage/WorkspaceList'))
const TaskboardPage = lazy(() => import('@/pages/WorkspacePage/TaskboardPage'))
const ResultsOverview = lazy(() => import('@/pages/result/ResultsOverview/index'))
const FavoritesPage = lazy(() => import('@/pages/FavoritesPage/FavoritesPage'))
const SearchPage = lazy(() => import('@/pages/SearchPage/SearchPage'))
const WorkbenchPage = lazy(() => import('@/pages/WorkbenchPage/index'))
const ProcessingPage = lazy(() => import('@/pages/result/ProcessingPage/index'))
const LibraryPage = lazy(() => import('@/pages/LibraryPage/index'))
const NoteShell = lazy(() => import('@/pages/result/NoteShell/index'))
const TaskCenterPage = lazy(() => import('@/pages/TaskCenterPage/index'))
const BatchCreatePage = lazy(() => import('@/pages/TaskCenterPage/BatchCreatePage'))
const BatchDetailPage = lazy(() => import('@/pages/TaskCenterPage/BatchDetailPage'))

// 懒加载 fallback：骨架屏替代纯文本（Skeleton 仅依赖 cn，不增加主 chunk 负担）
const RouteFallback = () => (
  <div className="flex h-full w-full flex-col gap-3 p-8" role="status" aria-label="页面加载中">
    <Skeleton className="h-7 w-56" />
    <Skeleton className="h-4 w-full max-w-xl" />
    <Skeleton className="h-4 w-4/5 max-w-lg" />
    <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Skeleton className="h-32 rounded-lg" />
      <Skeleton className="h-32 rounded-lg" />
      <Skeleton className="h-32 rounded-lg" />
      <Skeleton className="h-32 rounded-lg" />
    </div>
  </div>
)

const withSuspense = (node: ReactNode) => (
  <Suspense fallback={<RouteFallback />}>{node}</Suspense>
)

/** Keep legacy result deep links usable while maintaining one NoteShell state machine. */
export function legacyDetailRedirect({
  params,
  request,
}: {
  params: Params
  request: Request
}) {
  const url = new URL(request.url)
  return redirect(
    `/workspaces/${params.workspaceId}/items/${params.itemId}/note${url.search}`,
  )
}

// React Router v7 Data Router 定义；URL 与原 BrowserRouter + Routes + Route 完全一致。
export const router = createBrowserRouter([
  {
    path: '/',
    element: <Index />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: withSuspense(<WorkbenchPage />) },
      { path: 'new', element: <Navigate to="/" replace /> },
      {
        path: 'collections',
        element: withSuspense(<WorkspaceList />),
      },
      {
        path: 'workspaces',
        element: <Navigate to="/collections" replace />,
      },
      { path: 'favorites', element: withSuspense(<FavoritesPage />) },
      { path: 'knowledge', element: withSuspense(<SearchPage />) },
      {
        path: 'search',
        loader: ({ request }) => {
          const url = new URL(request.url)
          return redirect(`/knowledge${url.search}`)
        },
      },
      { path: 'library', element: withSuspense(<LibraryPage />) },
      { path: 'notes', element: withSuspense(<LibraryPage />) },
      { path: 'tasks', element: withSuspense(<TaskCenterPage />) },
      { path: 'tasks/new', element: withSuspense(<BatchCreatePage />) },
      { path: 'tasks/batches/:batchId', element: withSuspense(<BatchDetailPage />) },
      { path: 'workspaces/:id', element: withSuspense(<TaskboardPage />) },
      {
        path: 'workspaces/:workspaceId/items/:itemId/overview',
        element: withSuspense(<ResultsOverview />),
      },
      {
        path: 'workspaces/:workspaceId/items/:itemId/video_detail',
        loader: legacyDetailRedirect,
      },
      {
        path: 'workspaces/:workspaceId/items/:itemId/image_detail',
        loader: legacyDetailRedirect,
      },
      {
        path: 'workspaces/:workspaceId/items/:itemId/audio_detail',
        loader: legacyDetailRedirect,
      },
      {
        path: 'workspaces/:workspaceId/items/:itemId/text_detail',
        loader: legacyDetailRedirect,
      },
      {
        path: 'workspaces/:workspaceId/items/:itemId/note',
        element: withSuspense(<NoteShell />),
      },
      // 旧路由兼容（保留一个 release，loader redirect 到新路径）
      {
        path: 'workspaces/:workspaceId/items/:itemId/result',
        loader: legacyDetailRedirect,
      },
      {
        path: 'workspaces/:workspaceId/items/:itemId/image_result',
        loader: legacyDetailRedirect,
      },
      {
        path: 'workspaces/:workspaceId/items/:itemId/audio_result',
        loader: legacyDetailRedirect,
      },
      {
        path: 'workspaces/:workspaceId/items/:itemId/text_result',
        loader: legacyDetailRedirect,
      },
      {
        path: 'processing/batch/:workspaceId',
        loader: () => redirect('/tasks'),
      },
      {
        path: 'processing/:taskId',
        element: withSuspense(<ProcessingPage />),
      },
      {
        path: 'settings',
        element: withSuspense(<SettingPage />),
        children: [
          { index: true, element: <Navigate to="/settings/general" replace /> },
          { path: 'general', element: withSuspense(<GeneralSettingsPage />) },
          // N3 合并页
          { path: 'providers-models', element: withSuspense(<ProvidersAndModelsPage />) },
          { path: 'analysis-defaults', element: withSuspense(<AnalysisDefaultsPage />) },
          // 保留的独立页
          { path: 'network', element: withSuspense(<NetworkSettingsPage />) },
          { path: 'download', element: withSuspense(<DownloadSettingsPage />) },
          { path: 'monitor', element: withSuspense(<DeployMonitorPage />) },
          { path: 'trash', element: withSuspense(<TrashPage />) },
          { path: 'video-templates', element: withSuspense(<VideoTemplatesPage />) },
          { path: 'style-templates', element: withSuspense(<VideoTemplatesPage />) },
          { path: 'export-sync', element: withSuspense(<ExportSyncSettingsPage />) },
          { path: 'about', element: withSuspense(<AboutPage />) },
          // 旧路由重定向（向后兼容）
          { path: 'providers', element: <Navigate to="/settings/providers-models" replace /> },
          { path: 'models', element: <Navigate to="/settings/providers-models" replace /> },
          { path: 'screenshot', element: <Navigate to="/settings/analysis-defaults" replace /> },
          { path: 'transcriber', element: <Navigate to="/settings/analysis-defaults" replace /> },
          { path: '*', element: withSuspense(<NotFoundPage />) },
        ],
      },
      { path: '*', element: withSuspense(<NotFoundPage />) },
    ],
  },
])
