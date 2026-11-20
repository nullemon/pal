'use client'

import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button, useToast } from '@palscans/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { RemoteEditorPage } from '@/components/admin/server/chapter-pages'
import { Hint, Panel, PanelHeader, Pill } from '@/components/admin/ui'
import { postJson } from './api'

/**
 * The Pages screen for a chapter whose pages are not ours.
 *
 * A chapter imported in remote mode keeps nothing in the bucket: the fetch job reads each
 * image once to check it and record its size, then writes `results: {}`. The normal page
 * editor is built from that document, so it came out empty and the screen said "this
 * chapter has no processed pages yet" — accurate, and useless to someone looking at a
 * chapter they can see on the live site with a page that needs swapping.
 *
 * So this shows the same numbered grid, built from `chapter_pages` instead, and offers the
 * one edit that can work without a document behind it: replace page N. That page is encoded
 * into our bucket and the row stops being remote; every other page is untouched and still
 * costs nothing. A chapter may sit half-and-half indefinitely, which needs no new concept —
 * the reader already chooses per page, so a row that stops being remote simply starts being
 * served from our CDN.
 *
 * Copying the whole chapter in is still offered underneath, because it is the right move
 * when a chapter needs watermarking or reordering rather than one bad page. It is no longer
 * the *only* move, which is what made fixing a typo cost a hundred-page download.
 */
const m = adminMessages.pageEditor

interface SignedUpload {
  key: string
  url: string
  method: string
  headers?: Record<string, string>
}

const digest = async (file: File): Promise<string> => {
  const buffer = await file.arrayBuffer()
  const hash = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

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
  pages,
}: {
  chapterId: number
  sourceUrl: string | null
  /** The chapter is mid-copy: a whole-chapter job is queued or running. */
  copying: boolean
  pages: RemoteEditorPage[]
}) {
  const { toast } = useToast()
  const router = useRouter()
  const [busy, setBusy] = useState<number | 'all' | null>(null)
  const host = hostOf(sourceUrl) ?? hostOf(pages.find((p) => p.remoteUrl)?.remoteUrl ?? null)

  /** Upload the file, then ask the server to point this one page at it. */
  const replaceOne = async (idx: number, file: File) => {
    setBusy(idx)
    try {
      const sha256 = await digest(file)
      // `postJson`, because the route answers `{ data }` — reading the presign off the top
      // level is what made the page editor's own Replace fail silently.
      const intent = await postJson<SignedUpload>(`/api/admin/chapters/${chapterId}/pages/upload`, {
        sha256,
        type: file.type,
        bytes: file.size,
      })
      if (!intent.ok) throw new Error(intent.message || 'intent')
      const signed = intent.data
      const put = await fetch(signed.url, {
        method: signed.method,
        headers: signed.headers,
        body: file,
      })
      if (!put.ok) throw new Error('put')
      const res = await postJson(`/api/admin/chapters/${chapterId}/pages`, {
        op: 'replace_one',
        position: idx,
        key: signed.key,
      })
      if (!res.ok) throw new Error(res.message)
      toast({ title: fmt(m.remoteReplaced, { n: idx + 1 }), tone: 'ok' })
      router.refresh()
    } catch {
      toast({ title: m.remoteReplaceFailed, tone: 'danger' })
    } finally {
      setBusy(null)
    }
  }

  const copyAll = async () => {
    setBusy('all')
    const res = await postJson('/api/admin/chapters/bulk', {
      action: 'copy_to_storage',
      ids: [chapterId],
    })
    setBusy(null)
    if (!res.ok) {
      toast({ title: m.remoteFailed, description: res.message, tone: 'danger' })
      return
    }
    toast({ title: m.remoteQueued, tone: 'ok' })
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
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader
          title={host ? fmt(m.remoteGridTitle, { host }) : m.remoteGridTitleNoHost}
          aside={<span className="tabular-nums">{fmt(m.count, { n: pages.length })}</span>}
        />
        <Hint className="mt-1">{m.remoteGridHint}</Hint>
        {pages.length === 0 ? (
          <Hint className="mt-3">{m.empty}</Hint>
        ) : (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {pages.map((page) => (
              <li
                key={page.idx}
                className="flex flex-col overflow-hidden rounded-md border border-line bg-surface-1"
              >
                <div className="relative aspect-[2/3] bg-surface-2">
                  {/* biome-ignore lint/performance/noImgElement: a remote host's URL, not ours to optimise */}
                  <img
                    src={page.url}
                    alt={fmt(m.page, { n: page.idx + 1 })}
                    loading="lazy"
                    className="absolute inset-0 size-full object-contain"
                  />
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1.5">
                  <span className="text-xs font-semibold tabular-nums text-fg-muted">
                    {page.idx + 1}
                  </span>
                  {/* Which pages are already ours, so a half-converted chapter reads honestly. */}
                  {page.remoteUrl ? null : <Pill tone="ok">{m.remoteOurs}</Pill>}
                  <label
                    className={`ml-auto rounded px-1.5 py-0.5 text-[11px] font-semibold hover:bg-surface-3 ${
                      busy === null ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'
                    }`}
                  >
                    {busy === page.idx ? m.remoteReplacing : m.replace}
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      aria-label={fmt(m.replacePage, { n: page.idx + 1 })}
                      disabled={busy !== null}
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (file) void replaceOne(page.idx, file)
                        event.target.value = ''
                      }}
                    />
                  </label>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="flex flex-col gap-3">
        <PanelHeader title={m.remoteAllTitle} />
        <p className="m-0 max-w-[68ch] text-[13px] leading-5 text-fg-muted">
          {host ? fmt(m.remoteBody, { host }) : m.remoteBodyNoHost}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void copyAll()} disabled={busy !== null}>
            {busy === 'all' ? m.remoteBusy : m.remoteCta}
          </Button>
          <Hint className="text-[12.5px]">{m.remoteHint}</Hint>
        </div>
      </Panel>
    </div>
  )
}
