import { describe, expect, it, vi } from 'vitest'

import {
  KnowledgeStreamError,
  parseKnowledgeNdjson,
  sendKnowledgeMessage,
} from '@/services/knowledgeStream'

function responseFromChunks(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)))
      controller.close()
    },
  }), {
    status,
    headers: { 'Content-Type': 'application/x-ndjson' },
  })
}

describe('knowledge stream', () => {
  it('parses cross-chunk NDJSON, multiple deltas and done', async () => {
    const events = []
    const response = responseFromChunks([
      '{"type":"status","stage":"retr',
      'ieving","message_id":"m1"}\n{"type":"sources","sources":[{"source_id":"s1"}]}\n',
      '{"type":"delta","text":"答"}\n{"type":"delta","text":"案"}\n',
      '{"type":"done","message":{"message_id":"m1","content":"答案"}}\n',
    ])

    for await (const event of parseKnowledgeNdjson(response)) {
      events.push(event)
    }

    expect(events.map(event => event.type)).toEqual([
      'status',
      'sources',
      'delta',
      'delta',
      'done',
    ])
  })

  it('retains received sources when a backend error event arrives', async () => {
    const onSources = vi.fn()
    const fetcher = vi.fn().mockResolvedValue(responseFromChunks([
      '{"type":"sources","sources":[{"source_id":"s1"}]}\n',
      '{"type":"error","error":"模型不可用","recoverable":true}\n',
    ]))

    await expect(sendKnowledgeMessage({
      conversationId: 'c1',
      question: '问题',
      workspaceIds: ['w1'],
      onSources,
      fetcher,
    })).rejects.toMatchObject({
      message: '模型不可用',
      sources: [{ source_id: 's1' }],
      recoverable: true,
    })
    expect(onSources).toHaveBeenCalledTimes(1)
  })

  it('turns malformed lines and non-2xx responses into recoverable errors', async () => {
    const malformed = responseFromChunks(['not-json\n'])
    const events = parseKnowledgeNdjson(malformed)
    await expect(events.next()).rejects.toBeInstanceOf(KnowledgeStreamError)

    await expect(sendKnowledgeMessage({
      conversationId: 'c1',
      question: '问题',
      fetcher: vi.fn().mockResolvedValue(
        new Response('bad request', { status: 422 }),
      ),
    })).rejects.toMatchObject({ recoverable: true })
  })

  it('passes AbortSignal to fetch and reports abort without logging secrets', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetcher = vi.fn().mockRejectedValue(
      new DOMException('aborted', 'AbortError'),
    )

    await expect(sendKnowledgeMessage({
      conversationId: 'c1',
      question: '问题',
      signal: controller.signal,
      fetcher,
    })).rejects.toMatchObject({ aborted: true })
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('/knowledge/conversations/c1/messages/stream'),
      expect.objectContaining({ signal: controller.signal }),
    )
  })
})
