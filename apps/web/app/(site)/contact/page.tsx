import { messages } from '@palscans/core/messages'
import { legalMetadata, renderLegal } from '@/lib/seo/legal-page'
import { ContactForm } from './ContactForm'

export const revalidate = 300

export const generateMetadata = () => legalMetadata('contact')

const m = messages.legal.contact

/** /contact — the address text from the `pages` table plus the form → reports queue (docs/13). */
export default function ContactPage() {
  return renderLegal('contact', {
    children: (
      <section className="mt-8 border-t border-line pt-6">
        <h2 className="font-display text-[20px] font-extrabold uppercase tracking-[-0.02em] text-fg">
          {m.formTitle}
        </h2>
        <p className="mt-1 mb-5 text-[14px] leading-6 text-fg-muted">{m.formIntro}</p>
        <ContactForm />
      </section>
    ),
  })
}
