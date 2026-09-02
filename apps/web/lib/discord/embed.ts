import { messages } from '@palscans/core/messages'
import { clamp, type DiscordEmbed, type DiscordMessage } from './client'

/**
 * The new-chapter embed the channel webhook and the DM both post (docs/17 §D). Kept pure so
 * the admin's test button and the worker send exactly the same thing.
 */
export const BRAND_COLOR = 0x7c3aed

export interface ChapterEmbedInput {
  siteName: string
  siteUrl: string
  seriesTitle: string
  seriesSlug: string
  number: number
  chapterTitle?: string | null
  coverUrl?: string | null
  publishedAt?: Date | null
  /** Marks the chapter as premium / early access in the embed footer. */
  locked?: boolean
}

export const chapterUrl = (siteUrl: string, slug: string, number: number): string =>
  `${siteUrl.replace(/\/+$/, '')}/series/${slug}/chapter-${number}`

export const newChapterEmbed = (input: ChapterEmbedInput): DiscordEmbed => {
  const m = messages.notify.discord
  const chapter = m.chapter.replace('{n}', String(input.number))
  return {
    title: clamp(`${input.seriesTitle} · ${chapter}`, 256),
    url: chapterUrl(input.siteUrl, input.seriesSlug, input.number),
    description: clamp(input.chapterTitle ?? m.readNow, 400),
    color: BRAND_COLOR,
    ...(input.publishedAt ? { timestamp: input.publishedAt.toISOString() } : {}),
    ...(input.coverUrl ? { thumbnail: { url: input.coverUrl } } : {}),
    footer: { text: clamp(input.locked ? `${input.siteName} · ${m.premium}` : input.siteName, 80) },
  }
}

export const newChapterMessage = (input: ChapterEmbedInput): DiscordMessage => ({
  username: clamp(input.siteName, 80),
  embeds: [newChapterEmbed(input)],
})

/** The message the admin "Send test" button posts — clearly labelled so nobody is fooled. */
export const testMessage = (siteName: string, siteUrl: string): DiscordMessage => {
  const m = messages.notify.discord
  return {
    username: clamp(siteName, 80),
    content: m.testContent,
    embeds: [
      newChapterEmbed({
        siteName,
        siteUrl,
        seriesTitle: m.testSeries,
        seriesSlug: 'example-series',
        number: 1,
        chapterTitle: m.testChapter,
        publishedAt: new Date(),
      }),
    ],
  }
}
