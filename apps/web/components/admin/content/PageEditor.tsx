'use client'

import { fmt, messages } from '@palscans/core/messages'
import { useToast } from '@palscans/ui'
import { ExternalLink } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { postJson, putJson } from '../client/api'
import { SaveBar, useDraft } from '../client/controls'
import { slugify } from '../client/util'
import { Field, Hint, inputClass, Panel, PanelHeader, selectClass } from '../ui'
import { BodyField } from './BodyField'
import { EDITABLE_STATES, type PageDoc, publicPagePath } from './schemas'

/**
 * Edit one static page — terms, privacy, DMCA, contact (docs/13). The same island creates a
 * new page when `id` is null. Editing is deliberately plain: these are legal documents, so
 * the screen shows the exact text, its version, and nothing that could reword it.
 */
export function PageEditor({
  id,
  doc: initial,
  version,
}: {
  id: number | null
  doc: PageDoc
  version: number | null
}) {
  const m = messages.adminContent.pages
  const f = m.fields
  const { toast } = useToast()
  const router = useRouter()
  const [saved, setSaved] = useState(initial)
  const [doc, setDoc] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [slugTouched, setSlugTouched] = useState(
    !!initial.slug && initial.slug !== slugify(initial.title),
  )
  const dirty = useMemo(() => JSON.stringify(doc) !== JSON.stringify(saved), [doc, saved])
  const path = publicPagePath(doc.slug)
  useDraft(`admin.page.${id ?? 'new'}`, doc, dirty)

  const patch = (p: Partial<PageDoc>) => setDoc((d) => ({ ...d, ...p }))

  const save = async () => {
    setSaving(true)
    const res = id
      ? await putJson<{ id: number; version: number }>(`/api/admin/pages/${id}`, doc)
      : await postJson<{ id: number }>('/api/admin/pages', doc)
    setSaving(false)
    if (!res.ok) {
      toast({ title: messages.admin.errorSaving, description: res.message, tone: 'danger' })
      return
    }
    setSaved(doc)
    if (!id) {
      window.location.href = `/admin/pages/${res.data.id}`
      return
    }
    toast({ title: m.saved, tone: 'ok' })
    // The version counter is server-side; re-render this screen so it cannot drift.
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-3.5">
      <SaveBar
        // A new page has nothing to compare against: it is saveable once it has a title.
        dirty={id ? dirty : !!doc.title.trim()}
        saving={saving}
        onSave={() => void save()}
        onDiscard={id ? () => setDoc(saved) : undefined}
      />
      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel className="flex min-w-0 flex-col gap-3.5">
          <Field label={f.title} htmlFor="p-title">
            <input
              id="p-title"
              className={inputClass}
              value={doc.title}
              maxLength={200}
              onChange={(e) =>
                setDoc((d) => ({
                  ...d,
                  title: e.target.value,
                  ...(slugTouched || id ? {} : { slug: slugify(e.target.value) }),
                }))
              }
            />
          </Field>
          <Field label={f.slug} hint={f.slugHint} htmlFor="p-slug">
            <input
              id="p-slug"
              className={inputClass}
              value={doc.slug}
              maxLength={80}
              onChange={(e) => {
                setSlugTouched(true)
                patch({ slug: slugify(e.target.value) })
              }}
            />
          </Field>
          <BodyField value={doc.body} onChange={(body) => patch({ body })} rows={24} />
        </Panel>
        <div className="flex min-w-0 flex-col gap-3.5">
          <Panel className="flex flex-col gap-3.5">
            <PanelHeader title={m.editor} hint={m.legalHint} />
            <Field label={f.state} htmlFor="p-state">
              <select
                id="p-state"
                className={selectClass}
                value={doc.state}
                onChange={(e) => patch({ state: e.target.value as PageDoc['state'] })}
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
            {version === null ? null : (
              <div className="flex flex-col gap-1">
                <span className="text-[13px] font-semibold text-fg">
                  {fmt(m.version, { n: version })}
                </span>
                <Hint className="text-[12px] text-fg-subtle">{m.versionHint}</Hint>
              </div>
            )}
            {path && doc.state === 'published' ? (
              <a
                href={path}
                target="_blank"
                rel="noopener"
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-line px-3 text-[13px] font-semibold text-fg-muted hover:bg-surface-2 hover:text-fg"
              >
                <ExternalLink size={14} aria-hidden="true" />
                {m.viewOnSite}
              </a>
            ) : (
              <Hint className="text-[12px] text-fg-subtle">{m.notRenderedHint}</Hint>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}
