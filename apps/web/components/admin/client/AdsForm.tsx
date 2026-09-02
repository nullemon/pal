'use client'

import { messages } from '@palscans/core/messages'
import { useToast } from '@palscans/ui'
import { useState } from 'react'
import { AD_SLOT_SIZES, AD_SLOTS, type AdsSetting } from '../schemas-system'
import { Panel, PanelHeader, Table, Td, Th, textareaClass } from '../ui'
import { putJson } from './api'
import { SaveBar, Toggle } from './controls'

export function AdsForm({ initial }: { initial: AdsSetting }) {
  const m = messages.admin.ads
  const { toast } = useToast()
  const [saved, setSaved] = useState(initial)
  const [s, setS] = useState(initial)
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(s) !== JSON.stringify(saved)
  return (
    <div className="flex flex-col gap-3.5">
      <SaveBar
        dirty={dirty}
        saving={saving}
        onDiscard={() => setS(saved)}
        onSave={async () => {
          setSaving(true)
          const res = await putJson<AdsSetting>('/api/admin/ads', s)
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
      <Table>
        <thead>
          <tr>
            <Th>{m.slot}</Th>
            <Th>{m.placement}</Th>
            <Th>{m.size}</Th>
            <Th>{messages.admin.enabled}</Th>
            <Th>{m.tag}</Th>
          </tr>
        </thead>
        <tbody>
          {AD_SLOTS.map((id) => (
            <tr key={id} className="align-top">
              <Td className="pt-3 font-mono text-[12px] font-semibold">{id}</Td>
              <Td className="pt-3 text-fg-muted">{m.slots[id]}</Td>
              <Td className="pt-3 whitespace-nowrap text-[12px] text-fg-muted tabular-nums">
                {AD_SLOT_SIZES[id].desktop} · {AD_SLOT_SIZES[id].mobile}
              </Td>
              <Td className="pt-3">
                <Toggle
                  size="sm"
                  checked={s.slots[id].enabled}
                  onChange={(v) =>
                    setS({ ...s, slots: { ...s.slots, [id]: { ...s.slots[id], enabled: v } } })
                  }
                />
              </Td>
              <Td className="py-2">
                <textarea
                  rows={2}
                  className={`${textareaClass} min-w-[280px] font-mono text-[12px]`}
                  placeholder={m.tagPlaceholder}
                  value={s.slots[id].tag ?? ''}
                  onChange={(e) =>
                    setS({
                      ...s,
                      slots: { ...s.slots, [id]: { ...s.slots[id], tag: e.target.value || null } },
                    })
                  }
                />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Panel>
        <PanelHeader title={m.adsTxt} hint={m.adsTxtHint} />
        <textarea
          rows={8}
          className={`${textareaClass} font-mono text-[12px]`}
          value={s.ads_txt}
          onChange={(e) => setS({ ...s, ads_txt: e.target.value })}
          spellCheck={false}
        />
      </Panel>
    </div>
  )
}
