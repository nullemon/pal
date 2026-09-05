import { COPY_ENTRIES, COPY_GROUPS } from '@palscans/core/copy'
import { adminMessages } from '@palscans/core/messages/admin'
import { describe, expect, it } from 'vitest'

/**
 * The registry lives in `@palscans/core/copy`; the words that describe it on screen live in
 * `adminMessages.copyScreen`, because they are admin-only copy and the public catalogue is
 * not allowed to carry them (`lib/messages-split.test.ts`).
 *
 * That split has one failure mode: adding an entry and forgetting its label. The screen
 * degrades to showing the raw id — "premium.bullets.adFree" as a field label — which nobody
 * would notice in review and every operator would notice on the day. So it is asserted.
 */
const m = adminMessages.copyScreen

describe('every editable string is described on screen', () => {
  it('has a human label', () => {
    const missing = COPY_ENTRIES.filter((e) => !(e.id in m.entries)).map((e) => e.id)
    expect(missing, 'add these to adminMessages.copyScreen.entries').toEqual([])
  })

  it('says where it renders', () => {
    const missing = COPY_ENTRIES.filter((e) => !(e.id in m.where)).map((e) => e.id)
    expect(missing, 'add these to adminMessages.copyScreen.where').toEqual([])
  })

  it('carries no labels for entries that no longer exist', () => {
    const ids = new Set(COPY_ENTRIES.map((e) => e.id))
    expect(Object.keys(m.entries).filter((k) => !ids.has(k))).toEqual([])
    expect(Object.keys(m.where).filter((k) => !ids.has(k))).toEqual([])
  })

  it('names every group', () => {
    for (const g of COPY_GROUPS) {
      expect(m.groups[g], g).toBeTruthy()
      expect(m.groupHints[g], g).toBeTruthy()
    }
  })

  it('warns, in the group hint, about the two groups nothing renders yet', () => {
    // docs/15 names the maintenance page and the age gate; neither exists. The panel has to
    // say so, or an operator edits a string and hunts for it on a page that is not there.
    const unrendered = COPY_ENTRIES.filter((e) => !e.rendered)
    expect(unrendered.length).toBeGreaterThan(0)
    for (const e of unrendered) {
      expect(m.where[e.id as keyof typeof m.where], e.id).toMatch(/Nothing renders this yet/)
    }
  })
})
