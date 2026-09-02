'use client'

import { fmt, messages } from '@palscans/core/messages'
import { cn, useToast } from '@palscans/ui'
import { useCallback, useMemo, useState } from 'react'
import { putJson } from '@/components/admin/client/api'
import { SaveBar } from '@/components/admin/client/controls'
import { SEO_KEYS, type SeoKey } from '@/lib/seo/keys'
import type { SeoSettings } from '@/lib/seo/settings'
import { FeedsPanel, IdentityPanel, IndexingPanel, RobotsPanel, VerificationPanel } from './panels'
import { RedirectsPanel } from './redirects'
import type { SeoAdminInitial } from './shared'
import { SitemapPanel } from './SitemapPanel'
import { TemplatesPanel } from './templates'
import { ToolsPanel } from './tools'

type Tab = keyof typeof messages.adminSeo.tabs
const TABS = Object.keys(messages.adminSeo.tabs) as Tab[]

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * The SEO screen: one draft of every seo_settings row, the top-bar Save writes each dirty
 * key through PUT /api/admin/seo/settings, then the read caches are purged server-side.
 */
export function SeoAdmin({ initial }: { initial: SeoAdminInitial }) {
  const [saved, setSaved] = useState<SeoSettings>(initial.settings)
  const [draft, setDraft] = useState<SeoSettings>(initial.settings)
  const [tab, setTab] = useState<Tab>('identity')
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  const dirtyKeys = useMemo(() => SEO_KEYS.filter((k) => !same(saved[k], draft[k])), [saved, draft])

  const patch = useCallback(<K extends SeoKey>(key: K, value: Partial<SeoSettings[K]>) => {
    setDraft((d) => ({ ...d, [key]: { ...d[key], ...value } }))
  }, [])

  const save = async () => {
    setSaving(true)
    const next = { ...saved }
    let failed: string | null = null
    for (const key of dirtyKeys) {
      const res = await putJson<{ key: SeoKey; value: SeoSettings[SeoKey] }>(
        '/api/admin/seo/settings',
        { key, value: draft[key] },
      )
      if (res.ok) {
        ;(next as Record<SeoKey, unknown>)[key] = res.data.value
      } else {
        failed = res.message || res.error
        break
      }
    }
    setSaved(next)
    setSaving(false)
    if (failed) toast({ title: messages.adminSeo.saveFailed, description: failed, tone: 'danger' })
    else toast({ title: messages.adminSeo.saved, tone: 'ok' })
  }

  return (
    <>
      <SaveBar
        dirty={dirtyKeys.length > 0}
        saving={saving}
        onSave={save}
        onDiscard={() => setDraft(saved)}
      />

      <nav aria-label={messages.adminSeo.title} className="-mx-1 overflow-x-auto">
        <ul className="flex min-w-max gap-1 px-1">
          {TABS.map((t) => (
            <li key={t}>
              <button
                type="button"
                onClick={() => setTab(t)}
                aria-current={tab === t ? 'page' : undefined}
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold transition-colors',
                  tab === t
                    ? 'bg-brand-wash text-fg'
                    : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                )}
              >
                {messages.adminSeo.tabs[t]}
                {dirtyKeys.includes(t as SeoKey) ? (
                  <span className="size-1.5 rounded-full bg-gold" title={messages.admin.unsaved} />
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {tab === 'identity' ? (
        <IdentityPanel value={draft.identity} onChange={(v) => patch('identity', v)} />
      ) : null}
      {tab === 'templates' ? (
        <TemplatesPanel
          value={draft.templates}
          onChange={(v) => patch('templates', v)}
          series={initial.series}
          siteName={draft.identity.site_name}
        />
      ) : null}
      {tab === 'verification' ? (
        <VerificationPanel value={draft.verification} onChange={(v) => patch('verification', v)} />
      ) : null}
      {tab === 'sitemap' ? (
        <SitemapPanel
          value={draft.sitemap}
          onChange={(v) => patch('sitemap', v)}
          builds={initial.builds}
          indexNow={initial.indexNow}
          origin={initial.origin}
          chaptersIndexed={draft.indexing.chapters}
        />
      ) : null}
      {tab === 'feeds' ? (
        <FeedsPanel
          value={draft.feeds}
          onChange={(v) => patch('feeds', v)}
          origin={initial.origin}
        />
      ) : null}
      {tab === 'indexing' ? (
        <IndexingPanel value={draft.indexing} onChange={(v) => patch('indexing', v)} />
      ) : null}
      {tab === 'redirects' ? <RedirectsPanel initial={initial.redirects} /> : null}
      {tab === 'robots' ? (
        <RobotsPanel
          value={draft.robots}
          onChange={(v) => patch('robots', v)}
          settings={draft}
          origin={initial.origin}
        />
      ) : null}
      {tab === 'tools' ? <ToolsPanel origin={initial.origin} series={initial.series} /> : null}

      {dirtyKeys.length > 0 ? (
        <p className="text-[12.5px] text-fg-muted">
          {fmt(messages.admin.selected, { n: dirtyKeys.length })} · {messages.admin.cachePurged}
        </p>
      ) : null}
    </>
  )
}
