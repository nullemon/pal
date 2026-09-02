import { type JsonLdNode, serializeJsonLd } from './jsonld'

/** One `<script type="application/ld+json">` per page (docs/12 §4). */
export function JsonLd({ data }: { data: JsonLdNode | JsonLdNode[] }) {
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD built from typed data, `<` escaped
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  )
}
