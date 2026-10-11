'use client'

import { CHAPTER_LANGUAGES } from '@palscans/core/languages'
import { fmt, messages } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button, useToast } from '@palscans/ui'
import { Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Panel, PanelHeader, selectClass } from '../ui'
import { api, putJson } from './api'

/**
 * Credit a scanlation group on every chapter of this series.
 *
 * The one-click case, because it is by far the common one: a single group did the whole
 * title. Setting that chapter by chapter across forty of them is the sort of chore nobody
 * does, which means the credit the work was shared under never appears anywhere — and for
 * some groups that is a condition of hosting, not a nicety.
 *
 * Per-chapter credits still exist for a title that changed hands; this is the shortcut, not
 * a replacement.
 */

interface GroupOption {
  id: number
  name: string
}

export function SeriesGroups({ seriesId, canEdit }: { seriesId: number; canEdit: boolean }) {
  const m = adminMessages.groupsAdmin
  const { toast } = useToast()
  const [options, setOptions] = useState<GroupOption[]>([])
  const [groupId, setGroupId] = useState('')
  const [language, setLanguage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api<{ groups: GroupOption[] }>('/api/admin/groups').then((r) => {
      if (r.ok) setOptions(r.data.groups)
    })
  }, [])

  const apply = useCallback(async () => {
    setBusy(true)
    const result = await putJson<{ chapters: number }>(`/api/admin/series/${seriesId}/groups`, {
      // An empty selection clears the credit, which is the only way to undo a wrong one.
      groupIds: groupId === '' ? [] : [Number(groupId)],
      ...(language === '' ? {} : { language }),
    })
    setBusy(false)
    if (!result.ok) {
      toast({ title: result.message || messages.errors.generic, tone: 'danger' })
      return
    }
    toast({ title: fmt(m.appliedToSeries, { n: result.data.chapters }), tone: 'ok' })
  }, [seriesId, groupId, language, toast])

  if (!canEdit) return null
  return (
    <Panel>
      <PanelHeader title={m.seriesTitle} hint={m.seriesHint} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-[220px] flex-col gap-1.5">
          <span className="text-[13px] font-medium">{m.group}</span>
          <select
            className={selectClass}
            onChange={(e) => setGroupId(e.target.value)}
            value={groupId}
          >
            <option value="">{m.none}</option>
            {options.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-[180px] flex-col gap-1.5">
          <span className="text-[13px] font-medium">{adminMessages.admin.upload.language}</span>
          <select
            className={selectClass}
            onChange={(e) => setLanguage(e.target.value)}
            value={language}
          >
            {/* Default is every language: one group usually did the whole title. */}
            <option value="">{m.everyLanguage}</option>
            {CHAPTER_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <Button disabled={busy} onClick={() => void apply()} type="button" variant="outline">
          <Users aria-hidden className="size-4" /> {m.applyToSeries}
        </Button>
      </div>
      {options.length === 0 ? (
        <p className="mt-2 text-[12.5px] text-fg-muted">{m.noGroupsYet}</p>
      ) : null}
    </Panel>
  )
}
