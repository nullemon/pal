'use client'

import { type CreditSettings, creditFontSchema } from '@palscans/core/credit'
import { messages } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button, useToast } from '@palscans/ui'
import { Trash2, Upload } from 'lucide-react'
import { useCallback, useState } from 'react'
import { postJson, putJson } from '@/components/admin/client/api'
import { Toggle } from '@/components/admin/client/controls'
import { Field, Hint, inputClass, Panel, PanelHeader, selectClass } from '@/components/admin/ui'

/**
 * Appearance → Credit page (docs/03).
 *
 * The card that goes in as every chapter's second page: one image, uploaded rather than
 * shipped so a new design needs no deploy, and the text drawn into it. The per-chapter note
 * is on the chapter itself, because that is where it belongs.
 *
 * There was a per-series panel here — its own background and its own overlay per series —
 * and it is gone deliberately: one card for everything is what the group asked for, and a
 * table of a thousand series each wanting its own artwork is work nobody was going to do.
 * The renderer still composites a background if a series has one, so bringing the panel
 * back is a change to this file rather than to the compositor.
 */
const m = adminMessages.creditPage

/** Upload straight to storage through a presigned PUT, like every other admin asset. */
const uploadAsset = async (file: File, kind: 'overlay' | 'background'): Promise<string | null> => {
  const intent = await postJson<{
    key: string
    url: string
    method: string
    headers?: Record<string, string>
  }>('/api/admin/credit', { kind, type: file.type, bytes: file.size })
  if (!intent.ok) return null
  const put = await fetch(intent.data.url, {
    method: intent.data.method,
    headers: intent.data.headers,
    body: file,
  })
  return put.ok ? intent.data.key : null
}

export function CreditScreen({ initial }: { initial: CreditSettings }) {
  const { toast } = useToast()
  const [doc, setDoc] = useState<CreditSettings>(initial)
  const [busy, setBusy] = useState(false)

  const patch = (p: Partial<CreditSettings>) => setDoc((d) => ({ ...d, ...p }))

  const save = useCallback(async () => {
    setBusy(true)
    const res = await putJson<{ settings: CreditSettings }>('/api/admin/credit', doc)
    setBusy(false)
    if (!res.ok) {
      toast({ title: res.message || messages.errors.generic, tone: 'danger' })
      return
    }
    setDoc(res.data.settings)
    toast({ title: m.saved, tone: 'ok' })
  }, [doc, toast])

  const addOverlay = useCallback(
    async (file: File) => {
      setBusy(true)
      const key = await uploadAsset(file, 'overlay')
      setBusy(false)
      if (!key) {
        toast({ title: m.uploadFailed, tone: 'danger' })
        return
      }
      const id = `o${Date.now().toString(36)}`
      // The functional form, not `patch`: an upload takes seconds, and reading `doc` from
      // the closure would write back the settings as they were when the file was chosen.
      setDoc((d) => ({
        ...d,
        overlays: [...d.overlays, { id, name: file.name.replace(/\.[^.]+$/, ''), key }],
        // The first overlay uploaded becomes the default, so the feature is usable without
        // a second trip to a dropdown nobody has reason to look at yet.
        defaultOverlayId: d.defaultOverlayId || id,
      }))
      toast({ title: m.uploaded, tone: 'ok' })
    },
    [toast],
  )

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader title={m.title} hint={m.subtitle} />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
          <span className="inline-flex items-center gap-2.5">
            {m.enabled}
            <Toggle
              ariaLabel={m.enabled}
              checked={doc.enabled}
              onChange={(v) => patch({ enabled: v })}
              size="sm"
            />
          </span>
          <span className="text-[12.5px] text-fg-muted">{m.enabledHint}</span>
        </div>
        {doc.enabled ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
            <span className="inline-flex items-center gap-2.5">
              {m.allChapters}
              <Toggle
                ariaLabel={m.allChapters}
                checked={doc.allChapters}
                onChange={(v) => patch({ allChapters: v })}
                size="sm"
              />
            </span>
            <span className="text-[12.5px] text-fg-muted">{m.allChaptersHint}</span>
          </div>
        ) : null}
        {doc.enabled ? (
          <Hint>
            {doc.allChapters
              ? m.allChaptersOn
              : doc.enabledAt
                ? m.since.replace('{date}', doc.enabledAt.slice(0, 10))
                : ''}
          </Hint>
        ) : null}
        {doc.enabled ? (
          <Button className="w-fit" disabled={busy} onClick={() => void save()} size="sm">
            {busy ? m.saving : m.save}
          </Button>
        ) : null}
      </Panel>

      <Panel>
        <PanelHeader title={m.overlays} hint={m.overlaysHint} />
        <div className="flex flex-col gap-2">
          {doc.overlays.map((o) => (
            <div
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2"
              key={o.id}
            >
              <input
                className={inputClass}
                onChange={(e) =>
                  patch({
                    overlays: doc.overlays.map((x) =>
                      x.id === o.id ? { ...x, name: e.target.value } : x,
                    ),
                  })
                }
                value={o.name}
              />
              <span className="truncate text-[12px] text-fg-subtle">{o.key.split('/').pop()}</span>
              <Button
                className="text-danger"
                onClick={() =>
                  patch({
                    overlays: doc.overlays.filter((x) => x.id !== o.id),
                    defaultOverlayId: doc.defaultOverlayId === o.id ? '' : doc.defaultOverlayId,
                  })
                }
                size="sm"
                variant="ghost"
              >
                <Trash2 aria-hidden className="size-3.5" />
                {m.remove}
              </Button>
            </div>
          ))}
          <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 text-[13px] hover:bg-surface-2">
            <Upload aria-hidden className="size-4" />
            {m.addOverlay}
            <input
              accept="image/png,image/webp"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void addOverlay(file)
                e.target.value = ''
              }}
              type="file"
            />
          </label>
        </div>
        <Field label={m.font} htmlFor="credit-font">
          <select
            className={selectClass}
            id="credit-font"
            onChange={(e) =>
              patch({ font: creditFontSchema.catch(doc.font).parse(e.target.value) })
            }
            value={doc.font}
          >
            {creditFontSchema.options.map((id) => (
              <option key={id} value={id}>
                {m.fonts[id]}
              </option>
            ))}
          </select>
        </Field>
        <Hint>{m.fontHint}</Hint>
        {doc.overlays.length > 0 ? (
          <Field label={m.defaultOverlay} htmlFor="credit-default-overlay">
            <select
              className={selectClass}
              id="credit-default-overlay"
              onChange={(e) => patch({ defaultOverlayId: e.target.value })}
              value={doc.defaultOverlayId}
            >
              <option value="">{m.none}</option>
              {doc.overlays.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </Panel>

      <Panel>
        <PanelHeader title={m.roles} hint={m.rolesHint} />
        <div className="flex flex-col gap-2">
          {doc.roles.map((role, i) => (
            <div
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] items-center gap-2"
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and reorderable
              key={i}
            >
              <input
                className={inputClass}
                onChange={(e) =>
                  patch({
                    roles: doc.roles.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)),
                  })
                }
                placeholder={m.rolePlaceholder}
                value={role.label}
              />
              <input
                className={inputClass}
                onChange={(e) =>
                  patch({
                    roles: doc.roles.map((r, j) =>
                      j === i ? { ...r, handle: e.target.value } : r,
                    ),
                  })
                }
                placeholder={m.handlePlaceholder}
                value={role.handle}
              />
              <Button
                className="text-danger"
                onClick={() => patch({ roles: doc.roles.filter((_, j) => j !== i) })}
                size="sm"
                variant="ghost"
              >
                <Trash2 aria-hidden className="size-3.5" />
              </Button>
            </div>
          ))}
          <Button
            className="w-fit"
            onClick={() => patch({ roles: [...doc.roles, { label: '', handle: '' }] })}
            size="sm"
            variant="outline"
          >
            {m.addRole}
          </Button>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title={m.textTitle} />
        <Field label={m.defaultNote} htmlFor="credit-note">
          <textarea
            className={`${inputClass} min-h-[80px] py-2`}
            id="credit-note"
            maxLength={600}
            onChange={(e) => patch({ defaultNote: e.target.value })}
            value={doc.defaultNote}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={m.discord} htmlFor="credit-discord">
            <input
              className={inputClass}
              id="credit-discord"
              onChange={(e) => patch({ discord: e.target.value })}
              placeholder="palscans.org/discord"
              value={doc.discord}
            />
          </Field>
          <Field label={m.twitter} htmlFor="credit-twitter">
            <input
              className={inputClass}
              id="credit-twitter"
              onChange={(e) => patch({ twitter: e.target.value })}
              placeholder="x.com/palscans"
              value={doc.twitter}
            />
          </Field>
        </div>
        <Button className="mt-3 w-fit" disabled={busy} onClick={() => void save()}>
          {busy ? m.saving : m.save}
        </Button>
      </Panel>
    </div>
  )
}
