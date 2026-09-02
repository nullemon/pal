import type { JobMap } from '@palscans/core/queue'

/**
 * Best-effort notification jobs (docs/14 "Notifications"). The worker (P5) consumes
 * `notify.comment`; a queue outage must never fail a comment post, so errors are swallowed.
 */
export const enqueueCommentNotification = async (data: JobMap['notify.comment']): Promise<void> => {
  try {
    const { getQueue } = await import('@palscans/core/queue')
    const queue = await getQueue()
    await queue.add('notify.comment', data, {
      jobId: `notify.comment:${data.commentId}:${data.kind}`,
    })
  } catch {
    // ignore: notifications are a nicety, the comment is already stored
  }
}
