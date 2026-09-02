import { can, isStaff } from '@palscans/core'
import {
  allAllowlisted,
  COMMENT_MAX_CHARS,
  detectLinks,
  linkHrefs,
  misleadingLinks,
  plainText,
} from '@palscans/core/comments'
import { messages } from '@palscans/core/messages'
import { auditLog, commentEdits, comments, db, linkAllowlist, wordFilters } from '@palscans/db'
import { eq, isNull } from 'drizzle-orm'
import { forbidden, ipHashFor, notFound, ok, parseJson, requireUser } from '@/lib/comments/http'
import { applyWordFilters, canEditComment, loadActiveBans } from '@/lib/comments/pipeline'
import { getCommentRow, getCommentView, viewerFor } from '@/lib/comments/queries'
import { editCommentSchema, idParamSchema } from '@/lib/comments/schemas'
import { loadCommentSettings } from '@/lib/comments/settings'

type Params = { id: string }

/** PATCH /api/comments/:id {body} — within the edit window; links re-run the hold policy. */
export const PATCH = requireUser<Params>(async (request, ctx, user) => {
  const id = idParamSchema.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const row = await getCommentRow(db, id.data)
  if (!row) return notFound()
  const settings = await loadCommentSettings(db)
  if (!canEditComment(row, user, settings))
    return Response.json(
      { error: 'edit_window', message: messages.commentThread.editWindowOver },
      { status: 403 },
    )

  const staff = isStaff(user)
  const activeBans = await loadActiveBans(db, user.id)
  if (activeBans.has('user'))
    return Response.json(
      { error: 'banned', message: messages.commentThread.banned },
      { status: 403 },
    )

  const parsed = await parseJson(request, editCommentSchema)
  if (!parsed.ok) return parsed.response
  const text = plainText(parsed.data.body)
  if (text.length > COMMENT_MAX_CHARS)
    return Response.json(
      { error: 'too_long', message: messages.commentThread.tooLong },
      { status: 400 },
    )
  if (!staff && misleadingLinks(parsed.data.body).length > 0)
    return Response.json(
      { error: 'misleading_link', message: messages.commentThread.misleadingLink },
      { status: 400 },
    )

  const filters = await db
    .select({
      pattern: wordFilters.pattern,
      isRegex: wordFilters.isRegex,
      action: wordFilters.action,
      replacement: wordFilters.replacement,
    })
    .from(wordFilters)
    .where(isNull(wordFilters.deletedAt))
  const filtered = applyWordFilters(parsed.data.body, filters)
  if (filtered.action === 'block')
    return Response.json(
      { error: 'blocked_words', message: messages.commentThread.blockedWords },
      { status: 422 },
    )

  let status = row.status
  if (!staff && activeBans.has('shadow')) status = 'shadow'
  else if (!staff && status === 'published') {
    // text and link-node hrefs together, so a link node cannot bypass the hold policy
    const links = detectLinks([text, ...linkHrefs(parsed.data.body)].join(' '))
    const allow = (
      await db
        .select({ domain: linkAllowlist.domain })
        .from(linkAllowlist)
        .where(isNull(linkAllowlist.deletedAt))
    ).map((a) => a.domain)
    const hasLink = links.length > 0 && !allAllowlisted(links, allow)
    if ((hasLink && settings.hold_links) || filtered.action === 'hold') status = 'pending'
  }

  const now = new Date()
  await db
    .insert(commentEdits)
    .values({ commentId: row.id, editorId: user.id, body: row.body, editedAt: now })
  await db
    .update(comments)
    .set({
      body: filtered.body,
      isSpoiler: parsed.data.is_spoiler ?? row.isSpoiler,
      status,
      editedAt: now,
    })
    .where(eq(comments.id, row.id))
  if (row.userId !== user.id)
    await db.insert(auditLog).values({
      actorId: user.id,
      action: 'comment.edit',
      targetType: 'comment',
      targetId: row.id,
      before: row.body,
      after: filtered.body,
      ipHash: await ipHashFor(request),
    })

  const viewer = await viewerFor(db, user)
  const comment = await getCommentView(db, row.id, viewer)
  return ok({ comment, status })
})

/** DELETE /api/comments/:id — author or comment.moderate. Soft delete; stub stays if it has replies. */
export const DELETE = requireUser<Params>(async (request, ctx, user) => {
  const id = idParamSchema.safeParse((await ctx.params).id)
  if (!id.success) return notFound()
  const row = await getCommentRow(db, id.data)
  if (!row || row.deletedAt) return notFound()
  const own = row.userId === user.id
  if (!own && !can(user, 'comment.moderate')) return forbidden()

  await db.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, row.id))
  if (!own)
    await db.insert(auditLog).values({
      actorId: user.id,
      action: 'comment.delete',
      targetType: 'comment',
      targetId: row.id,
      before: { status: row.status, userId: row.userId },
      after: { deleted: true },
      ipHash: await ipHashFor(request),
    })
  return ok({ id: row.id, stub: row.replyCount > 0 })
})
