'use client'

import { COMMENT_MAX_CHARS, type CommentBody, hasSpoiler, plainText } from '@palscans/core/comments'
import { fmt, messages } from '@palscans/core/messages'
import { Avatar, Button, cn, Sheet, useToast } from '@palscans/ui'
import { AtSign, Bold, EyeOff, Images, Italic, Search, Strikethrough, X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { api } from '@/lib/comments/client'
import { parseMarkup } from '@/lib/comments/markup'
import type { CommentImage, CommentThreadConfig, CommentViewer } from '@/lib/comments/types'
import { TurnstileWidget } from './TurnstileWidget'

export interface ComposerSubmission {
  body: CommentBody
  imageId: number | null
  isSpoiler: boolean
  /** Turnstile token when the widget is shown (docs/14 §2 step 3). */
  turnstile?: string
}

/** `'challenge'`: the server wants a Turnstile token — the composer shows the widget and keeps the text. */
export type ComposerResult = boolean | 'challenge'

export interface ComposerProps {
  viewer: CommentViewer | null
  config: CommentThreadConfig
  mode?: 'new' | 'reply' | 'edit'
  initialText?: string
  initialImage?: CommentImage | null
  placeholder?: string
  autoFocus?: boolean
  /** Resolve true to clear the editor. */
  onSubmit: (s: ComposerSubmission) => Promise<ComposerResult>
  onCancel?: () => void
}

interface MentionHit {
  id: number
  username: string
  displayName: string
  avatarUrl: string | null
}

const toolButton =
  'inline-flex size-11 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-brand-wash hover:text-fg disabled:opacity-40'

/**
 * The composer (docs/14 §1): bold · italic · strike · spoiler · image from the collection ·
 * GIF (Premium) · mention typeahead · 2,000-character live counter. It is a textarea with
 * lightweight markup so it works on every phone; `parseMarkup` turns it into the body.
 */
export function Composer({
  viewer,
  config,
  mode = 'new',
  initialText = '',
  initialImage = null,
  placeholder,
  autoFocus,
  onSubmit,
  onCancel,
}: ComposerProps) {
  const { toast } = useToast()
  const [text, setText] = useState(initialText)
  const [image, setImage] = useState<CommentImage | null>(initialImage)
  const [busy, setBusy] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [hits, setHits] = useState<MentionHit[]>([])
  const [hitIndex, setHitIndex] = useState(0)
  const [challenge, setChallenge] = useState(config.challenge && mode !== 'edit')
  const [token, setToken] = useState<string | null>(null)
  const [widgetReset, setWidgetReset] = useState(0)
  const ref = useRef<HTMLTextAreaElement>(null)
  const listId = useId()
  const widget = !!config.turnstileSiteKey && challenge

  const max = config.maxChars || COMMENT_MAX_CHARS
  const length = text.length
  const over = length > max

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(400, el.scrollHeight)}px`
  }, [])

  // mention typeahead: the `@word` right before the caret
  useEffect(() => {
    if (mentionQuery === null) {
      setHits([])
      return
    }
    const q = mentionQuery
    const t = window.setTimeout(async () => {
      const res = await api<{ users: MentionHit[] }>(
        `/api/comments/mentions?q=${encodeURIComponent(q)}`,
      )
      if (res.ok) {
        setHits(res.data.users)
        setHitIndex(0)
      }
    }, 180)
    return () => window.clearTimeout(t)
  }, [mentionQuery])

  const updateMention = useCallback((value: string, caret: number) => {
    const before = value.slice(0, caret)
    const m = /(?:^|[\s([])@([A-Za-z0-9_.]{1,32})$/.exec(before)
    setMentionQuery(m?.[1] ?? null)
  }, [])

  const wrapSelection = (open: string, close = open) => {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = text.slice(start, end)
    const next = `${text.slice(0, start)}${open}${selected}${close}${text.slice(end)}`
    setText(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = selected ? end + open.length + close.length : start + open.length
      el.setSelectionRange(pos, pos)
    })
  }

  const insertAtCaret = (snippet: string) => {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart
    const next = `${text.slice(0, start)}${snippet}${text.slice(el.selectionEnd)}`
    setText(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + snippet.length, start + snippet.length)
    })
  }

  const pickMention = (hit: MentionHit) => {
    const el = ref.current
    if (!el) return
    const caret = el.selectionStart
    const before = text.slice(0, caret).replace(/@[A-Za-z0-9_.]{0,32}$/, `@${hit.username} `)
    const next = before + text.slice(caret)
    setText(next)
    setMentionQuery(null)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(before.length, before.length)
    })
  }

  const submit = async () => {
    if (busy || over) return
    const body = parseMarkup(text, { imageId: image?.id ?? null })
    const plain = plainText(body)
    if (!plain.trim() && !image) return
    setBusy(true)
    try {
      const result = await onSubmit({
        body,
        imageId: image?.id ?? null,
        isSpoiler: hasSpoiler(body),
        turnstile: widget && token ? token : undefined,
      })
      if (result === 'challenge') setChallenge(true)
      if (result === true) {
        setText('')
        setImage(null)
        if (ref.current) ref.current.style.height = 'auto'
      }
      // tokens are single-use: ask the widget for a fresh one either way
      if (widget || result === 'challenge') {
        setToken(null)
        setWidgetReset((n) => n + 1)
      }
    } finally {
      setBusy(false)
    }
  }

  if (!viewer) {
    return (
      <div className="flex min-h-[96px] flex-col justify-center gap-3 rounded-[12px] border border-line bg-surface-1 px-4 py-3 text-sm text-fg-muted sm:flex-row sm:items-center sm:justify-between">
        <span>{messages.comments.signInToComment}</span>
        <span className="flex gap-2">
          <Button href="/login?next=%23comments" size="sm">
            {messages.commentThread.signIn}
          </Button>
          <Button href="/register" size="sm" variant="outline">
            {messages.commentThread.createAccount}
          </Button>
        </span>
      </div>
    )
  }
  if (!viewer.verified) {
    return (
      <div className="flex min-h-[96px] flex-col justify-center gap-3 rounded-[12px] border border-line bg-surface-1 px-4 py-3 text-sm text-fg-muted sm:flex-row sm:items-center sm:justify-between">
        <span>{messages.comments.verifyToComment}</span>
        <Button href="/verify" size="sm" variant="outline">
          {messages.commentThread.verifyEmail}
        </Button>
      </div>
    )
  }

  const compact = mode !== 'new'
  return (
    <div className={cn('flex items-start gap-3', compact && 'gap-2.5')}>
      {mode !== 'edit' ? (
        <Avatar
          name={viewer.displayName}
          src={viewer.avatarUrl}
          size={compact ? 32 : 40}
          className="border-2 border-line"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'relative flex flex-col rounded-[12px] border border-line bg-surface-1 focus-within:border-brand',
            !compact && 'min-h-[96px]',
          )}
        >
          <textarea
            ref={ref}
            value={text}
            // biome-ignore lint/a11y/noAutofocus: only set for reply/edit boxes the reader just opened
            autoFocus={autoFocus}
            aria-label={messages.comments.placeholder}
            aria-autocomplete="list"
            aria-controls={hits.length ? listId : undefined}
            placeholder={placeholder ?? messages.commentThread.composerPlaceholder}
            rows={compact ? 2 : 2}
            onChange={(e) => {
              setText(e.target.value)
              updateMention(e.target.value, e.target.selectionStart)
              e.target.style.height = 'auto'
              e.target.style.height = `${Math.min(400, e.target.scrollHeight)}px`
            }}
            onKeyDown={(e) => {
              if (hits.length && mentionQuery !== null) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setHitIndex((i) => (i + 1) % hits.length)
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setHitIndex((i) => (i - 1 + hits.length) % hits.length)
                  return
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  const hit = hits[hitIndex]
                  if (hit) {
                    e.preventDefault()
                    pickMention(hit)
                    return
                  }
                }
                if (e.key === 'Escape') {
                  setMentionQuery(null)
                  return
                }
              }
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                void submit()
              }
              if (e.key === 'Escape' && onCancel) onCancel()
            }}
            onBlur={() => window.setTimeout(() => setMentionQuery(null), 150)}
            className="min-h-[52px] w-full resize-none bg-transparent px-3.5 pb-2 pt-3 text-sm leading-5 text-fg outline-none placeholder:text-fg-muted"
          />
          {hits.length && mentionQuery !== null ? (
            <div
              id={listId}
              role="listbox"
              className="absolute left-3 top-full z-20 mt-1 w-64 overflow-hidden rounded-[10px] border border-line bg-surface-2 py-1 shadow-2"
            >
              {hits.map((h, i) => (
                <button
                  key={h.id}
                  type="button"
                  role="option"
                  aria-selected={i === hitIndex}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickMention(h)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                    i === hitIndex ? 'bg-brand-wash text-fg' : 'text-fg-muted hover:bg-surface-3',
                  )}
                >
                  <Avatar name={h.displayName} src={h.avatarUrl} size={22} />
                  <span className="font-semibold">@{h.username}</span>
                  <span className="truncate text-[12px] text-fg-subtle">{h.displayName}</span>
                </button>
              ))}
            </div>
          ) : null}
          {image ? (
            <div className="relative mx-3.5 mb-2 w-fit overflow-hidden rounded-md border border-line">
              <img
                src={image.src}
                alt=""
                width={Math.min(160, image.width)}
                height={Math.round((Math.min(160, image.width) / image.width) * image.height)}
                className="block h-auto"
              />
              <button
                type="button"
                onClick={() => setImage(null)}
                aria-label={messages.commentThread.removeImage}
                className="absolute right-1 top-1 inline-flex size-6 items-center justify-center rounded-full bg-bg/80 text-fg hover:bg-danger hover:text-white"
              >
                <X size={12} />
              </button>
            </div>
          ) : null}
          <div className="flex h-11 items-center gap-0.5 border-t border-line pl-1 pr-1.5">
            <button
              type="button"
              title={messages.commentThread.bold}
              className={toolButton}
              onClick={() => wrapSelection('**')}
            >
              <Bold size={16} />
            </button>
            <button
              type="button"
              title={messages.commentThread.italic}
              className={toolButton}
              onClick={() => wrapSelection('*')}
            >
              <Italic size={16} />
            </button>
            <button
              type="button"
              title={messages.commentThread.strike}
              className={toolButton}
              onClick={() => wrapSelection('~~')}
            >
              <Strikethrough size={16} />
            </button>
            <button
              type="button"
              title={messages.commentThread.spoiler}
              className={toolButton}
              onClick={() => wrapSelection('||')}
            >
              <EyeOff size={16} />
            </button>
            {config.imagesEnabled && mode !== 'edit' ? (
              <button
                type="button"
                title={messages.commentThread.image}
                className={cn(toolButton, 'hidden sm:inline-flex')}
                onClick={() => setPickerOpen(true)}
              >
                <Images size={16} />
              </button>
            ) : null}
            {mode !== 'edit' ? (
              <button
                type="button"
                title={messages.commentThread.gif}
                className={cn(toolButton, 'hidden sm:inline-flex')}
                onClick={() => {
                  if (
                    config.customGifs === 'all' ||
                    (config.customGifs === 'premium' && viewer.canUseCustomGifs)
                  )
                    setPickerOpen(true)
                  else
                    toast({
                      title: messages.commentThread.gifPremium,
                      description: messages.premium.pitch,
                    })
                }}
              >
                <span className="inline-flex h-[18px] items-center rounded-[5px] border-[1.5px] border-current px-[5px] text-[10px] font-bold leading-none tracking-[0.04em]">
                  GIF
                </span>
              </button>
            ) : null}
            <button
              type="button"
              title={messages.commentThread.mention}
              className={toolButton}
              onClick={() => {
                insertAtCaret('@')
                setMentionQuery('')
              }}
            >
              <AtSign size={16} />
            </button>
            <div className="flex-1" />
            <span
              className={cn(
                'mr-2.5 text-[12px] font-medium tabular-nums',
                over ? 'text-danger' : 'text-fg-muted',
              )}
              aria-live="polite"
            >
              {fmt(messages.comments.charCount, {
                n: length.toLocaleString('en'),
                max: max.toLocaleString('en'),
              })}
            </span>
            {onCancel ? (
              <Button type="button" variant="ghost" size="sm" onClick={onCancel} className="mr-1">
                {messages.commentThread.cancelEdit}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              className="h-[34px] rounded-[9px] px-[18px]"
              disabled={busy || over || (!text.trim() && !image)}
              onClick={() => void submit()}
            >
              {busy
                ? messages.commentThread.optimisticPending
                : mode === 'edit'
                  ? messages.commentThread.saveEdit
                  : mode === 'reply'
                    ? messages.comments.reply
                    : messages.comments.post}
            </Button>
          </div>
        </div>
        {widget && config.turnstileSiteKey ? (
          <TurnstileWidget
            siteKey={config.turnstileSiteKey}
            onToken={setToken}
            onExpire={() => setToken(null)}
            resetKey={widgetReset}
          />
        ) : null}
        {mode === 'new' ? (
          <p className="mt-1 text-[12px] leading-4 text-fg-muted">
            {messages.commentThread.composerHint}
          </p>
        ) : null}
      </div>
      <ImagePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(img) => setImage(img)}
      />
    </div>
  )
}

interface PickerImage extends CommentImage {
  tags: string[]
}

function ImagePicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (img: CommentImage) => void
}) {
  const [q, setQ] = useState('')
  const [images, setImages] = useState<PickerImage[] | null>(null)
  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(async () => {
      const res = await api<{ images: PickerImage[] }>(
        `/api/comments/images${q ? `?q=${encodeURIComponent(q)}` : ''}`,
      )
      setImages(res.ok ? res.data.images : [])
    }, 150)
    return () => window.clearTimeout(t)
  }, [open, q])
  return (
    <Sheet open={open} onClose={onClose} title={messages.commentThread.imagePickerTitle}>
      <div className="flex flex-col gap-3 p-4">
        <label className="flex h-10 items-center gap-2 rounded-[10px] border border-line bg-surface-1 px-3 text-fg-muted focus-within:border-brand">
          <Search size={16} aria-hidden="true" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={messages.commentThread.imageSearch}
            className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted"
          />
        </label>
        {images === null ? (
          <p className="py-8 text-center text-sm text-fg-muted">{messages.common.loading}</p>
        ) : images.length === 0 ? (
          <p className="py-8 text-center text-sm text-fg-muted">
            {messages.commentThread.imagePickerEmpty}
          </p>
        ) : (
          <ul className="grid max-h-[50dvh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
            {images.map((img) => (
              <li key={img.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(img)
                    onClose()
                  }}
                  className="block w-full overflow-hidden rounded-md border border-line bg-surface-1 hover:border-brand"
                >
                  <img
                    src={img.src}
                    alt={img.tags.join(', ')}
                    width={img.width}
                    height={img.height}
                    loading="lazy"
                    className="aspect-square h-auto w-full object-cover"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  )
}
