/**
 * The per-series follow modes, with no zod in sight.
 *
 * Split out of `./schema` because the follow button renders on every series page and at the
 * end of every chapter, and importing a module that touches zod there puts 84 KB gzipped on
 * the reader's critical path (docs/20). `./schema` re-exports everything below, so server
 * code can keep importing from one place; only the browser needs the distinction.
 */

/**
 * How loud one followed series is allowed to be (docs/17 §D). The reader-facing half of
 * `series_follows.mode` — the same list the migration's check constraint and
 * `@palscans/db`'s `SERIES_FOLLOW_MODES` carry, kept here so the account screen and the
 * series page can render the picker without importing a database driver.
 *
 *   all    -> in-app, push, Discord, email digest
 *   push   -> in-app, push
 *   in_app -> in-app
 *   digest -> email digest only
 *   off    -> nothing
 *
 * There is no per-chapter *email*: for a new chapter, email is the digest, which is why
 * `digest` is the email row rather than a sixth mode that would send nothing.
 */
export const FOLLOW_MODES = ['all', 'push', 'in_app', 'digest', 'off'] as const
export type FollowMode = (typeof FOLLOW_MODES)[number]

export const DEFAULT_FOLLOW_MODE: FollowMode = 'all'

export const isFollowMode = (v: unknown): v is FollowMode =>
  typeof v === 'string' && (FOLLOW_MODES as readonly string[]).includes(v)

/** The table above, as data. `email` is the digest — see the note on `FOLLOW_MODES`. */
const FOLLOW_MODE_CHANNELS: Record<FollowMode, readonly string[]> = {
  all: ['in_app', 'push', 'email', 'discord'],
  push: ['in_app', 'push'],
  in_app: ['in_app'],
  digest: ['email'],
  off: [],
}

/**
 * Does this series' setting let `channel` through? Pure, and deliberately *only* half the
 * decision: every sender ANDs it with `prefAllows`, so a channel the reader turned off
 * globally stays off however loud one series is set.
 */
export const followAllows = (mode: FollowMode, channel: string): boolean =>
  FOLLOW_MODE_CHANNELS[mode].includes(channel)

/** A followed series is in the digest on `all` and `digest`, and nowhere else. */
export const followInDigest = (mode: FollowMode): boolean => followAllows(mode, 'email')
