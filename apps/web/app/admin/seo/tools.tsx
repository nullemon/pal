'use client'

import { fmt, messages } from '@palscans/core/messages'
import { Button } from '@palscans/ui'
import { useId, useState } from 'react'
import { postJson } from '@/components/admin/client/api'
import { Field, inputClass, Panel, PanelHeader, Pill } from '@/components/admin/ui'
import type { JsonLdIssue } from '@/lib/seo/jsonld'

const m = messages.adminSeo.tools

interface ValidateResult {
  url: string
  blocks: number
  types: string[]
  ok: boolean
  issues: JsonLdIssue[]
  jsonld: unknown[]
}

export function ToolsPanel({
  origin,
  series,
}: {
  origin: string
  series: { id: number; slug: string; title: string }[]
}) {
  const id = useId()
  const [url, setUrl] = useState(series[0] ? `/series/${series[0].slug}` : '/')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ValidateResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setBusy(true)
    setError(null)
    const res = await postJson<ValidateResult>('/api/admin/seo/validate', { url })
    setBusy(false)
    if (res.ok) setResult(res.data)
    else {
      setResult(null)
      setError(res.error === 'same_origin_only' ? m.sameOriginOnly : res.message || m.fetchFailed)
    }
  }

  return (
    <Panel>
      <PanelHeader title={m.title} hint={m.hint} />
      <div className="flex flex-col gap-2 md:flex-row md:items-end">
        <Field label={m.url} htmlFor={`${id}-url`} className="flex-1">
          <input
            id={`${id}-url`}
            className={`${inputClass} font-mono`}
            value={url}
            placeholder={`${origin}/series/…`}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run()
            }}
          />
        </Field>
        <Button onClick={run} disabled={busy || !url.trim()}>
          {busy ? m.validating : m.validate}
        </Button>
      </div>
      {error ? <p className="mt-3 text-[13px] text-danger">{error}</p> : null}
      {result ? (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            {result.blocks === 0 ? (
              <Pill tone="warn">{m.noJsonLd}</Pill>
            ) : result.ok ? (
              <Pill tone="ok">{fmt(m.valid, { n: result.types.length })}</Pill>
            ) : (
              <Pill tone="danger">{fmt(m.invalid, { n: result.issues.length })}</Pill>
            )}
            <span className="font-mono text-[12px] text-fg-muted">{result.url}</span>
          </div>
          {result.types.length ? (
            <div className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-fg-muted">{m.types}</span>
              <ul className="flex flex-wrap gap-1.5">
                {result.types.map((t) => (
                  <li key={t}>
                    <Pill tone="brand">{t}</Pill>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {result.issues.length ? (
            <div className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-fg-muted">{m.issues}</span>
              <ul className="flex flex-col gap-1 text-[13px]">
                {result.issues.map((i) => (
                  <li key={`${i.type}-${i.field}-${i.message}`} className="flex gap-2">
                    <Pill tone="danger">{i.type}</Pill>
                    <span className="text-fg-muted">{i.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {result.jsonld.length ? (
            <pre className="max-h-[420px] overflow-auto rounded-md border border-line bg-bg p-3 font-mono text-[11.5px] leading-4 text-fg-muted">
              {JSON.stringify(result.jsonld, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </Panel>
  )
}
