'use client'

import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button, cn, useToast } from '@palscans/ui'
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  KeyRound,
  PlugZap,
  ShieldAlert,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { postJson, putJson } from '@/components/admin/client/api'
import { SaveBar } from '@/components/admin/client/controls'
import {
  Hint,
  inputClass,
  Panel,
  PanelHeader,
  Pill,
  type PillTone,
  selectClass,
} from '@/components/admin/ui'
import { fieldVisible, groupStatus } from '@/lib/config/panel'
import {
  CONFIG_GROUPS,
  type ConfigField,
  type ConfigGroup,
  FIELDS_BY_ID,
  fieldsIn,
  SECRET_MASK,
} from '@/lib/config/registry'
import type { ConfigFieldView, ConfigSource } from '@/lib/config/store'
import type { TestReport } from '@/lib/config/tests'

/**
 * Admin → System → Integrations (docs/19): every credential the site runs on, in one screen,
 * with three things the operator cannot get from a `.env` file.
 *
 * **Where a value comes from.** Each field carries its source — saved here, inherited from
 * the environment, or set nowhere — because "is this deployment still reading my old .env?"
 * is the question that makes a migration frightening.
 *
 * **A secret that is set reads as "Set".** The server sends a mask and never the value, so a
 * box of dots would be a lie the operator might try to edit around. Replace and Remove are
 * explicit; leaving the field alone submits the mask, which the store treats as "unchanged".
 *
 * **A test that means something.** Every group has a button that talks to the real provider
 * and reports each step separately, so a wrong bucket looks different from a wrong key.
 */

const m = adminMessages.admin.integrations

const sourceTone: Record<ConfigSource, PillTone> = {
  panel: 'brand',
  env: 'gold',
  unset: 'neutral',
}

const stateTone: Record<'ready' | 'partial' | 'off', PillTone> = {
  ready: 'ok',
  partial: 'warn',
  off: 'neutral',
}

const checkTone: Record<'pass' | 'fail' | 'skip', PillTone> = {
  pass: 'ok',
  fail: 'danger',
  skip: 'neutral',
}

const domId = (id: string): string => `cfg-${id.replace(/\./g, '-')}`

const byId = (fields: readonly ConfigFieldView[]): Record<string, string> =>
  Object.fromEntries(fields.map((f) => [f.id, f.value]))

const sourcesById = (fields: readonly ConfigFieldView[]): Record<string, ConfigSource> =>
  Object.fromEntries(fields.map((f) => [f.id, f.source]))

/* -------------------------------------------------------------------- banners */

function Notice({
  tone,
  icon,
  title,
  children,
}: {
  tone: 'danger' | 'warn' | 'neutral'
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border p-4 md:px-5',
        tone === 'danger' && 'border-danger/40 bg-danger/10',
        tone === 'warn' && 'border-warn/40 bg-warn/10',
        tone === 'neutral' && 'border-line bg-surface-1',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'mt-px shrink-0',
          tone === 'danger' && 'text-danger',
          tone === 'warn' && 'text-warn',
          tone === 'neutral' && 'text-fg-subtle',
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[13px] font-bold leading-[18px]">{title}</div>
        <p className="mt-0.5 text-[12.5px] leading-[18px] text-fg-muted">{children}</p>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------------- fields */

interface RowProps {
  field: ConfigField
  value: string
  source: ConfigSource
  editing: boolean
  disabled: boolean
  onChange: (value: string) => void
  onEdit: (editing: boolean) => void
}

/** One registry field: label, source, the control its `kind` calls for, and what that means. */
function SettingRow({ field, value, source, editing, disabled, onChange, onEdit }: RowProps) {
  const id = domId(field.id)
  const noteId = `${id}-note`
  const storedSecret = field.secret && value === SECRET_MASK && !editing
  const removingSecret = field.secret && value === '' && source !== 'unset'

  // A field set nowhere gets no note: the "not set" pill already says it, and repeating the
  // sentence under all twenty-odd empty boxes buries the two that do have something to say.
  const note = storedSecret
    ? m.secretStoredNote
    : removingSecret
      ? m.secretRemovedNote
      : editing
        ? m.secretReplacingNote
        : source === 'env'
          ? fmt(m.sourceEnvNote, { name: field.env })
          : source === 'panel'
            ? fmt(m.sourcePanelNote, { name: field.env })
            : null

  const common = {
    id,
    disabled,
    'aria-describedby': note ? noteId : undefined,
    className: inputClass,
  }

  let control: ReactNode
  if (storedSecret) {
    control = (
      <div className="flex flex-wrap items-center gap-2">
        <input
          {...common}
          readOnly
          value={m.secretSet}
          className={cn(
            inputClass,
            'w-auto min-w-24 flex-1 bg-surface-2 font-semibold text-fg-muted',
          )}
        />
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => onEdit(true)}>
          {m.secretReplace}
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange('')}>
          {m.secretRemove}
        </Button>
      </div>
    )
  } else if (field.kind === 'select') {
    control = (
      <select
        {...common}
        className={selectClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{adminMessages.admin.none}</option>
        {field.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  } else if (field.kind === 'boolean') {
    control = (
      <div className="flex h-9 items-center gap-2.5">
        <input
          {...common}
          type="checkbox"
          className="size-[18px] shrink-0 accent-brand"
          checked={value === 'true'}
          onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
        />
        <span className="text-[13px] font-semibold text-fg-muted">
          {value === 'true' ? adminMessages.admin.on : adminMessages.admin.off}
        </span>
      </div>
    )
  } else {
    control = (
      <div className="flex flex-wrap items-center gap-2">
        <input
          {...common}
          className={cn(inputClass, editing && 'min-w-24 flex-1')}
          type={field.secret ? 'password' : field.kind === 'number' ? 'number' : 'text'}
          inputMode={field.kind === 'number' ? 'numeric' : undefined}
          min={field.kind === 'number' ? 0 : undefined}
          max={field.kind === 'number' ? 65535 : undefined}
          value={value}
          spellCheck={false}
          autoComplete={field.secret ? 'new-password' : 'off'}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        {editing ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              onChange(SECRET_MASK)
              onEdit(false)
            }}
          >
            {m.secretKeep}
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <label htmlFor={id} className="text-[12px] font-medium leading-4 text-fg-muted">
          {field.label}
        </label>
        <Pill tone={sourceTone[source]}>{m.source[source]}</Pill>
      </div>
      {control}
      {note ? (
        <p id={noteId} className="text-[12px] leading-4 text-fg-subtle">
          {note}
        </p>
      ) : null}
      {field.hint ? (
        <span className="text-[12px] leading-4 text-fg-subtle">{field.hint}</span>
      ) : null}
    </div>
  )
}

/* ---------------------------------------------------------------------- tests */

function TestResult({ report }: { report: TestReport }) {
  const failed = report.checks.some((c) => c.state === 'fail')
  const title = failed ? m.testFailed : report.ok ? m.testPassed : m.testMixed
  return (
    <div className="mt-3.5 rounded-md border border-line bg-surface-2 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Pill tone={failed ? 'danger' : report.ok ? 'ok' : 'neutral'}>{m.testTitle}</Pill>
        <span className="text-[13px] font-semibold">{title}</span>
      </div>
      <ul className="flex flex-col gap-2">
        {report.checks.map((c) => (
          <li
            key={c.label}
            className="flex min-w-0 flex-col gap-0.5 border-t border-line-soft pt-2 first:border-0 first:pt-0"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={checkTone[c.state]}>{m.checkStates[c.state]}</Pill>
              <span className="text-[12.5px] font-semibold">{c.label}</span>
            </div>
            <p className="break-words text-[12.5px] leading-[18px] text-fg-muted">{c.detail}</p>
          </li>
        ))}
      </ul>
      <p className="mt-2.5 text-[12px] leading-4 text-fg-subtle">{m.testUnsaved}</p>
    </div>
  )
}

/* --------------------------------------------------------------------- screen */

export function IntegrationsScreen({
  initial,
}: {
  initial: { fields: ConfigFieldView[]; sealingKey: 'CREDENTIALS_KEY' | 'SESSION_SECRET' | null }
}) {
  const { toast } = useToast()
  const [saved, setSaved] = useState(() => byId(initial.fields))
  const [values, setValues] = useState(() => byId(initial.fields))
  const [sources, setSources] = useState(() => sourcesById(initial.fields))
  const [editing, setEditing] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<ConfigGroup | null>(null)
  const [reports, setReports] = useState<Partial<Record<ConfigGroup, TestReport>>>({})

  const sealed = initial.sealingKey !== null
  const dirty = CONFIG_GROUPS.some((g) =>
    fieldsIn(g).some((f) => (values[f.id] ?? '') !== (saved[f.id] ?? '')),
  )

  const set = (id: string, value: string) => setValues((prev) => ({ ...prev, [id]: value }))
  const edit = (id: string, on: boolean) => {
    setEditing((prev) => ({ ...prev, [id]: on }))
    if (on) set(id, '')
  }

  const discard = () => {
    setValues(saved)
    setEditing({})
  }

  /**
   * What to submit for a set of fields. Three omissions, all deliberate:
   *
   * - a hidden field (an S3 key while the driver is the local folder) is left out, because
   *   submitting '' for it would delete a row the operator only wanted to stop looking at
   * - a secret opened for replacement and then left empty is left out too, so an accidental
   *   Replace is not a deletion; Remove is the button that deletes
   * - on a save (`onlyChanged`) an untouched field is left out, so editing one box does not
   *   quietly copy every other value out of the environment and into the database — the
   *   source pills would all flip to "Panel" for a save the operator never asked for
   */
  const payloadFor = (
    fields: readonly ConfigField[],
    { onlyChanged = false } = {},
  ): Record<string, string> => {
    const payload: Record<string, string> = {}
    for (const field of fields) {
      if (!fieldVisible(field, values)) continue
      const value = values[field.id] ?? ''
      if (editing[field.id] === true && value === '') continue
      if (onlyChanged && value === (saved[field.id] ?? '')) continue
      payload[field.id] = value
    }
    return payload
  }

  const save = async () => {
    setSaving(true)
    const res = await putJson<{ fields: ConfigFieldView[] }>('/api/admin/integrations', {
      values: payloadFor(
        CONFIG_GROUPS.flatMap((g) => fieldsIn(g)),
        { onlyChanged: true },
      ),
    })
    setSaving(false)
    if (!res.ok)
      return toast({
        title: adminMessages.admin.errorSaving,
        description: res.message,
        tone: 'danger',
      })
    setSaved(byId(res.data.fields))
    setValues(byId(res.data.fields))
    setSources(sourcesById(res.data.fields))
    setEditing({})
    toast({ title: m.saved, description: m.savedNote, tone: 'ok' })
  }

  const runTest = async (group: ConfigGroup) => {
    setTesting(group)
    const res = await postJson<TestReport>('/api/admin/integrations', {
      group,
      values: payloadFor(fieldsIn(group)),
    })
    setTesting(null)
    if (!res.ok) return toast({ title: m.testError, description: res.message, tone: 'danger' })
    setReports((prev) => ({ ...prev, [group]: res.data }))
  }

  return (
    <div className="flex flex-col gap-3.5">
      <SaveBar
        dirty={dirty && sealed}
        saving={saving}
        onDiscard={discard}
        onSave={() => void save()}
        status={sealed ? undefined : m.readOnly}
      />

      {initial.sealingKey === null ? (
        <Notice tone="danger" icon={<ShieldAlert size={16} />} title={m.sealing.missingTitle}>
          {m.sealing.missingBody}
        </Notice>
      ) : initial.sealingKey === 'SESSION_SECRET' ? (
        <Notice tone="warn" icon={<CircleAlert size={16} />} title={m.sealing.sessionTitle}>
          {m.sealing.sessionBody}
        </Notice>
      ) : (
        <Notice tone="neutral" icon={<KeyRound size={16} />} title={m.sealing.okTitle}>
          {m.sealing.okBody}
        </Notice>
      )}

      <div className="grid items-start gap-3.5 lg:grid-cols-2">
        {CONFIG_GROUPS.map((group) => {
          const status = groupStatus(group, values)
          const fields = fieldsIn(group).filter((f) => fieldVisible(f, values))
          const report = reports[group]
          const missing = status.missing.map((id) => FIELDS_BY_ID.get(id)?.label ?? id).join(', ')
          return (
            <Panel key={group}>
              <PanelHeader
                title={m.groups[group]}
                hint={m.groupHints[group]}
                aside={<Pill tone={stateTone[status.state]}>{m.state[status.state]}</Pill>}
              />
              <div className="flex flex-col gap-3.5">
                {fields.map((field) => (
                  <SettingRow
                    key={field.id}
                    field={field}
                    value={values[field.id] ?? ''}
                    source={sources[field.id] ?? 'unset'}
                    editing={editing[field.id] === true}
                    disabled={!sealed}
                    onChange={(v) => set(field.id, v)}
                    onEdit={(on) => edit(field.id, on)}
                  />
                ))}
              </div>
              {missing ? (
                <Hint className="mt-3.5">{fmt(m.stillNeeded, { fields: missing })}</Hint>
              ) : null}
              <div className="mt-3.5 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={testing !== null}
                  onClick={() => void runTest(group)}
                >
                  <PlugZap size={14} aria-hidden="true" />
                  {testing === group ? m.testing : m.test}
                </Button>
                {report ? (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 text-[12.5px]',
                      report.ok ? 'text-ok' : 'text-fg-muted',
                    )}
                  >
                    {report.ok ? (
                      <CircleCheck size={14} aria-hidden="true" />
                    ) : report.checks.some((c) => c.state === 'fail') ? (
                      <CircleAlert size={14} aria-hidden="true" className="text-danger" />
                    ) : (
                      <CircleDashed size={14} aria-hidden="true" />
                    )}
                    {report.ok
                      ? m.testPassed
                      : report.checks.some((c) => c.state === 'fail')
                        ? m.testFailed
                        : m.testMixed}
                  </span>
                ) : null}
              </div>
              {report ? <TestResult report={report} /> : null}
            </Panel>
          )
        })}
      </div>
    </div>
  )
}
