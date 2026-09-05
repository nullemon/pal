import { DEFAULT_FORMATTING } from '@palscans/core/formatting'
import { messages } from '@palscans/core/messages'
import { describe, expect, it } from 'vitest'
import { copySettingSchema } from '@/components/admin/schemas-copy'

/**
 * What `PUT /api/admin/appearance/copy` will and will not accept.
 *
 * The renderer falls back from a bad override rather than throwing, which is the safety net.
 * This is the other half: the save is *refused* so the operator is told, instead of saving
 * something that will be silently ignored and looking like a broken panel.
 */

const body = (copy: Record<string, string>) => ({ copy, formatting: DEFAULT_FORMATTING })

const firstIssue = (input: unknown) => {
  const parsed = copySettingSchema.safeParse(input)
  return parsed.success
    ? null
    : { path: parsed.error.issues[0]?.path, message: parsed.error.issues[0]?.message }
}

describe('accepts', () => {
  it('an empty document', () => {
    expect(copySettingSchema.safeParse(body({})).success).toBe(true)
  })

  it('a changed string', () => {
    expect(copySettingSchema.safeParse(body({ 'browse.empty': 'Nothing here.' })).success).toBe(
      true,
    )
  })

  it('an empty value, which is how the Reset button asks for the default back', () => {
    expect(copySettingSchema.safeParse(body({ 'browse.empty': '' })).success).toBe(true)
    expect(copySettingSchema.safeParse(body({ 'browse.empty': '   ' })).success).toBe(true)
  })

  it('a placeholder the string declares', () => {
    expect(copySettingSchema.safeParse(body({ 'search.empty': 'Nothing for {q}.' })).success).toBe(
      true,
    )
  })
})

describe('refuses, naming the field', () => {
  it('a key that is not editable', () => {
    const issue = firstIssue(body({ 'nav.signOut': 'Log out' }))
    expect(issue?.path).toEqual(['copy', 'nav.signOut'])
    expect(issue?.message).toContain('Unknown copy key')
  })

  it('a wall of text in a one-line field', () => {
    const issue = firstIssue(body({ 'browse.empty': 'x'.repeat(10_240) }))
    expect(issue?.path).toEqual(['copy', 'browse.empty'])
    expect(issue?.message).toContain('the limit is 200')
  })

  it('a placeholder the call site will never substitute', () => {
    const issue = firstIssue(body({ 'browse.empty': 'Nothing here, {name}.' }))
    expect(issue?.message).toContain('{name}')
  })

  it('a formatting value that is not one of the options', () => {
    expect(
      copySettingSchema.safeParse({
        copy: {},
        formatting: { ...DEFAULT_FORMATTING, clock: '36h' },
      }).success,
    ).toBe(false)
  })

  it('a body so large it is not worth parsing', () => {
    // 20 KB per field is the outer bound before the per-entry rule even runs; the route also
    // refuses a body over 64 KB before it is buffered (`readBody` in lib/auth/http.ts).
    expect(copySettingSchema.safeParse(body({ 'browse.empty': 'x'.repeat(30_000) })).success).toBe(
      false,
    )
  })
})

describe('the shipped wording', () => {
  it('is always accepted, so an operator can retype it by hand', () => {
    expect(
      copySettingSchema.safeParse(body({ 'search.empty': messages.search.empty })).success,
    ).toBe(true)
  })
})
