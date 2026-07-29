import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listTaskBatches } from '@/services/taskBatches'
import type { TaskBatch } from '@/types/taskBatch'

export function BatchesTab({ workspaceId }: { workspaceId: string }) {
  const [batches, setBatches] = useState<TaskBatch[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    listTaskBatches({ workspace_id: workspaceId })
      .then((result) => setBatches(result.batches))
      .catch((reason) => setError(reason instanceof Error ? reason.message : '加载失败'))
  }, [workspaceId])

  if (error) return <div role="alert">{error}</div>
  if (batches.length === 0) return <div className="rounded-lg border p-8 text-center">这个合集还没有批次</div>
  return (
    <section className="space-y-2" aria-label="批次">
      {batches.map((batch) => (
        <Link key={batch.batch_id} to={`/tasks/batches/${batch.batch_id}`} className="flex items-center justify-between rounded-lg border p-4">
          <span>{batch.name}</span>
          <span>{batch.completed_count}/{batch.total_count} · {batch.status}</span>
        </Link>
      ))}
    </section>
  )
}
