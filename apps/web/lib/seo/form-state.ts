/** Client-safe state for the DMCA and contact forms (`useActionState`). */
export type FormState =
  | { status: 'idle' }
  | { status: 'ok'; id: number; email: string }
  | { status: 'error'; message: string; fields?: Record<string, string> }

export const IDLE: FormState = { status: 'idle' }
