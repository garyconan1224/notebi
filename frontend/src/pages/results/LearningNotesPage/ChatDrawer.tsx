import NoteChatDrawer from '@/components/NoteChatDrawer'

interface ChatDrawerProps {
  workspaceId: string
  /** 前端构建的 system prompt（ln.md + transcript 上下文） */
  systemPrompt: string
}

/**
 * B-8: 学习笔记页内 AI 问答抽屉。
 * 薄包装 NoteChatDrawer（drawer 模式），保留原 ln 导出路径。
 */
export default function ChatDrawer({ workspaceId, systemPrompt }: ChatDrawerProps) {
  return (
    <NoteChatDrawer
      workspaceId={workspaceId}
      systemPrompt={systemPrompt}
      scopeHint="仅基于本视频笔记与字幕回答"
      mode="drawer"
    />
  )
}
