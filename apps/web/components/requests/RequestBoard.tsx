'use client'

import { messages } from '@palscans/core/messages'
import { EmptyState } from '@palscans/ui'
import { useState } from 'react'
import { RequestCard } from './RequestCard'
import type { RequestFilterValue, RequestItem } from './shared'

const m = messages.requests

/**
 * The list on `/requests`. The rows arrive rendered from the server (sorting, filtering and
 * paging are links, so the board is shareable and crawlable); this island exists only so an
 * upvote updates in place instead of reloading the page.
 *
 * Rows deliberately do **not** re-sort under the reader's cursor when a vote lands — moving
 * the thing somebody just pressed is how a list loses its place. The order is whatever the
 * server sent; the next load reflects the new counts.
 */
export function RequestBoard({
  items,
  filter,
}: {
  items: RequestItem[]
  filter: RequestFilterValue
}) {
  const [rows, setRows] = useState(items)

  if (rows.length === 0)
    return <EmptyState title={filter === 'open' ? m.emptyOpen : m.empty} description={m.lead} />

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((item) => (
        <RequestCard
          key={item.id}
          item={item}
          onChange={(next) => setRows((rs) => rs.map((r) => (r.id === next.id ? next : r)))}
        />
      ))}
    </ul>
  )
}
