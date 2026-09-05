/**
 * Intrinsic size of every cover the seed and the worker produce (2:3, docs/05).
 *
 * These live here rather than in `./media` because a client component needs them to reserve
 * the right box for a cover, and `./media` reaches the storage config and the environment —
 * importing it from the browser drags ioredis and BullMQ into the client bundle.
 */
export const COVER_WIDTH = 400
export const COVER_HEIGHT = 600
