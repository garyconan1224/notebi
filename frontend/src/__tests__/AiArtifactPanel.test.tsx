import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AiArtifactPanel } from '@/pages/result/NoteShell/AiArtifactPanel'
import { useLnEditorStore } from '@/store/lnEditorStore'
import { useTaskStore } from '@/store/taskStore'
import { lastMindElixir, resetMindElixirMock } from './helpers/mindElixirMock'

vi.mock('mind-elixir', async () => (await import('./helpers/mindElixirMock')).mindElixirModuleMock)
vi.mock('mind-elixir/i18n', async () => (await import('./helpers/mindElixirMock')).mindElixirI18nMock)
vi.mock('@zumer/snapdom', async () => (await import('./helpers/mindElixirMock')).snapdomModuleMock)

vi.mock('@/services/lnScreenshots', () => ({
  uploadLnScreenshot: vi.fn().mockResolvedValue({
    url: '/static/workspaces/ws-1/ln-screenshots/shot-1.png',
    filename: 'shot-1.png',
  }),
}))

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@/services/noteArtifacts', () => ({
  listNoteArtifacts: mocks.list,
  createNoteArtifact: mocks.create,
  deleteNoteArtifact: mocks.remove,
}))

const ARTIFACT = {
  artifact_id: 'artifact-1',
  kind: 'mind_map' as const,
  title: '思维导图',
  content_md: '- 核心\n  - 分支',
  source_scope: 'full_note' as const,
  original_text: '',
  model_used: 'provider/model',
  created_at: '2026-07-29T00:00:00Z',
}

describe('AiArtifactPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMindElixirMock()
    mocks.list.mockResolvedValue([ARTIFACT])
    mocks.create.mockResolvedValue({
      status: 'accepted',
      task_id: 'artifact-task-1',
      workspace_id: 'ws-1',
      item_id: 'item-1',
    })
    mocks.remove.mockResolvedValue(undefined)
    useTaskStore.setState({ tasks: [], hiddenTaskIds: [], currentTaskId: null })
    useLnEditorStore.getState().setGetSelectionFn(() => '需要改写的原句')
    useLnEditorStore.getState().setReplaceSelectionFn(vi.fn(() => true))
  })

  it('重新打开时列出已保存的独立产物，并可插入笔记', async () => {
    const insert = vi.fn(() => true)
    useLnEditorStore.getState().setInsertFn(insert)

    render(
      <AiArtifactPanel
        open
        initialKind="mind_map"
        workspaceId="ws-1"
        itemId="item-1"
        onClose={vi.fn()}
      />,
    )

    expect(await screen.findByText('思维导图')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '插入笔记' }))
    expect(insert).toHaveBeenCalledWith('\n\n- 核心\n  - 分支\n\n')
  })

  it('思维导图产物支持插入为图片与插入为大纲', async () => {
    const insert = vi.fn(() => true)
    useLnEditorStore.getState().setInsertFn(insert)
    mocks.list.mockResolvedValue([
      { ...ARTIFACT, content_json: { root: { id: 'n0', text: '核心', children: [] } } },
    ])

    render(
      <AiArtifactPanel
        open
        initialKind="mind_map"
        workspaceId="ws-1"
        itemId="item-1"
        onClose={vi.fn()}
      />,
    )

    // 等结构化内容视图挂载（出现「插入为大纲」按钮时 MindMapView 已渲染）
    await screen.findByRole('button', { name: '插入为大纲' })
    // 大纲插入采用实时导图数据（用户可能已编辑节点）
    lastMindElixir().getData.mockReturnValue({
      nodeData: { id: 'n0', topic: '核心', children: [{ id: 'n1', topic: '分支', children: [] }] },
    })
    fireEvent.click(screen.getByRole('button', { name: '插入为大纲' }))
    expect(insert).toHaveBeenCalledWith('\n\n## 核心\n\n- 分支\n\n')

    // 图片插入：snapdom 截图 → 上传 → markdown 图片语法
    fireEvent.click(screen.getByRole('button', { name: '插入为图片' }))
    await waitFor(() =>
      expect(insert).toHaveBeenCalledWith('\n\n![思维导图](/static/workspaces/ws-1/ln-screenshots/shot-1.png)\n\n'),
    )
  })

  it('选区改写先显示原文和改写结果，接受后才替换', async () => {
    const replacement = vi.fn(() => true)
    useLnEditorStore.getState().setReplaceSelectionFn(replacement)
    const rewritten = {
      ...ARTIFACT,
      artifact_id: 'rewrite-1',
      kind: 'selection_rewrite' as const,
      title: '选区改写',
      source_scope: 'selection' as const,
      original_text: '需要改写的原句',
      content_md: '更清晰的新句子',
    }
    mocks.list.mockResolvedValue([])

    render(
      <AiArtifactPanel
        open
        initialKind="selection_rewrite"
        workspaceId="ws-1"
        itemId="item-1"
        onClose={vi.fn()}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: '生成选区改写' }))
    expect(mocks.create).toHaveBeenCalledWith(
      'ws-1',
      'item-1',
      expect.objectContaining({
        kind: 'selection_rewrite',
        selected_text: '需要改写的原句',
      }),
    )
    await waitFor(() => expect(useTaskStore.getState().getTask('artifact-task-1')).toBeTruthy())

    act(() => {
      useTaskStore.getState().updateTask('artifact-task-1', {
        status: 'SUCCESS',
        progress: 1,
        result: { artifact: rewritten },
        updated_at: new Date().toISOString(),
      })
    })

    expect(await screen.findByText('需要改写的原句')).toBeInTheDocument()
    expect(screen.getByText('更清晰的新句子')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '接受改写' }))
    expect(replacement).toHaveBeenCalledWith('更清晰的新句子')
  })

  it('拒绝改写不会修改正文', async () => {
    const replacement = vi.fn(() => true)
    useLnEditorStore.getState().setReplaceSelectionFn(replacement)
    mocks.list.mockResolvedValue([{
      ...ARTIFACT,
      kind: 'selection_rewrite',
      title: '选区改写',
      source_scope: 'selection',
      original_text: '旧句子',
      content_md: '新句子',
    }])

    render(
      <AiArtifactPanel
        open
        initialKind="selection_rewrite"
        workspaceId="ws-1"
        itemId="item-1"
        onClose={vi.fn()}
      />,
    )

    await screen.findByText('旧句子')
    fireEvent.click(screen.getByRole('button', { name: '拒绝改写' }))
    await waitFor(() => expect(screen.queryByText('旧句子')).not.toBeInTheDocument())
    expect(replacement).not.toHaveBeenCalled()
  })
})
