'use client'

import { type CreditSettings, creditFontSchema } from '@palscans/core/credit'
import { messages } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button, useToast } from '@palscans/ui'
import { Trash2, Upload } from 'lucide-react'
import { useCallback, useState } from 'react'
import { postJson, putJson } from '@/components/admin/client/api'
import { Toggle } from '@/components/admin/client/controls'
import {
  Field,
  Hint,
  inputClass,
  Panel,
  PanelHeader,
  selectClass,
  Table,
  Td,
  Th,
} from '@/components/admin/ui'

/**
 * Appearance → Credit page (docs/03).
 *
 * The card that goes in as every new chapter's second page. Three things live here and
 * nowhere else: the overlays (uploaded, not shipped — so a new design needs no deploy), the
 * roles and handles, and the footer. The per-series background sits below, and the per
 * -chapter note is on the chapter itself, because that is where each belongs.
 */
const m = adminMessages.creditPage

export interface SeriesRow {
  id: number
  title: string
  backgroundKey: string | null
  overlayId: string | null
}

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

export function CreditScreen({
  initial,
  series,
}: {
  initial: CreditSettings
  series: SeriesRow[]
}) {
  const { toast } = useToast()
  const [doc, setDoc] = useState<CreditSettings>(initial)
  const [rows, setRows] = useState(series)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('')

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

  const setSeriesAsset = useCallback(
    async (row: SeriesRow, file: File | null, overlayId?: string) => {
      setBusy(true)
      const key = file ? await uploadAsset(file, 'background') : undefined
      if (file && !key) {
        setBusy(false)
        toast({ title: m.uploadFailed, tone: 'danger' })
        return
      }
      const body = {
        seriesId: row.id,
        ...(key !== undefined ? { backgroundKey: key } : {}),
        ...(overlayId !== undefined ? { overlayId } : {}),
      }
      const res = await fetch('/api/admin/credit', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      setBusy(false)
      if (!res.ok) {
        toast({ title: messages.errors.generic, tone: 'danger' })
        return
      }
      setRows((current) =>
        current.map((r) =>
          r.id === row.id
            ? {
                ...r,
                ...(key !== undefined ? { backgroundKey: key } : {}),
                ...(overlayId !== undefined ? { overlayId } : {}),
              }
            : r,
        ),
      )
      toast({ title: m.seriesSaved, tone: 'ok' })
    },
    [toast],
  )

  /**
   * The background every series falls back to.
   *
   * It is a separate control from the table below because it is a different decision: the
   * table says what *this* series looks like, this says what the rest do. The overlay is
   * transparent where the background shows, so without one that window is flat dark — which
   * is a reasonable card, but it should be a choice rather than what happens by default.
   */
  const setDefaultBackground = useCallback(
    async (file: File) => {
      setBusy(true)
      const key = await uploadAsset(file, 'background')
      setBusy(false)
      if (!key) {
        toast({ title: m.uploadFailed, tone: 'danger' })
        return
      }
      // Functional form: an upload takes seconds and `doc` from the closure would be stale.
      setDoc((d) => ({ ...d, defaultBackgroundKey: key }))
      toast({ title: m.backgroundUploaded, tone: 'ok' })
    },
    [toast],
  )

  const visible = rows.filter((r) => r.title.toLowerCase().includes(filter.toLowerCase()))

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
        {doc.enabled && doc.enabledAt ? (
          <Hint>{m.since.replace('{date}', doc.enabledAt.slice(0, 10))}</Hint>
        ) : null}
      </Panel>

      <Panel>
        <PanelHeader title={m.overlays} hint={m.overlaysHint} />
        <div className="flex flex-col gap-2">
          {doc.overlays.map((o) => (
            <div className="flex flex-wrap items-center gap-2" key={o.id}>
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
              <span className="text-[12px] text-fg-subtle">{o.key.split('/').pop()}</span>
              <Button
                className="ml-auto text-danger"
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
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and reorderable
            <div className="flex flex-wrap items-center gap-2" key={i}>
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

      <Panel>
        <PanelHeader title={m.perSeries} hint={m.perSeriesHint} />
        <Field hint={m.defaultBackgroundHint} label={m.defaultBackground}>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 text-[13px] hover:bg-surface-2">
              <Upload aria-hidden className="size-4" />
              {doc.defaultBackgroundKey ? m.replace : m.upload}
              <input
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void setDefaultBackground(file)
                  e.target.value = ''
                }}
                type="file"
              />
            </label>
            {doc.defaultBackgroundKey ? (
              <>
                <span className="text-[12px] text-fg-subtle">
                  {doc.defaultBackgroundKey.split('/').pop()}
                </span>
                <Button
                  className="text-danger"
                  onClick={() => patch({ defaultBackgroundKey: '' })}
                  size="sm"
                  variant="ghost"
                >
                  <Trash2 aria-hidden className="size-3.5" />
                  {m.clear}
                </Button>
              </>
            ) : null}
            {/* The Save for this panel. Uploading only puts the key in the form -- the same
                as the overlays above -- and the only other Save is three panels up, which is
                far enough away to read as "nothing happened". */}
            <Button className="ml-auto" disabled={busy} onClick={() => void save()} size="sm">
              {busy ? m.saving : m.save}
            </Button>
          </div>
        </Field>
        <input
          className={inputClass}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={m.findSeries}
          value={filter}
        />
        <Table>
          <thead>
            <tr>
              <Th>{m.seriesColumn}</Th>
              <Th>{m.backgroundColumn}</Th>
              <Th>{m.overlayColumn}</Th>
            </tr>
          </thead>
          <tbody>
            {visible.slice(0, 100).map((row) => (
              <tr key={row.id}>
                <Td>{row.title}</Td>
                <Td>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12.5px] text-accent">
                    <Upload aria-hidden className="size-3.5" />
                    {row.backgroundKey ? m.replace : m.upload}
                    <input
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      disabled={busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) void setSeriesAsset(row, file)
                        e.target.value = ''
                      }}
                      type="file"
                    />
                  </label>
                </Td>
                <Td>
                  <select
                    className={selectClass}
                    onChange={(e) => void setSeriesAsset(row, null, e.target.value)}
                    value={row.overlayId ?? ''}
                  >
                    <option value="">{m.useDefault}</option>
                    {doc.overlays.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {visible.length > 100 ? <Hint>{m.narrowSearch}</Hint> : null}
      </Panel>
    </div>
  )
}
