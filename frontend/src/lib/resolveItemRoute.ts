/**
 * 根据 item 决定跳转路径：
 * - 后端权威给定 primary_view 时优先遵循（图片/视频等结果页）
 * - 兜底统一进入 /note（NoteShell）
 *
 * R4.1 起统一使用，MaterialCard / FavoritesTab / LibraryPage / ResultsOverview 共用。
 * 接受 WorkspaceItem 或 LibraryItem（两者都有 item_id / type / preflight?.intent）。
 */
export function resolveItemRoute(
  workspaceId: string,
  item: { item_id: string; type: string; preflight?: { intent?: string } | null; primary_view?: string },
): string {
  // 1. 若后端权威给定 primary_view，优先遵循
  if (item.primary_view) {
    if (item.primary_view === 'note') {
      return `/workspaces/${workspaceId}/items/${item.item_id}/note`
    } else {
      const DETAIL_ROUTE: Record<string, string> = {
        video: 'video_detail',
        audio: 'note',
        image: 'image_result',
        text: 'text_result',
      }
      const suffix = DETAIL_ROUTE[item.type] ?? 'overview'
      return `/workspaces/${workspaceId}/items/${item.item_id}/${suffix}`
    }
  }

  // 2. 兜底：统一进入笔记页
  return `/workspaces/${workspaceId}/items/${item.item_id}/note`
}
