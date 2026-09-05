'use client'

import type { Feature } from '@palscans/core'
import { messages } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button, useToast } from '@palscans/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { CreateUserInput } from '@/app/admin/users/schemas'
import { postJson } from '@/components/admin/client/api'
import { Toggle } from '@/components/admin/client/controls'
import { Field, Hint, inputClass, Panel, PanelHeader, selectClass } from '@/components/admin/ui'

export function NewUserForm({
  roles,
  features,
  canGrant,
}: {
  roles: string[]
  features: Feature[]
  canGrant: boolean
}) {
  const m = adminMessages.admin.users
  const router = useRouter()
  const { toast } = useToast()
  const [form, setForm] = useState<CreateUserInput>({
    email: '',
    username: undefined,
    password: undefined,
    role: 'user',
    verified: true,
    entitlements: [],
  })
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const valid =
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email) && (!password || password.length >= 10)

  const submit = async () => {
    setBusy(true)
    const res = await postJson<{ id: number }>('/api/admin/users', {
      ...form,
      username: username.trim() || undefined,
      password: password || undefined,
    })
    setBusy(false)
    if (!res.ok) {
      toast({ title: adminMessages.admin.errorSaving, description: res.message, tone: 'danger' })
      return
    }
    toast({ title: m.newUserCreated, tone: 'ok' })
    router.push(`/admin/users/${res.data.id}`)
  }

  return (
    <div className="grid max-w-4xl items-start gap-3.5 lg:grid-cols-2">
      <Panel>
        <PanelHeader title={m.newUserCredentials} />
        <div className="flex flex-col gap-3">
          <Field label={m.newUserEmail} htmlFor="nu-email">
            <input
              id="nu-email"
              type="email"
              autoComplete="off"
              className={inputClass}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label={m.newUserUsername} htmlFor="nu-username" hint={messages.auth.usernameRule}>
            <input
              id="nu-username"
              autoComplete="off"
              className={inputClass}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>
          <Field label={m.newUserPassword} htmlFor="nu-password" hint={m.newUserPasswordHint}>
            <input
              id="nu-password"
              type="password"
              autoComplete="new-password"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        </div>
      </Panel>

      <div className="flex flex-col gap-3.5">
        <Panel>
          <PanelHeader title={m.role} hint={m.newUserRoleHint} />
          <div className="flex flex-col gap-3">
            <Field label={m.role} htmlFor="nu-role" className="max-w-48">
              <select
                id="nu-role"
                className={selectClass}
                value={form.role}
                onChange={(e) =>
                  setForm({ ...form, role: e.target.value as CreateUserInput['role'] })
                }
              >
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex items-start justify-between gap-4 border-t border-line-soft pt-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] font-semibold">{m.newUserVerified}</span>
                <Hint>{m.newUserVerifiedHint}</Hint>
              </div>
              <Toggle
                checked={form.verified}
                ariaLabel={m.newUserVerified}
                onChange={(v) => setForm({ ...form, verified: v })}
              />
            </div>
          </div>
        </Panel>

        {canGrant ? (
          <Panel>
            <PanelHeader title={m.newUserEntitlements} hint={m.newUserEntitlementsHint} />
            <div className="grid grid-cols-2 gap-1.5">
              {features.map((f) => (
                <label key={f} className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-[var(--color-brand)]"
                    checked={form.entitlements.includes(f)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        entitlements: e.target.checked
                          ? [...form.entitlements, f]
                          : form.entitlements.filter((x) => x !== f),
                      })
                    }
                  />
                  {f}
                </label>
              ))}
            </div>
          </Panel>
        ) : null}

        <div className="flex gap-2">
          <Button disabled={!valid || busy} onClick={() => void submit()}>
            {busy ? adminMessages.admin.saving : m.newUserCreate}
          </Button>
          <Button href="/admin/users" variant="outline">
            {messages.common.cancel}
          </Button>
        </div>
      </div>
    </div>
  )
}
