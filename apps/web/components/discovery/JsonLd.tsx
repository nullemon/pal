/**
 * One `<script type="application/ld+json">` per page (docs/12 §4). The payload is JSON we
 * build ourselves from database values; `<` is escaped so a title can never close the tag.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD must be raw text; the payload is escaped above
      dangerouslySetInnerHTML={{ __html: json }}
    />
  )
}
