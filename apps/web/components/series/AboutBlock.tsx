import { fmt, messages } from '@palscans/core/messages'
import { RichText } from '@/components/discovery/RichText'

/**
 * The "About {title}" block (docs/12 §3) — the operator's own prose about a series.
 *
 * It is the one field on the SEO tab that is *for readers* rather than for a crawler's
 * snippet: somewhere to say what this series is, why it is worth reading, how the translation
 * came about. It was stored and never rendered, so every word anyone typed into it went
 * nowhere, and the tab implied otherwise by keeping a checklist item for it.
 *
 * Below the chapter list rather than above it. Someone arriving from search wants the
 * chapters; someone who has decided to read is the one who scrolls, and that is who this is
 * written for. Server-rendered either way, so a crawler sees the words — which is the other
 * half of why the field exists.
 */
export function AboutBlock({
  doc,
  title,
  className,
}: {
  /** `series.seo_text`, the stored rich-text document. Null for most series. */
  doc: unknown
  title: string
  className?: string
}) {
  if (!doc) return null
  return (
    <section aria-labelledby="about-title" className={className}>
      <h2 className="section-title mb-2" id="about-title">
        {fmt(messages.series.aboutTitle, { title })}
      </h2>
      <RichText className="prose-palscans max-w-[860px] text-[15px] leading-[26px]" doc={doc} />
    </section>
  )
}
