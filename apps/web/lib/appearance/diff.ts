/**
 * "Each publish is a version with a diff" (docs/15 "Presets, preview, history").
 *
 * A field-by-field comparison of two settings documents, rendered by the shared version
 * history modal. Pure and import-free so the admin client bundle can run it and a unit test
 * can assert on it without a database.
 *
 * ## What it compares, and why arrays are compared whole
 *
 * Documents here are small JSON objects — a few dozen scalars, plus the header and footer
 * link lists. Nested objects are walked, so `color.accent` is one line rather than "color
 * changed". Arrays are **not** walked: `header[2].label` would be a lie the moment a link is
 * inserted above it, because every index below shifts and a one-link insert reads as six
 * changes. A list is one field, summarised by length and by the labels in it, which is how
 * an operator thinks about "the header nav".
 *
 * There is no attempt at a minimal edit script. This is a "what am I about to publish"
 * check, not a merge tool.
 */

export interface DiffEntry {
  /** Dotted path into the document, e.g. `color.accent` or `announcement.text`. */
  path: string
  kind: 'added' | 'removed' | 'changed'
  /** Human-readable renderings; `null` means the field was absent on that side. */
  before: string | null
  after: string | null
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** One line for a value: short enough for a table cell, honest about what it elides. */
export const describeValue = (value: unknown): string => {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value === '' ? '(empty)' : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '(none)'
    const labels = value
      .map((item) =>
        isPlainObject(item)
          ? typeof item.label === 'string'
            ? item.label
            : typeof item.title === 'string'
              ? item.title
              : typeof item.id === 'string'
                ? item.id
                : null
          : typeof item === 'string'
            ? item
            : null,
      )
      .filter((l): l is string => !!l)
    const summary = labels.length === value.length ? labels.join(', ') : `${value.length} items`
    return summary
  }
  return JSON.stringify(value)
}

const equal = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return false
  if (typeof a !== 'object') return false
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Every field that differs between two documents, deepest-first path order.
 *
 * `before`/`after` are `null` only for a key that is absent on that side — an explicit
 * `null` in the document renders as `—`, so "never set" and "cleared" stay distinguishable
 * in the code even where they read the same on screen.
 */
export const diffDocuments = (before: unknown, after: unknown, prefix = ''): DiffEntry[] => {
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    return keys.flatMap((key) => {
      const path = prefix ? `${prefix}.${key}` : key
      const l = before[key]
      const r = after[key]
      if (!(key in before))
        return [{ path, kind: 'added' as const, before: null, after: describeValue(r) }]
      if (!(key in after))
        return [{ path, kind: 'removed' as const, before: describeValue(l), after: null }]
      return diffDocuments(l, r, path)
    })
  }
  if (equal(before, after)) return []
  return [
    {
      path: prefix,
      kind: 'changed',
      before: describeValue(before),
      after: describeValue(after),
    },
  ]
}

/** `true` when the two documents are the same to the byte the database would store. */
export const documentsEqual = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b)
