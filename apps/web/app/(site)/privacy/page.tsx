import { legalMetadata, renderLegal } from '@/lib/seo/legal-page'

export const revalidate = 300

export const generateMetadata = () => legalMetadata('privacy')

/** /privacy — rich text from the `pages` table (docs/13). */
export default function PrivacyPage() {
  return renderLegal('privacy')
}
