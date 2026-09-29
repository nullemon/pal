import { DEFAULT_SEO_TEMPLATES, TEMPLATE_VARIABLES } from '@palscans/core'

;('use client')

import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
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

const m = adminMessages.adminSeo.templates
const PAGES = Object.keys(m.pages) as (keyof SeoTemplates)[]
// Built from the exported list rather than retyped, so a variable added to the renderer can
// never be one an operator has no way to discover. `{sep}` and `{chapter_label}` were both
// missing from the hand-written version this replaces.
const LENGTH_VARS = new Set<string>(['synopsis', 'intro', 'excerpt'])
const VARS = TEMPLATE_VARIABLES.map((v) => (LENGTH_VARS.has(v) ? `{${v}:N}` : `{${v}}`)).join(' ')
const TITLE_MAX = 60
const DESC_MAX = 160

// The placeholders shown under each field are the defaults the site actually renders. This
// was a second, hand-maintained copy, and it had drifted: it hardcoded `·` and `—` where the
// real templates use `{sep}`, so the screen advertised a separator the operator could not
// change and hid the variable that changes it.
const DEFAULTS: SeoTemplates = DEFAULT_SEO_TEMPLATES

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
