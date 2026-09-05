'use client'

import { messages } from '@palscans/core/messages'

/**
 * The last resort: a failure in the root layout itself, above `(site)/error.tsx`. Next
 * replaces the whole document here, so this file must supply its own `<html>` and `<body>`
 * and cannot rely on the theme tokens, the fonts or any component — the layout that would
 * have provided them is the thing that failed. Hence the inline styles and the plain markup:
 * it has to render when nothing else does.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const m = messages.errors
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#100d17',
          color: '#efeaf7',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          padding: '24px',
        }}
      >
        <main style={{ maxWidth: '38rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '28px', margin: '0 0 12px', fontWeight: 800 }}>{m.errorTitle}</h1>
          <p style={{ margin: '0 0 20px', lineHeight: 1.6, color: '#a79fc0' }}>{m.errorBody}</p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: '#7c3aed',
              color: '#ffffff',
              border: 0,
              borderRadius: '8px',
              padding: '10px 18px',
              fontSize: '15px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {m.errorRetry}
          </button>
          {error.digest ? (
            <p style={{ marginTop: '24px', fontSize: '12px', color: '#6f6890' }}>{error.digest}</p>
          ) : null}
        </main>
      </body>
    </html>
  )
}
