import { COPY_KEYS, copyEntry, copyProblem, normalizeCopyText } from '@palscans/core/copy'
import {
  CHAPTER_LABEL_STYLES,
  CLOCK_FORMATS,
  NUMBER_FORMATS,
  RELATIVE_TIME_MODES,
  WEEK_STARTS,
} from '@palscans/core/formatting'
import { z } from 'zod'

/**
 * The body of `PUT /api/admin/appearance/copy` (docs/15 "Copy the operator owns" and
 * "Formatting").
 *
 * Its own file rather than `schemas-appearance.ts`: that module is reached (type-only) from
 * `lib/layouts/home.ts`, which every public route loads, and a value import of the copy
 * registry from there would be one careless edit away from the reader's bundle.
 *
 * The per-string rules are `copyProblem` from `@palscans/core/copy` — the same function the
 * renderer falls back with. A save is *refused* with a message naming the field, so the
 * operator finds out here rather than discovering later that a page quietly ignored them.
 */

const copyValues = z.record(z.string(), z.string().max(20_000)).superRefine((value, ctx) => {
  for (const [id, text] of Object.entries(value)) {
    if (!COPY_KEYS.includes(id)) {
      ctx.addIssue({ code: 'custom', path: [id], message: `Unknown copy key: ${id}` })
      continue
    }
    const entry = copyEntry(id)
    // Empty means "use the shipped default" — the screen's Reset button sends exactly this.
    if (!entry || normalizeCopyText(entry, text) === '') continue
    const problem = copyProblem(id, text)
    if (!problem) continue
    const message =
      problem.problem === 'too_long'
        ? `Too long: ${problem.length} characters, the limit is ${problem.max}.`
        : problem.problem === 'unknown_placeholder'
          ? `{${problem.token}} is not a value this string can use.`
          : 'That value cannot be used here.'
    ctx.addIssue({ code: 'custom', path: [id], message })
  }
})

export const formattingSettingSchema = z.object({
  relativeTimes: z.enum(RELATIVE_TIME_MODES),
  clock: z.enum(CLOCK_FORMATS),
  numbers: z.enum(NUMBER_FORMATS),
  chapterLabel: z.enum(CHAPTER_LABEL_STYLES),
  weekStartsOn: z.enum(WEEK_STARTS),
})

export const copySettingSchema = z.object({
  copy: copyValues,
  formatting: formattingSettingSchema,
})

export type CopySettingBody = z.infer<typeof copySettingSchema>
