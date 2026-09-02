import { bigint, timestamp } from 'drizzle-orm/pg-core'

export const identity = () =>
  bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity()

export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

export const createdAt = () => timestamptz('created_at').notNull().defaultNow()
export const updatedAt = () => timestamptz('updated_at').notNull().defaultNow()
export const deletedAt = () => timestamptz('deleted_at')

export const ref = (name: string) => bigint(name, { mode: 'number' })
