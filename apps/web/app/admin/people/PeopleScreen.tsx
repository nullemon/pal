'use client'

import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button, useToast } from '@palscans/ui'
import { useCallback, useState } from 'react'
import {
  EmptyRow,
  Hint,
  inputClass,
  Panel,
  PanelHeader,
  Table,
  Td,
  Th,
} from '@/components/admin/ui'

/**
 * Authors and artists: rename, and fold duplicates together.
 *
 * The duplicate list is the reason the screen exists. Every AniList import creates a row per
 * credit, so the same person arrives under two spellings and each one takes half their series
 * with it — and until now nothing could put them back together.
 *
 * Merging is offered, never performed automatically. "Kubo Tite" and "Tite Kubo" are one
 * person; "Ryu Ki-Woon" and "Ryu Ki-Woong" may be two, and once the loser is deleted its
 * credits cannot be told from the winner's own, so there is nothing to undo it with.
 */
const m = adminMessages.peopleAdmin

export interface PersonRow {
  id: number
  slug: string
  name: string
  seriesCount: number
}

interface Props {
  initial: PersonRow[]
  duplicates: Array<[PersonRow, PersonRow]>
  canRename: boolean
  canMerge: boolean
}

const seriesLabel = (n: number) => (n === 1 ? m.seriesOne : fmt(m.seriesCount, { n }))

export function PeopleScreen({ initial, duplicates, canRename, canMerge }: Props) {
  const { toast } = useToast()
  const [rows, setRows] = useState(initial)
  const [pairs, setPairs] = useState(duplicates)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const shown = query.trim()
    ? rows.filter((r) => r.name.toLowerCase().includes(query.trim().toLowerCase()))
    : rows

  const rename = useCallback(
    async (id: number) => {
      const name = draft.trim()
      if (!name) return
      setBusy(true)
      try {
        const response = await fetch(`/api/admin/people/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        })
        if (!response.ok) throw new Error()
        setRows((current) => current.map((r) => (r.id === id ? { ...r, name } : r)))
        setPairs((current) =>
          current.map(([a, b]) => [
            a.id === id ? { ...a, name } : a,
            b.id === id ? { ...b, name } : b,
          ]),
        )
        setEditing(null)
        toast({ title: m.renamed, tone: 'ok' })
      } catch {
        toast({ title: m.failed, tone: 'danger' })
      } finally {
        setBusy(false)
      }
    },
    [draft, toast],
  )

  const merge = useCallback(
    async (winner: PersonRow, loser: PersonRow) => {
      if (!confirm(fmt(m.confirmMerge, { winner: winner.name, loser: loser.name }))) return
      setBusy(true)
      try {
        const response = await fetch('/api/admin/people/merge', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ winnerId: winner.id, loserId: loser.id }),
        })
        if (!response.ok) throw new Error()
        const body = (await response.json()) as { moved: number }
        setRows((current) =>
          current
            .filter((r) => r.id !== loser.id)
            .map((r) =>
              r.id === winner.id ? { ...r, seriesCount: r.seriesCount + loser.seriesCount } : r,
            ),
        )
        setPairs((current) => current.filter(([a, b]) => a.id !== loser.id && b.id !== loser.id))
        toast({ title: fmt(m.merged, { n: body.moved }), tone: 'ok' })
      } catch {
        toast({ title: m.failed, tone: 'danger' })
      } finally {
        setBusy(false)
      }
    },
    [toast],
  )

  return (
    <>
      {pairs.length > 0 ? (
        <Panel>
          <PanelHeader title={m.duplicates} hint={m.duplicatesHint} />
          <Table>
            <thead>
              <tr>
                <Th>{m.keep}</Th>
                <Th>{m.merge}</Th>
                {canMerge ? <Th align="right"> </Th> : null}
              </tr>
            </thead>
            <tbody>
              {pairs.map(([winner, loser]) => (
                <tr key={`${winner.id}-${loser.id}`} className="hover:bg-surface-2/60">
                  <Td>
                    <span className="font-semibold">{winner.name}</span>
                    <span className="ml-2 text-fg-subtle">{seriesLabel(winner.seriesCount)}</span>
                  </Td>
                  <Td>
                    <span>{loser.name}</span>
                    <span className="ml-2 text-fg-subtle">{seriesLabel(loser.seriesCount)}</span>
                  </Td>
                  {canMerge ? (
                    <Td align="right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => merge(winner, loser)}
                        disabled={busy}
                      >
                        {m.merge}
                      </Button>
                    </Td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      ) : (
        <Panel>
          <PanelHeader title={m.duplicates} />
          <Hint>{m.noDuplicates}</Hint>
        </Panel>
      )}

      <Panel>
        <PanelHeader title={m.title} />
        <input
          className={`${inputClass} mb-3 max-w-xs`}
          value={query}
          placeholder={m.searchPlaceholder}
          aria-label={m.searchLabel}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Table>
          <thead>
            <tr>
              <Th>{m.nameLabel}</Th>
              <Th align="right">{m.seriesCount.replace('{n} ', '')}</Th>
              {canRename ? <Th align="right"> </Th> : null}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? <EmptyRow colSpan={canRename ? 3 : 2}>{m.empty}</EmptyRow> : null}
            {shown.map((row) => (
              <tr key={row.id} className="hover:bg-surface-2/60">
                <Td>
                  {editing === row.id ? (
                    <input
                      className={inputClass}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      disabled={busy}
                    />
                  ) : (
                    row.name
                  )}
                </Td>
                <Td align="right" className="tabular-nums">
                  {row.seriesCount}
                </Td>
                {canRename ? (
                  <Td align="right">
                    {editing === row.id ? (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" onClick={() => rename(row.id)} disabled={busy}>
                          {m.save}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                          {m.cancel}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditing(row.id)
                          setDraft(row.name)
                        }}
                      >
                        {m.rename}
                      </Button>
                    )}
                  </Td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </>
  )
}
