/**
 * What a reader may say is wrong with a chapter. Shared by the sheet in the reader, the
 * route that files the report, and `/admin/reports`, which turns the stored code back into
 * the sentence the reader picked — so the three can never drift apart.
 *
 * Codes, not sentences, are what reaches the database: the queue can be filtered and
 * counted by reason, and rewording the label later does not orphan the old rows.
 */
export const CHAPTER_REPORT_REASONS = [
  'missing_page',
  'wrong_order',
  'wrong_chapter',
  'poor_quality',
  'other',
] as const

export type ChapterReportReason = (typeof CHAPTER_REPORT_REASONS)[number]

/** Free-text note. Long enough to describe a broken chapter, short enough not to be an essay. */
export const MAX_NOTE = 500
