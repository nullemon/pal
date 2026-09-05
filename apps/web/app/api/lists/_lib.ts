import { getDb, MAX_LIST_DESCRIPTION, MAX_LIST_NAME, readingLists } from '@palscans/db'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

/** Shared validation and the ownership check every /api/lists route runs first. */

export const listIdSchema = z.coerce.number().int().positive()
export const seriesIdSchema = z.coerce.number().int().positive()

export const listNameSchema = z.string().trim().min(1).max(MAX_LIST_NAME)
export const listDescriptionSchema = z.string().trim().max(MAX_LIST_DESCRIPTION)

export const createListSchema = z.object({
  name: listNameSchema,
  description: listDescriptionSchema.optional(),
  isPublic: z.boolean().optional(),
})

export const patchListSchema = z
  .object({
    name: listNameSchema.optional(),
    description: listDescriptionSchema.nullable().optional(),
    isPublic: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to change' })

export const addItemSchema = z.object({ seriesId: seriesIdSchema })
export const moveItemSchema = z.object({ toIndex: z.coerce.number().int().min(0) })

/**
 * True only when this account owns the list. Every mutation is scoped by owner in its own
 * WHERE clause as well; this exists so a request for someone else's list gets the same 404
 * as a list that does not exist, rather than a 403 that confirms it does.
 */
export const ownsList = async (listId: number, userId: number): Promise<boolean> => {
  const db = await getDb()
  const [row] = await db
    .select({ id: readingLists.id })
    .from(readingLists)
    .where(and(eq(readingLists.id, listId), eq(readingLists.userId, userId)))
    .limit(1)
  return Boolean(row)
}
