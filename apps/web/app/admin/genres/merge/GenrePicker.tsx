'use client'

import { adminMessages } from '@palscans/core/messages/admin'
import { Button } from '@palscans/ui'
import { useState } from 'react'
import { Field, selectClass } from '@/components/admin/ui'

/**
 * Picking the two sides. Two selects and a link — the preview itself is a server render, so
 * this component never has to agree with it about anything.
 */

interface Option {
  id: number
  name: string
  slug: string
  kind: string
  seriesCount: number
}

const m = adminMessages.genreAdmin

export function GenrePicker({
  genres,
  loser,
  winner,
  sameGenre,
}: {
  genres: Option[]
  loser: number | null
  winner: number | null
  sameGenre: boolean
}) {
  const [l, setL] = useState<string>(loser ? String(loser) : '')
  const [w, setW] = useState<string>(winner ? String(winner) : '')
  const label = (o: Option) => `${o.name} · /${o.slug} · ${o.seriesCount}`
  const ready = l !== '' && w !== '' && l !== w

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={m.mergeLoser} hint={m.mergeLoserHint} htmlFor="genre-loser">
          <select
            id="genre-loser"
            className={selectClass}
            value={l}
            onChange={(e) => setL(e.target.value)}
          >
            <option value="">—</option>
            {genres.map((o) => (
              <option key={o.id} value={o.id}>
                {label(o)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={m.mergeWinner} hint={m.mergeWinnerHint} htmlFor="genre-winner">
          <select
            id="genre-winner"
            className={selectClass}
            value={w}
            onChange={(e) => setW(e.target.value)}
          >
            <option value="">—</option>
            {genres.map((o) => (
              <option key={o.id} value={o.id}>
                {label(o)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {sameGenre || (l !== '' && l === w) ? (
        <p className="text-[13px] text-danger">{m.mergeSameGenre}</p>
      ) : null}
      <div className="flex gap-2">
        {ready ? (
          <Button size="sm" href={`/admin/genres/merge?winner=${w}&loser=${l}`}>
            {m.mergePreview}
          </Button>
        ) : (
          <Button size="sm" disabled>
            {m.mergePreview}
          </Button>
        )}
        <a
          href="/admin/genres"
          className="inline-flex h-8 items-center rounded-md border border-line px-3 text-[13px] font-semibold hover:bg-surface-2"
        >
          {m.title}
        </a>
      </div>
    </div>
  )
}
