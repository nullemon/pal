import { loadQueue } from '@/components/admin/server/queue'
import { withPermission } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/jobs/stream — Server-Sent Events with the upload queue (docs/04 "live
 * page-level progress from the worker over SSE"). The worker writes progress into
 * `chapters.processing`; this handler polls it every second and pushes a snapshot when it
 * changes, so it works with or without Redis.
 */
export const GET = withPermission('chapter.read', async (request) => {
  const encoder = new TextEncoder()
  let timer: ReturnType<typeof setInterval> | undefined
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let last = ''
      const tick = async () => {
        try {
          const items = await loadQueue()
          const json = JSON.stringify(items)
          if (json !== last) {
            last = json
            controller.enqueue(encoder.encode(`event: queue\ndata: ${json}\n\n`))
          } else {
            controller.enqueue(encoder.encode(': keepalive\n\n'))
          }
        } catch (err) {
          controller.enqueue(
            encoder.encode(`event: error\ndata: ${JSON.stringify(String(err))}\n\n`),
          )
        }
      }
      await tick()
      timer = setInterval(() => void tick(), 1000)
      request.signal.addEventListener('abort', () => {
        if (timer) clearInterval(timer)
        try {
          controller.close()
        } catch {
          // already closed
        }
      })
    },
    cancel() {
      if (timer) clearInterval(timer)
    },
  })
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
})
