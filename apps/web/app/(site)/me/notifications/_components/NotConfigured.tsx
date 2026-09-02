import { messages } from '@palscans/core/messages'
import { AlertCircle } from 'lucide-react'

/**
 * The state every unconfigured integration shows (docs/17 §D: "clear 'not configured'
 * states"). It names the environment variables that are missing so the operator knows what
 * to set, and it is a plain notice — never a control that pretends to work.
 */
export function NotConfigured({ missing }: { missing: readonly string[] }) {
  return (
    <div className="flex items-start gap-2.5 rounded-md border border-line bg-surface-2 p-3 text-[13px] text-fg-muted">
      <AlertCircle size={15} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
      <div>
        <span className="font-semibold text-fg">{messages.notify.notConfigured}</span>
        {missing.length > 0 ? (
          <p className="mt-0.5">
            {messages.notify.notConfiguredHint.replace('{keys}', missing.join(', '))}
          </p>
        ) : null}
      </div>
    </div>
  )
}
