'use client'

import { fmt } from '@palscans/core/messages'
import { adminMessages } from '@palscans/core/messages/admin'
import { Button } from '@palscans/ui'
import { ExternalLink } from 'lucide-react'
import { useId } from 'react'
import {
  Field,
  inputClass,
  Panel,
  PanelHeader,
  selectClass,
  textareaClass,
} from '@/components/admin/ui'
import { AI_CRAWLERS, DEFAULT_ROBOTS, robotsTxt } from '@/lib/seo/robots'
import type {
  SeoFeeds,
  SeoIdentity,
  SeoIndexing,
  SeoRobots,
  SeoSettings,
  SeoVerification,
} from '@/lib/seo/settings'
import { FormGrid, numberValue, SwitchRow } from './shared'

const m = adminMessages.adminSeo

export function IdentityPanel({
  value,
  onChange,
}: {
  value: SeoIdentity
  onChange: (v: Partial<SeoIdentity>) => void
}) {
  const id = useId()
  return (
    <Panel>
      <PanelHeader title={m.identity.title} hint={m.identity.hint} />
      <FormGrid>
        <Field label={m.identity.siteName} htmlFor={`${id}-name`}>
          <input
            id={`${id}-name`}
            className={inputClass}
            value={value.site_name}
            onChange={(e) => onChange({ site_name: e.target.value })}
          />
        </Field>
        <Field label={m.identity.separator} htmlFor={`${id}-sep`}>
          <select
            id={`${id}-sep`}
            className={selectClass}
            value={value.separator}
            onChange={(e) => onChange({ separator: e.target.value as SeoIdentity['separator'] })}
          >
            {(['·', '—', '|'] as const).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={m.identity.defaultDescription}
          className="md:col-span-2"
          htmlFor={`${id}-desc`}
        >
          <textarea
            id={`${id}-desc`}
            rows={2}
            className={textareaClass}
            value={value.default_description}
            onChange={(e) => onChange({ default_description: e.target.value })}
          />
        </Field>
        <Field
          label={m.identity.defaultOgImage}
          hint={m.identity.defaultOgImageHint}
          htmlFor={`${id}-og`}
        >
          <input
            id={`${id}-og`}
            className={inputClass}
            value={value.default_og_image_key ?? ''}
            placeholder="brand/og-default.png"
            onChange={(e) => onChange({ default_og_image_key: e.target.value || null })}
          />
        </Field>
        <Field label={m.identity.logo} htmlFor={`${id}-logo`}>
          <input
            id={`${id}-logo`}
            className={inputClass}
            value={value.logo_key ?? ''}
            placeholder="brand/logo.png"
            onChange={(e) => onChange({ logo_key: e.target.value || null })}
          />
        </Field>
        <Field label={m.identity.xHandle} htmlFor={`${id}-x`}>
          <input
            id={`${id}-x`}
            className={inputClass}
            value={value.x_handle ?? ''}
            placeholder="@palscans"
            onChange={(e) => onChange({ x_handle: e.target.value || null })}
          />
        </Field>
        <Field label={m.identity.sameAs} hint={m.identity.sameAsHint} htmlFor={`${id}-same`}>
          <textarea
            id={`${id}-same`}
            rows={6}
            className={textareaClass}
            value={value.same_as.join('\n')}
            onChange={(e) =>
              onChange({
                same_as: e.target.value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>
      </FormGrid>
    </Panel>
  )
}

export function VerificationPanel({
  value,
  onChange,
}: {
  value: SeoVerification
  onChange: (v: Partial<SeoVerification>) => void
}) {
  const id = useId()
  const fields = [
    ['google', m.verification.google, 'google-site-verification'],
    ['bing', m.verification.bing, 'msvalidate.01'],
    ['yandex', m.verification.yandex, 'yandex-verification'],
    ['pinterest', m.verification.pinterest, 'p:domain_verify'],
  ] as const
  return (
    <Panel>
      <PanelHeader title={m.verification.title} hint={m.verification.hint} />
      <FormGrid>
        {fields.map(([key, label, meta]) => (
          <Field key={key} label={label} hint={`<meta name="${meta}">`} htmlFor={`${id}-${key}`}>
            <input
              id={`${id}-${key}`}
              className={inputClass}
              value={value[key] ?? ''}
              autoComplete="off"
              onChange={(e) => onChange({ [key]: e.target.value || null })}
            />
          </Field>
        ))}
      </FormGrid>
    </Panel>
  )
}

export function IndexingPanel({
  value,
  onChange,
}: {
  value: SeoIndexing
  onChange: (v: Partial<SeoIndexing>) => void
}) {
  return (
    <Panel>
      <PanelHeader title={m.indexing.title} hint={m.indexing.hint} />
      <SwitchRow
        label={m.indexing.site}
        hint={m.indexing.siteHint}
        checked={value.site}
        onChange={(site) => onChange({ site })}
      />
      <SwitchRow
        label={m.indexing.chapters}
        hint={m.indexing.chaptersHint}
        checked={value.chapters}
        onChange={(chapters) => onChange({ chapters })}
      />
      <SwitchRow
        label={m.indexing.profiles}
        checked={value.profiles}
        onChange={(profiles) => onChange({ profiles })}
      />
      <SwitchRow
        label={m.indexing.browseFilters}
        hint={m.indexing.browseFiltersHint}
        checked={value.browse_filters}
        onChange={(browse_filters) => onChange({ browse_filters })}
      />
    </Panel>
  )
}

export function FeedsPanel({
  value,
  onChange,
  origin,
}: {
  value: SeoFeeds
  onChange: (v: Partial<SeoFeeds>) => void
  origin: string
}) {
  const id = useId()
  const routes = [
    '/feed',
    '/feed/series',
    '/series/<slug>/feed',
    '/genres/<slug>/feed',
    '/announcements/feed',
  ]
  return (
    <Panel>
      <PanelHeader title={m.feeds.title} hint={m.feeds.hint} />
      <SwitchRow
        label={m.feeds.enabled}
        hint={m.feeds.enabledHint}
        checked={value.enabled}
        onChange={(enabled) => onChange({ enabled })}
      />
      <SwitchRow
        label={m.feeds.includeEarlyAccess}
        hint={m.feeds.includeEarlyAccessHint}
        checked={value.include_early_access}
        onChange={(include_early_access) => onChange({ include_early_access })}
      />
      <FormGrid className="mt-4">
        <Field label={m.feeds.customUrl} hint={m.feeds.customUrlHint} htmlFor={`${id}-url`}>
          <input
            id={`${id}-url`}
            className={inputClass}
            type="url"
            value={value.custom_url ?? ''}
            placeholder="https://feeds.example.com/palscans"
            onChange={(e) => onChange({ custom_url: e.target.value || null })}
          />
        </Field>
        <Field label={m.feeds.items} htmlFor={`${id}-items`}>
          <input
            id={`${id}-items`}
            className={inputClass}
            type="number"
            min={5}
            max={200}
            value={value.items}
            onChange={(e) => onChange({ items: numberValue(e.target.value, 50) })}
          />
        </Field>
      </FormGrid>
      <div className="mt-4 flex flex-col gap-1">
        <span className="text-[12px] font-medium text-fg-muted">{m.feeds.routes}</span>
        <ul className="flex flex-wrap gap-1.5">
          {routes.map((r) => {
            const real = !r.includes('<')
            const cls =
              'inline-flex h-7 items-center gap-1 rounded-md border border-line bg-bg px-2 font-mono text-[12px] text-fg-muted'
            return (
              <li key={r}>
                {real ? (
                  <a
                    href={`${origin}${r}`}
                    target="_blank"
                    rel="noopener"
                    className={`${cls} hover:text-fg`}
                  >
                    {r}
                    <ExternalLink size={11} aria-hidden="true" />
                  </a>
                ) : (
                  <span className={cls}>{r}</span>
                )}
              </li>
            )
          })}
          <li>
            <span className="inline-flex h-7 items-center rounded-md border border-line bg-bg px-2 font-mono text-[12px] text-fg-subtle">
              ?format=atom
            </span>
          </li>
        </ul>
      </div>
    </Panel>
  )
}

export function RobotsPanel({
  value,
  onChange,
  settings,
  origin,
}: {
  value: SeoRobots
  onChange: (v: Partial<SeoRobots>) => void
  settings: SeoSettings
  origin: string
}) {
  const id = useId()
  const preview = robotsTxt({ ...settings, robots: value }, origin)
  return (
    <Panel>
      <PanelHeader
        title={m.robots.title}
        hint={m.robots.hint}
        aside={
          <Button variant="outline" size="sm" onClick={() => onChange({ custom: null })}>
            {m.robots.useDefault}
          </Button>
        }
      />
      <SwitchRow
        label={m.robots.disallowAi}
        hint={fmt(m.robots.disallowAiHint, { n: AI_CRAWLERS.length })}
        checked={value.disallow_ai}
        onChange={(disallow_ai) => onChange({ disallow_ai })}
      />
      <FormGrid className="mt-4">
        <Field label={m.robots.custom} htmlFor={`${id}-rules`}>
          <textarea
            id={`${id}-rules`}
            rows={14}
            spellCheck={false}
            className={`${textareaClass} font-mono text-[12px]`}
            value={value.custom ?? DEFAULT_ROBOTS}
            onChange={(e) => onChange({ custom: e.target.value })}
          />
        </Field>
        <Field label={m.robots.preview}>
          <pre className="max-h-[336px] overflow-auto rounded-md border border-line bg-bg p-3 font-mono text-[12px] leading-5 text-fg-muted">
            {preview}
          </pre>
        </Field>
      </FormGrid>
    </Panel>
  )
}
