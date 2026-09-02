import type { Role } from '@palscans/core'
import type { CommentBody } from '@palscans/core/comments'

export const REACTION_KINDS = ['up', 'funny', 'love', 'surprised', 'angry', 'sad'] as const
export type ReactionKind = (typeof REACTION_KINDS)[number]

export const COMMENT_SORTS = ['best', 'newest', 'oldest'] as const
export type CommentSort = (typeof COMMENT_SORTS)[number]

export const REPORT_REASONS = [
  'spam',
  'harassment',
  'spoiler',
  'off_topic',
  'illegal',
  'other',
] as const
export type ReportReason = (typeof REPORT_REASONS)[number]

export interface CommentTarget {
  kind: 'series' | 'chapter'
  id: number
}

/** `series:12` / `chapter:59310` → target, or null. */
export const parseTarget = (value: string | null | undefined): CommentTarget | null => {
  if (!value) return null
  const m = /^(series|chapter):(\d{1,12})$/.exec(value)
  if (!m?.[1] || !m[2]) return null
  return { kind: m[1] as CommentTarget['kind'], id: Number.parseInt(m[2], 10) }
}

export const targetKey = (t: CommentTarget): string => `${t.kind}:${t.id}`

export interface CommentAuthor {
  id: number
  username: string
  displayName: string
  avatarUrl: string | null
  role: Role
  isPremium: boolean
}

export interface CommentImage {
  id: number
  src: string
  width: number
  height: number
}

export type CommentVisibleStatus = 'published' | 'pending' | 'shadow'

/** What the client renders. Everything is JSON-serialisable (dates as ISO strings). */
export interface CommentView {
  id: number
  parentId: number | null
  author: CommentAuthor
  body: CommentBody
  isSpoiler: boolean
  isPinned: boolean
  status: CommentVisibleStatus
  score: number
  reactionCounts: Partial<Record<ReactionKind, number>>
  viewerReactions: ReactionKind[]
  replyCount: number
  /** Chronological preview (first two) or the full list once expanded. */
  replies: CommentView[]
  createdAt: string
  editedAt: string | null
  deleted: boolean
  locked: boolean
  image: CommentImage | null
}

export interface CommentPage {
  comments: CommentView[]
  total: number
  nextCursor: string | null
  sort: CommentSort
}

export interface CommentViewer {
  id: number
  username: string
  displayName: string
  avatarUrl: string | null
  role: Role
  isPremium: boolean
  verified: boolean
  canModerate: boolean
  blockedIds: number[]
}

/** Comment-thread configuration the client needs (from comment settings). */
export interface CommentThreadConfig {
  editWindowMinutes: number
  collapseThreshold: number
  maxMentions: number
  maxChars: number
  imagesEnabled: boolean
  customGifs: 'off' | 'premium' | 'all'
  pageSize: number
}
