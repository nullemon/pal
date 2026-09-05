import { messages } from '@palscans/core/messages'
import { Mail } from 'lucide-react'
import { turnstileSiteKey } from '@/lib/auth/turnstile'
import { DMCA_AGENT } from '@/lib/seo/legal'
import { legalMetadata, renderLegal } from '@/lib/seo/legal-page'
import { DmcaForm } from './DmcaForm'

export const revalidate = 300

export const generateMetadata = () => legalMetadata('dmca')

const m = messages.legal.dmca

/** /dmca — the policy text, the designated agent's details and the structured notice form (docs/07). */
export default async function DmcaPage() {
  // Read on the server and handed down: the site key is public, but sourcing it from the
  // admin panel means enabling bot protection takes a revalidation, not a deploy.
  const siteKey = await turnstileSiteKey()
  return renderLegal('dmca', {
    aside: (
      <section className="rounded-lg border border-line bg-surface-1 p-5">
        <h2 className="font-display text-[15px] font-extrabold uppercase tracking-[-0.01em] text-fg">
          {m.agentTitle}
        </h2>
        <p className="mt-1 text-[13px] leading-5 text-fg-muted">{m.agentIntro}</p>
        <dl className="mt-3 flex flex-col gap-2 text-[14px]">
          <div>
            <dt className="text-[12px] font-semibold uppercase tracking-[0.06em] text-fg-subtle">
              {m.agentTitle}
            </dt>
            <dd className="text-fg">{DMCA_AGENT.name}</dd>
          </div>
          <div>
            <dt className="text-[12px] font-semibold uppercase tracking-[0.06em] text-fg-subtle">
              Email
            </dt>
            <dd>
              <a
                href={`mailto:${DMCA_AGENT.email}`}
                className="inline-flex items-center gap-1.5 text-brand-hover hover:underline"
              >
                <Mail size={14} aria-hidden="true" />
                {DMCA_AGENT.email}
              </a>
            </dd>
          </div>
        </dl>
      </section>
    ),
    children: (
      <section className="mt-8 border-t border-line pt-6">
        <h2 className="font-display text-[20px] font-extrabold uppercase tracking-[-0.02em] text-fg">
          {m.formTitle}
        </h2>
        <p className="mt-1 mb-5 text-[14px] leading-6 text-fg-muted">{m.formIntro}</p>
        <DmcaForm turnstileSiteKey={siteKey} />
      </section>
    ),
  })
}
