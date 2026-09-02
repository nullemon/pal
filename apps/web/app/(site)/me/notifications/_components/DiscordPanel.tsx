'use client'

import { messages } from '@palscans/core/messages'
import { Button, RelativeTime, useToast } from '@palscans/ui'
import { Link2, Unlink } from 'lucide-react'
import { useState, useTransition } from 'react'
import { createDiscordCode, unlinkDiscord } from '../actions'

export interface DiscordLinkView {
  discordUsername: string | null
  discordId: string | null
  linkedAt: string | null
  code: string | null
  codeExpiresAt: string | null
}

/**
 * Discord account linking (docs/17 §D). The reader asks for a code here and types it at the
 * bot; the bot redeems it server-side, so nothing on this page ever holds a Discord token.
 * The code is short-lived and single use, which is why it is generated on demand rather than
 * kept on the profile.
 */
export function DiscordPanel({ initial }: { initial: DiscordLinkView }) {
  const m = messages.notify.discord
  const { toast } = useToast()
  const [link, setLink] = useState(initial)
  const [pending, startTransition] = useTransition()

  const generate = () =>
    startTransition(async () => {
      const res = await createDiscordCode()
      if (!res.ok || !res.code) {
        toast({ title: res.message, tone: 'danger' })
        return
      }
      setLink({ ...link, code: res.code, codeExpiresAt: res.expiresAt ?? null })
    })

  const remove = () =>
    startTransition(async () => {
      const res = await unlinkDiscord()
      if (res.ok)
        setLink({
          discordUsername: null,
          discordId: null,
          linkedAt: null,
          code: null,
          codeExpiresAt: null,
        })
      toast({ title: res.message, tone: res.ok ? 'ok' : 'danger' })
    })

  if (link.discordId)
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[13px]">
          <p className="font-semibold text-fg">
            {m.linked.replace('{name}', link.discordUsername ?? link.discordId)}
          </p>
          {link.linkedAt ? (
            <p className="mt-0.5 text-fg-muted">
              <RelativeTime iso={link.linkedAt} />
            </p>
          ) : null}
        </div>
        <Button size="sm" variant="outline" disabled={pending} onClick={remove}>
          <Unlink size={13} aria-hidden="true" />
          {m.unlink}
        </Button>
      </div>
    )

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-[62ch] text-[13px] text-fg-muted">{m.description}</p>
      {link.code ? (
        <div className="flex flex-col gap-1.5 rounded-md border border-line bg-surface-2 p-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-fg-subtle">
            {m.code}
          </span>
          <span className="font-mono text-[22px] font-bold tracking-[0.18em] text-fg">
            {link.code}
          </span>
          <span className="text-[12px] text-fg-muted">
            {m.linkHint.replace('{command}', `/link ${link.code}`).replace('{minutes}', '15')}
          </span>
          {link.codeExpiresAt ? (
            <span className="text-[12px] text-fg-subtle">
              {m.codeExpires.replace('{time}', '')}
              <RelativeTime iso={link.codeExpiresAt} />
            </span>
          ) : null}
        </div>
      ) : (
        <p className="text-[13px] text-fg-muted">{m.notLinked}</p>
      )}
      <div>
        <Button size="sm" variant="outline" disabled={pending} onClick={generate}>
          <Link2 size={13} aria-hidden="true" />
          {m.link}
        </Button>
      </div>
    </div>
  )
}
