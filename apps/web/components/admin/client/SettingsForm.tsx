'use client'

import { messages } from '@palscans/core/messages'
import { useToast } from '@palscans/ui'
import { useState } from 'react'
import type { SiteSetting } from '../schemas-system'
import { Field, inputClass, Panel, PanelHeader } from '../ui'
import { putJson } from './api'
import { SaveBar, Segmented, Toggle } from './controls'

export function SettingsForm({ initial }: { initial: SiteSetting }) {
  const m = messages.admin.settings
  const { toast } = useToast()
  const [saved, setSaved] = useState(initial)
  const [s, setS] = useState(initial)
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(s) !== JSON.stringify(saved)
  return (
    <div className="grid gap-3.5 lg:grid-cols-2">
      <SaveBar
        dirty={dirty}
        saving={saving}
        onDiscard={() => setS(saved)}
        onSave={async () => {
          setSaving(true)
          const res = await putJson<SiteSetting>('/api/admin/settings', s)
          setSaving(false)
          if (!res.ok)
            return toast({
              title: messages.admin.errorSaving,
              description: res.message,
              tone: 'danger',
            })
          setSaved(res.data)
          setS(res.data)
          toast({ title: m.saved, tone: 'ok' })
        }}
      />
      <Panel>
        <PanelHeader title={m.siteName} />
        <div className="flex flex-col gap-3">
          <Field label={m.siteName} htmlFor="st-name">
            <input
              id="st-name"
              className={inputClass}
              value={s.name}
              onChange={(e) => setS({ ...s, name: e.target.value })}
            />
          </Field>
          <Field label={m.tagline} htmlFor="st-tag">
            <input
              id="st-tag"
              className={inputClass}
              value={s.tagline}
              onChange={(e) => setS({ ...s, tagline: e.target.value })}
            />
          </Field>
          <Field label={m.siteUrl} htmlFor="st-url">
            <input
              id="st-url"
              className={inputClass}
              value={s.url}
              onChange={(e) => setS({ ...s, url: e.target.value })}
            />
          </Field>
          <Field label={m.discordUrl} htmlFor="st-dc">
            <input
              id="st-dc"
              className={inputClass}
              value={s.discord_url}
              onChange={(e) => setS({ ...s, discord_url: e.target.value })}
            />
          </Field>
        </div>
      </Panel>
      <div className="flex flex-col gap-3.5">
        <Panel>
          <PanelHeader title={m.registration} />
          <Segmented
            value={s.registration}
            onChange={(v) => setS({ ...s, registration: v })}
            options={[
              { value: 'open', label: m.registrationModes.open },
              { value: 'invite', label: m.registrationModes.invite },
              { value: 'closed', label: m.registrationModes.closed },
            ]}
          />
        </Panel>
        <Panel>
          <PanelHeader title={m.maintenance} />
          <div className="flex flex-col gap-3">
            <Toggle
              checked={s.maintenance.enabled}
              onChange={(v) => setS({ ...s, maintenance: { ...s.maintenance, enabled: v } })}
              label={m.maintenance}
            />
            <Field label={m.maintenanceEta} htmlFor="st-eta">
              <input
                id="st-eta"
                className={inputClass}
                value={s.maintenance.eta ?? ''}
                onChange={(e) =>
                  setS({ ...s, maintenance: { ...s.maintenance, eta: e.target.value || null } })
                }
              />
            </Field>
          </div>
        </Panel>
      </div>
    </div>
  )
}
