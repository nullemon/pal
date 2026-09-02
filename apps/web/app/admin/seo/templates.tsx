'use client'

import { fmt, messages } from '@palscans/core/messages'
import { Button, cn } from '@palscans/ui'
import { useEffect, useId, useState } from 'react'
import { postJson } from '@/components/admin/client/api'
import {
  Field,
  inputClass,
  Panel,
  PanelHeader,
  selectClass,
  textareaClass,
} from '@/components/admin/ui'
import type { TemplatePreview } from '@/lib/seo/admin-data'
import type { SeoTemplates } from '@/lib/seo/settings'

const m = messages.adminSeo.templates
const PAGES = Object.keys(m.pages) as (keyof SeoTemplates)[]
const VARS =
  '{site} {title} {type} {chapter} {chapter_count} {latest_chapter} {genres} {author} {year} {synopsis:N} {genre} {count} {intro:N} {excerpt:N} {next_prev_hint}'
const TITLE_MAX = 60
const DESC_MAX = 160

const DEFAULTS: SeoTemplates = {
  home: {
    title: '{site} — Read Manhwa, Manga and Manhua Online',
    description:
      'Read the latest manhwa, manga and manhua chapters on {site}, updated daily. Free, fast, mobile-friendly.',
  },
  series: {
    title: '{title} — Read Online Free · {site}',
    description:
      'Read {title} {type} online. {chapter_count} chapters, latest {latest_chapter}. {synopsis:160}',
  },
  chapter: {
    title: '{title} Chapter {chapter} · {site}',
    description: 'Read {title} Chapter {chapter} online free at {site}. {next_prev_hint}',
  },
  genre: {
    title: '{genre} Manhwa & Manga — Read Online · {site}',
    description: 'Browse {count} {genre} series on {site}. {intro:160}',
  },
  rankings: {
    title: 'Top Manhwa & Manga This Week · {site}',
    description: 'The most-read manhwa, manga and manhua on {site} this week, month and all time.',
  },
  announcement: { title: '{title} · {site}', description: '{excerpt:160}' },
}

function Count({ n, max }: { n: number; max: number }) {
  return (
    <span className={cn('text-[11px] tabular-nums', n > max ? 'text-warn' : 'text-fg-subtle')}>
      {fmt(m.characters, { n })}
      {n > max ? ` · ${fmt(m.tooLong, { max })}` : ''}
    </span>
  )
}

/** A Google-result style card for one rendered template. */
function ResultCard({ preview }: { preview: TemplatePreview }) {
  return (
    <div className="rounded-md border border-line bg-bg p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-subtle">
        {m.pages[preview.page]}
      </div>
      <div className="mt-1 truncate text-[12px] text-fg-muted">{preview.url}</div>
      <div className="mt-0.5 text-[16px] font-semibold leading-[22px] text-brand-hover">
        {preview.title || '—'}
      </div>
      <p className="mt-0.5 line-clamp-2 text-[13px] leading-[18px] text-fg-muted">
        {preview.description || '—'}
      </p>
      <div className="mt-1 flex gap-3">
        <Count n={preview.title.length} max={TITLE_MAX} />
        <Count n={preview.description.length} max={DESC_MAX} />
      </div>
    </div>
  )
}

export function TemplatesPanel({
  value,
  onChange,
  series,
  siteName,
}: {
  value: SeoTemplates
  onChange: (v: Partial<SeoTemplates>) => void
  series: { id: number; slug: string; title: string }[]
  siteName: string
}) {
  const id = useId()
  const [slug, setSlug] = useState(series[0]?.slug ?? '')
  const [previews, setPreviews] = useState<TemplatePreview[]>([])
  const [loading, setLoading] = useState(false)

  const key = JSON.stringify(value)
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      setLoading(true)
      const res = await postJson<{ previews: TemplatePreview[] }>('/api/admin/seo/preview', {
        slug: slug || undefined,
        templates: JSON.parse(key) as SeoTemplates,
      })
      if (!cancelled) {
        if (res.ok) setPreviews(res.data.previews)
        setLoading(false)
      }
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [key, slug])

  return (
    <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Panel>
        <PanelHeader title={m.title} hint={fmt(m.hint, { vars: VARS })} />
        <div className="flex flex-col gap-5">
          {PAGES.map((page) => (
            <fieldset
              key={page}
              className="flex flex-col gap-2 border-t border-line-soft pt-4 first:border-t-0 first:pt-0"
            >
              <div className="flex items-center justify-between">
                <legend className="text-[13.5px] font-bold text-fg">{m.pages[page]}</legend>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onChange({ [page]: DEFAULTS[page] })}
                >
                  {m.reset}
                </Button>
              </div>
              <Field label={m.pageTitle} htmlFor={`${id}-${page}-t`}>
                <input
                  id={`${id}-${page}-t`}
                  className={inputClass}
                  value={value[page].title}
                  onChange={(e) => onChange({ [page]: { ...value[page], title: e.target.value } })}
                />
              </Field>
              <Field label={m.pageDescription} htmlFor={`${id}-${page}-d`}>
                <textarea
                  id={`${id}-${page}-d`}
                  rows={2}
                  className={textareaClass}
                  value={value[page].description}
                  onChange={(e) =>
                    onChange({ [page]: { ...value[page], description: e.target.value } })
                  }
                />
              </Field>
            </fieldset>
          ))}
        </div>
      </Panel>

      <Panel className="xl:sticky xl:top-[76px] xl:self-start">
        <PanelHeader title={m.preview} aside={loading ? <span>{m.previewLoading}</span> : null} />
        <Field label={m.previewSeries} htmlFor={`${id}-series`} className="mb-3">
          <select
            id={`${id}-series`}
            className={selectClass}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          >
            {series.map((s) => (
              <option key={s.id} value={s.slug}>
                {s.title}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex flex-col gap-2">
          {previews.length === 0 && !loading ? (
            <p className="text-[13px] text-fg-muted">{siteName}</p>
          ) : null}
          {previews.map((p) => (
            <ResultCard key={p.page} preview={p} />
          ))}
        </div>
      </Panel>
    </div>
  )
}
