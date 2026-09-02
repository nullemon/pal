import { ToastProvider } from '@palscans/ui'
import type { ReactNode } from 'react'

/**
 * Chrome for the staff sign-in. It lives in its own route group so it escapes
 * `app/admin/layout.tsx`, which gates every panel route behind `admin.access` and would
 * otherwise bounce this page to the reader login. Deliberately plain: no collage, no
 * marketing — a control-panel door, not a shop front.
 */
export default function StaffLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <div className="grid min-h-dvh place-items-center bg-bg px-5 py-10">
        <main id="main" className="w-full max-w-[400px]">
          {children}
        </main>
      </div>
    </ToastProvider>
  )
}
