# 14 — Comment system

A first-party comment system on series and chapter pages with the full feature set readers
expect from the reference site, backed by a moderation pipeline that holds anything risky
before it is seen. No third-party embed: comments are content, they affect page speed and
SEO, and moderation has to be in the same admin panel as everything else.

## 1. What readers get

| Feature | Behaviour |
|---|---|
| Where | Every series page and every chapter page; a per-series and per-chapter toggle, and a global kill switch |
| Who | Signed-in users with a verified email. No guest comments — it is where spam comes from |
| Composer | Rich text: **bold**, *italic*, ~~strike~~, `spoiler` (blurred until tapped), links (held for review — see §3), mentions `@username` with typeahead, one image from the **community collection** per comment, custom GIF upload for Premium. 2,000-character limit, live counter |
| Threads | Top-level comments and one level of replies (reply-to-reply quotes the target and stays in the same thread). Deep nesting is unreadable on a phone |
| Reactions | Six: upvote · funny · love · surprised · angry · sad. One of each per user per comment; counts shown; tapping your own removes it |
| Sorting | **Best** (score with a time decay, default) · Newest · Oldest; replies always chronological |
| Score | `upvotes + weighted positive reactions − reports·k`; comments below a threshold collapse to a "show anyway" line rather than disappearing |
| Pinned | Staff can pin one comment per page to the top |
| Staff and mod styling | Admin and moderator comments carry a role badge and a subtle gradient row so official answers are visible at a glance |
| Premium perks | **Priority placement**: among comments with equal score, Premium sorts first; **see who reacted**: Premium can open the reactor list; custom GIFs; animated avatar shows in the comment |
| Edit / delete | Edit within 15 minutes (shows "edited"); delete any time — replaced by "[deleted]" if it has replies, removed outright if not |
| Report | One tap with a reason: spam · harassment · spoiler without tag · off-topic · illegal · other. Reporter never sees the outcome directly; the comment hides for them immediately |
| Block user | Hides that user's comments and replies for the blocker everywhere; the blocked user is not told |
| Mentions | `@username` notifies the mentioned user (rate-limited to 5 mentions per comment) |
| Notifications | Reply to your comment, mention, reaction milestones (grouped: "12 people reacted") |
| Loading | First 20 comments server-rendered for SEO and speed; "Load more" fetches the next page; new comments appear via a lightweight poll every 60s while the tab is visible |
| Highlighting | Deep links `#comment-<id>` scroll to and highlight the comment; used by notifications and by reports in admin |

Rendering: bodies are stored as **structured JSON** (see `02-data-model.md`) and rendered by
walking a whitelist of node types. There is no HTML in the database and no sanitiser on the
read path to get wrong.

## 2. Moderation pipeline

Every comment passes through this on submit, in order, before anyone else sees it:

```
submit
 ├─ 1. account gate      verified email · not comment-banned · not banned · account age ≥ N min
 ├─ 2. rate limit        per user (e.g. 5/min, 60/hour), stricter for accounts < 7 days old
 ├─ 3. Turnstile         invisible challenge for accounts < 7 days or after a rate-limit hit
 ├─ 4. link policy       any URL → status = pending (default), unless domain allowlisted or author is staff
 ├─ 5. word filters      block list → rejected with a reason · hold list → pending · replace list → masked
 ├─ 6. automod rules     scoring heuristics (§4) → publish · hold · shadow
 ├─ 7. duplicate check   same body from same user in 10 min, or same body across users → hold
 └─ publish | pending | shadow | rejected
```

`published` is visible to everyone. `pending` is visible only to its author (marked "awaiting
review") and sits in the moderation queue. `shadow` is visible only to its author with no
marker — for persistent spammers, so they do not create a new account. `rejected` returns
an inline reason to the author.

### Links are held by default

This is the single most effective spam control on a site like this and it is on from day
one. A comment containing a URL, a bare domain (`example.com`), an obfuscated one
(`example[dot]com`, `hxxp://`), a Discord invite, or a Telegram handle goes to `pending`.
Staff comments and an admin-managed **domain allowlist** (your own domain, Discord, the
group's socials) bypass it. Approving a held link once does not allowlist the domain —
that is a separate, deliberate action in the queue.

## 3. Moderation queue (Admin → Community → Comments)

One queue with tabs — **Pending · Reported · Flagged · All** — each row showing the
comment in context (series/chapter, parent comment if a reply, author card with account
age, comment count, prior actions, and the automod score with the rules that fired).

Actions, keyboard-driven (`j`/`k` move, `a` approve, `r` reject, `d` delete, `b` ban menu):

- **Approve** · **Approve and allowlist domain** · **Reject with reason** · **Delete**
- **Edit** (staff edits are marked and audited)
- **Pin** / **Lock thread** (no new replies) / **Lock page** (no new comments on this chapter)
- **User**: warn (sends a notice) · comment-ban 1d / 7d / 30d / permanent · shadow-ban ·
  ban account · block IP/ASN · view all comments by this user · bulk delete this user's
  last N comments
- **Bulk**: select many → approve / reject / delete / ban authors

Every action writes to `audit_log`. Reports resolve automatically when the comment is
actioned; a report on an approved comment stays visible as history on the author card.

### Settings (Admin → Community → Comment settings)

| Setting | Default |
|---|---|
| Comments enabled (global) | on |
| Require verified email | on |
| Minimum account age to comment | 10 minutes |
| Hold comments containing links | **on** |
| Domain allowlist | palscans.org, discord.gg/<your invite> |
| Hold comments from accounts younger than | 24 hours (first 3 comments held) |
| Images allowed | community collection: on · custom GIFs: Premium only |
| Max mentions per comment | 5 |
| Edit window | 15 minutes |
| Collapse threshold | score ≤ −5 |
| Rate limits | 5/min, 60/hour; new accounts 2/min, 20/hour |
| Word filters | block / hold / replace lists, regex allowed, with a test box |
| Automod | rule toggles and thresholds (§4) |
| Auto-lock chapters older than | off (optionally 180 days) |
| Report threshold for auto-hide | 5 unique reporters, or 2 if any is Premium |

## 4. Automod rules

Each rule adds to a score; thresholds decide publish / hold / shadow. All tunable, all
logged with the comment so a moderator sees *why* it was held.

| Rule | Signal |
|---|---|
| New account | age < 24h (+3), < 7d (+1) |
| Link present | +5 (held regardless — see §2) |
| Repeated text | same body posted before (+4), near-duplicate by trigram similarity (+3) |
| Shouting | > 70% uppercase over 20+ chars (+1) |
| Character spam | runs of the same character ≥ 8 (+1), excessive emoji (+1) |
| Mention flood | > 3 mentions (+2) |
| Velocity | > 3 comments in 60s (+3) |
| Reported history | author has ≥ 2 actioned reports in 30 days (+3) |
| Reputation credit | account > 90 days with ≥ 50 published comments (−3); Premium (−1) |

Thresholds: score ≥ 6 → hold; ≥ 10 and author has prior actioned reports → shadow.

## 5. Community image collection

Readers can attach an image from a curated collection (reaction images, panels the site is
allowed to use). Staff upload and tag them in **Admin → Community → Images**; readers
search by tag in the composer. User-uploaded custom GIFs (Premium) pass through the image
pipeline (re-encoded, EXIF stripped, size-capped at 2 MB / 480 px) and land in a
**pending images** tab until approved the first time; approved uploads are reusable by that
user. Every image has a takedown button that also removes it from every comment using it.

## 6. Abuse controls that are not in the queue

- IP and ASN hashing on every comment for pattern detection; raw IPs are never stored.
- Shadow-banned users see their comments normally; nobody else does.
- A user who is blocked by ≥ 10 distinct accounts in 7 days is auto-flagged for review.
- Report abuse: a reporter whose reports are rejected ≥ 5 times in 30 days has their reports
  deprioritised.
- Turnstile on the composer for new accounts, and site-wide when an attack is detected
  (a "lockdown" toggle in settings that holds every new comment).

## 7. Data model additions

```sql
CREATE TYPE comment_status AS ENUM ('published','pending','shadow','rejected','removed');

ALTER TABLE comments
  ADD COLUMN status        comment_status NOT NULL DEFAULT 'published',
  ADD COLUMN automod_score smallint NOT NULL DEFAULT 0,
  ADD COLUMN automod_rules text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN has_link      boolean NOT NULL DEFAULT false,
  ADD COLUMN image_id      bigint,                      -- community_images.id
  ADD COLUMN ip_hash       bytea,
  ADD COLUMN locked        boolean NOT NULL DEFAULT false;
CREATE INDEX ON comments (status, created_at DESC) WHERE status IN ('pending','shadow');

CREATE TABLE comment_edits (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  comment_id bigint NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  editor_id  bigint NOT NULL REFERENCES users(id),
  body       jsonb NOT NULL,                             -- the previous body
  edited_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE comment_mentions (
  comment_id bigint NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (comment_id, user_id)
);

CREATE TABLE user_blocks (
  blocker_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE community_images (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key         text NOT NULL,                             -- object key
  width       integer NOT NULL, height integer NOT NULL,
  tags        text[] NOT NULL DEFAULT '{}',
  uploaded_by bigint REFERENCES users(id),
  status      text NOT NULL DEFAULT 'pending',           -- pending | approved | removed
  is_collection boolean NOT NULL DEFAULT false,          -- curated vs a user's own GIF
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON community_images USING gin (tags) WHERE status = 'approved';

CREATE TABLE word_filters (
  id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pattern text NOT NULL,                                 -- literal or regex
  is_regex boolean NOT NULL DEFAULT false,
  action  text NOT NULL,                                 -- block | hold | replace
  replacement text,
  created_by bigint REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE link_allowlist (
  domain     citext PRIMARY KEY,
  created_by bigint REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE comment_settings (                          -- singleton key/value like seo_settings
  key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);

-- comment_reactions and reports already exist in 02-data-model.md;
-- users.comment_banned_until and audit_log are already there too.
```

## 8. API

```
GET    /api/comments?target=chapter:59310&sort=best&cursor=…     public, cached 60s
POST   /api/comments                       {target, parent_id?, body, image_id?}
PATCH  /api/comments/:id                   {body}                      within edit window
DELETE /api/comments/:id
POST   /api/comments/:id/reactions         {kind}      DELETE …/reactions/:kind
POST   /api/comments/:id/report            {reason, detail?}
GET    /api/comments/:id/reactors          Premium or staff
POST   /api/users/:id/block                DELETE /api/users/:id/block
GET    /api/community-images?q=tag         approved collection
POST   /api/community-images               Premium upload → pending

Admin:
GET    /api/admin/comments?status=pending|reported|flagged&…
POST   /api/admin/comments/:id/{approve|reject|delete|pin|lock|shadow}
POST   /api/admin/comments/bulk            {ids, action}
POST   /api/admin/users/:id/{warn|comment-ban|shadow-ban|ban}
CRUD   /api/admin/word-filters, /api/admin/link-allowlist, /api/admin/comment-settings
```

All mutating routes go through the permission wrapper from `04-admin-panel.md`; the
public routes check the account gate and rate limits in Redis before touching Postgres.

## 9. Performance and SEO

- The first page of comments is server-rendered into the chapter/series HTML, so it counts
  as content and paints without JavaScript; the composer and reactions hydrate as an island.
- Comment pages are cached for 60s at the edge and invalidated on publish/approve.
- Reaction counts are denormalised on `comments` and reconciled nightly, like the other
  counters.
- User-generated links are `rel="nofollow ugc"` always, even when allowlisted.
