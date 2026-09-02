/**
 * One `<script type="application/ld+json">` for the chapter (docs/12 §4). The payload is
 * built from database values; `<` is escaped so a title can never close the tag.
 */
export function ChapterJsonLd({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD must be raw text; the payload is escaped above
      dangerouslySetInnerHTML={{ __html: json }}
    />
  )
}
