import { customType } from 'drizzle-orm/pg-core'

/** Case-insensitive text (extension `citext`, enabled in the first migration). */
export const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext'
  },
})

export const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return 'bytea'
  },
  toDriver(value) {
    return value
  },
  fromDriver(value: unknown) {
    if (value instanceof Uint8Array) return value
    if (typeof value === 'string') {
      // postgres-js may hand back hex ("\\x…") for bytea when parsers are bypassed
      const hex = value.startsWith('\\x') ? value.slice(2) : value
      return Uint8Array.from(Buffer.from(hex, 'hex'))
    }
    return new Uint8Array(value as ArrayBufferLike)
  },
})

export const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector'
  },
})
