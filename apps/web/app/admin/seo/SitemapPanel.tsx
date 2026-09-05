'use client'

import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button, useToast } from '@palscans/ui'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { useId, useState } from 'react'
import { postJson } from '@/components/admin/client/api'
import {
  EmptyRow,
  Field,
  Hint,
  inputClass,
  Num,
  Panel,
  PanelHeader,
  Pill,
  Table,
  Td,
  Th,
} from '@/components/admin/ui'
import type { SitemapBuildView } from '@/lib/seo/admin-data'
import { generateIndexNowKey } from '@/lib/seo/indexnow'
import { SITEMAP_SECTIONS, type SitemapSection } from '@/lib/seo/keys'
import type { SeoSitemap } from '@/lib/seo/settings'
import type { IndexNowLog } from '@/lib/seo/sitemaps'
import { bytes, FormGrid, Iso, numberValue, SwitchRow } from './shared'

const m = adminMessages.adminSeo.sitemap

export function SitemapPanel({
  value,
  onChange,
  builds: initialBuilds,
  indexNow: initialIndexNow,
  origin,
  chaptersIndexed,
}: {
  value: SeoSitemap
  onChange: (v: Partial<SeoSitemap>) => void
  builds: SitemapBuildView[]
  indexNow: IndexNowLog | null
  origin: string
  chaptersIndexed: boolean
}) {
  const id = useId()
  const { toast } = useToast()
  const [builds, setBuilds] = useState(initialBuilds)
  const [indexNow, setIndexNow] = useState(initialIndexNow)
  const [building, setBuilding] = useState(false)
  const last = builds[0] ?? null

  const rebuild = async () => {
    setBuilding(true)
    const res = await postJson<{ builds: SitemapBuildView[]; indexNow: IndexNowLog | null }>(
      '/api/admin/seo/sitemaps',
      {},
    )
    setBuilding(false)
    if (res.ok) {
      setBuilds(res.data.builds)
      setIndexNow(res.data.indexNow)
      const b = res.data.builds[0]
      if (b?.error) toast({ title: m.failed, description: b.error, tone: 'danger' })
      else toast({ title: m.ok, description: fmt(m.fileUrls, { n: b?.urlCount ?? 0 }), tone: 'ok' })
    } else toast({ title: m.failed, description: res.message || res.error, tone: 'danger' })
  }

  const toggleSection = (s: SitemapSection, on: boolean) =>
    onChange({
      sections: on ? [...new Set([...value.sections, s])] : value.sections.filter((x) => x !== s),
    })

  return (
    <>
      <Panel>
        <PanelHeader
          title={m.title}
          hint={m.hint}
          aside={
            <a
              href={`${origin}/sitemap.xml`}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1 text-fg-muted hover:text-fg"
            >
              {m.openIndex}
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          }
        />
        <SwitchRow
          label={m.enabled}
          hint={m.enabledHint}
          checked={value.enabled}
          onChange={(enabled) => onChange({ enabled })}
        />
        <SwitchRow
          label={m.includeUnlisted}
          checked={value.include_unlisted}
          onChange={(include_unlisted) => onChange({ include_unlisted })}
        />
        <FormGrid className="mt-4">
          <Field label={m.customUrl} hint={m.customUrlHint} htmlFor={`${id}-url`}>
            <input
              id={`${id}-url`}
              className={inputClass}
              type="url"
              value={value.custom_url ?? ''}
              placeholder="https://cdn.example.com/sitemap.xml"
              onChange={(e) => onChange({ custom_url: e.target.value || null })}
            />
          </Field>
          <Field label={m.chaptersPerFile} htmlFor={`${id}-per`}>
            <input
              id={`${id}-per`}
              className={inputClass}
              type="number"
              min={100}
              max={50000}
              step={100}
              value={value.chapters_per_file}
              onChange={(e) => onChange({ chapters_per_file: numberValue(e.target.value, 20000) })}
            />
          </Field>
          <Field label={m.sections} className="md:col-span-2">
            <div className="flex flex-wrap gap-2">
              {SITEMAP_SECTIONS.map((s) => {
                const on = value.sections.includes(s)
                const disabled = s === 'chapters' && !chaptersIndexed
                return (
                  <label
                    key={s}
                    className={`inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border px-2.5 text-[13px] ${
                      on ? 'border-brand bg-brand-wash text-fg' : 'border-line bg-bg text-fg-muted'
                    } ${disabled ? 'opacity-50' : ''}`}
                  >
                    <input
                      type="checkbox"
                      className="accent-brand"
                      checked={on}
                      disabled={disabled}
                      onChange={(e) => toggleSection(s, e.target.checked)}
                    />
                    {m.sectionLabels[s]}
                  </label>
                )
              })}
            </div>
            {!chaptersIndexed ? (
              <Hint className="mt-1">{adminMessages.adminSeo.indexing.chaptersHint}</Hint>
            ) : null}
          </Field>
          <Field label={m.indexNowKey} hint={m.indexNowKeyHint} htmlFor={`${id}-key`}>
            <div className="flex gap-2">
              <input
                id={`${id}-key`}
                className={`${inputClass} font-mono`}
                value={value.indexnow_key ?? ''}
                spellCheck={false}
                onChange={(e) => onChange({ indexnow_key: e.target.value || null })}
              />
              <Button
                variant="outline"
                size="md"
                onClick={() => onChange({ indexnow_key: generateIndexNowKey() })}
              >
                {m.generateKey}
              </Button>
            </div>
          </Field>
        </FormGrid>
      </Panel>

      <Panel>
        <PanelHeader
          title={m.buildLog}
          hint={
            last
              ? `${m.lastBuild}: ${last.finishedAt?.slice(0, 16).replace('T', ' ') ?? m.running} · ${fmt(m.fileUrls, { n: last.urlCount })}`
              : m.noBuilds
          }
          aside={
            <Button size="sm" onClick={rebuild} disabled={building}>
              <RefreshCw
                size={14}
                aria-hidden="true"
                className={building ? 'animate-spin' : undefined}
              />
              {building ? m.regenerating : m.regenerate}
            </Button>
          }
        />
        {last && !last.error ? (
          <ul className="mb-3 flex flex-wrap gap-1.5">
            {last.files.map((f) => (
              <li
                key={f.name}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-bg px-2 text-[12px] text-fg-muted"
              >
                <a href={`${origin}/sitemaps/${f.name}`} className="font-mono hover:text-fg">
                  {f.name}
                </a>
                <Num className="text-fg">{f.urls}</Num>
                <span className="text-fg-subtle">{bytes(f.bytes)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <Table>
          <thead>
            <tr>
              <Th>{m.colStarted}</Th>
              <Th>{m.colKind}</Th>
              <Th align="right">{m.colUrls}</Th>
              <Th align="right">{m.colFiles}</Th>
              <Th>{m.colStatus}</Th>
            </tr>
          </thead>
          <tbody>
            {builds.length === 0 ? <EmptyRow colSpan={5}>{m.noBuilds}</EmptyRow> : null}
            {builds.map((b) => (
              <tr key={b.id}>
                <Td>
                  <Iso value={b.startedAt} />
                </Td>
                <Td>{b.kind === 'full' ? m.full : m.incremental}</Td>
                <Td align="right">
                  <Num>{b.urlCount}</Num>
                </Td>
                <Td align="right">
                  <Num>{b.files.length}</Num>
                </Td>
                <Td>
                  {b.error ? (
                    <span className="inline-flex items-center gap-2">
                      <Pill tone="danger">{m.failed}</Pill>
                      <span className="max-w-[320px] truncate text-fg-muted" title={b.error}>
                        {b.error}
                      </span>
                    </span>
                  ) : b.finishedAt ? (
                    <Pill tone="ok">{m.ok}</Pill>
                  ) : (
                    <Pill tone="gold">{m.running}</Pill>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="mt-3 text-[12.5px] text-fg-muted">
          {m.indexNow}:{' '}
          {indexNow ? (
            <>
              <Iso value={indexNow.at} /> · <Num>{indexNow.submitted}</Num> URLs ·{' '}
              {indexNow.ok ? (
                <Pill tone="ok">{indexNow.status ?? m.ok}</Pill>
              ) : (
                <Pill tone="danger">{indexNow.error ?? indexNow.status ?? m.failed}</Pill>
              )}
            </>
          ) : (
            m.indexNowNone
          )}
        </p>
      </Panel>
    </>
  )
}
