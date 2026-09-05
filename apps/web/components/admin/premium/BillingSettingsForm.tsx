'use client'

import { messages } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button, useToast } from '@palscans/ui'
import { useId, useState } from 'react'
import { putJson } from '../client/api'
import { Segmented, Toggle } from '../client/controls'
import { Field, Hint, inputClass, Panel, PanelHeader, Pill, Table, Td, Th } from '../ui'
import {
  type BillingSettingsInput,
  formatFeatureList,
  type PlanInput,
  parseFeatureList,
} from './billing-schemas'

/**
 * The editable billing rules and the plan/price table (agent A). Saves are inline rather than
 * in the top bar: agent B's entitlement panels already own the top bar's Save on this screen.
 */

const m = messages.billing.admin

const PLACEHOLDER_PREFIX = 'price_dev_'

const centsToInput = (cents: number): string => (cents / 100).toFixed(2)

const inputToCents = (value: string): number => {
  const n = Number.parseFloat(value.replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

export function BillingSettingsForm({
  settings,
  plans,
}: {
  settings: BillingSettingsInput
  plans: PlanInput[]
}) {
  const { toast } = useToast()
  const id = useId()
  const [savedSettings, setSavedSettings] = useState(settings)
  const [s, setS] = useState(settings)
  const [savedPlans, setSavedPlans] = useState(plans)
  const [p, setP] = useState(plans)
  const [busy, setBusy] = useState<'settings' | 'plans' | null>(null)

  const settingsDirty = JSON.stringify(s) !== JSON.stringify(savedSettings)
  const plansDirty = JSON.stringify(p) !== JSON.stringify(savedPlans)

  const patchPlan = (index: number, patch: Partial<PlanInput>) =>
    setP((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const saveSettings = async () => {
    setBusy('settings')
    const res = await putJson<BillingSettingsInput>('/api/admin/premium/billing', s)
    setBusy(null)
    if (!res.ok)
      return toast({
        title: adminMessages.admin.errorSaving,
        description: res.message,
        tone: 'danger',
      })
    setSavedSettings(res.data)
    setS(res.data)
    toast({ title: m.saved, tone: 'ok' })
  }

  const savePlans = async () => {
    setBusy('plans')
    const res = await putJson<{ plans: PlanInput[] }>('/api/admin/premium/billing/plans', {
      plans: p,
    })
    setBusy(null)
    if (!res.ok)
      return toast({
        title: adminMessages.admin.errorSaving,
        description: res.message,
        tone: 'danger',
      })
    setSavedPlans(res.data.plans)
    setP(res.data.plans)
    toast({ title: m.savedPlans, tone: 'ok' })
  }

  return (
    <div className="flex flex-col gap-3.5">
      <Panel className="p-0 md:px-0">
        <div className="p-4 pb-0 md:px-5">
          <PanelHeader title={m.plansTitle} hint={m.plansHint} />
        </div>
        <Table className="rounded-none border-0">
          <thead>
            <tr>
              <Th>{m.plan}</Th>
              <Th>{m.price}</Th>
              <Th>{m.interval}</Th>
              <Th>{m.stripePriceId}</Th>
              <Th>{m.featuresColumn}</Th>
              <Th>{m.activeColumn}</Th>
            </tr>
          </thead>
          <tbody>
            {p.map((plan, i) => (
              <tr key={plan.id} className="align-top">
                <Td className="py-2.5">
                  <input
                    aria-label={`${m.plan} ${plan.id}`}
                    className={`${inputClass} min-w-[120px]`}
                    value={plan.name}
                    onChange={(e) => patchPlan(i, { name: e.target.value })}
                  />
                  <span className="mt-1 block font-mono text-[11px] text-fg-subtle">{plan.id}</span>
                </Td>
                <Td className="py-2.5">
                  <input
                    aria-label={`${m.price} ${plan.id}`}
                    inputMode="decimal"
                    className={`${inputClass} w-[90px] tabular-nums`}
                    value={centsToInput(plan.priceCents)}
                    onChange={(e) => patchPlan(i, { priceCents: inputToCents(e.target.value) })}
                  />
                </Td>
                <Td className="py-2.5">
                  <Segmented
                    size="sm"
                    ariaLabel={`${m.interval} ${plan.id}`}
                    value={plan.interval}
                    onChange={(v) => patchPlan(i, { interval: v })}
                    options={[
                      { value: 'month', label: 'Month' },
                      { value: 'year', label: 'Year' },
                    ]}
                  />
                </Td>
                <Td className="py-2.5">
                  <input
                    aria-label={`${m.stripePriceId} ${plan.id}`}
                    className={`${inputClass} min-w-[190px] font-mono text-[12px]`}
                    value={plan.stripePriceId}
                    onChange={(e) => patchPlan(i, { stripePriceId: e.target.value.trim() })}
                  />
                  {plan.stripePriceId.startsWith(PLACEHOLDER_PREFIX) ? (
                    <span className="mt-1 block">
                      <Pill tone="warn">{m.placeholderPrice}</Pill>
                    </span>
                  ) : null}
                </Td>
                <Td className="py-2.5">
                  <input
                    aria-label={`${m.featuresColumn} ${plan.id}`}
                    className={`${inputClass} min-w-[260px] font-mono text-[12px]`}
                    placeholder={m.featurePlaceholder}
                    value={formatFeatureList(plan.features)}
                    onChange={(e) => patchPlan(i, { features: parseFeatureList(e.target.value) })}
                  />
                </Td>
                <Td className="py-3">
                  <Toggle
                    size="sm"
                    ariaLabel={`${m.activeColumn} ${plan.id}`}
                    checked={plan.active}
                    onChange={(v) => patchPlan(i, { active: v })}
                  />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="flex justify-end p-4 md:px-5">
          <Button
            size="sm"
            disabled={!plansDirty || busy !== null}
            onClick={savePlans}
            className="h-9 rounded-[9px] px-4 font-bold"
          >
            {busy === 'plans' ? adminMessages.admin.saving : adminMessages.admin.saveChanges}
          </Button>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title={m.settingsTitle} />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={m.graceDays} hint={m.graceDaysHint} htmlFor={`${id}-grace`}>
            <input
              id={`${id}-grace`}
              type="number"
              min={0}
              max={30}
              className={`${inputClass} w-[90px] tabular-nums`}
              value={s.graceDays}
              onChange={(e) =>
                setS({ ...s, graceDays: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })
              }
            />
          </Field>
          <Field
            label={m.statementDescriptor}
            hint={m.statementDescriptorHint}
            htmlFor={`${id}-descriptor`}
          >
            <input
              id={`${id}-descriptor`}
              maxLength={22}
              className={inputClass}
              value={s.statementDescriptor}
              onChange={(e) => setS({ ...s, statementDescriptor: e.target.value })}
            />
          </Field>
          <Field label={m.supportPath} htmlFor={`${id}-support`}>
            <input
              id={`${id}-support`}
              className={inputClass}
              value={s.supportPath}
              onChange={(e) => setS({ ...s, supportPath: e.target.value })}
            />
          </Field>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-[13px] font-semibold text-fg">{m.tax}</span>
                <Hint>{m.taxHint}</Hint>
              </div>
              <Toggle
                checked={s.taxEnabled}
                ariaLabel={m.tax}
                onChange={(v) => setS({ ...s, taxEnabled: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-semibold text-fg">{m.taxId}</span>
              <Toggle
                checked={s.taxIdCollection}
                ariaLabel={m.taxId}
                disabled={!s.taxEnabled}
                onChange={(v) => setS({ ...s, taxIdCollection: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-[13px] font-semibold text-fg">{m.portal}</span>
                <Hint>{m.portalHint}</Hint>
              </div>
              <Toggle
                checked={s.portalEnabled}
                ariaLabel={m.portal}
                onChange={(v) => setS({ ...s, portalEnabled: v })}
              />
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            size="sm"
            disabled={!settingsDirty || busy !== null}
            onClick={saveSettings}
            className="h-9 rounded-[9px] px-4 font-bold"
          >
            {busy === 'settings' ? adminMessages.admin.saving : adminMessages.admin.saveChanges}
          </Button>
        </div>
      </Panel>
    </div>
  )
}
