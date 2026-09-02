import { messages } from '@palscans/core/messages'
import { getDb, users } from '@palscans/db'
import { eq } from 'drizzle-orm'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { avatarUrl } from '@/lib/auth/media'
import { deletionPurgeAt, nextUsernameChangeAt } from '@/lib/auth/users'
import { THEME_COOKIE } from '@/lib/theme'
import { PageTitle, Section } from '../_components/Section'
import {
  AvatarForm,
  DeleteAccountForm,
  ExportButton,
  ProfileForm,
  ResendVerificationButton,
  ThemePicker,
  UsernameForm,
} from '../_components/SettingsForms'
import { requireAccount } from '../_lib'

export const metadata: Metadata = { title: messages.me.settings.title }

export default async function SettingsPage() {
  const user = await requireAccount('/me/settings')
  const db = await getDb()
  const [row] = await db
    .select({
      email: users.email,
      username: users.username,
      displayName: users.displayName,
      bio: users.bio,
      avatarKey: users.avatarKey,
      safeMode: users.safeMode,
      emailVerifiedAt: users.emailVerifiedAt,
      passwordHash: users.passwordHash,
      usernameChangedAt: users.usernameChangedAt,
      deletionRequestedAt: users.deletionRequestedAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1)
  if (!row) notFound()
  const themeCookie = (await cookies()).get(THEME_COOKIE)?.value
  const theme = themeCookie === 'light' ? 'light' : themeCookie === 'dark' ? 'dark' : 'system'
  const purgeAt = deletionPurgeAt(row.deletionRequestedAt)

  return (
    <>
      <PageTitle title={messages.me.settings.title} />
      <div className="flex flex-col gap-6">
        <Section title={messages.me.settings.profile}>
          <div className="flex flex-col gap-6">
            <AvatarForm
              name={row.displayName || row.username || '?'}
              src={avatarUrl(row.avatarKey)}
            />
            <ProfileForm
              initial={{
                displayName: row.displayName ?? '',
                bio: row.bio ?? '',
                safeMode: row.safeMode,
              }}
            />
          </div>
        </Section>

        <Section id="username" title={messages.me.settings.username}>
          <UsernameForm
            current={row.username ?? ''}
            nextChangeAt={nextUsernameChangeAt(row.usernameChangedAt)?.toISOString() ?? null}
          />
        </Section>

        <Section id="email" title={messages.me.settings.email}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-fg">{row.email}</p>
              <p className="text-[12px] text-fg-muted">
                {row.emailVerifiedAt ? (
                  <span className="text-ok">{messages.me.settings.verified}</span>
                ) : (
                  <span className="text-warn">{messages.me.settings.unverified}</span>
                )}
                {' · '}
                {messages.me.settings.memberSince}{' '}
                <time dateTime={row.createdAt.toISOString()}>
                  {row.createdAt.toISOString().slice(0, 10)}
                </time>
              </p>
            </div>
            {row.emailVerifiedAt ? null : <ResendVerificationButton />}
          </div>
        </Section>

        <Section
          id="appearance"
          title={messages.me.settings.appearance}
          description={messages.account.theme}
        >
          <ThemePicker initial={theme} />
        </Section>

        <Section
          id="privacy"
          title={messages.me.settings.privacy}
          description={messages.me.settings.exportHint}
          action={<ExportButton />}
        >
          <p className="text-[13px] text-fg-muted">{messages.me.settings.export}</p>
        </Section>

        <Section
          id="delete"
          title={messages.me.settings.deleteTitle}
          description={messages.me.settings.deleteHint}
        >
          <DeleteAccountForm
            hasPassword={!!row.passwordHash}
            scheduledFor={purgeAt?.toISOString() ?? null}
          />
        </Section>
      </div>
    </>
  )
}
