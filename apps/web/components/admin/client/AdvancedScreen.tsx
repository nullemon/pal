'use client'

import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { cn, useToast } from '@palscans/ui'
import { CircleAlert, Info, ShieldAlert, TriangleAlert } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import {
  type CheckResult,
  CSS_MAX_LENGTH,
  type Problem,
  reviewAdvanced,
  SNIPPET_MAX_LENGTH,
} from '@/lib/appearance/advanced'
import type { AdvancedDoc } from '@/lib/appearance/schema'
import { Hint, Panel, PanelHeader, textareaClass } from '../ui'
import { putJson } from './api'
import { SaveBar, Toggle } from './controls'

const m = adminMessages.advancedScreen

type CssCode = keyof typeof m.css
type HtmlCode = keyof typeof m.html

/**
 * Admin → Appearance → Advanced (docs/15 "Advanced").
 *
 * Three boxes, one switch, and the reasons written next to them. The checks run as you type
 * and Save is held back while anything is refused — the API runs the same checks again, so
 * this is a courtesy rather than the control, but it is the difference between "fix line 12"
 * and a 422 after the fact.
 *
 * Everything the operator needs in order to trust or distrust the feature is on the page:
 * that the panel never renders any of this, that a save is live, where the snippets actually
 * land in the document, whether a CSP will block them, and which off-site hosts the snippets
 * would call. A box that silently does nothing is the worst version of this feature.
 */
export function AdvancedScreen({ initial }: { initial: AdvancedDoc }) {
  const { toast } = useToast()
  const [saved, setSaved] = useState<AdvancedDoc>(initial)
  const [draft, setDraft] = useState<AdvancedDoc>(initial)
  const [saving, setSaving] = useState(false)

  // The same function the route decides with, so "Save is disabled" and "the API refused"
  // can never disagree about why.
  const review = useMemo(() => reviewAdvanced(draft), [draft])
  const { css, head_html: head, footer_html: footer, hosts } = review

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const blocked = review.refusal !== null

  const set = <K extends keyof AdvancedDoc>(key: K, value: AdvancedDoc[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const save = async () => {
    setSaving(true)
    const res = await putJson<{ advanced: AdvancedDoc }>('/api/admin/appearance/advanced', draft)
    setSaving(false)
    if (!res.ok) {
      toast({ title: adminMessages.admin.errorSaving, description: res.message, tone: 'danger' })
      return
    }
    setSaved(res.data.advanced)
    setDraft(res.data.advanced)
    toast({ title: res.data.advanced.enabled ? m.saved : m.savedOff, tone: 'ok' })
  }

  return (
    <div className="flex flex-col gap-3.5">
      <SaveBar
        dirty={dirty}
        canSave={!blocked}
        saving={saving}
        onDiscard={() => setDraft(saved)}
        onSave={() => void save()}
      />

      <Panel>
        <PanelHeader title={m.gateTitle} />
        <div className="flex items-start gap-2.5 text-[13px] leading-[18px] text-fg-muted">
          <ShieldAlert size={16} aria-hidden="true" className="mt-px shrink-0 text-gold" />
          <p>{m.gateBody}</p>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title={draft.enabled ? m.enabledTitle : m.disabledTitle}
          hint={m.enabledHint}
          aside={
            <Toggle
              checked={draft.enabled}
              onChange={(v) => set('enabled', v)}
              ariaLabel={draft.enabled ? m.enabledTitle : m.disabledTitle}
              label={m.enabledTitle}
            />
          }
        />
      </Panel>

      <CodeBox
        title={m.cssTitle}
        hint={m.cssHint}
        label={m.cssLabel}
        placeholder={m.cssPlaceholder}
        value={draft.css}
        max={CSS_MAX_LENGTH}
        rows={12}
        onChange={(v) => set('css', v)}
        result={css}
        describe={(p) =>
          fmt(m.css[p.code as CssCode], {
            line: p.line,
            detail: p.detail ?? '',
            max: CSS_MAX_LENGTH,
          })
        }
      />

      <Panel>
        <PanelHeader title={m.cspTitle} />
        <div className="flex flex-col gap-2.5">
          <div className="flex items-start gap-2.5 text-[13px] leading-[18px] text-fg-muted">
            <Info size={16} aria-hidden="true" className="mt-px shrink-0 text-fg-subtle" />
            <div className="flex flex-col gap-2">
              <p>{m.cspYes}</p>
              <p>{m.cspLimits}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-fg-muted">
            <span className="font-semibold text-fg">{m.hostsLabel}:</span>
            {hosts.length === 0 ? (
              <span>{m.hostsNone}</span>
            ) : (
              hosts.map((h) => (
                <code
                  key={h}
                  className="rounded-full border border-line bg-surface-2 px-2 py-0.5 font-mono text-[12px] text-fg"
                >
                  {h}
                </code>
              ))
            )}
          </div>
        </div>
      </Panel>

      <CodeBox
        title={m.headTitle}
        hint={m.headHint}
        label={m.headTitle}
        placeholder={m.snippetPlaceholder}
        value={draft.head_html}
        max={SNIPPET_MAX_LENGTH}
        rows={7}
        onChange={(v) => set('head_html', v)}
        result={head}
        note={m.slotNote}
        describe={(p) =>
          fmt(m.html[p.code as HtmlCode], {
            line: p.line,
            detail: p.detail ?? '',
            max: SNIPPET_MAX_LENGTH,
          })
        }
      />

      <CodeBox
        title={m.footerTitle}
        hint={m.footerHint}
        label={m.footerTitle}
        placeholder={m.snippetPlaceholder}
        value={draft.footer_html}
        max={SNIPPET_MAX_LENGTH}
        rows={7}
        onChange={(v) => set('footer_html', v)}
        result={footer}
        describe={(p) =>
          fmt(m.html[p.code as HtmlCode], {
            line: p.line,
            detail: p.detail ?? '',
            max: SNIPPET_MAX_LENGTH,
          })
        }
      />

      <Panel>
        <PanelHeader title={m.recoveryTitle} />
        <ul className="flex list-disc flex-col gap-1.5 pl-4 text-[13px] leading-[18px] text-fg-muted">
          <li>{m.recoveryAdmin}</li>
          <li>{m.recoverySwitch}</li>
          <li>{m.recoveryNoPreview}</li>
          <li>{m.recoveryAudit}</li>
        </ul>
      </Panel>

      <Panel>
        <PanelHeader title={m.rulesTitle} />
        <ul className="flex list-disc flex-col gap-1.5 pl-4 text-[13px] leading-[18px] text-fg-muted">
          <li>{m.rulesCss}</li>
          <li>{m.rulesHtml}</li>
        </ul>
      </Panel>
    </div>
  )
}

function CodeBox<Code extends string>({
  title,
  hint,
  label,
  placeholder,
  value,
  max,
  rows,
  onChange,
  result,
  describe,
  note,
}: {
  title: string
  hint: string
  label: string
  placeholder: string
  value: string
  max: number
  rows: number
  onChange: (value: string) => void
  result: CheckResult<Code>
  describe: (problem: Problem<Code>) => string
  note?: string
}) {
  const id = useId()
  const errorId = `${id}-problems`
  const bad = result.errors.length > 0
  return (
    <Panel>
      <PanelHeader
        title={title}
        hint={hint}
        aside={<span>{fmt(m.cssChars, { n: value.length, max })}</span>}
      />
      {note ? <Hint className="mb-2.5">{note}</Hint> : null}
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={bad}
        aria-describedby={result.errors.length || result.warnings.length ? errorId : undefined}
        className={cn(
          textareaClass,
          'font-mono text-[12.5px] leading-[19px]',
          // Never colour alone: an invalid box carries the red border *and* the listed
          // problems below it, each one prefixed with an icon and the line number.
          bad && 'border-danger focus-visible:border-danger',
        )}
      />
      {result.errors.length || result.warnings.length ? (
        <div id={errorId} className="mt-2.5 flex flex-col gap-2">
          {result.errors.length ? (
            <ProblemList
              tone="danger"
              title={m.problemsTitle}
              items={result.errors.map(describe)}
            />
          ) : null}
          {result.warnings.length ? (
            <ProblemList
              tone="warn"
              title={m.warningsTitle}
              items={result.warnings.map(describe)}
            />
          ) : null}
        </div>
      ) : null}
    </Panel>
  )
}

function ProblemList({
  tone,
  title,
  items,
}: {
  tone: 'danger' | 'warn'
  title: string
  items: string[]
}) {
  const Icon = tone === 'danger' ? CircleAlert : TriangleAlert
  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2',
        tone === 'danger' ? 'border-danger/40 bg-danger/10' : 'border-warn/40 bg-warn/10',
      )}
    >
      {/* The label is `text-fg`, not the tone colour: `--color-danger` is 4.4:1 on this tint
          in the dark theme and 3.8:1 in the light one, both under the 4.5:1 text needs. The
          tone is carried by the icon and the border, which are UI and only owe 3:1 — and the
          state is written in words either way, never by colour alone. */}
      <p className="flex items-center gap-1.5 text-[12px] font-bold uppercase leading-4 tracking-[0.06em] text-fg">
        <Icon
          size={13}
          aria-hidden="true"
          className={tone === 'danger' ? 'text-danger' : 'text-warn'}
        />
        {title}
      </p>
      <ul className="mt-1 flex list-disc flex-col gap-1 pl-4 text-[13px] leading-[18px] text-fg">
        {items.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
    </div>
  )
}
