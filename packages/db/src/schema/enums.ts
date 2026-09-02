import { pgEnum } from 'drizzle-orm/pg-core'

export const userRole = pgEnum('user_role', [
  'user',
  'supporter',
  'premium',
  'uploader',
  'moderator',
  'admin',
])
export const seriesType = pgEnum('series_type', ['manga', 'manhwa', 'manhua', 'comic', 'novel'])
export const seriesStatus = pgEnum('series_status', [
  'ongoing',
  'completed',
  'hiatus',
  'cancelled',
  'dropped',
])
export const pubState = pgEnum('pub_state', [
  'draft',
  'scheduled',
  'published',
  'unlisted',
  'removed',
])
export const chapterState = pgEnum('chapter_state', [
  'draft',
  'processing',
  'ready',
  'scheduled',
  'published',
  'failed',
  'removed',
])
export const commentStatus = pgEnum('comment_status', [
  'published',
  'pending',
  'shadow',
  'rejected',
  'removed',
])
export const readingDirection = pgEnum('reading_direction', ['ltr', 'rtl', 'vertical'])

export type UserRole = (typeof userRole.enumValues)[number]
export type SeriesType = (typeof seriesType.enumValues)[number]
export type SeriesStatus = (typeof seriesStatus.enumValues)[number]
export type PubState = (typeof pubState.enumValues)[number]
export type ChapterState = (typeof chapterState.enumValues)[number]
export type CommentStatus = (typeof commentStatus.enumValues)[number]
export type ReadingDirection = (typeof readingDirection.enumValues)[number]
