'use client'

import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button, useToast } from '@palscans/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Hint, Panel, PanelHeader } from '@/components/admin/ui'
import { postJson } from './api'

/**
 * What the Pages screen says when the chapter has no pages of ours to show.
 *
 * A chapter imported in remote mode keeps nothing in the bucket: the fetch job reads each
 * image once to check it and record its size, then writes `results: {}`. Everything on this
 * screen is built from that document, so the grid came out empty and the screen said "this
 * chapter has no processed pages yet" — accurate, and useless. An operator looking at a
 * chapter they can see on the live site, being told it has no pages, with no control that
 * does anything, has no way to work out that the fix is a setting on a different screen.
 * That is the whole of "still no clue how to replace one page".
 *
 * So the dead end says what is actually true and offers the one thing that resolves it. The
 * button is the same `copy_to_storage` action the chapter list runs in bulk, pointed at one
 * chapter: the operator does not have to find the list, filter it, tick a row and open a
 * menu to do the obvious thing from the screen that just told them they could not.
 */
const m = adminMessages.pageEditor

/** The host a remote chapter reads from, for the sentence. Null if the URL is unparseable. */
const hostOf = (url: string | null): string | null => {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

export function RemotePages({
  chapterId,
  sourceUrl,
  copying,
}: {
  chapterId: number
  sourceUrl: string | null
  /** The chapter is mid-copy: the job is queued or running and the button is spent. */
  copying: boolean
}) {
  const { toast } = useToast()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const host = hostOf(sourceUrl)

  const copy = async () => {
    setBusy(true)
    const res = await postJson<{ affected: number[]; skipped: Array<{ reason: string }> }>(
      '/api/admin/chapters/bulk',
      { action: 'copy_to_storage', ids: [chapterId] },
    )
    setBusy(false)
    if (!res.ok) {
      toast({ title: m.remoteFailed, description: res.message, tone: 'danger' })
      return
    }
    toast({ title: m.remoteQueued, tone: 'ok' })
    // The copy is a worker job, so there is nothing new to show yet. Refreshing picks up the
    // chapter's move to `processing`, which is the honest state to leave the operator on.
    router.refresh()
  }

  if (copying)
    return (
      <Panel className="flex flex-col gap-3">
        <PanelHeader title={m.remoteCopying} />
        <p className="m-0 max-w-[68ch] text-[13px] leading-5 text-fg-muted">
          {m.remoteCopyingBody}
        </p>
      </Panel>
    )

  return (
    <Panel className="flex flex-col gap-3">
      <PanelHeader title={m.remoteTitle} />
      <p className="m-0 max-w-[68ch] text-[13px] leading-5 text-fg-muted">
        {host ? fmt(m.remoteBody, { host }) : m.remoteBodyNoHost}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void copy()} disabled={busy}>
          {busy ? m.remoteBusy : m.remoteCta}
        </Button>
        <Hint className="text-[12.5px]">{m.remoteHint}</Hint>
      </div>
    </Panel>
  )
}
