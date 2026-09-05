'use client'

import {
  COPY_ENTRIES,
  COPY_GROUPS,
  type CopyEntry,
  type CopyGroup,
  copyProblem,
  normalizeCopyText,
} from '@palscans/core/copy'
import {
  CHAPTER_LABEL_STYLES,
  CLOCK_FORMATS,
  type FormattingSettings,
  formatChapterLabel,
  formatCount,
  formatStamp,
  NUMBER_FORMATS,
  RELATIVE_TIME_MODES,
  WEEK_STARTS,
} from '@palscans/core/formatting'
import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { useToast } from '@palscans/ui'
import { RotateCcw } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { Field, Hint, inputClass, Panel, PanelHeader, Pill, textareaClass } from '../ui'
import { putJson } from './api'
import { SaveBar, Segmented } from './controls'

const m = adminMessages.copyScreen

/**
 * The shared admin input paints its placeholder `fg-subtle`, which is 4.13:1 on the light
 * theme's page background — under the 4.5:1 this needs. Everywhere else that is fine, because
 * a placeholder there is a hint you can ignore. Here the placeholder *is* the information:
 * it is the shipped wording, and "what does this string say today" has to be readable. So
 * this screen paints it `fg-muted` (7.17:1 light, 10.6:1 dark). Done by substitution rather
 * than by appending a second utility, because two `placeholder:text-*` classes have equal
 * specificity and which one wins is decided by stylesheet order, not by the class attribute.
 */
const withReadablePlaceholder = (cls: string) =>
  cls.replace('placeholder:text-fg-subtle', 'placeholder:text-fg-muted')
const copyInputClass = withReadablePlaceholder(inputClass)
const copyTextareaClass = withReadablePlaceholder(textareaClass)

export interface CopyScreenProps {
  /** Only the strings that differ from the catalogue; everything else opens empty. */
  initialCopy: Record<string, string>
  initialFormatting: FormattingSettings
}

type Draft = { copy: Record<string, string>; formatting: FormattingSettings }

const byGroup = (group: CopyGroup): CopyEntry[] => COPY_ENTRIES.filter((e) => e.group === group)

/** A record with the empty strings dropped, so "reset" and "never touched" compare equal. */
const pruned = (copy: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(copy).filter(([, v]) => v.trim() !== ''))

const label = (id: string) => m.entries[id as keyof typeof m.entries] ?? id
const where = (id: string) => m.where[id as keyof typeof m.where] ?? ''

/**
 * Admin → Appearance → Copy (docs/15 "Copy the operator owns" + "Formatting").
 *
 * One field per editable string. The shipped wording is the field's *placeholder*, never its
 * value, which makes three things true at once: an untouched field is visibly untouched, a
 * changed one is visibly changed, and clearing a field is the reset — the Reset button just
 * does that for you.
 *
 * Problems are shown as you type and the Save button refuses while any remain, because the
 * alternative — saving something the renderer will silently fall back from — is how an
 * operator ends up believing the panel is broken.
 */
export function CopyScreen({ initialCopy, initialFormatting }: CopyScreenProps) {
  const { toast } = useToast()
  const [saved, setSaved] = useState<Draft>({
    copy: initialCopy,
    formatting: initialFormatting,
  })
  const [draft, setDraft] = useState<Draft>({ copy: initialCopy, formatting: initialFormatting })
  const [saving, setSaving] = useState(false)

  const dirty =
    JSON.stringify({ ...draft, copy: pruned(draft.copy) }) !==
    JSON.stringify({ ...saved, copy: pruned(saved.copy) })

  const problems = useMemo(() => {
    const out: Record<string, string> = {}
    for (const [id, text] of Object.entries(draft.copy)) {
      const entry = COPY_ENTRIES.find((e) => e.id === id)
      if (!entry || normalizeCopyText(entry, text) === '') continue
      const problem = copyProblem(id, text)
      if (!problem) continue
      out[id] =
        problem.problem === 'too_long'
          ? fmt(m.tooLong, { max: problem.max ?? entry.max })
          : problem.problem === 'unknown_placeholder'
            ? fmt(m.unknownPlaceholder, { token: `{${problem.token}}` })
            : m.tooLong
    }
    return out
  }, [draft.copy])

  const changedCount = Object.keys(pruned(draft.copy)).length

  const setText = (id: string, value: string) =>
    setDraft((d) => ({ ...d, copy: { ...d.copy, [id]: value } }))

  const save = async () => {
    setSaving(true)
    const body = { copy: pruned(draft.copy), formatting: draft.formatting }
    const res = await putJson<{ copy: Record<string, string>; formatting: FormattingSettings }>(
      '/api/admin/appearance/copy',
      body,
    )
    setSaving(false)
    if (!res.ok) {
      toast({
        title: adminMessages.admin.errorSaving,
        description: res.message,
        tone: 'danger',
      })
      return
    }
    setSaved({ copy: res.data.copy, formatting: res.data.formatting })
    setDraft({ copy: res.data.copy, formatting: res.data.formatting })
    toast({ title: m.saved, tone: 'ok' })
  }

  return (
    <div className="flex flex-col gap-3.5">
      <SaveBar
        dirty={dirty}
        canSave={Object.keys(problems).length === 0}
        saving={saving}
        onDiscard={() => setDraft(saved)}
        onSave={() => void save()}
        status={fmt(m.overriddenCount, { n: changedCount, total: COPY_ENTRIES.length })}
      />

      <FormattingPanel
        value={draft.formatting}
        onChange={(formatting) => setDraft((d) => ({ ...d, formatting }))}
      />

      {COPY_GROUPS.map((group) => (
        <Panel key={group}>
          <PanelHeader title={m.groups[group]} hint={m.groupHints[group]} />
          <div className="flex flex-col gap-4">
            {byGroup(group).map((entry) => (
              <CopyField
                key={entry.id}
                entry={entry}
                value={draft.copy[entry.id] ?? ''}
                problem={problems[entry.id]}
                onChange={(v) => setText(entry.id, v)}
              />
            ))}
          </div>
        </Panel>
      ))}
    </div>
  )
}

function CopyField({
  entry,
  value,
  problem,
  onChange,
}: {
  entry: CopyEntry
  value: string
  problem?: string
  onChange: (value: string) => void
}) {
  const id = useId()
  const errorId = `${id}-error`
  const overridden = value.trim() !== ''
  const tokens = entry.placeholders.map((p) => `{${p}}`).join(', ')
  return (
    <Field
      label={label(entry.id)}
      htmlFor={id}
      // The hint carries where the string lands *and* what it may interpolate: without the
      // first, thirty fields are unreadable; without the second, a placeholder is a trap.
      hint={[where(entry.id), tokens ? fmt(m.placeholdersAllowed, { tokens }) : '']
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex items-start gap-2">
        {entry.multiline ? (
          <textarea
            id={id}
            rows={3}
            value={value}
            maxLength={entry.max * 2}
            placeholder={entry.defaultText}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? errorId : undefined}
            onChange={(e) => onChange(e.target.value)}
            className={`${copyTextareaClass} ${problem ? 'border-danger' : ''}`}
          />
        ) : (
          <input
            id={id}
            type="text"
            value={value}
            maxLength={entry.max * 2}
            placeholder={entry.defaultText}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? errorId : undefined}
            onChange={(e) => onChange(e.target.value)}
            className={`${copyInputClass} ${problem ? 'border-danger' : ''}`}
          />
        )}
        <button
          type="button"
          onClick={() => onChange('')}
          disabled={!overridden}
          aria-label={fmt(m.resetAria, { label: label(entry.id) })}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] font-semibold text-fg-muted transition-colors hover:border-fg-subtle hover:text-fg disabled:opacity-40"
        >
          <RotateCcw size={13} aria-hidden="true" />
          {m.reset}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {/* Never colour alone: the state is a word, the counter is a number. */}
        <Pill tone={overridden ? 'brand' : 'neutral'}>
          {overridden ? m.changed : m.usingDefault}
        </Pill>
        <span
          className={`text-[12px] tabular-nums ${
            value.length > entry.max ? 'font-semibold text-danger' : 'text-fg-muted'
          }`}
        >
          {fmt(m.counter, { n: value.length, max: entry.max })}
        </span>
        {entry.rendered ? null : (
          <span className="text-[12px] font-semibold text-warn">{m.notRendered}</span>
        )}
      </div>
      {problem ? (
        <p id={errorId} className="text-[12px] font-semibold text-danger">
          {problem}
        </p>
      ) : null}
    </Field>
  )
}

const f = m.formatting
/** Two hours ago, so the preview shows a relative phrase that is not "just now". */
const SAMPLE_AGO_MS = 2 * 60 * 60 * 1000

function FormattingPanel({
  value,
  onChange,
}: {
  value: FormattingSettings
  onChange: (next: FormattingSettings) => void
}) {
  // Fixed instant: a preview that ticks makes the two columns disagree mid-read.
  const sample = useMemo(() => new Date(Date.now() - SAMPLE_AGO_MS), [])
  const timePreview =
    value.relativeTimes === 'absolute'
      ? formatStamp(sample, value.clock)
      : `2 hr. ago${value.relativeTimes === 'both' ? ` · ${sample.toISOString().slice(0, 10)}` : ''}`
  return (
    <Panel>
      <PanelHeader title={f.title} hint={f.hint} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={f.relativeTimes} hint={f.relativeTimesHint}>
          <Segmented
            ariaLabel={f.relativeTimes}
            value={value.relativeTimes}
            onChange={(relativeTimes) => onChange({ ...value, relativeTimes })}
            options={RELATIVE_TIME_MODES.map((v) => ({
              value: v,
              label: f.relativeTimesOptions[v],
            }))}
          />
        </Field>
        <Field label={f.clock} hint={f.clockHint}>
          <Segmented
            ariaLabel={f.clock}
            value={value.clock}
            onChange={(clock) => onChange({ ...value, clock })}
            options={CLOCK_FORMATS.map((v) => ({ value: v, label: f.clockOptions[v] }))}
          />
        </Field>
        <Field label={f.numbers} hint={f.numbersHint}>
          <Segmented
            ariaLabel={f.numbers}
            value={value.numbers}
            onChange={(numbers) => onChange({ ...value, numbers })}
            options={NUMBER_FORMATS.map((v) => ({ value: v, label: f.numbersOptions[v] }))}
          />
        </Field>
        <Field label={f.chapterLabel} hint={f.chapterLabelHint}>
          <Segmented
            ariaLabel={f.chapterLabel}
            value={value.chapterLabel}
            onChange={(chapterLabel) => onChange({ ...value, chapterLabel })}
            options={CHAPTER_LABEL_STYLES.map((v) => ({
              value: v,
              label: f.chapterLabelOptions[v],
            }))}
          />
        </Field>
        <Field label={f.weekStartsOn} hint={f.weekStartsOnHint}>
          <Segmented
            ariaLabel={f.weekStartsOn}
            value={value.weekStartsOn}
            onChange={(weekStartsOn) => onChange({ ...value, weekStartsOn })}
            options={WEEK_STARTS.map((v) => ({ value: v, label: f.weekStartsOnOptions[v] }))}
          />
        </Field>
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-medium leading-4 text-fg-muted">{f.preview}</span>
          <div className="rounded-md border border-line bg-bg px-3 py-2 text-[13px] text-fg">
            <div className="flex justify-between gap-3">
              <Hint>{f.previewTime}</Hint>
              <span className="tabular-nums">{timePreview}</span>
            </div>
            <div className="flex justify-between gap-3">
              <Hint>{f.previewViews}</Hint>
              <span className="tabular-nums">{formatCount(81_300, value.numbers)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <Hint>{f.previewChapter}</Hint>
              <span className="tabular-nums">{formatChapterLabel(301, value.chapterLabel)}</span>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  )
}
