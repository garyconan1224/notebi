/* eslint-disable react-refresh/only-export-components */
import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate, redirect } from 'react-router-dom'
import Index from '@/pages/Index'
import { isFeatureEnabled, productConfig, type WorkspaceKind } from '@/config/product'

// 按路由做代码分割：每个页面组件通过动态 import 拆成独立 chunk
const SettingPage = lazy(() => import('@/pages/SettingPage/index'))
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
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))
const WorkspaceList = lazy(() => import('@/pages/WorkspacePage/WorkspaceList'))
const TaskboardPage = lazy(() => import('@/pages/WorkspacePage/TaskboardPage'))
const VideoResultPage = lazy(() => import('@/pages/result/VideoResultPage'))
const ImageResultPage = lazy(() => import('@/pages/result/ImageResultPage'))
const TextResultPage = lazy(() => import('@/pages/result/TextResultPage'))
const ResultsOverview = lazy(() => import('@/pages/result/ResultsOverview/index'))
const FavoritesPage = lazy(() => import('@/pages/FavoritesPage/FavoritesPage'))
const SearchPage = lazy(() => import('@/pages/SearchPage/SearchPage'))
const WorkbenchPage = lazy(() => import('@/pages/WorkbenchPage/index'))
const KnowledgePage = lazy(() => import('@/pages/KnowledgePage/index'))
const ProcessingPage = lazy(() => import('@/pages/result/ProcessingPage/index'))
const BatchProcessingPage = lazy(() => import('@/pages/result/BatchProcessingPage/index'))
const StoryboardPage = lazy(() => import('@/pages/StoryboardPage/index'))
const LibraryPage = lazy(() => import('@/pages/LibraryPage/index'))
const NoteShell = lazy(() => import('@/pages/result/NoteShell/index'))

// 懒加载 fallback：保持极简，避免把额外依赖拉进主 chunk
const RouteFallback = () => (
  <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
    Loading…
  </div>
)

const withSuspense = (node: ReactNode) => (
  <Suspense fallback={<RouteFallback />}>{node}</Suspense>
)

const fallbackLibraryPath = productConfig.defaultKind === 'replica' ? '/replicas' : '/notes'

function guardRoute(enabled: boolean, node: ReactNode, fallback = '/'): ReactNode {
  return enabled ? node : <Navigate to={fallback} replace />
}

function guardKindRoute(kind: WorkspaceKind, node: ReactNode): ReactNode {
  return guardRoute(productConfig.allowedKinds.includes(kind), node, fallbackLibraryPath)
}

// React Router v7 Data Router 定义；URL 与原 BrowserRouter + Routes + Route 完全一致。
export const router = createBrowserRouter([
  {
    path: '/',
    element: <Index />,
    children: [
      { index: true, element: withSuspense(<WorkbenchPage />) },
      { path: 'new', element: <Navigate to="/" replace /> },
      {
        path: 'workspaces',
        element: guardRoute(productConfig.mode === 'nibi', withSuspense(<WorkspaceList />), fallbackLibraryPath),
      },
      { path: 'favorites', element: withSuspense(<FavoritesPage />) },
      { path: 'search', element: withSuspense(<SearchPage />) },
      { path: 'library', element: withSuspense(<LibraryPage />) },
      { path: 'notes', element: guardKindRoute('note', withSuspense(<LibraryPage kind="note" />)) },
      { path: 'replicas', element: guardKindRoute('replica', withSuspense(<LibraryPage kind="replica" />)) },
      { path: 'knowledge', element: guardRoute(isFeatureEnabled('showKnowledge'), withSuspense(<KnowledgePage />)) },
      { path: 'workspaces/:id', element: withSuspense(<TaskboardPage />) },
      {
        path: 'workspaces/:workspaceId/items/:itemId/overview',
        element: withSuspense(<ResultsOverview />),
      },
      {
        path: 'workspaces/:workspaceId/items/:itemId/video_detail',
        element: withSuspense(<VideoResultPage />),
      },
      {
        path: 'workspaces/:workspaceId/items/:itemId/image_detail',
        element: withSuspense(<ImageResultPage />),
      },
      {
        path: 'workspaces/:workspaceId/items/:itemId/audio_detail',
        // 兼容旧链接；音频实际页面统一收敛到 /note。
        loader: ({ params }) => redirect(`/workspaces/${params.workspaceId}/items/${params.itemId}/note`),
      },
      {
        path: 'workspaces/:workspaceId/items/:itemId/text_detail',
        element: withSuspense(<TextResultPage />),
      },
      {
        path: 'workspaces/:workspaceId/items/:itemId/note',
        element: guardKindRoute('note', withSuspense(<NoteShell />)),
      },
      // 旧路由兼容（保留一个 release，loader redirect 到新路径）
      {
        path: 'workspaces/:workspaceId/items/:itemId/result',
        loader: ({ params }) => redirect(`/workspaces/${params.workspaceId}/items/${params.itemId}/video_detail`),
      },
      {
        path: 'workspaces/:workspaceId/items/:itemId/image_result',
        loader: ({ params }) => redirect(`/workspaces/${params.workspaceId}/items/${params.itemId}/image_detail`),
      },
      {
        path: 'workspaces/:workspaceId/items/:itemId/audio_result',
        loader: ({ params }) => redirect(`/workspaces/${params.workspaceId}/items/${params.itemId}/note`),
      },
      {
        path: 'workspaces/:workspaceId/items/:itemId/text_result',
        loader: ({ params }) => redirect(`/workspaces/${params.workspaceId}/items/${params.itemId}/text_detail`),
      },
      {
        path: 'processing/batch/:workspaceId',
        element: withSuspense(<BatchProcessingPage />),
      },
      {
        path: 'processing/:taskId',
        element: withSuspense(<ProcessingPage />),
      },
      { path: 'storyboard', element: guardRoute(isFeatureEnabled('showStoryboard'), withSuspense(<StoryboardPage />)) },
      {
        path: 'settings',
        element: withSuspense(<SettingPage />),
        children: [
          { index: true, element: <Navigate to="/settings/providers-models" replace /> },
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
          { path: 'about', element: withSuspense(<AboutPage />) },
          // 旧路由重定向（向后兼容）
          { path: 'providers', element: <Navigate to="/settings/providers-models" replace /> },
          { path: 'models', element: <Navigate to="/settings/providers-models" replace /> },
          { path: 'screenshot', element: <Navigate to="/settings/analysis-defaults" replace /> },
          { path: 'transcriber', element: <Navigate to="/settings/analysis-defaults" replace /> },
          { path: 'prompt-formats', element: <Navigate to="/settings/analysis-defaults" replace /> },
          { path: '*', element: withSuspense(<NotFoundPage />) },
        ],
      },
      { path: '*', element: withSuspense(<NotFoundPage />) },
    ],
  },
])
