import 'server-only'

import { appearanceSettings, type Db, getDb, publishedAppearance, users } from '@palscans/db'
import { and, desc, eq, inArray, lt } from 'drizzle-orm'
import { type ScopeDocument, scopeAdapter } from './documents'
import { type AppearanceDoc, carryAdvanced, EMPTY_ADVANCED, parseAppearance } from './schema'
import type { AppearanceScope } from './scope'

/**
 * Draft → publish → history, for every Appearance screen, over the one
 * `appearance_settings` table (docs/15 "Presets, preview, history").
 *
 * This is the machinery the Theme screen already had, generalised by the `scope` column
 * added in migration 9033 rather than copied. Everything a screen needs — one draft, one
 * published row, an archive with who and when, publish, and revert-to-a-version — is here
 * once, and each screen's route handler is a dozen lines that name a scope and a schema.
 *
 * ## The three rules the shapes below encode
 *
 * 1. **One draft and one published row per scope**, enforced by two partial unique indexes
 *    rather than by hoping two browser tabs do not save at the same moment.
 * 2. **History is linear and append-only.** Reverting does not resurrect the old row; it
 *    inserts a *copy* of it as the new published version and archives the one it replaced.
 *    So "revert to v4" leaves v4 in the archive and adds v9 — the log reads as a sequence of
 *    decisions, and reverting a revert needs no special case.
 * 3. **Publishing is what touches the live site.** Saving a draft writes exactly one row in
 *    `appearance_settings` and nothing else, which is the whole point: an operator can
 *    rewrite 29 copy strings across three sittings and the readers see none of it.
 */

export const VERSION_LIMIT = 30

export interface VersionSummary {
  id: number
  status: string
  createdAt: string
  publishedAt: string | null
  by: string | null
}

export interface ScopeState<S extends AppearanceScope> {
  /** What the site is rendering right now. Always present — the shipped defaults if nothing else. */
  live: ScopeDocument<S>
  /** The unpublished draft, when there is one. */
  draft: { id: number; doc: ScopeDocument<S>; savedAt: string; by: string | null } | null
  /** The most recent publish through this screen, when there has been one. */
  published: {
    id: number
    doc: ScopeDocument<S>
    publishedAt: string | null
    by: string | null
  } | null
  versions: VersionSummary[]
}

const rowsFor = async (db: Db, scope: AppearanceScope, limit = VERSION_LIMIT) =>
  db
    .select({
      id: appearanceSettings.id,
      settings: appearanceSettings.settings,
      status: appearanceSettings.status,
      publishedAt: appearanceSettings.publishedAt,
      createdAt: appearanceSettings.createdAt,
      createdBy: users.username,
    })
    .from(appearanceSettings)
    .leftJoin(users, eq(users.id, appearanceSettings.createdBy))
    .where(
      and(
        eq(appearanceSettings.scope, scope),
        inArray(appearanceSettings.status, ['draft', 'published', 'archived']),
      ),
    )
    .orderBy(desc(appearanceSettings.id))
    .limit(limit)

/** Everything one Appearance screen renders: the live document, the draft, and the log. */
export const loadScopeState = async <S extends AppearanceScope>(
  scope: S,
  db?: Db,
): Promise<ScopeState<S>> => {
  const database = db ?? (await getDb())
  const adapter = scopeAdapter(scope)
  const [rows, live] = await Promise.all([rowsFor(database, scope), adapter.live(database)])
  const draft = rows.find((r) => r.status === 'draft') ?? null
  const published = rows.find((r) => r.status === 'published') ?? null
  return {
    live,
    draft: draft
      ? {
          id: draft.id,
          doc: adapter.parse(draft.settings),
          savedAt: draft.createdAt.toISOString(),
          by: draft.createdBy,
        }
      : null,
    published: published
      ? {
          id: published.id,
          doc: adapter.parse(published.settings),
          publishedAt: published.publishedAt?.toISOString() ?? null,
          by: published.createdBy,
        }
      : null,
    versions: rows.map((r) => ({
      id: r.id,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      publishedAt: r.publishedAt?.toISOString() ?? null,
      by: r.createdBy,
    })),
  }
}

/** The unpublished draft document for a scope, or null. This is what a preview renders. */
export const draftDocument = async <S extends AppearanceScope>(
  scope: S,
  db?: Db,
): Promise<ScopeDocument<S> | null> => {
  const database = db ?? (await getDb())
  const [row] = await database
    .select({ settings: appearanceSettings.settings })
    .from(appearanceSettings)
    .where(and(eq(appearanceSettings.scope, scope), eq(appearanceSettings.status, 'draft')))
    .limit(1)
  return row ? scopeAdapter(scope).parse(row.settings) : null
}

/** One document per requested scope, read in a single round trip. Used by the preview path. */
export const draftDocuments = async (
  scopes: readonly AppearanceScope[],
  db?: Db,
): Promise<Partial<{ [S in AppearanceScope]: ScopeDocument<S> }>> => {
  if (scopes.length === 0) return {}
  const database = db ?? (await getDb())
  const rows = await database
    .select({ scope: appearanceSettings.scope, settings: appearanceSettings.settings })
    .from(appearanceSettings)
    .where(
      and(
        eq(appearanceSettings.status, 'draft'),
        inArray(appearanceSettings.scope, scopes as string[]),
      ),
    )
  const out: Record<string, unknown> = {}
  for (const row of rows) {
    const scope = row.scope as AppearanceScope
    if (scopes.includes(scope)) out[scope] = scopeAdapter(scope).parse(row.settings)
  }
  return out as Partial<{ [S in AppearanceScope]: ScopeDocument<S> }>
}

/**
 * One archived version and the one published before it — everything the history modal needs
 * to show "what this publish changed".
 *
 * The base is the next *older* row in the same scope rather than whatever is live now, so
 * the diff reads as the decision that was taken at the time. `null` for the first version
 * ever, where every field is new by definition.
 */
export const versionWithBase = async <S extends AppearanceScope>(
  scope: S,
  id: number,
  db?: Db,
): Promise<{ doc: ScopeDocument<S>; base: ScopeDocument<S> | null } | null> => {
  const database = db ?? (await getDb())
  const adapter = scopeAdapter(scope)
  const [row] = await database
    .select({ settings: appearanceSettings.settings })
    .from(appearanceSettings)
    .where(and(eq(appearanceSettings.id, id), eq(appearanceSettings.scope, scope)))
    .limit(1)
  if (!row) return null
  const [previous] = await database
    .select({ settings: appearanceSettings.settings })
    .from(appearanceSettings)
    .where(
      and(
        eq(appearanceSettings.scope, scope),
        lt(appearanceSettings.id, id),
        inArray(appearanceSettings.status, ['published', 'archived']),
      ),
    )
    .orderBy(desc(appearanceSettings.id))
    .limit(1)
  return {
    doc: adapter.parse(row.settings),
    base: previous ? adapter.parse(previous.settings) : null,
  }
}

/** Create or replace the scope's single draft row. Returns its id. */
/**
 * Strip anything a request may not set, whatever route it arrived through.
 *
 * Only the theme document has such a field: `advanced` holds the custom CSS and the
 * head/footer snippets, which are `appearance.advanced` (admin-only). Every route here is
 * `settings.write`, held by more people — so without this, saving a theme draft, publishing
 * one, or reverting to an old version would each be a way to put a `<script>` on every
 * public page and the permission would be decoration. The stored block is carried forward,
 * so a theme save never destroys it either.
 */
const sanitize = async <S extends AppearanceScope>(
  scope: S,
  doc: ScopeDocument<S>,
  db: Db,
): Promise<ScopeDocument<S>> => {
  if (scope !== 'theme') return doc
  const live = await publishedAppearance(db)
  const stored = live ? parseAppearance(live.settings).advanced : EMPTY_ADVANCED
  return carryAdvanced(doc as AppearanceDoc, stored) as ScopeDocument<S>
}

export const saveDraft = async <S extends AppearanceScope>(
  scope: S,
  input: ScopeDocument<S>,
  userId: number,
  db?: Db,
): Promise<number> => {
  const database = db ?? (await getDb())
  const doc = await sanitize(scope, input, database)
  const adapter = scopeAdapter(scope)
  const [existing] = await database
    .select({ id: appearanceSettings.id })
    .from(appearanceSettings)
    .where(and(eq(appearanceSettings.scope, scope), eq(appearanceSettings.status, 'draft')))
    .limit(1)
  if (existing) {
    await database
      .update(appearanceSettings)
      .set({
        settings: doc as Record<string, unknown>,
        resolvedCss: adapter.derivedCss(doc),
        createdBy: userId,
        createdAt: new Date(),
      })
      .where(eq(appearanceSettings.id, existing.id))
    return existing.id
  }
  const [row] = await database
    .insert(appearanceSettings)
    .values({
      scope,
      settings: doc as Record<string, unknown>,
      resolvedCss: adapter.derivedCss(doc),
      status: 'draft',
      createdBy: userId,
    })
    .returning({ id: appearanceSettings.id })
  return row?.id ?? 0
}

/** Throw the draft away and go back to what is live. Returns the id that was removed. */
export const discardDraft = async (scope: AppearanceScope, db?: Db): Promise<number | null> => {
  const database = db ?? (await getDb())
  const [row] = await database
    .delete(appearanceSettings)
    .where(and(eq(appearanceSettings.scope, scope), eq(appearanceSettings.status, 'draft')))
    .returning({ id: appearanceSettings.id })
  return row?.id ?? null
}

export type PublishFailure = 'no_draft' | 'not_found'

export interface PublishResult<S extends AppearanceScope> {
  id: number
  doc: ScopeDocument<S>
  /** The document that was live before this publish, for the audit row. */
  previous: ScopeDocument<S>
  previousId: number | null
}

/**
 * Publish the draft, or a copy of an earlier version.
 *
 * `transform` runs on the document after it is read and before anything is written — it is
 * how the brand screen drops uploads that are no longer in storage, with the operator's
 * consent, without this module having to know what an upload is.
 */
export const publishScope = async <S extends AppearanceScope>(
  scope: S,
  options: {
    versionId?: number
    userId: number
    transform?: (doc: ScopeDocument<S>) => ScopeDocument<S>
    db?: Db
  },
): Promise<PublishResult<S> | { error: PublishFailure }> => {
  const database = options.db ?? (await getDb())
  const adapter = scopeAdapter(scope)
  const now = new Date()

  const [current] = await database
    .select({ id: appearanceSettings.id, settings: appearanceSettings.settings })
    .from(appearanceSettings)
    .where(and(eq(appearanceSettings.scope, scope), eq(appearanceSettings.status, 'published')))
    .limit(1)
  const previous = await adapter.live(database)

  const source = options.versionId
    ? await database
        .select({ id: appearanceSettings.id, settings: appearanceSettings.settings })
        .from(appearanceSettings)
        .where(
          and(eq(appearanceSettings.id, options.versionId), eq(appearanceSettings.scope, scope)),
        )
        .limit(1)
    : await database
        .select({ id: appearanceSettings.id, settings: appearanceSettings.settings })
        .from(appearanceSettings)
        .where(and(eq(appearanceSettings.scope, scope), eq(appearanceSettings.status, 'draft')))
        .limit(1)
  const row = source[0]
  if (!row) return { error: options.versionId ? 'not_found' : 'no_draft' }

  const parsed = adapter.parse(row.settings)
  // Sanitised on the way out of storage too, not just on the way in: a revert publishes a
  // document written months ago, and without this a `settings.write` holder could restore a
  // version whose `advanced` block still carried a tracking script an admin had since
  // removed. The live block wins, exactly as it does on a save.
  const restored = await sanitize(scope, parsed, database)
  const doc = options.transform ? options.transform(restored) : restored
  const css = adapter.derivedCss(doc)

  let publishedId = 0
  await database.transaction(async (tx) => {
    if (current)
      await tx
        .update(appearanceSettings)
        .set({ status: 'archived' })
        .where(eq(appearanceSettings.id, current.id))
    if (options.versionId) {
      // A revert inserts a copy so the archive stays a record of what happened, not of what
      // is current — see rule 2 at the top of this file.
      const [inserted] = await tx
        .insert(appearanceSettings)
        .values({
          scope,
          settings: doc as Record<string, unknown>,
          resolvedCss: css,
          status: 'published',
          publishedAt: now,
          createdBy: options.userId,
        })
        .returning({ id: appearanceSettings.id })
      publishedId = inserted?.id ?? 0
    } else {
      await tx
        .update(appearanceSettings)
        .set({
          status: 'published',
          publishedAt: now,
          settings: doc as Record<string, unknown>,
          resolvedCss: css,
        })
        .where(eq(appearanceSettings.id, row.id))
      publishedId = row.id
    }
  })

  await adapter.apply(database, doc, options.userId)
  return { id: publishedId, doc, previous, previousId: current?.id ?? null }
}
