import { describe, expect, it } from 'vitest'
import { safeJobId } from '../queue/bullmq.js'
import { createQueue, MemoryQueue } from '../queue/index.js'

describe('MemoryQueue', () => {
  it('runs jobs by name with concurrency and retries', async () => {
    const q = new MemoryQueue('test')
    const seen: number[] = []
    let attempts = 0
    q.process(
      'chapter.process',
      async (job) => {
        seen.push(job.data.chapterId)
      },
      2,
    )
    q.process('sitemap.build', async () => {
      attempts++
      if (attempts < 3) throw new Error('flaky')
    })
    const ids = await Promise.all([
      q.add('chapter.process', { chapterId: 1 }),
      q.add('chapter.process', { chapterId: 2 }),
      q.add('chapter.process', { chapterId: 2 }, { jobId: 'dup' }),
      q.add('chapter.process', { chapterId: 3 }, { jobId: 'dup' }),
      q.add('sitemap.build', { kind: 'full' }, { attempts: 3 }),
      q.add('chapter.publish', { chapterId: 9 }, { delayMs: 20 }),
    ])
    expect(ids[2]).toBe('dup')
    expect(ids[3]).toBe('dup')
    q.process('chapter.publish', async (job) => {
      seen.push(job.data.chapterId * 100)
    })
    await new Promise((r) => setTimeout(r, 400))
    await q.drain()
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 2, 900])
    expect(attempts).toBe(3)
    const stats = await q.stats()
    expect(stats.completed).toBe(5)
    expect(stats.failed).toBe(0)
    expect(stats.waiting + stats.delayed + stats.active).toBe(0)
    await q.close()
  })
  it('records exhausted failures', async () => {
    const q = new MemoryQueue()
    q.process('email.send', async () => {
      throw new Error('smtp down')
    })
    await q.add('email.send', { to: 'a@b', template: 't', vars: {} })
    await new Promise((r) => setTimeout(r, 50))
    await q.drain()
    expect((await q.stats()).failed).toBe(1)
    expect(q.failures[0]?.job.name).toBe('email.send')
    await q.close()
  })
  it('createQueue falls back to memory without REDIS_URL', async () => {
    const q = await createQueue({ redisUrl: '', kind: undefined })
    expect(q.kind).toBe('memory')
    await q.close()
  })
})

describe('safeJobId', () => {
  it('swaps the separator BullMQ reserves for its own keys', () => {
    // BullMQ throws "Custom Id cannot contain :" — which every caller here would hit, since
    // they all name their ids after the job.
    expect(safeJobId('chapter.process:12:3')).toBe('chapter.process-12-3')
    expect(safeJobId('import.run:7')).toBe('import.run-7')
  })

  it('leaves an unset id unset, so BullMQ still assigns one', () => {
    expect(safeJobId(undefined)).toBeUndefined()
  })

  it('keeps distinct ids distinct', () => {
    expect(safeJobId('series.art:4:cover')).not.toBe(safeJobId('series.art:4:banner'))
  })
})
