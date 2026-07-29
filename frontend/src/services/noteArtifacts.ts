import http from './client'

export type NoteArtifactKind =
  | 'mind_map'
  | 'action_items'
  | 'key_cards'
  | 'flashcards'
  | 'glossary'
  | 'timeline'
  | 'selection_rewrite'

export interface NoteArtifact {
  artifact_id: string
  kind: NoteArtifactKind
  title: string
  content_md: string
  source_scope: 'full_note' | 'selection'
  original_text: string
  model_used: string
  created_at: string
}

export interface NoteArtifactTaskAccepted {
  status: 'accepted'
  task_id: string
  workspace_id: string
  item_id: string
}

export async function listNoteArtifacts(
  workspaceId: string,
  itemId: string,
): Promise<NoteArtifact[]> {
  const { data } = await http.get<NoteArtifact[]>(
    `/workspaces/${workspaceId}/items/${itemId}/artifacts`,
  )
  return data
}

export async function createNoteArtifact(
  workspaceId: string,
  itemId: string,
  request: {
    kind: NoteArtifactKind
    selected_text?: string
    instructions?: string
    provider_id?: string
    model?: string
  },
): Promise<NoteArtifactTaskAccepted> {
  const { data } = await http.post<NoteArtifactTaskAccepted>(
    `/workspaces/${workspaceId}/items/${itemId}/artifacts`,
    request,
  )
  return data
}

export async function deleteNoteArtifact(
  workspaceId: string,
  itemId: string,
  artifactId: string,
): Promise<void> {
  await http.delete(
    `/workspaces/${workspaceId}/items/${itemId}/artifacts/${artifactId}`,
  )
}
