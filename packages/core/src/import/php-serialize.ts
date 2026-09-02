/**
 * The minimum PHP `serialize()` reader the importer needs: WordPress stores option-shaped
 * meta (`_bookmark_data`, `wp_capabilities`) as serialized PHP arrays. Scalars and arrays
 * only — objects are returned as their property map, and anything malformed returns null
 * rather than throwing, because one bad row must not stop a batch.
 */
export type PhpValue = string | number | boolean | null | PhpValue[] | { [key: string]: PhpValue }

interface Cursor {
  s: string
  i: number
}

const readUntil = (c: Cursor, ch: string): string | null => {
  const at = c.s.indexOf(ch, c.i)
  if (at < 0) return null
  const out = c.s.slice(c.i, at)
  c.i = at + 1
  return out
}

const parseValue = (c: Cursor): { value: PhpValue } | null => {
  const kind = c.s[c.i]
  if (kind === undefined) return null
  switch (kind) {
    case 'N': {
      if (c.s.slice(c.i, c.i + 2) !== 'N;') return null
      c.i += 2
      return { value: null }
    }
    case 'b': {
      c.i += 2
      const raw = readUntil(c, ';')
      return raw === null ? null : { value: raw === '1' }
    }
    case 'i': {
      c.i += 2
      const raw = readUntil(c, ';')
      if (raw === null) return null
      const n = Number.parseInt(raw, 10)
      return Number.isNaN(n) ? null : { value: n }
    }
    case 'd': {
      c.i += 2
      const raw = readUntil(c, ';')
      if (raw === null) return null
      const n = Number.parseFloat(raw)
      return Number.isNaN(n) ? null : { value: n }
    }
    case 's': {
      c.i += 2
      const lenRaw = readUntil(c, ':')
      if (lenRaw === null) return null
      const len = Number.parseInt(lenRaw, 10)
      if (Number.isNaN(len) || c.s[c.i] !== '"') return null
      const value = c.s.slice(c.i + 1, c.i + 1 + len)
      c.i += len + 2
      if (c.s[c.i] !== ';') return null
      c.i += 1
      return { value }
    }
    case 'a':
    case 'O': {
      if (kind === 'O') {
        c.i += 2
        const nameLen = readUntil(c, ':')
        if (nameLen === null) return null
        c.i += Number.parseInt(nameLen, 10) + 3
      } else {
        c.i += 2
      }
      const countRaw = readUntil(c, ':')
      if (countRaw === null || c.s[c.i] !== '{') return null
      c.i += 1
      const count = Number.parseInt(countRaw, 10)
      if (Number.isNaN(count) || count < 0) return null
      const out: Record<string, PhpValue> = {}
      const keys: PhpValue[] = []
      for (let n = 0; n < count; n += 1) {
        const key = parseValue(c)
        if (!key) return null
        const val = parseValue(c)
        if (!val) return null
        keys.push(key.value)
        out[String(key.value)] = val.value
      }
      if (c.s[c.i] !== '}') return null
      c.i += 1
      const isList = keys.every((k, n) => k === n)
      return { value: isList ? keys.map((k) => out[String(k)] as PhpValue) : out }
    }
    default:
      return null
  }
}

/** Parse a serialized PHP value; null when the input is not serialized or is malformed. */
export const phpUnserialize = (input: string): PhpValue => {
  const parsed = parseValue({ s: input, i: 0 })
  return parsed ? parsed.value : null
}

/**
 * Read a WordPress meta value that may be a plain scalar, JSON, or PHP-serialized.
 * Returns a plain object/array/scalar, never throws.
 */
export const readMetaValue = (raw: string | undefined): PhpValue => {
  if (raw === undefined || raw === '') return null
  const trimmed = raw.trim()
  if (/^[aObidsN][:;]/.test(trimmed)) {
    const php = phpUnserialize(trimmed)
    if (php !== null) return php
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed) as PhpValue
    } catch {
      return trimmed
    }
  }
  return trimmed
}
