'use client'

import { messages } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button, useToast } from '@palscans/ui'
import { ExternalLink, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { del, postJson, putJson } from '../client/api'
import { SaveBar, useDraft } from '../client/controls'
import { slugify } from '../client/util'
import { Field, Hint, inputClass, Panel, PanelHeader, selectClass, textareaClass } from '../ui'
import { BodyField } from './BodyField'
import { excerptFrom, markdownToDoc } from './markdown'
import {
  type AnnouncementDoc,
  EDITABLE_STATES,
  fromLocalInput,
  parseTags,
  toLocalInput,
} from './schemas'

/**
 * Create and edit one announcement (docs/04 Content · Announcements). The same island serves
 * both: with `id === null` it POSTs and then lands on the saved post's own URL.
 */
export function AnnouncementEditor({
  id,
  doc: initial,
  canDelete,
}: {
  id: number | null
  doc: AnnouncementDoc
  canDelete: boolean
}) {
  const m = adminMessages.adminContent.announcements
  const f = m.fields
  const { toast } = useToast()
  const [saved, setSaved] = useState(initial)
  const [doc, setDoc] = useState(initial)
  const [tagText, setTagText] = useState(initial.tags.join(', '))
  const [saving, setSaving] = useState(false)
  const [slugTouched, setSlugTouched] = useState(
    !!initial.slug && initial.slug !== slugify(initial.title),
  )
  const dirty = useMemo(() => JSON.stringify(doc) !== JSON.stringify(saved), [doc, saved])
  useDraft(`admin.announcement.${id ?? 'new'}`, doc, dirty)

  const patch = (p: Partial<AnnouncementDoc>) => setDoc((d) => ({ ...d, ...p }))

  const setTitle = (title: string) =>
    patch(slugTouched ? { title } : { title, slug: slugify(title) })

  const save = async (override?: Partial<AnnouncementDoc>) => {
    const next = { ...doc, ...override }
    setSaving(true)
    const res = id
      ? await putJson<{ id: number; slug: string }>(`/api/admin/announcements/${id}`, next)
      : await postJson<{ id: number; slug: string }>('/api/admin/announcements', next)
    setSaving(false)
    if (!res.ok) {
      toast({ title: adminMessages.admin.errorSaving, description: res.message, tone: 'danger' })
      return
    }
    setDoc(next)
    setSaved(next)
    if (!id) {
      window.location.href = `/admin/announcements/${res.data.id}`
      return
    }
    toast({ title: m.saved, tone: 'ok' })
  }

  const remove = async () => {
    if (!id) return
    const res = await del<{ id: number }>(`/api/admin/announcements/${id}`)
    if (!res.ok) {
      toast({ title: adminMessages.admin.errorSaving, description: res.message, tone: 'danger' })
      return
    }
    const removed = { ...doc, state: 'removed' as const }
    setDoc(removed)
    setSaved(removed)
    toast({
      title: m.deleted,
      tone: 'danger',
      action: {
        label: messages.common.undo,
        onClick: () => {
          void del(`/api/admin/announcements/${id}?restore=1`).then((r) => {
            if (!r.ok) return
            const draft = { ...doc, state: 'draft' as const }
            setDoc(draft)
            setSaved(draft)
            toast({ title: m.restored, tone: 'ok' })
          })
        },
      },
    })
  }

  const fillExcerpt = () => patch({ excerpt: excerptFrom(markdownToDoc(doc.body)) || null })

  return (
    <div className="flex flex-col gap-3.5">
      <SaveBar
        // A new post has nothing to compare against: it is saveable once it has a title.
        dirty={id ? dirty : !!doc.title.trim()}
        saving={saving}
        onSave={() => void save()}
        onDiscard={id ? () => setDoc(saved) : undefined}
        status={id && doc.state !== 'published' ? adminMessages.admin.draftNotPublished : undefined}
      />
      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel className="flex min-w-0 flex-col gap-3.5">
          <Field label={f.title} htmlFor="a-title">
            <input
              id="a-title"
              className={inputClass}
              value={doc.title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label={f.slug} hint={f.slugHint} htmlFor="a-slug">
            <input
              id="a-slug"
              className={inputClass}
              value={doc.slug}
              maxLength={80}
              onChange={(e) => {
                setSlugTouched(true)
                patch({ slug: slugify(e.target.value) })
              }}
            />
          </Field>
          <BodyField value={doc.body} onChange={(body) => patch({ body })} />
        </Panel>
        <div className="flex min-w-0 flex-col gap-3.5">
          <Panel className="flex flex-col gap-3.5">
            <PanelHeader title={m.editor} />
            <Field label={f.state} htmlFor="a-state">
              <select
                id="a-state"
                className={selectClass}
                value={doc.state}
                onChange={(e) => patch({ state: e.target.value as AnnouncementDoc['state'] })}
              >
                {(doc.state === 'removed' ? [...EDITABLE_STATES, 'removed'] : EDITABLE_STATES).map(
                  (s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ),
                )}
              </select>
            </Field>
            <Field label={f.publishedAt} hint={f.publishedAtHint} htmlFor="a-published">
              <input
                id="a-published"
                type="datetime-local"
                className={inputClass}
                value={toLocalInput(doc.publishedAt)}
                onChange={(e) => patch({ publishedAt: fromLocalInput(e.target.value) })}
              />
            </Field>
            {doc.state !== 'published' ? (
              <Button
                variant="outline"
                size="sm"
                disabled={saving || !doc.title.trim()}
                onClick={() => void save({ state: 'published' })}
              >
                {m.publishNow}
              </Button>
            ) : (
              <a
                href={`/announcements/${doc.slug}`}
                target="_blank"
                rel="noopener"
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-line px-3 text-[13px] font-semibold text-fg-muted hover:bg-surface-2 hover:text-fg"
              >
                <ExternalLink size={14} aria-hidden="true" />
                {m.viewOnSite}
              </a>
            )}
          </Panel>
          <Panel className="flex flex-col gap-3.5">
            <Field label={f.excerpt} hint={f.excerptHint} htmlFor="a-excerpt">
              <textarea
                id="a-excerpt"
                className={textareaClass}
                rows={3}
                maxLength={300}
                value={doc.excerpt ?? ''}
                onChange={(e) => patch({ excerpt: e.target.value || null })}
              />
            </Field>
            <button
              type="button"
              className="self-start text-[12.5px] font-semibold text-brand-hover hover:underline"
              onClick={fillExcerpt}
            >
              {f.excerptFill}
            </button>
            <Field label={f.tags} hint={f.tagsHint} htmlFor="a-tags">
              <input
                id="a-tags"
                className={inputClass}
                value={tagText}
                onChange={(e) => setTagText(e.target.value)}
                onBlur={() => {
                  const tags = parseTags(tagText)
                  setTagText(tags.join(', '))
                  patch({ tags })
                }}
              />
            </Field>
            <Field label={f.coverKey} hint={f.coverKeyHint} htmlFor="a-cover">
              <input
                id="a-cover"
                className={inputClass}
                value={doc.coverKey ?? ''}
                maxLength={300}
                onChange={(e) => patch({ coverKey: e.target.value || null })}
              />
            </Field>
          </Panel>
          {id && canDelete ? (
            <Panel className="flex flex-col gap-2">
              <Hint>{m.deleteConfirm}</Hint>
              <Button
                variant="outline"
                size="sm"
                className="self-start text-danger"
                disabled={doc.state === 'removed'}
                onClick={() => void remove()}
              >
                <Trash2 size={14} aria-hidden="true" />
                {messages.common.delete}
              </Button>
              <Hint className="text-[12px] text-fg-subtle">{adminMessages.admin.undoWindow}</Hint>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  )
}
