'use client'

import { adminMessages } from '@palscans/core/messages/admin'
import { Button, cn, useToast } from '@palscans/ui'
import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { parseInline } from '@/lib/chrome/inline'
import type { MenusSetting } from '@/lib/chrome/schema'
import {
  BOTTOM_NAV_DEFAULTS,
  BOTTOM_NAV_IDS,
  type BottomNavId,
  SOCIAL_LABELS,
  SOCIAL_NETWORKS,
  SUPPORT_LABELS,
  SUPPORT_NETWORKS,
} from '@/lib/site'
import { Field, Hint, inputClass, Panel, PanelHeader, selectClass } from '../ui'
import { putJson } from './api'
import { SaveBar, Toggle } from './controls'

type Header = MenusSetting['header'][number]
type Column = MenusSetting['footer'][number]

const rowButton =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-line text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-40'

/** `datetime-local` speaks local wall-clock; the document stores an absolute instant. */
const toLocalInput = (iso: string | null): string => {
  if (!iso) return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}
const fromLocalInput = (value: string): string | null => {
  if (!value) return null
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? null : at.toISOString()
}

/**
 * Appearance → Header, footer, menus (docs/15).
 *
 * One document, one Save. Everything on this screen is a link list, and the list controls are
 * plain buttons rather than drag-and-drop: reordering has to work with a keyboard, and "Move
 * up" is the version that does without a second implementation for it.
 */
export function MenusScreen({ initial }: { initial: MenusSetting }) {
  const m = adminMessages.menus
  const { toast } = useToast()
  const [saved, setSaved] = useState(initial)
  const [s, setS] = useState(initial)
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(s) !== JSON.stringify(saved)
  const set = (patch: Partial<MenusSetting>) => setS((prev) => ({ ...prev, ...patch }))

  const move = <T,>(list: readonly T[], from: number, to: number): T[] => {
    if (to < 0 || to >= list.length) return [...list]
    const next = [...list]
    const [item] = next.splice(from, 1)
    if (item !== undefined) next.splice(to, 0, item)
    return next
  }

  const setHeader = (i: number, patch: Partial<Header>) =>
    set({ header: s.header.map((l, n) => (n === i ? { ...l, ...patch } : l)) })

  const setColumn = (ci: number, patch: Partial<Column>) =>
    set({ footer: s.footer.map((c, n) => (n === ci ? { ...c, ...patch } : c)) })

  const toggleBottom = (id: BottomNavId) => {
    const has = s.bottom_nav.includes(id)
    if (has) return set({ bottom_nav: s.bottom_nav.filter((v) => v !== id) })
    if (s.bottom_nav.length >= 4) return
    set({ bottom_nav: [...s.bottom_nav, id] })
  }

  return (
    <div className="flex flex-col gap-3.5">
      <SaveBar
        dirty={dirty}
        saving={saving}
        onDiscard={() => setS(saved)}
        onSave={async () => {
          setSaving(true)
          const res = await putJson<MenusSetting>('/api/admin/appearance/menus', s)
          setSaving(false)
          if (!res.ok)
            return toast({
              title: adminMessages.admin.errorSaving,
              description: res.message,
              tone: 'danger',
            })
          setSaved(res.data)
          setS(res.data)
          toast({ title: m.saved, tone: 'ok' })
        }}
      />

      <Panel>
        <PanelHeader title={m.header} hint={m.headerHint} />
        <div className="flex flex-col gap-2">
          {s.header.length === 0 ? <Hint>{m.empty}</Hint> : null}
          {s.header.map((link, i) => (
            <div
              // Position is the identity here: two rows may legitimately share a label.
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and edited in place
              key={i}
              className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-bg p-2"
            >
              <input
                aria-label={m.label}
                placeholder={m.label}
                className={cn(inputClass, 'w-[150px]')}
                value={link.label}
                maxLength={40}
                onChange={(e) => setHeader(i, { label: e.target.value })}
              />
              <input
                aria-label={m.target}
                placeholder="/browse"
                className={cn(inputClass, 'min-w-[160px] flex-1 font-mono text-[12px]')}
                value={link.href}
                maxLength={300}
                onChange={(e) => setHeader(i, { href: e.target.value })}
              />
              <label className="flex items-center gap-1.5 text-[12px] text-fg-muted">
                <input
                  type="checkbox"
                  className="accent-brand"
                  checked={link.prefix}
                  onChange={(e) => setHeader(i, { prefix: e.target.checked })}
                />
                {m.prefix}
              </label>
              <label className="flex items-center gap-1.5 text-[12px] text-fg-muted">
                <input
                  type="checkbox"
                  className="accent-brand"
                  checked={link.mobile}
                  onChange={(e) => setHeader(i, { mobile: e.target.checked })}
                />
                {m.onPhone}
              </label>
              <div className="ml-auto flex gap-1">
                <button
                  type="button"
                  className={rowButton}
                  aria-label={m.moveUp}
                  disabled={i === 0}
                  onClick={() => set({ header: move(s.header, i, i - 1) })}
                >
                  <ChevronUp size={15} />
                </button>
                <button
                  type="button"
                  className={rowButton}
                  aria-label={m.moveDown}
                  disabled={i === s.header.length - 1}
                  onClick={() => set({ header: move(s.header, i, i + 1) })}
                >
                  <ChevronDown size={15} />
                </button>
                <button
                  type="button"
                  className={rowButton}
                  aria-label={m.removeRow}
                  onClick={() => set({ header: s.header.filter((_, n) => n !== i) })}
                >
                  <X size={15} />
                </button>
              </div>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            disabled={s.header.length >= 12}
            onClick={() =>
              set({ header: [...s.header, { label: '', href: '/', prefix: false, mobile: false }] })
            }
          >
            <Plus size={14} aria-hidden="true" />
            {m.addLink}
          </Button>
        </div>
      </Panel>

      <div className="grid gap-3.5 lg:grid-cols-2">
        <Panel>
          <PanelHeader title={m.primaryButton} hint={m.primaryButtonHint} />
          <div className="flex flex-col gap-3">
            <Toggle
              checked={s.primary_button.enabled}
              onChange={(v) => set({ primary_button: { ...s.primary_button, enabled: v } })}
              label={m.showButton}
            />
            <Field label={m.label} htmlFor="mn-pb-label">
              <input
                id="mn-pb-label"
                className={inputClass}
                value={s.primary_button.label}
                maxLength={40}
                onChange={(e) =>
                  set({ primary_button: { ...s.primary_button, label: e.target.value } })
                }
              />
            </Field>
            <Field label={m.target} hint={m.targetHint} htmlFor="mn-pb-href">
              <input
                id="mn-pb-href"
                className={cn(inputClass, 'font-mono text-[12px]')}
                value={s.primary_button.href}
                maxLength={300}
                onChange={(e) =>
                  set({ primary_button: { ...s.primary_button, href: e.target.value } })
                }
              />
            </Field>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title={m.bottomNav} hint={m.bottomNavHint} />
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">{m.bottomNav}</legend>
            <div className="grid grid-cols-2 gap-1.5">
              {BOTTOM_NAV_IDS.map((id) => {
                const picked = s.bottom_nav.includes(id)
                return (
                  <label
                    key={id}
                    className={cn(
                      'flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[13px]',
                      picked ? 'border-brand bg-brand-wash text-fg' : 'border-line text-fg-muted',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="accent-brand"
                      checked={picked}
                      disabled={!picked && s.bottom_nav.length >= 4}
                      onChange={() => toggleBottom(id)}
                    />
                    {BOTTOM_NAV_DEFAULTS[id].label}
                  </label>
                )
              })}
            </div>
            <Hint>{m.bottomNavCount.replace('{n}', String(s.bottom_nav.length))}</Hint>
          </fieldset>
        </Panel>
      </div>

      <Panel>
        <PanelHeader title={m.footer} hint={m.footerHint} />
        <div className="grid gap-3 md:grid-cols-2">
          {s.footer.map((column, ci) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional and edited in place
            <div key={ci} className="rounded-md border border-line bg-bg p-3">
              <div className="mb-2 flex items-center gap-2">
                <input
                  aria-label={m.columnTitle}
                  placeholder={m.columnTitle}
                  className={cn(inputClass, 'font-semibold')}
                  value={column.title}
                  maxLength={40}
                  onChange={(e) => setColumn(ci, { title: e.target.value })}
                />
                <button
                  type="button"
                  className={rowButton}
                  aria-label={m.removeColumn}
                  onClick={() => set({ footer: s.footer.filter((_, n) => n !== ci) })}
                >
                  <X size={15} />
                </button>
              </div>
              <div className="flex flex-col gap-1.5">
                {column.links.map((link, li) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and edited in place
                  <div key={li} className="flex items-center gap-1.5">
                    <input
                      aria-label={m.label}
                      placeholder={m.label}
                      className={cn(inputClass, 'w-[130px]')}
                      value={link.label}
                      maxLength={40}
                      onChange={(e) =>
                        setColumn(ci, {
                          links: column.links.map((l, n) =>
                            n === li ? { ...l, label: e.target.value } : l,
                          ),
                        })
                      }
                    />
                    <input
                      aria-label={m.target}
                      placeholder="/browse"
                      className={cn(inputClass, 'min-w-0 flex-1 font-mono text-[12px]')}
                      value={link.href}
                      maxLength={300}
                      onChange={(e) =>
                        setColumn(ci, {
                          links: column.links.map((l, n) =>
                            n === li ? { ...l, href: e.target.value } : l,
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      className={rowButton}
                      aria-label={m.moveUp}
                      disabled={li === 0}
                      onClick={() => setColumn(ci, { links: move(column.links, li, li - 1) })}
                    >
                      <ChevronUp size={15} />
                    </button>
                    <button
                      type="button"
                      className={rowButton}
                      aria-label={m.removeRow}
                      onClick={() =>
                        setColumn(ci, { links: column.links.filter((_, n) => n !== li) })
                      }
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  disabled={column.links.length >= 12}
                  onClick={() =>
                    setColumn(ci, { links: [...column.links, { label: '', href: '/' }] })
                  }
                >
                  <Plus size={14} aria-hidden="true" />
                  {m.addLink}
                </Button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={s.footer.length >= 4}
            onClick={() => set({ footer: [...s.footer, { title: '', links: [] }] })}
          >
            <Plus size={14} aria-hidden="true" />
            {m.addColumn}
          </Button>
          {s.footer.length >= 4 ? <Hint>{m.columnLimit}</Hint> : null}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title={m.community} hint={m.communityHint} />
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={m.discord} htmlFor="mn-discord">
            <input
              id="mn-discord"
              className={cn(inputClass, 'font-mono text-[12px]')}
              placeholder="https://discord.gg/…"
              value={s.community.discord_url ?? ''}
              onChange={(e) =>
                set({ community: { ...s.community, discord_url: e.target.value || null } })
              }
            />
          </Field>
          {SOCIAL_NETWORKS.map((network) => (
            <Field key={network} label={SOCIAL_LABELS[network]} htmlFor={`mn-${network}`}>
              <input
                id={`mn-${network}`}
                className={cn(inputClass, 'font-mono text-[12px]')}
                value={s.community.socials[network] ?? ''}
                onChange={(e) =>
                  set({
                    community: {
                      ...s.community,
                      socials: { ...s.community.socials, [network]: e.target.value || null },
                    },
                  })
                }
              />
            </Field>
          ))}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Hint>{m.support}</Hint>
          </div>
          {SUPPORT_NETWORKS.map((network) => (
            <Field key={network} label={SUPPORT_LABELS[network]} htmlFor={`mn-${network}`}>
              <input
                id={`mn-${network}`}
                className={cn(inputClass, 'font-mono text-[12px]')}
                value={s.community.support[network] ?? ''}
                onChange={(e) =>
                  set({
                    community: {
                      ...s.community,
                      support: { ...s.community.support, [network]: e.target.value || null },
                    },
                  })
                }
              />
            </Field>
          ))}
        </div>
        <div className="mt-4">
          {/* `Toggle` renders "On"/"Off" beside the switch and puts the label on `aria-label`,
              so a switch with no heading over it needs its name written out here. */}
          <div className="flex items-center gap-3">
            <Toggle
              checked={s.community.rss}
              onChange={(v) => set({ community: { ...s.community, rss: v } })}
              ariaLabel={m.rss}
            />
            <span className="text-[13px] font-semibold">{m.rss}</span>
          </div>
          <Hint className="mt-1">{m.rssHint}</Hint>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title={m.legal} />
        <div className="flex flex-col gap-3">
          <Field label={m.copyright} htmlFor="mn-copy">
            <input
              id="mn-copy"
              className={inputClass}
              value={s.copyright}
              maxLength={300}
              onChange={(e) => set({ copyright: e.target.value })}
            />
          </Field>
          <Field label={m.attribution} hint={m.attributionHint} htmlFor="mn-attr">
            <input
              id="mn-attr"
              className={inputClass}
              value={s.attribution ?? ''}
              maxLength={300}
              onChange={(e) => set({ attribution: e.target.value || null })}
            />
          </Field>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title={m.announcement} hint={m.announcementHint} />
        <div className="flex flex-col gap-3">
          <Toggle
            checked={s.announcement.enabled}
            onChange={(v) => set({ announcement: { ...s.announcement, enabled: v } })}
            label={adminMessages.admin.enabled}
          />
          <Field label={m.announcementText} hint={m.announcementTextHint} htmlFor="mn-ann">
            <input
              id="mn-ann"
              className={inputClass}
              value={s.announcement.text}
              maxLength={300}
              onChange={(e) => set({ announcement: { ...s.announcement, text: e.target.value } })}
            />
          </Field>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label={m.tone} htmlFor="mn-tone">
              <select
                id="mn-tone"
                className={selectClass}
                value={s.announcement.tone}
                onChange={(e) =>
                  set({
                    announcement: {
                      ...s.announcement,
                      tone: e.target.value as MenusSetting['announcement']['tone'],
                    },
                  })
                }
              >
                {(['info', 'warning', 'promo'] as const).map((t) => (
                  <option key={t} value={t}>
                    {m.tones[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={m.startsAt} htmlFor="mn-start">
              <input
                id="mn-start"
                type="datetime-local"
                className={inputClass}
                value={toLocalInput(s.announcement.starts_at)}
                onChange={(e) =>
                  set({
                    announcement: {
                      ...s.announcement,
                      starts_at: fromLocalInput(e.target.value),
                    },
                  })
                }
              />
            </Field>
            <Field label={m.endsAt} hint={m.scheduleHint} htmlFor="mn-end">
              <input
                id="mn-end"
                type="datetime-local"
                className={inputClass}
                value={toLocalInput(s.announcement.ends_at)}
                onChange={(e) =>
                  set({
                    announcement: { ...s.announcement, ends_at: fromLocalInput(e.target.value) },
                  })
                }
              />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={m.audience} hint={m.audienceHint} htmlFor="mn-aud">
              <select
                id="mn-aud"
                className={selectClass}
                value={s.announcement.audience}
                onChange={(e) =>
                  set({
                    announcement: {
                      ...s.announcement,
                      audience: e.target.value as MenusSetting['announcement']['audience'],
                    },
                  })
                }
              >
                {(['everyone', 'guests', 'members'] as const).map((a) => (
                  <option key={a} value={a}>
                    {m.audiences[a]}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex flex-col gap-1 pt-5">
              <div className="flex items-center gap-3">
                <Toggle
                  checked={s.announcement.dismissible}
                  onChange={(v) => set({ announcement: { ...s.announcement, dismissible: v } })}
                  ariaLabel={m.dismissible}
                />
                <span className="text-[13px] font-semibold">{m.dismissible}</span>
              </div>
              <Hint>{m.dismissibleHint}</Hint>
            </div>
          </div>
          <div>
            <Hint className="mb-1.5">{m.barPreview}</Hint>
            {/* Rendered through the same grammar the site uses, so the operator sees the bar
                rather than the markup they typed. */}
            <div
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-[13px]',
                s.announcement.tone === 'warning'
                  ? 'bg-warn/15 text-fg'
                  : s.announcement.tone === 'promo'
                    ? 'bg-brand text-brand-ink'
                    : 'bg-brand-wash text-fg',
              )}
            >
              {s.announcement.text
                ? parseInline(s.announcement.text).map((node, i) => {
                    const key = `${node.kind}-${i}`
                    if (node.kind === 'strong') return <strong key={key}>{node.text}</strong>
                    if (node.kind === 'em') return <em key={key}>{node.text}</em>
                    if (node.kind === 'link')
                      return (
                        <span key={key} className="underline underline-offset-2">
                          {node.text}
                        </span>
                      )
                    return <span key={key}>{node.text}</span>
                  })
                : adminMessages.admin.none}
            </div>
          </div>
        </div>
      </Panel>
    </div>
  )
}
