'use client'

import { DEFAULT_FORMATTING, type FormattingSettings } from '@palscans/core/formatting'
import { createContext, type ReactNode, useContext } from 'react'

/**
 * Appearance → Formatting, delivered to the components that render a timestamp or a chapter
 * number (docs/15 "Formatting").
 *
 * A context rather than a prop because `RelativeTime` is rendered from about twenty places,
 * most of them several levels down a server tree; threading a settings object through all of
 * them would be a hundred-line diff whose only job is passing one value along.
 *
 * It is deliberately thin: `@palscans/core/formatting` imports nothing but `time.js`, so
 * this file adds a context, a hook and five string fields to the client bundle and nothing
 * else. Importing the `@palscans/core` root here instead would drag `watermark.ts` — and
 * therefore zod — onto every reader's phone, which is the regression docs/20 measured at
 * 83.6 KB gzipped.
 *
 * The default is `DEFAULT_FORMATTING`, so a component rendered outside a provider (a test,
 * the 404 page, a Storybook-ish harness) formats exactly as it did before this existed.
 */
const FormatContext = createContext<FormattingSettings>(DEFAULT_FORMATTING)

export function FormatProvider({
  value,
  children,
}: {
  value: FormattingSettings
  children: ReactNode
}) {
  return <FormatContext.Provider value={value}>{children}</FormatContext.Provider>
}

export const useFormatting = (): FormattingSettings => useContext(FormatContext)
