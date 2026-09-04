import { messages } from '@palscans/core/messages'
import type { Metadata } from 'next'
import { PageTitle } from '../_components/Section'
import { requireAccount } from '../_lib'
import { DownloadsClient } from './DownloadsClient'

export const metadata: Metadata = { title: messages.me.downloads.title }

/**
 * Downloads live in the browser, not the database, so this page is a shell around a client
 * island. It still requires an account: downloads are a Premium feature and the rest of
 * `/me` is behind the same gate.
 */
export default async function DownloadsPage() {
  await requireAccount('/me/downloads')
  return (
    <>
      <PageTitle title={messages.me.downloads.title} />
      <p className="mb-5 max-w-[60ch] text-[13px] leading-5 text-fg-muted">
        {messages.me.downloads.lead}
      </p>
      <DownloadsClient />
    </>
  )
}
